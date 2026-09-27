/**
 * What a team is missing and what it could spare, as named facts — a port of
 * FCCore `TeamNeeds`. The vocabulary a trade is built from; nothing is folded
 * into one "trade value".
 */
import type { Baselines } from './Baselines'
import type { ByeCalendar } from './ByeWeeks'
import { crunchOutlook, eligibilityKey, shortDedicatedPositions, type RosterEntry } from './ByeCrunch'
import { hasWeeklyProductionData, type Position } from './Position'
import { dedicatedCounts, type SlotTemplate } from './RosterSlots'

export type NeedKind =
  /** Weeks the team can't fill a slot these positions could fill. */
  | { kind: 'shortWeeks'; weeks: number[] }
  /** A starter below the league's start line at his position. */
  | { kind: 'weakStarter'; playerID: string; gap: number }

export interface Need {
  positions: ReadonlySet<Position>
  kind: NeedKind
  /** Only a flex group is short, not a dedicated slot. */
  viaFlex: boolean
}

export function needID(n: Need): string {
  const names = eligibilityKey(n.positions)
  return n.kind.kind === 'shortWeeks' ? `short-${names}-${n.viaFlex}-${n.kind.weeks.join(',')}` : `weak-${names}-${n.kind.playerID}`
}

export const needWeeks = (n: Need) => (n.kind.kind === 'shortWeeks' ? n.kind.weeks : undefined)

export interface SurplusPlayer {
  playerID: string
  position: Position
  /** Season points per game; `undefined` for DEF, IDP or no line. */
  value?: number
  aboveReplacement: boolean
  /** Remaining weeks his team plays. */
  playsWeeks: number[]
}

/** A position with no production data can only offer depth. */
export const isDepthOnly = (s: SurplusPlayer) => !hasWeeklyProductionData(s.position)

export interface TeamNeeds {
  needs: Need[]
  surplus: SurplusPlayer[]
}

export const needsAt = (t: TeamNeeds, p: Position) => t.needs.filter((n) => n.positions.has(p))
export const surplusAt = (t: TeamNeeds, ps: ReadonlySet<Position>) => t.surplus.filter((s) => ps.has(s.position))

export interface BuildNeedsInput {
  roster: readonly RosterEntry[]
  /** Positionally aligned; `"0"` for unset. */
  starters: readonly string[]
  template: SlotTemplate
  /** Season points per game — absent means no line. */
  values: Readonly<Record<string, number>>
  baselines: Baselines
  calendar: ByeCalendar
  weeks: readonly number[]
  includeFlexStarters?: boolean
}

export function buildTeamNeeds({ roster, starters, template, values, baselines, calendar, weeks, includeFlexStarters = false }: BuildNeedsInput): TeamNeeds {
  const needs: Need[] = []
  const outlook = crunchOutlook(roster, template, calendar, weeks)
  const dedicatedWeeks = new Map<Position, number[]>()
  const flexWeeks = new Map<string, { eligible: ReadonlySet<Position>; weeks: number[] }>()
  for (const week of [...weeks].sort((a, b) => a - b)) {
    const report = outlook.get(week)
    if (!report) continue
    for (const p of shortDedicatedPositions(report)) {
      if (!dedicatedWeeks.has(p)) dedicatedWeeks.set(p, [])
      dedicatedWeeks.get(p)!.push(week)
    }
    for (const g of report.flexGroups) {
      if (g.shortfall <= 0) continue
      const key = [...g.eligible].sort().join('')
      if (!flexWeeks.has(key)) flexWeeks.set(key, { eligible: g.eligible, weeks: [] })
      flexWeeks.get(key)!.weeks.push(week)
    }
  }
  for (const [p, list] of [...dedicatedWeeks].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    needs.push({ positions: new Set([p]), kind: { kind: 'shortWeeks', weeks: list }, viaFlex: false })
  }
  for (const [, g] of [...flexWeeks].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    needs.push({ positions: g.eligible, kind: { kind: 'shortWeeks', weeks: g.weeks }, viaFlex: true })
  }

  const entryByID = new Map<string, RosterEntry>()
  for (const e of roster) if (!entryByID.has(e.id)) entryByID.set(e.id, e)
  template.starters.forEach((slot, index) => {
    if (index >= starters.length) return
    const id = starters[index]!
    const value = id === '0' ? undefined : values[id]
    if (value === undefined) return
    if (slot.dedicated) {
      const line = baselines[slot.dedicated]?.startLine
      if (line !== undefined && value < line) {
        needs.push({ positions: new Set([slot.dedicated]), kind: { kind: 'weakStarter', playerID: id, gap: line - value }, viaFlex: false })
      }
    } else if (includeFlexStarters) {
      const position = entryByID.get(id)?.position
      const line = position ? baselines[position]?.startLine : undefined
      if (line !== undefined && value < line) {
        needs.push({ positions: slot.eligible, kind: { kind: 'weakStarter', playerID: id, gap: line - value }, viaFlex: true })
      }
    }
  })

  // Surplus: bench players where the dedicated slots are already covered.
  const starting = new Set(starters.filter((s) => s !== '0'))
  const required = dedicatedCounts(template)
  const surplus: SurplusPlayer[] = []
  for (const entry of roster) {
    if (starting.has(entry.id) || entry.position === undefined) continue
    const position = entry.position
    const atPosition = roster.filter((e) => e.position === position).length
    if (atPosition <= (required[position] ?? 0)) continue
    const value = values[entry.id]
    const replacement = baselines[position]?.replacementLine
    const s: SurplusPlayer = {
      playerID: entry.id, position,
      aboveReplacement: value !== undefined && replacement !== undefined && value >= replacement,
      playsWeeks: weeks.filter((w) => !calendar.isOnBye(entry.team, w)),
    }
    if (value !== undefined) s.value = value
    surplus.push(s)
  }
  surplus.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  return { needs, surplus }
}
