/**
 * RB streaming model — a port of FCCore `RBStreamModel`. A two-stage
 * opportunity × conversion projection for one week, in the league's own
 * points: carries are the volume, rushing first downs the floor, touchdowns
 * the ceiling. Favorites run more. Every prior and knob is heuristic.
 */
import type { Position } from '../Position'
import { formatFixed } from '../numeric'
import { roundAwayFromZero } from '../rounding'
import {
  PLAY_PROBABILITY, PRACTICE_STATUS_LABEL, QUARTILE_Z, clamp, isStreamPractice, riskWeight, shrink, streamReport,
  type StreamComparison, type StreamPractice, type StreamProjection, type StreamReport, type StreamRiskMode,
  type StreamStatPoints,
} from '../Stream'

// MARK: - Roles

export const RB_ROLES = ['BELLCOW', 'LEAD', 'COMMITTEE', 'PASS_DOWN', 'GOAL_LINE'] as const
export type RBRole = (typeof RB_ROLES)[number]
export const isRBRole = (v: unknown): v is RBRole => RB_ROLES.includes(v as RBRole)

export const RB_ROLE_LABEL: Readonly<Record<RBRole, string>> = {
  BELLCOW: 'Bellcow', LEAD: 'Lead', COMMITTEE: 'Committee', PASS_DOWN: 'Pass-down', GOAL_LINE: 'Goal-line',
}
export const RB_ROLE_SUMMARY: Readonly<Record<RBRole, string>> = {
  BELLCOW: 'Workhorse, most carries and goal-line work',
  LEAD: 'Lead back in a two-man split',
  COMMITTEE: 'Shared backfield',
  PASS_DOWN: 'Third-down and two-minute back',
  GOAL_LINE: 'Short-yardage and goal-line back',
}

/** Team-share and per-carry / per-target priors for one role. */
export interface RBPrior {
  carryShare: number
  targetShare: number
  yardsPerCarry: number
  rushFirstDowns: number
  rushTouchdowns: number
  run30: number
  run40: number
  run50: number
  catchRate: number
  yardsPerCatch: number
  catchFirstDowns: number
  catchTouchdowns: number
  /** Neutral share of team red-zone carries for the role. */
  redZoneShare: number
}

export const RB_PRIORS: Readonly<Record<RBRole, RBPrior>> = {
  BELLCOW: { carryShare: 0.62, targetShare: 0.11, yardsPerCarry: 4.3, rushFirstDowns: 0.24, rushTouchdowns: 0.030,
    run30: 0.010, run40: 0.0055, run50: 0.0030, catchRate: 0.77, yardsPerCatch: 8.0,
    catchFirstDowns: 0.24, catchTouchdowns: 0.020, redZoneShare: 0.60 },
  LEAD: { carryShare: 0.50, targetShare: 0.08, yardsPerCarry: 4.3, rushFirstDowns: 0.23, rushTouchdowns: 0.028,
    run30: 0.009, run40: 0.0050, run50: 0.0027, catchRate: 0.77, yardsPerCatch: 7.8,
    catchFirstDowns: 0.23, catchTouchdowns: 0.018, redZoneShare: 0.50 },
  COMMITTEE: { carryShare: 0.38, targetShare: 0.07, yardsPerCarry: 4.2, rushFirstDowns: 0.22, rushTouchdowns: 0.024,
    run30: 0.008, run40: 0.0045, run50: 0.0024, catchRate: 0.76, yardsPerCatch: 7.5,
    catchFirstDowns: 0.22, catchTouchdowns: 0.016, redZoneShare: 0.35 },
  PASS_DOWN: { carryShare: 0.20, targetShare: 0.10, yardsPerCarry: 4.5, rushFirstDowns: 0.20, rushTouchdowns: 0.018,
    run30: 0.009, run40: 0.0050, run50: 0.0027, catchRate: 0.80, yardsPerCatch: 8.2,
    catchFirstDowns: 0.26, catchTouchdowns: 0.018, redZoneShare: 0.15 },
  GOAL_LINE: { carryShare: 0.25, targetShare: 0.03, yardsPerCarry: 3.7, rushFirstDowns: 0.25, rushTouchdowns: 0.045,
    run30: 0.004, run40: 0.0020, run50: 0.0010, catchRate: 0.75, yardsPerCatch: 6.5,
    catchFirstDowns: 0.20, catchTouchdowns: 0.020, redZoneShare: 0.45 },
}

