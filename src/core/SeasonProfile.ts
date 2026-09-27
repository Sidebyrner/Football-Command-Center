/**
 * One player's season as the acquisition board and baselines see it — a port
 * of FCCore `SeasonProfile` and `SeasonScan`. Everything here already
 * happened: no forecast, no blended composite.
 */
import { distributionOfWeeks } from './Distribution'
import type { Position } from './Position'
import { scoreSeason, type ScoredWeek } from './ScoringEngine'
import type { ScoringProfile } from './ScoringProfile'
import type { WeeklyFile } from './WeeklyStats'

export interface SeasonProfile {
  gsisID: string
  name: string
  position: Position
  /** Most recent team, nflverse dialect. */
  team?: string
  games: number
  pointsPerGame: number
  /** Points per game over the last `formWeeks` games played. */
  formPointsPerGame?: number
  floor?: number
  ceiling?: number
  median?: number
  targetShare?: number
  recentTargetShare?: number
  airYardsShare?: number
  weeks: ScoredWeek[]
}

/** How many recent games count as "form". */
export const FORM_WEEKS = 4

/** Mean over values that exist — a missing column isn't a zero. */
export function meanOfPresent(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => v !== undefined && Number.isFinite(v))
  return present.length ? present.reduce((s, v) => s + v, 0) / present.length : undefined
}

/** Scores every player in a weekly file (QB/RB/WR/TE/K only). */
export function runSeasonScan(file: WeeklyFile, profile: ScoringProfile, formWeeks = FORM_WEEKS): SeasonProfile[] {
  const out: SeasonProfile[] = []
  for (const player of file.allPlayers()) {
    const { rows, position } = player
    if (!position || rows.length === 0) continue
    const season = scoreSeason(rows, profile, position)
    if (season.games === 0 || season.pointsPerGame === undefined) continue
    const recent = formWeeks > 0 ? rows.slice(-formWeeks) : []
    const form = scoreSeason(recent, profile, position)
    const d = distributionOfWeeks(season.weeks)
    out.push({
      gsisID: player.gsisID,
      name: player.meta?.name ?? player.gsisID,
      position,
      team: rows[rows.length - 1]?.team,
      games: season.games,
      pointsPerGame: season.pointsPerGame,
      formPointsPerGame: form.pointsPerGame,
      floor: d.floor,
      ceiling: d.ceiling,
      median: d.median,
      targetShare: meanOfPresent(rows.map((r) => r.value('targetShare'))),
      recentTargetShare: meanOfPresent(recent.map((r) => r.value('targetShare'))),
      airYardsShare: meanOfPresent(rows.map((r) => r.value('airYardsShare'))),
      weeks: season.weeks,
    })
  }
  return out
}
