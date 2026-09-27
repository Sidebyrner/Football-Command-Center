/**
 * The cohort grade, situation chips and the opt-in composite — a port of
 * FCCore `PlayerGrade`. Every metric is computed from real current-season
 * data; a player with no value for a metric isn't ranked on it.
 */
import type { Position } from './Position'
import { percentileRank } from './Percentile'
import { roundAwayFromZero } from './rounding'
import type { ScoringProfile } from './ScoringProfile'

/** Declaration order matches Swift's `GradeMetric.allCases`. */
export const GRADE_METRICS = [
  'pointsPerGame', 'snapShare', 'expectedPointsPerGame',
  'touchesPerGame', 'rushAttemptsPerGame', 'targetShare', 'targetsPerGame', 'airYardsShare', 'redZoneTouchesPerGame',
  'yardsPerTarget', 'catchRate', 'dropRate', 'yardsBeforeContact', 'yardsAfterContact', 'brokenTacklesPerTouch',
  'passerRating', 'completionPct', 'yardsPerAttempt', 'interceptionRate', 'sackRate',
  'fieldGoalPct', 'fieldGoalAttemptsPerGame',
  'pointsAllowedPerGame', 'takeawaysPerGame', 'defensiveSacksPerGame',
  'tacklesPerGame', 'defensiveSnapShare', 'sacksPerGame', 'passesDefendedPerGame',
] as const
export type GradeMetric = (typeof GRADE_METRICS)[number]

/** Lower is better. */
export const isInverted = (m: GradeMetric) => m === 'dropRate' || m === 'interceptionRate' || m === 'sackRate' || m === 'pointsAllowedPerGame'

export const GRADE_METRIC_LABEL: Readonly<Record<GradeMetric, string>> = {
  pointsPerGame: 'Points per game', snapShare: 'Snap share', expectedPointsPerGame: 'Expected points per game',
  touchesPerGame: 'Touches per game', rushAttemptsPerGame: 'Rush attempts per game', targetShare: 'Target share',
  targetsPerGame: 'Targets per game', airYardsShare: 'Air yards share', redZoneTouchesPerGame: 'Red zone touches per game',
  yardsPerTarget: 'Yards per target', catchRate: 'Catch rate', dropRate: 'Drop rate',
  yardsBeforeContact: 'Yards before contact', yardsAfterContact: 'Yards after contact', brokenTacklesPerTouch: 'Broken tackles per touch',
  passerRating: 'Passer rating', completionPct: 'Completion %', yardsPerAttempt: 'Yards per attempt',
  interceptionRate: 'Interception rate', sackRate: 'Sack rate',
  fieldGoalPct: 'Field goal %', fieldGoalAttemptsPerGame: 'FG attempts per game',
  pointsAllowedPerGame: 'Points allowed per game', takeawaysPerGame: 'Takeaways per game', defensiveSacksPerGame: 'Sacks per game',
  tacklesPerGame: 'Tackles per game', defensiveSnapShare: 'Defensive snap share', sacksPerGame: 'Sacks per game',
  passesDefendedPerGame: 'Passes defended per game',
}

const USAGE_SOURCED: ReadonlySet<GradeMetric> = new Set(['snapShare', 'expectedPointsPerGame', 'yardsBeforeContact', 'yardsAfterContact', 'brokenTacklesPerTouch', 'dropRate'])
export const gradeMetricSource = (m: GradeMetric) => (USAGE_SOURCED.has(m) ? 'nflverse snap counts, pfr and ffopportunity' : 'Sleeper stat lines')

export type GradeWeightTable = Partial<Record<GradeMetric, number>>