export const rbPrior = (role: RBRole): RBPrior => RB_PRIORS[role]

export const RB_KNOBS = {
  leagueAverageRushAttempts: 26.0,
  leagueAveragePassAttempts: 33.5,
  volumeShrinkGames: 3.0,
  rushTotalSlope: 0.004,
  /** Underdogs abandon the run. */
  rushSpreadSlope: -0.012,
  passTotalSlope: 0.006,
  passSpreadSlope: 0.008,
  environmentRange: [0.80, 1.20] as const,
  leagueAverageImplied: 22.5,
  impliedRange: [0.70, 1.35] as const,
  ypcShrinkK: 60.0,
  rushFirstDownShrinkK: 60.0,
  rushTouchdownShrinkK: 150.0,
  longRunShrinkK: 300.0,
  catchShrinkK: 20.0,
  yardsPerCatchShrinkK: 15.0,
  catchFirstDownShrinkK: 25.0,
  catchTouchdownShrinkK: 120.0,
  dvpFullWeightGames: 6.0,
  dvpCap: 0.15,
  lineCap: 0.25,
  redZoneMultCap: 0.60,
  /** RB roles move fast — lean on the latest game. */
  recencyWeightLast1: 0.60,
  rolePriorWeight: 0.30,
  /** Fumbles per touch, and the share of those lost. */
  fumbleRate: 0.010,
  fumbleLostShare: 0.5,
  /** Long catches per target, for backs (not shrunk). */
  catch30PerTarget: 0.010,
  catch40PerTarget: 0.005,
  catch50PerTarget: 0.0025,
  thinSampleCarries: 20.0,
  /** Share of 40+ and 50+ yard runs that are touchdowns (heuristic). */
  touchdownShareOf40: 0.35,
  touchdownShareOf50: 0.45,
} as const

// MARK: - Scoring

/**
 * Rushing and receiving scoring, long-play tiers stacked (a 45-yard run earns
 * `bonus30 + bonus40`) and kept separately for runs and catches. A lost fumble
 * records both `fum` and `fum_lost`.
 */
export interface RBScoring {
  reception: number
  rushingYard: number
  receivingYard: number
  firstDown: number
  touchdown: number
  runBonus30: number
  runBonus40: number
  runBonus50: number
  catchBonus30: number
  catchBonus40: number
  catchBonus50: number
  fumble: number
  fumbleLost: number
  touchdownBonus40: number
  touchdownBonus50: number
}

export function rbScoring(values: Partial<RBScoring> = {}): RBScoring {
  return {
    reception: 0, rushingYard: 0, receivingYard: 0, firstDown: 0, touchdown: 0,
    runBonus30: 0, runBonus40: 0, runBonus50: 0, catchBonus30: 0, catchBonus40: 0, catchBonus50: 0,
    fumble: 0, fumbleLost: 0, touchdownBonus40: 0, touchdownBonus50: 0,
    ...values,
  }
}

/** The reference engine's defaults: 0 PPR, 0.1/yd, 1/first down, 6/TD, fumble −3 (−2 more lost). */
export const RB_REFERENCE_SCORING: Readonly<RBScoring> = Object.freeze(rbScoring({
  reception: 0, rushingYard: 0.1, receivingYard: 0.1, firstDown: 1, touchdown: 6, fumble: -3, fumbleLost: -2,
}))

/** The reference's single set of long-play bonuses, applied to runs and catches alike. */
export function withLongPlayBonuses(s: RBScoring, b30: number, b40: number, b50: number): RBScoring {
  return { ...s, runBonus30: b30, runBonus40: b40, runBonus50: b50, catchBonus30: b30, catchBonus40: b40, catchBonus50: b50 }
}

