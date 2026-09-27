/**
 * Where the startable and replacement lines sit per position, on a season
 * per-game basis — a port of FCCore `Baselines` and `FlexDemand`.
 */
import type { Position } from './Position'
import { accepts, dedicatedCounts, isFlex, type SlotTemplate } from './RosterSlots'
import type { SeasonProfile } from './SeasonProfile'
import { roundAwayFromZero } from './rounding'

export interface PositionBaseline {
  position: Position
  /** How many of this position the league starts. */
  starters: number
  /** Season pace of the last player the league actually starts. */
  startLine: number
  /** The next player down; `undefined` when the pool isn't that deep. */
  replacementLine?: number
  pool: number
}

export type Baselines = Partial<Record<Position, PositionBaseline>>

/** Below this, a per-game average is one hot afternoon. */
export const MINIMUM_GAMES_FOR_LINE = 3

/**
 * Season-pace baselines. Flex is excluded from the counts on purpose (mildly
 * conservative); lines stay at full precision so the Nth-best player clears his
 * own line.
 */
export function seasonPaceBaselines(players: readonly SeasonProfile[], template: SlotTemplate, teamCount: number, minimumGames = MINIMUM_GAMES_FOR_LINE): Baselines {
  if (teamCount <= 0) return {}
  const byPosition: Partial<Record<Position, number[]>> = {}
  for (const p of players) if (p.games >= minimumGames) (byPosition[p.position] ??= []).push(p.pointsPerGame)
  return baselineLines(byPosition, template, teamCount)
}

/**
 * The same Nth-best construction over any per-position values. `flexDemand`
 * adds starters per team from flex slots as the league fills them — a superflex
 * league needs it.
 */
export function baselineLines(
  byPosition: Partial<Record<Position, readonly number[]>>, template: SlotTemplate, teamCount: number,
  flexDemand: Partial<Record<Position, number>> = {},
): Baselines {
  if (teamCount <= 0) return {}
  const counts = dedicatedCounts(template)
  const out: Baselines = {}
  for (const [position, values] of Object.entries(byPosition) as [Position, number[]][]) {
    const perTeam = (counts[position] ?? 0) + (flexDemand[position] ?? 0)
    const starters = roundAwayFromZero(perTeam * teamCount)
    if (starters <= 0 || values.length === 0) continue
    const descending = [...values].sort((a, b) => b - a)
    const startLine = starters - 1 < descending.length ? descending[starters - 1]! : descending[descending.length - 1]!
    const baseline: PositionBaseline = { position, starters, startLine, pool: descending.length }
    if (starters < descending.length) baseline.replacementLine = descending[starters]
    out[position] = baseline
  }
  return out
}

/**
 * How flex slots are actually filled, as extra starters per team per position,
 * measured from the managers' own lineups. `lineups` align with the template.
 */
export function observedFlexDemand(template: SlotTemplate, lineups: readonly (readonly (Position | undefined)[])[]): Partial<Record<Position, number>> {
  if (lineups.length === 0) return {}
  const filled: Partial<Record<Position, number>> = {}
  let observedSlots = 0
  for (const lineup of lineups) {
    template.starters.forEach((slot, i) => {
      if (!isFlex(slot) || i >= lineup.length) return
      const position = lineup[i]
      if (position === undefined || !accepts(slot, position)) return
      filled[position] = (filled[position] ?? 0) + 1
      observedSlots++
    })
  }
  // An empty flex slot on some teams still exists on every team.
  const flexCount = template.starters.filter(isFlex).length
  if (flexCount === 0 || observedSlots === 0) return {}
  const scale = (flexCount * lineups.length) / observedSlots
  const out: Partial<Record<Position, number>> = {}
  for (const [p, n] of Object.entries(filled) as [Position, number][]) out[p] = (n * scale) / lineups.length
  return out
}