/** The position models' weights. */
export function weeklyGradeWeights(position: Position): GradeWeightTable {
  switch (position) {
    case 'QB': return { passerRating: 12, completionPct: 9, yardsPerAttempt: 9, interceptionRate: 8, sackRate: 6, rushAttemptsPerGame: 7, pointsPerGame: 6, snapShare: 4 }
    case 'RB': return { touchesPerGame: 12, rushAttemptsPerGame: 10, snapShare: 9, expectedPointsPerGame: 9, redZoneTouchesPerGame: 8, targetShare: 7, yardsAfterContact: 7, brokenTacklesPerTouch: 6, yardsBeforeContact: 5, pointsPerGame: 5 }
    case 'WR': return { targetShare: 11, targetsPerGame: 9, airYardsShare: 8, expectedPointsPerGame: 8, redZoneTouchesPerGame: 7, yardsPerTarget: 7, snapShare: 6, catchRate: 6, dropRate: 4, pointsPerGame: 5 }
    case 'TE': return { targetShare: 12, targetsPerGame: 9, expectedPointsPerGame: 8, redZoneTouchesPerGame: 7, catchRate: 7, yardsPerTarget: 6, airYardsShare: 5, snapShare: 6, pointsPerGame: 5 }
    case 'K': return { fieldGoalPct: 10, pointsPerGame: 10, fieldGoalAttemptsPerGame: 6 }
    case 'DEF': return { pointsPerGame: 10, pointsAllowedPerGame: 8, takeawaysPerGame: 7, defensiveSacksPerGame: 6 }
    case 'LB': case 'DL': case 'DB': return { pointsPerGame: 10, tacklesPerGame: 9, defensiveSnapShare: 9, sacksPerGame: 6, passesDefendedPerGame: 5 }
  }
}

/** Nudges weights toward what the league pays for. Only existing metrics move. */
export function applyScoringProfile(weights: GradeWeightTable, profile: ScoringProfile): GradeWeightTable {
  const out = { ...weights }
  const bump = (m: GradeMetric, by: number) => {
    const current = out[m]
    if (current !== undefined) out[m] = Math.max(0, current + by)
  }
  const ppr = profile.receptionPoints
  if (ppr === 0) { bump('targetsPerGame', -2); bump('targetShare', -1); bump('yardsPerTarget', 2) }
  else if (ppr >= 1) { bump('targetsPerGame', 2); bump('catchRate', 1) }
  if (profile.incompletion <= -1) { bump('completionPct', 2); bump('sackRate', 1) }
  if (profile.interception <= -4) bump('interceptionRate', 2)
  if (profile.idpSack >= 3) bump('sacksPerGame', 3)
  if (profile.idpTackle <= 0) bump('tacklesPerGame', -4)
  return out
}

export interface GradeFactor {
  metric: GradeMetric
  value: number
  /** 0…1, already inverted for lower-is-better metrics. */
  percentile: number
  weight: number
  contribution: number
}

export interface PlayerGrade {
  score?: number
  coverage: number
  factors: GradeFactor[]
  missing: GradeMetric[]
  cohortSize: number
}

export const THIN_COVERAGE = 0.5
/** Cohorts smaller than this can't support a percentile. */
export const MINIMUM_COHORT = 12

export const isThin = (g: PlayerGrade) => g.coverage < THIN_COVERAGE

export function gradeTier(g: PlayerGrade): string | undefined {
  const s = g.score
  if (s === undefined) return undefined
  if (s >= 82) return 'Tier 1 — Elite'
  if (s >= 68) return 'Tier 2 — Strong'
  if (s >= 54) return 'Tier 3 — Solid'
  if (s >= 40) return 'Tier 4 — Depth'
  return 'Tier 5 — Speculative'
}

export const topFactors = (g: PlayerGrade) => [...g.factors].sort((a, b) => b.contribution - a.contribution)

/** `cohorts` must be sorted ascending. */
export function computePlayerGrade(
  metrics: Partial<Record<GradeMetric, number>>, cohorts: Partial<Record<GradeMetric, readonly number[]>>, weights: GradeWeightTable,
): PlayerGrade {
  let total = 0
  let used = 0
  let all = 0
  const factors: GradeFactor[] = []
  const missing: GradeMetric[] = []
  let largestCohort = 0
  for (const [metric, weight] of (Object.entries(weights) as [GradeMetric, number][]).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    all += weight
    const value = metrics[metric]
    const cohort = cohorts[metric]
    if (value === undefined || !Number.isFinite(value) || !cohort || cohort.length < MINIMUM_COHORT) {
      missing.push(metric)
      continue
    }
    largestCohort = Math.max(largestCohort, cohort.length)
    let percentile = percentileRank(value, cohort)
    if (isInverted(metric)) percentile = 1 - percentile
    percentile = Math.min(Math.max(percentile, 0), 1)
    factors.push({ metric, value, percentile, weight, contribution: percentile * weight })
    total += percentile * weight
    used += weight
  }
  const grade: PlayerGrade = { coverage: all > 0 ? used / all : 0, factors, missing, cohortSize: largestCohort }
  if (used > 0) grade.score = roundAwayFromZero((total / used) * 100)
  return grade
}