/** Sleeper's `_30_39` keys are ranges and `_40p`/`_50p` thresholds. */
export function rbScoringFromSleeper(s: Readonly<Record<string, number>>): RBScoring {
  const tiers = (prefix: string): [number, number, number] => {
    const range30 = s[`${prefix}_30_39`] ?? 0
    const over40 = s[`${prefix}_40p`] ?? 0
    const over50 = s[`${prefix}_50p`]
    return [range30, over40 - range30, over50 === undefined ? 0 : over50 - over40]
  }
  const run = tiers('rush'), catches = tiers('rec')
  return {
    reception: s['rec'] ?? 0,
    rushingYard: s['rush_yd'] ?? 0,
    receivingYard: s['rec_yd'] ?? 0,
    firstDown: s['rush_fd'] ?? 0,
    touchdown: s['rush_td'] ?? 0,
    runBonus30: run[0], runBonus40: run[1], runBonus50: run[2],
    catchBonus30: catches[0], catchBonus40: catches[1], catchBonus50: catches[2],
    fumble: s['fum'] ?? 0,
    fumbleLost: s['fum_lost'] ?? 0,
    touchdownBonus40: s['rush_td_40p'] ?? 0,
    touchdownBonus50: s['rush_td_50p'] ?? 0,
  }
}

export const hasLongPlayBonuses = (s: RBScoring) =>
  [s.runBonus30, s.runBonus40, s.runBonus50, s.catchBonus30, s.catchBonus40, s.catchBonus50].some((v) => v !== 0)

const MODELLED_KEYS: ReadonlySet<string> = new Set([
  'rec', 'rec_yd', 'rush_yd', 'rec_fd', 'rush_fd', 'rec_td', 'rush_td', 'rush_att',
  'rush_30_39', 'rush_40p', 'rush_50p', 'rec_30_39', 'rec_40p', 'rec_50p',
  'rush_td_40p', 'rush_td_50p', 'fum', 'fum_lost',
])

/** Rushing keys the league pays for that are not projected, named rather than dropped. */
export function rbUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !MODELLED_KEYS.has(key)
      && (key.startsWith('rush') || key.startsWith('bonus_rush') || key === 'bonus_fd_rb' || key === 'bonus_rec_rb'))
    .map(([key]) => key)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

// MARK: - Candidate (input)

export interface RBCandidate {
  name: string
  team: string
  role: RBRole
  opponent: string
  home?: boolean
  /** His team's spread: positive = underdog. */
  spreadOff: number
  total: number
  teamRushAttempts: number
  teamPassAttempts: number
  teamGames: number
  carryShareLast1?: number
  carryShareLast3?: number
  carryShareEst?: number
  targetShareLast1?: number
  targetShareLast3?: number
  snapShare?: number
  roleConf: number
  /** Share of team red-zone carries; undefined uses the role's neutral share. */
  redZoneShare?: number
  statCarries: number
  rushYards: number
  rushFirstDowns?: number
  rushTouchdowns: number
  /** Runs of 30+, 40+ and 50+ yards — cumulative. */
  runs30: number
  runs40: number
  runs50: number
  statTargets: number
  receptions?: number
  receivingYards: number
  receivingFirstDowns?: number
  receivingTouchdowns: number
  dvpPct: number
  dvpGames: number
  /** O-line / box-count / front-seven-injury adjustment; 1.0 neutral. */
  lineAdj: number
  practice: StreamPractice
  rosterPct?: number
  available?: boolean
  notes: string
  sources: string[]
  dataFlags: string[]
  playerID?: string
}

export type RBCandidateInit = Pick<RBCandidate, 'name' | 'team' | 'role' | 'opponent'> & Partial<RBCandidate>

