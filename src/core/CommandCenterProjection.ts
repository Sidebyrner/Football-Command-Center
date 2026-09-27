/**
 * The Command Center's own projection — a port of FCCore
 * `CommandCenterProjection`. A separate, named number that never blends with
 * Rotowire's. The formula, so it can be argued with:
 *
 *     pace     = w × thisSeason + (1 − w) × prior,  w = games / (games + 4)
 *     usage    = clamp(recent xFP / season xFP, 0.8 … 1.2)
 *     schedule = clamp(1 + 0.5 × (allowed − average) / average, 0.75 … 1.25)
 *     weekly   = pace × usage × schedule(this opponent)
 *     ROS/gm   = pace × usage × mean(schedule(each remaining opponent))
 */
import type { Position } from './Position'
import { roundHalfUp } from './rounding'

export interface CommandCenterInputs {
  position?: Position
  /** This season's points per game in the league's scoring, and the games behind it. */
  thisSeasonPointsPerGame?: number
  thisSeasonGames: number
  lastSeasonPointsPerGame?: number
  /** The prior for someone with no last season. */
  replacementLine?: number
  expectedPointsRecent?: number
  expectedPointsSeason?: number
  opponentAllowedPerGame?: number
  leagueAverageAllowed?: number
  remainingOpponents?: { allowed: number; average: number }[]
}

export interface ProjectionFactor {
  name: string
  /** A multiplier, or for the pace the points it starts from. */
  value: number
  detail: string
}

export interface CommandCenterProjection {
  weekly?: number
  restOfSeasonPerGame?: number
  pace?: number
  factors: ProjectionFactor[]
  /** Why there's no number, when there's none. */
  note?: string
}

export const REGRESSION_GAMES = 4
export const USAGE_BOUNDS: [number, number] = [0.8, 1.2]
export const SCHEDULE_BOUNDS: [number, number] = [0.75, 1.25]
export const SCHEDULE_WEIGHT = 0.5
export const PROJECTION_SOURCE_LABEL = 'Command Center projection'

export const isValued = (p: CommandCenterProjection) => p.weekly !== undefined

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(Math.max(v, lo), hi)
const f1 = (v: number) => v.toFixed(1)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function scheduleFactor(allowed: number, average: number): number {
  if (!(average > 0)) return 1
  return clamp(1 + (SCHEDULE_WEIGHT * (allowed - average)) / average, SCHEDULE_BOUNDS)
}

export function projectCommandCenter(inputs: CommandCenterInputs): CommandCenterProjection {
  const factors: ProjectionFactor[] = []
  const prior = inputs.lastSeasonPointsPerGame ?? inputs.replacementLine
  const priorName = inputs.lastSeasonPointsPerGame !== undefined ? 'last season' : 'the replacement line'
  const thisSeason = inputs.thisSeasonPointsPerGame
  let pace: number
  if (thisSeason !== undefined && prior !== undefined) {
    const games = Math.max(0, inputs.thisSeasonGames)
    const weight = games / (games + REGRESSION_GAMES)
    pace = weight * thisSeason + (1 - weight) * prior
    factors.push({
      name: 'Pace', value: pace,
      detail: `${f1(thisSeason)} this season over ${plural(inputs.thisSeasonGames, 'game')}, regressed ${((1 - weight) * 100).toFixed(0)}% toward ${f1(prior)} (${priorName})`,
    })
  } else if (thisSeason !== undefined) {
    pace = thisSeason
    factors.push({ name: 'Pace', value: thisSeason, detail: `${f1(thisSeason)} this season over ${plural(inputs.thisSeasonGames, 'game')}, nothing to regress toward` })
  } else if (prior !== undefined) {
    pace = prior
    factors.push({
      name: 'Pace', value: prior,
      detail: inputs.lastSeasonPointsPerGame !== undefined
        ? `no games yet this season — last season's ${f1(prior)}`
        : `no line either season — the replacement line, ${f1(prior)}`,
    })
  } else {
    return { factors: [], note: 'No points per game this season or last, and no replacement line at his position.' }
  }

  let usage = 1
  const { expectedPointsRecent: recent, expectedPointsSeason: season } = inputs
  if (recent !== undefined && season !== undefined && season > 0) {
    usage = clamp(recent / season, USAGE_BOUNDS)
    factors.push({ name: 'Usage', value: usage, detail: `expected points last 4 (${f1(recent)}) against the season (${f1(season)})` })
  } else {
    factors.push({ name: 'Usage', value: 1, detail: 'no expected-points data — no adjustment' })
  }

  let thisWeek = 1
  const { opponentAllowedPerGame: allowed, leagueAverageAllowed: average } = inputs
  if (allowed !== undefined && average !== undefined) {
    thisWeek = scheduleFactor(allowed, average)
    factors.push({ name: 'Matchup', value: thisWeek, detail: `opponent allows ${f1(allowed)} pts/gm to his position against a ${f1(average)} average` })
  } else {
    factors.push({ name: 'Matchup', value: 1, detail: 'no defense-vs-position for this opponent — no adjustment' })
  }

  const remaining = (inputs.remainingOpponents ?? []).map((o) => scheduleFactor(o.allowed, o.average))
  const rosSchedule = remaining.length ? remaining.reduce((s, v) => s + v, 0) / remaining.length : 1
  if (remaining.length) {
    factors.push({ name: 'Remaining schedule', value: rosSchedule, detail: `mean matchup factor over ${plural(remaining.length, 'remaining game')}` })
  }
  return {
    weekly: roundHalfUp(pace * usage * thisWeek, 1),
    restOfSeasonPerGame: roundHalfUp(pace * usage * rosSchedule, 1),
    pace: roundHalfUp(pace, 2),
    factors,
  }
}