// MARK: - Situation

export const SITUATION_METRICS = [
  'passProtection', 'runBlocking', 'quarterbackPlay', 'targetCompetition', 'teamPace',
  'gameEnvironment', 'snapTrend', 'depthChartRank', 'airYardsShare', 'redZoneShare',
] as const
export type SituationMetric = (typeof SITUATION_METRICS)[number]

export const SITUATION: Readonly<Record<SituationMetric, { label: string; source: string; defaultWeight: number }>> = {
  passProtection: { label: 'OL pass protection', source: 'pfr pressure rate and sacks allowed, this season', defaultWeight: 5 },
  runBlocking: { label: 'OL run blocking', source: 'pfr yards before contact, this season', defaultWeight: 6 },
  quarterbackPlay: { label: 'QB play', source: 'ESPN Total QBR and passer rating, this season', defaultWeight: 8 },
  targetCompetition: { label: 'Target competition', source: 'share of team targets to the top two, Sleeper lines', defaultWeight: 4 },
  teamPace: { label: 'Team pace', source: 'offensive plays per game, nflverse', defaultWeight: 3 },
  gameEnvironment: { label: 'Game environment', source: 'implied team total this week, recorded closing lines', defaultWeight: 5 },
  snapTrend: { label: 'Snap trend', source: "last 3 games' snap share against the season, nflverse snap counts", defaultWeight: 6 },
  depthChartRank: { label: 'Depth chart', source: 'official depth chart, nflverse', defaultWeight: 4 },
  airYardsShare: { label: 'Air yards share', source: 'share of team air yards, Sleeper lines', defaultWeight: 8 },
  redZoneShare: { label: 'Red zone share', source: 'share of team red zone touches, Sleeper lines', defaultWeight: 7 },
}

export interface SituationChip {
  metric: SituationMetric
  value: number
  /** 0…1 against `comparedTo`; `undefined` when there's no set to compare against. */
  percentile?: number
  detail: string
  comparedTo: string
}

export interface WeightedGradePart {
  name: string
  percentile: number
  weight: number
  contribution: number
}

export interface WeightedGrade {
  score?: number
  coverage: number
  parts: WeightedGradePart[]
  missing: string[]
}

export const GRADE_KEY = 'cohortGrade'
export const DEFAULT_GRADE_WEIGHT = 40

/** The opt-in composite under visible weights, reporting its own coverage. */
export function computeWeightedGrade(grade: PlayerGrade | undefined, chips: readonly SituationChip[], weights: Readonly<Record<string, number>>): WeightedGrade {
  let total = 0
  let used = 0
  let all = 0
  const parts: WeightedGradePart[] = []
  const missing: string[] = []
  const part = (name: string, percentile: number, weight: number) => {
    parts.push({ name, percentile, weight, contribution: percentile * weight })
    total += percentile * weight
    used += weight
  }
  const gradeWeight = weights[GRADE_KEY] ?? DEFAULT_GRADE_WEIGHT
  if (gradeWeight > 0) {
    all += gradeWeight
    if (grade?.score !== undefined) part('Cohort grade', grade.score / 100, gradeWeight)
    else missing.push('Cohort grade')
  }
  for (const metric of SITUATION_METRICS) {
    const weight = weights[metric] ?? SITUATION[metric].defaultWeight
    if (!(weight > 0)) continue
    all += weight
    const percentile = chips.find((c) => c.metric === metric)?.percentile
    if (percentile !== undefined) part(SITUATION[metric].label, percentile, weight)
    else missing.push(SITUATION[metric].label)
  }
  const out: WeightedGrade = { coverage: all > 0 ? used / all : 0, parts: parts.sort((a, b) => b.contribution - a.contribution), missing }
  if (used > 0) out.score = roundAwayFromZero((total / used) * 100)
  return out
}