/** Swift's memberwise init, with its defaults. */
export function rbCandidate(init: RBCandidateInit): RBCandidate {
  return {
    spreadOff: 0, total: 45, teamRushAttempts: 0, teamPassAttempts: 0, teamGames: 0, roleConf: 0.7,
    statCarries: 0, rushYards: 0, rushTouchdowns: 0, runs30: 0, runs40: 0, runs50: 0, statTargets: 0,
    receivingYards: 0, receivingTouchdowns: 0, dvpPct: 0, dvpGames: 0, lineAdj: 1, practice: 'none',
    notes: '', sources: [], dataFlags: [],
    ...init,
  }
}

/**
 * Decodes one candidate from the reference JSON. Swift decodes with
 * `.convertFromSnakeCase`, so the raw keys are the snake-case spellings of its
 * CodingKeys (`opp`, `team_rush_att`, `tgt_share_last1`, `rz_share`, `rush_30p` …).
 */
export function decodeRBCandidate(raw: unknown): RBCandidate {
  if (typeof raw !== 'object' || raw === null) throw new Error('RBCandidate: not an object')
  const o = raw as Record<string, unknown>
  const present = (k: string) => o[k] !== undefined && o[k] !== null
  const opt = (k: string): number | undefined => {
    if (!present(k)) return undefined
    if (typeof o[k] !== 'number') throw new Error(`RBCandidate: ${k} is not a number`)
    return o[k] as number
  }
  const num = (k: string, fallback: number) => opt(k) ?? fallback
  const int = (k: string): number | undefined => {
    const v = opt(k)
    if (v !== undefined && !Number.isInteger(v)) throw new Error(`RBCandidate: ${k} is not an integer`)
    return v
  }
  const str = (k: string): string | undefined => {
    if (!present(k)) return undefined
    if (typeof o[k] !== 'string') throw new Error(`RBCandidate: ${k} is not a string`)
    return o[k] as string
  }
  const bool = (k: string): boolean | undefined => {
    if (!present(k)) return undefined
    if (typeof o[k] !== 'boolean') throw new Error(`RBCandidate: ${k} is not a boolean`)
    return o[k] as boolean
  }
  const strings = (k: string): string[] | undefined => {
    if (!present(k)) return undefined
    const v = o[k]
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`RBCandidate: ${k} is not [String]`)
    return v as string[]
  }
  const name = str('name'), team = str('team')
  if (name === undefined) throw new Error('RBCandidate: missing name')
  if (team === undefined) throw new Error('RBCandidate: missing team')
  if (!isRBRole(o['role'])) throw new Error(`RBCandidate: bad role ${String(o['role'])}`)
  let practice: StreamPractice = 'none'
  if (present('practice')) {
    if (!isStreamPractice(o['practice'])) throw new Error(`RBCandidate: bad practice ${String(o['practice'])}`)
    practice = o['practice']
  }
  return {
    name, team, role: o['role'], opponent: str('opp') ?? '', home: bool('home'),
    spreadOff: num('spread_off', 0), total: num('total', 45),
    teamRushAttempts: num('team_rush_att', 0), teamPassAttempts: num('team_pass_att', 0),
    teamGames: int('team_games') ?? 0,
    carryShareLast1: opt('carry_share_last1'), carryShareLast3: opt('carry_share_last3'),
    carryShareEst: opt('carry_share_est'), targetShareLast1: opt('tgt_share_last1'),
    targetShareLast3: opt('tgt_share_last3'), snapShare: opt('snap_share'),
    roleConf: num('role_conf', 0.7), redZoneShare: opt('rz_share'),
    statCarries: num('stat_carries', 0), rushYards: num('rush_yd', 0),
    rushFirstDowns: opt('rush_fd'), rushTouchdowns: num('rush_td', 0),
    runs30: num('rush_30p', 0), runs40: num('rush_40p', 0), runs50: num('rush_50p', 0),
    statTargets: num('stat_targets', 0), receptions: opt('rec'),
    receivingYards: num('rec_yd', 0), receivingFirstDowns: opt('rec_fd'),
    receivingTouchdowns: num('rec_td', 0), dvpPct: num('dvp_pct', 0),
    dvpGames: int('dvp_games') ?? 0, lineAdj: num('line_adj', 1),
    practice,
    rosterPct: opt('roster_pct'), available: bool('available'),
    notes: str('notes') ?? '',
    sources: strings('sources') ?? [],
    dataFlags: strings('data_flags') ?? [],
    playerID: str('player_id'),
  }
}

