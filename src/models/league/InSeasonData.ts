/**
 * Everything forward-looking or current-season, assembled once per context —
 * a port of FCApp `InSeasonData`. Every member is optional: a screen must
 * render without any of them.
 */
import type { DepthChartFile, PracticeReport, TeamContextFile, UsageFile } from '@core/InSeasonFiles'
import type { Provenance } from '@data/fetched'
import { played, scoreLine, type SleeperProjection, type SleeperWeekStat } from '@data/insightsModels'

export interface InSeasonData {
  /** Rotowire's projected lines for the current week, by Sleeper id. */
  projections: ReadonlyMap<string, SleeperProjection>
  /** Sleeper's actual lines, week → Sleeper id. Covers DEF and IDP. */
  weekStats: ReadonlyMap<number, ReadonlyMap<string, SleeperWeekStat>>
  /** The official injury report for the current week, by gsis id. */
  practiceReports: ReadonlyMap<string, PracticeReport>
  depthCharts?: DepthChartFile
  usage?: UsageFile
  teamContext?: TeamContextFile
  sleeperProvenance?: Provenance
  filesProvenance?: Provenance
  /** Sources asked for and not read, in words. */
  unavailable: string[]
  projectionSourceLabel?: string
}

export const EMPTY_IN_SEASON: InSeasonData = {
  projections: new Map(), weekStats: new Map(), practiceReports: new Map(), unavailable: [],
}

export const hasProjections = (d: InSeasonData) => d.projections.size > 0

export const statWeeks = (d: InSeasonData) => [...d.weekStats.keys()].sort((a, b) => a - b)

/** A player's lines so far this season, ascending by week. */
export function statLines(d: InSeasonData, sleeperID: string): SleeperWeekStat[] {
  return statWeeks(d).map((w) => d.weekStats.get(w)?.get(sleeperID)).filter((l): l is SleeperWeekStat => l !== undefined)
}

/** Points per game from Sleeper's lines — the only production DEF and IDP have. */
export function sleeperPointsPerGame(d: InSeasonData, sleeperID: string, scoring: Readonly<Record<string, number>>): number | undefined {
  const lines = statLines(d, sleeperID).filter(played)
  if (lines.length === 0) return undefined
  return lines.reduce((s, l) => s + scoreLine(l, scoring).points, 0) / lines.length
}

/** Projected points this week; `undefined` when there's no projection. */
export function projectedPoints(d: InSeasonData, sleeperID: string, scoring: Readonly<Record<string, number>>): number | undefined {
  const p = d.projections.get(sleeperID)
  return p ? scoreLine(p, scoring).points : undefined
}