export const rbCandidateID = (c: RBCandidate) => c.playerID ?? c.name

// MARK: - Projection (output)

export interface RBProjection extends StreamProjection {
  platform: Position
  role: RBRole
  expRushAttempts: number
  expPassAttempts: number
  rushEnv: number
  passEnv: number
  implied: number
  impliedMult: number
  carryShare: number
  targetShare: number
  expCarries: number
  expTargets: number
  dvpMult: number
  lineMult: number
  redZoneMult: number
  eRushYd: number
  eRushFirstDowns: number
  eRushTouchdowns: number
  eRec: number
  eRecYd: number
  eRecFirstDowns: number
  eRecTouchdowns: number
  /** Long plays of 30+/40+/50+ yards, runs and catches together. */
  e30: number
  e40: number
  e50: number
  eRun30: number
  eRun40: number
  eRun50: number
  eFumbles: number
  eTouchdowns40: number
  eTouchdowns50: number
  redZoneShare?: number
  rosterPct?: number
}

export const rbTouchdowns = (p: RBProjection) => p.eRushTouchdowns + p.eRecTouchdowns
export const rbFirstDowns = (p: RBProjection) => p.eRushFirstDowns + p.eRecFirstDowns

/** Expected points by scoring stat, largest first; sums to `meanIfPlays`. */
export function rbPointsBreakdown(p: RBProjection, s: RBScoring): StreamStatPoints[] {
  const catch30 = p.e30 - p.eRun30, catch40 = p.e40 - p.eRun40, catch50 = p.e50 - p.eRun50
  const td = rbTouchdowns(p), fd = rbFirstDowns(p)
  const rows: StreamStatPoints[] = [
    { stat: 'Rush yards', count: p.eRushYd, points: p.eRushYd * s.rushingYard },
    { stat: 'Rec yards', count: p.eRecYd, points: p.eRecYd * s.receivingYard },
    { stat: 'First downs', count: fd, points: fd * s.firstDown },
    { stat: 'TD', count: td, points: td * s.touchdown },
    { stat: 'Receptions', count: p.eRec, points: p.eRec * s.reception },
    { stat: 'Long plays', count: p.e30,
      points: p.eRun30 * s.runBonus30 + p.eRun40 * s.runBonus40 + p.eRun50 * s.runBonus50
        + catch30 * s.catchBonus30 + catch40 * s.catchBonus40 + catch50 * s.catchBonus50 },
    { stat: 'Long TDs', count: p.eTouchdowns40,
      points: p.eTouchdowns40 * s.touchdownBonus40 + p.eTouchdowns50 * s.touchdownBonus50 },
    { stat: 'Fumbles', count: p.eFumbles,
      points: p.eFumbles * (s.fumble + RB_KNOBS.fumbleLostShare * s.fumbleLost) },
  ]
  return rows.filter((r) => r.points !== 0).sort((a, b) => b.points - a.points)
}

// MARK: - Engine

const K = RB_KNOBS

// Stage 1 — opportunity

export function rbTeamVolume(c: RBCandidate): { rush: number; pass: number; rushEnv: number; passEnv: number } {
  const g = c.teamGames
  const rushBase = shrink(c.teamGames > 0 ? c.teamRushAttempts / g : undefined, g, K.leagueAverageRushAttempts, K.volumeShrinkGames)
  const passBase = shrink(c.teamGames > 0 ? c.teamPassAttempts / g : undefined, g, K.leagueAveragePassAttempts, K.volumeShrinkGames)
  const [lo, hi] = K.environmentRange
  const rushEnv = clamp(1 + K.rushTotalSlope * (c.total - 45) + K.rushSpreadSlope * c.spreadOff, lo, hi)
  const passEnv = clamp(1 + K.passTotalSlope * (c.total - 45) + K.passSpreadSlope * c.spreadOff, lo, hi)
  return { rush: rushBase * rushEnv, pass: passBase * passEnv, rushEnv, passEnv }
}

export function rbRecencyShare(last1: number | undefined, last3: number | undefined, est: number | undefined, prior: number, roleConf: number): number {
  const w1 = K.recencyWeightLast1
  let observed: number
  if (last1 !== undefined && last3 !== undefined) observed = w1 * last1 + (1 - w1) * last3
  else if (last1 !== undefined) observed = last1
  else if (last3 !== undefined) observed = last3
  else if (est !== undefined) observed = est
  else observed = prior
  const pull = K.rolePriorWeight * (1 - roleConf)
  return (1 - pull) * observed + pull * prior
}

/** Points the team is expected to score (a favorite's spread is negative). */
export function rbImplied(c: RBCandidate): { implied: number; mult: number } {
  const implied = (c.total - c.spreadOff) / 2
  return { implied, mult: clamp(implied / K.leagueAverageImplied, K.impliedRange[0], K.impliedRange[1]) }
}

// Stage 2 — conversion

export interface RBRates {
  ypc: number
  rushFd: number
  rushTd: number
  r30: number
  r40: number
  r50: number
  catchRate: number
  yardsPerCatch: number
  catchFd: number
  catchTd: number
}

export function rbConversionRates(c: RBCandidate, p: RBPrior): RBRates {
  const n = c.statCarries
  const perCarry = (x: number) => (n > 0 ? x / n : undefined)
  const ypc = shrink(perCarry(c.rushYards), n, p.yardsPerCarry, K.ypcShrinkK)
  const rushFd = shrink(c.rushFirstDowns === undefined ? undefined : perCarry(c.rushFirstDowns), n, p.rushFirstDowns, K.rushFirstDownShrinkK)
  const rushTd = shrink(perCarry(c.rushTouchdowns), n, p.rushTouchdowns, K.rushTouchdownShrinkK)
  const r30 = shrink(perCarry(c.runs30), n, p.run30, K.longRunShrinkK)
  const r40 = Math.min(shrink(perCarry(c.runs40), n, p.run40, K.longRunShrinkK), r30)
  const r50 = Math.min(shrink(perCarry(c.runs50), n, p.run50, K.longRunShrinkK), r40)

  const t = c.statTargets
  const perTarget = (x: number) => (t > 0 ? x / t : undefined)
  const catchRate = shrink(c.receptions === undefined ? undefined : perTarget(c.receptions), t, p.catchRate, K.catchShrinkK)
  const recs = c.receptions
  const ypr = shrink(recs !== undefined && recs > 0 ? c.receivingYards / recs : undefined, recs ?? 0,
    p.yardsPerCatch, K.yardsPerCatchShrinkK)
  const catchFd = shrink(c.receivingFirstDowns === undefined ? undefined : perTarget(c.receivingFirstDowns), t, p.catchFirstDowns, K.catchFirstDownShrinkK)
  const catchTd = shrink(perTarget(c.receivingTouchdowns), t, p.catchTouchdowns, K.catchTouchdownShrinkK)
  return { ypc, rushFd, rushTd, r30, r40, r50, catchRate, yardsPerCatch: ypr, catchFd, catchTd }
}

export function rbMatchupMultipliers(c: RBCandidate, p: RBPrior): { dvp: number; line: number; redZone: number } {
  let dvp = 1.0
  if (c.dvpGames > 0) {
    const w = c.dvpGames / (c.dvpGames + K.dvpFullWeightGames)
    dvp = 1 + clamp((w * c.dvpPct) / 100, -K.dvpCap, K.dvpCap)
  }
  const line = 1 + clamp(c.lineAdj - 1, -K.lineCap, K.lineCap)
  const neutral = p.redZoneShare
  const rz = c.redZoneShare ?? neutral
  const redZone = 1 + clamp((rz - neutral) / neutral, -K.redZoneMultCap, K.redZoneMultCap)
  return { dvp, line, redZone }
}

const fmt = (x: number, places: number) => formatFixed(x, places)
/** Swift `Int((x * 100).rounded())`. */
const pct = (x: number) => Math.trunc(roundAwayFromZero(x * 100))

// Projection

export function projectRB(c: RBCandidate, s: RBScoring, risk: StreamRiskMode = 'neutral'): RBProjection {
  const p = rbPrior(c.role)
  const { rush: rushAtt, pass: passAtt, rushEnv, passEnv } = rbTeamVolume(c)
  const carryShare = clamp(rbRecencyShare(c.carryShareLast1, c.carryShareLast3, c.carryShareEst, p.carryShare, c.roleConf), 0.02, 0.85)
  const targetShare = clamp(rbRecencyShare(c.targetShareLast1, c.targetShareLast3, undefined, p.targetShare, c.roleConf), 0, 0.30)
  const carries = rushAtt * carryShare
  const targets = passAtt * targetShare
  const r = rbConversionRates(c, p)
  const { dvp, line, redZone: rzMult } = rbMatchupMultipliers(c, p)
  const { implied, mult: impMult } = rbImplied(c)
  const eff = dvp * line

  const eRushYd = carries * r.ypc * eff
  const eRushFd = carries * r.rushFd * eff
  const eRushTd = carries * r.rushTd * rzMult * impMult * (0.5 + 0.5 * eff)
  const eRec = targets * r.catchRate
  const eRecYd = eRec * r.yardsPerCatch * (0.5 + 0.5 * eff)
  const eRecFd = targets * r.catchFd * (0.5 + 0.5 * eff)
  const eRecTd = targets * r.catchTd * impMult
  const eRun30 = carries * r.r30 * eff, eRun40 = carries * r.r40 * eff, eRun50 = carries * r.r50 * eff
  const eCatch30 = targets * K.catch30PerTarget
  const eCatch40 = targets * K.catch40PerTarget
  const eCatch50 = targets * K.catch50PerTarget
  const eFum = (carries + eRec) * K.fumbleRate
  const eTd40 = eRun40 * K.touchdownShareOf40
  const eTd50 = eRun50 * K.touchdownShareOf50

  const longPlays = eRun30 * s.runBonus30 + eRun40 * s.runBonus40 + eRun50 * s.runBonus50
    + eCatch30 * s.catchBonus30 + eCatch40 * s.catchBonus40 + eCatch50 * s.catchBonus50
  const mean = eRushYd * s.rushingYard + eRecYd * s.receivingYard
    + (eRushFd + eRecFd) * s.firstDown
    + (eRushTd + eRecTd) * s.touchdown
    + eRec * s.reception
    + longPlays
    + eFum * (s.fumble + K.fumbleLostShare * s.fumbleLost)
    + eTd40 * s.touchdownBonus40 + eTd50 * s.touchdownBonus50

  let variance = s.firstDown * s.firstDown * (eRushFd + eRecFd)
  variance += s.touchdown * s.touchdown * (eRushTd + eRecTd)
  variance += s.runBonus30 * s.runBonus30 * eRun30 + s.runBonus40 * s.runBonus40 * eRun40
    + s.runBonus50 * s.runBonus50 * eRun50
  variance += s.catchBonus30 * s.catchBonus30 * eCatch30 + s.catchBonus40 * s.catchBonus40 * eCatch40
    + s.catchBonus50 * s.catchBonus50 * eCatch50
  variance += s.rushingYard * s.rushingYard * (carries * r.ypc * r.ypc * 2.0) // runs are heavy-tailed
  variance += s.receivingYard * s.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
  variance += s.fumble * s.fumble * eFum
  variance += s.touchdownBonus40 * s.touchdownBonus40 * eTd40 + s.touchdownBonus50 * s.touchdownBonus50 * eTd50
  const usageSD = mean * 0.30 * (1 - c.roleConf)
  const sd = Math.sqrt(variance + usageSD * usageSD)

  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * mean
  const z = QUARTILE_Z
  const floor = Math.max(0, pPlay * (mean - z * sd))
  const ceiling = pPlay * (mean + z * sd)
  const utility = expPts + riskWeight(risk) * sd

  const rawFlags = [...c.dataFlags]
  if (c.statCarries < K.thinSampleCarries) rawFlags.push('thin carry sample')
  if (c.carryShareLast1 === undefined && c.carryShareLast3 === undefined) rawFlags.push('carry share estimated')
  if (c.rushFirstDowns === undefined) rawFlags.push('rush first-down rate from role prior')
  if (c.available === undefined) rawFlags.push('availability unverified')
  if (!hasLongPlayBonuses(s)) rawFlags.push('big-play bonuses = 0 (not yet set)')
  const seen = new Set<string>()
  const flags = rawFlags.filter((f) => (seen.has(f) ? false : (seen.add(f), true)))

  const spread = c.spreadOff >= 0 ? `+${fmt(c.spreadOff, 1)}` : fmt(c.spreadOff, 1)
  const explain = [
    `${fmt(rushAtt, 1)} expected team carries (script ×${fmt(rushEnv, 3)} from O/U ${fmt(c.total, 1)} and spread ${spread}) × ${pct(carryShare)}% share → ${fmt(carries, 1)} carries`,
    `${fmt(targets, 1)} targets from ${fmt(passAtt, 1)} team passes × ${pct(targetShare)}% share`,
    `Per carry: ${fmt(r.ypc, 2)} yds, first down ${pct(r.rushFd)}%, TD ${fmt(r.rushTd * 100, 1)}%`,
    `Implied team total ${fmt(implied, 1)} (TD ×${fmt(impMult, 2)}) · run D ×${fmt(dvp, 3)} · line ×${fmt(line, 2)} · red zone ×${fmt(rzMult, 2)}`,
    `P(plays) ${pct(pPlay)}% (${PRACTICE_STATUS_LABEL[c.practice]})`,
  ]

  return {
    id: rbCandidateID(c), platform: 'RB', roleLabel: RB_ROLE_LABEL[c.role],
    name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
    expRushAttempts: rushAtt, expPassAttempts: passAtt, rushEnv, passEnv,
    implied, impliedMult: impMult, carryShare, targetShare,
    expCarries: carries, expTargets: targets, dvpMult: dvp, lineMult: line, redZoneMult: rzMult,
    eRushYd, eRushFirstDowns: eRushFd, eRushTouchdowns: eRushTd,
    eRec, eRecYd, eRecFirstDowns: eRecFd, eRecTouchdowns: eRecTd,
    e30: eRun30 + eCatch30, e40: eRun40 + eCatch40, e50: eRun50 + eCatch50,
    eRun30, eRun40, eRun50, eFumbles: eFum,
    eTouchdowns40: eTd40, eTouchdowns50: eTd50, redZoneShare: c.redZoneShare,
    meanIfPlays: mean, sdIfPlays: sd, pPlay, expPts,
    floorP25: floor, ceilingP75: ceiling, utility,
    roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
    flags, notes: c.notes, sources: c.sources, explain,
    pBeatIncumbent: undefined, expGain: undefined, bidBand: undefined,
  }
}

export type RBStreamReport = StreamReport<RBProjection>
export type RBComparison = StreamComparison<RBProjection>

export interface RBReportOptions {
  incumbentID?: string
  risk?: StreamRiskMode
  onlyAvailable?: boolean
}

export function rbStreamReport(candidates: readonly RBCandidate[], scoring: RBScoring, options: RBReportOptions = {}): RBStreamReport {
  const { incumbentID, risk = 'neutral', onlyAvailable = false } = options
  return streamReport(candidates.map((c) => projectRB(c, scoring, risk)), incumbentID, onlyAvailable)
}
