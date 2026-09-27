/**
 * WR streaming model — a port of FCCore `WRStreamModel`: a two-stage
 * opportunity × conversion projection for one week, in the league's own
 * points. Built for no-PPR, first-down scoring. Formulas and constants match
 * the reference engine (`wr_stream.py`) so the parity test pins them; the one
 * addition is long-TD bonuses (40+/50+ yard TDs). Every prior is heuristic.
 */
import { formatFixed } from '../numeric'
import { roundAwayFromZero } from '../rounding'
import {
  PLAY_PROBABILITY, PRACTICE_STATUS_LABEL, QUARTILE_Z, clamp, isStreamPractice, riskWeight, shrink, streamReport,
  type StreamComparison, type StreamPractice, type StreamProjection, type StreamReport,
  type StreamRiskMode, type StreamStatPoints,
} from '../Stream'

// MARK: - Roles

export const WR_ROLES = ['ALPHA', 'BOUNDARY', 'DEEP', 'SLOT', 'GADGET'] as const
/** How a receiver is used — the unit the priors are set on. */
export type WRRole = (typeof WR_ROLES)[number]
export const isWRRole = (v: unknown): v is WRRole => WR_ROLES.includes(v as WRRole)

export const WR_ROLE_LABEL: Readonly<Record<WRRole, string>> = {
  ALPHA: 'Alpha', BOUNDARY: 'Boundary', DEEP: 'Deep', SLOT: 'Slot', GADGET: 'Gadget',
}
export const WR_ROLE_SUMMARY: Readonly<Record<WRRole, string>> = {
  ALPHA: 'True WR1, all-field usage',
  BOUNDARY: 'Outside X/Z, intermediate and deep',
  DEEP: 'Low-volume field stretcher',
  SLOT: 'Chain-mover, short aDOT',
  GADGET: 'Screens, motion, jet sweeps',
}

/** Per-target priors for one role. */
export interface WRPrior {
  catchRate: number
  yardsPerCatch: number
  firstDowns: number
  touchdowns: number
  p30: number
  p40: number
  p50: number
}

const PRIORS: Readonly<Record<WRRole, WRPrior>> = {
  ALPHA: { catchRate: 0.63, yardsPerCatch: 13.5, firstDowns: 0.38, touchdowns: 0.055, p30: 0.055, p40: 0.032, p50: 0.016 },
  BOUNDARY: { catchRate: 0.58, yardsPerCatch: 14.5, firstDowns: 0.36, touchdowns: 0.05, p30: 0.07, p40: 0.042, p50: 0.022 },
  DEEP: { catchRate: 0.48, yardsPerCatch: 17.5, firstDowns: 0.33, touchdowns: 0.055, p30: 0.11, p40: 0.075, p50: 0.042 },
  SLOT: { catchRate: 0.7, yardsPerCatch: 10.5, firstDowns: 0.4, touchdowns: 0.04, p30: 0.03, p40: 0.015, p50: 0.006 },
  GADGET: { catchRate: 0.72, yardsPerCatch: 9.0, firstDowns: 0.3, touchdowns: 0.035, p30: 0.03, p40: 0.018, p50: 0.008 },
}
const TARGET_SHARE: Readonly<Record<WRRole, number>> = { ALPHA: 0.26, BOUNDARY: 0.18, DEEP: 0.12, SLOT: 0.17, GADGET: 0.11 }

export const WRStreamPriors = {
  prior: (role: WRRole): WRPrior => ({ ...PRIORS[role] }),
  targetShare: (role: WRRole): number => TARGET_SHARE[role],
}

export const WR_STREAM_KNOBS = {
  leagueAveragePassAttempts: 33.5,
  passAttemptsShrinkGames: 3.0,
  totalSlope: 0.006,
  spreadSlope: 0.008,
  environmentRange: [0.82, 1.18] as const,
  catchShrinkK: 30.0,
  ypcShrinkK: 20.0,
  firstDownShrinkK: 30.0,
  touchdownShrinkK: 120.0,
  bigPlayShrinkK: 150.0,
  dvpFullWeightGames: 6.0,
  dvpCap: 0.15,
  coverageCap: 0.3,
  redZoneMultCap: 0.6,
  neutralRedZoneShare: 0.18,
  recencyWeightLast1: 0.55,
  rolePriorWeight: 0.3,
  /** ~1.5% of catches are fumbled, league-wide. */
  fumblesPerCatch: 0.015,
  /** Below this many targets the conversion sample is flagged as thin. */
  thinSampleTargets: 15.0,
  /** Share of 40+ / 50+ yard catches that are touchdowns (for long-TD bonuses). */
  touchdownShareOf40: 0.3,
  touchdownShareOf50: 0.4,
} as const
const K = WR_STREAM_KNOBS

// MARK: - Scoring

/**
 * The league's receiving scoring, with the long-catch tiers **stacked**: a
 * 45-yard catch earns `bonus30 + bonus40`. Long-TD bonuses stack as Sleeper has them.
 */
export interface WRScoring {
  reception: number
  receivingYard: number
  rushingYard: number
  firstDown: number
  touchdown: number
  bonus30: number
  bonus40: number
  bonus50: number
  fumble: number
  fumbleLost: number
  touchdownBonus40: number
  touchdownBonus50: number
}

export function makeWRScoring(init: Partial<WRScoring> = {}): WRScoring {
  return {
    reception: 0, receivingYard: 0, rushingYard: 0, firstDown: 0, touchdown: 0,
    bonus30: 0, bonus40: 0, bonus50: 0, fumble: 0, fumbleLost: 0, touchdownBonus40: 0, touchdownBonus50: 0,
    ...init,
  }
}

/** The reference engine's defaults: 0 PPR, 0.1/yd, 1/first down, 6/TD, fumble −3 (−5 lost). */
export const WR_SCORING_REFERENCE_DEFAULTS: Readonly<WRScoring> = Object.freeze(makeWRScoring({
  reception: 0, receivingYard: 0.1, rushingYard: 0.1, firstDown: 1, touchdown: 6, fumble: -3, fumbleLost: -2,
}))

/** Sleeper's range/threshold keys → stacked tiers (`bonus40 = rec_40p − rec_30_39`). */
export function wrScoringFromSleeper(s: Readonly<Record<string, number>>): WRScoring {
  const range30 = s.rec_30_39 ?? 0
  const over40 = s.rec_40p ?? 0
  const over50 = s.rec_50p
  return makeWRScoring({
    reception: s.rec ?? 0,
    receivingYard: s.rec_yd ?? 0,
    rushingYard: s.rush_yd ?? 0,
    firstDown: s.rec_fd ?? 0,
    touchdown: s.rec_td ?? 0,
    bonus30: range30,
    bonus40: over40 - range30,
    bonus50: over50 === undefined ? 0 : over50 - over40,
    fumble: s.fum ?? 0,
    fumbleLost: s.fum_lost ?? 0,
    touchdownBonus40: s.rec_td_40p ?? 0,
    touchdownBonus50: s.rec_td_50p ?? 0,
  })
}

export const hasLongCatchBonuses = (s: WRScoring) => s.bonus30 !== 0 || s.bonus40 !== 0 || s.bonus50 !== 0

const MODELLED_KEYS: ReadonlySet<string> = new Set([
  'rec', 'rec_yd', 'rush_yd', 'rec_fd', 'rush_fd', 'rec_td', 'rush_td', 'rec_30_39', 'rec_40p', 'rec_50p',
  'rec_td_40p', 'rec_td_50p', 'fum', 'fum_lost',
])

/** Receiving keys the league pays for that are not projected, sorted. */
export function wrUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !MODELLED_KEYS.has(key)
      && (key.startsWith('rec') || key.startsWith('bonus_rec') || key === 'bonus_fd_wr'))
    .map(([key]) => key)
    .sort()
}

// MARK: - Candidate (input)

export interface WRCandidate {
  name: string
  team: string
  role: WRRole
  opponent: string
  home?: boolean
  /** From the receiver's team perspective: positive = his team is the underdog. */
  spreadOff: number
  total: number
  teamPassAttempts: number
  teamGames: number
  targetShareLast1?: number
  targetShareLast3?: number
  targetShareEst?: number
  /** Routes run / team dropbacks; stabilizes target share early. */
  routeShare?: number
  roleConf: number
  /** Share of team red-zone targets; `undefined` uses the neutral 18%. */
  redZoneShare?: number
  statTargets: number
  receptions?: number
  receivingYards: number
  firstDowns?: number
  touchdowns: number
  /** Catches of 30+, 40+ and 50+ yards — cumulative. */
  catches30: number
  catches40: number
  catches50: number
  adot?: number
  rushAttemptsPerGame: number
  rushYardsPerCarry: number
  rushFirstDownRate: number
  dvpPct: number
  dvpGames: number
  /** 1.0 neutral; below for a shadow corner, above for a banged-up secondary. */
  coverageAdj: number
  practice: StreamPractice
  rosterPct?: number
  available?: boolean
  notes: string
  sources: string[]
  dataFlags: string[]
  playerID?: string
}

export const wrCandidateID = (c: Pick<WRCandidate, 'playerID' | 'name'>) => c.playerID ?? c.name

/** Swift's memberwise init: required fields plus the same defaults. */
export function makeWRCandidate(init: Pick<WRCandidate, 'name' | 'team' | 'role' | 'opponent'> & Partial<WRCandidate>): WRCandidate {
  return {
    spreadOff: 0, total: 45, teamPassAttempts: 0, teamGames: 0, roleConf: 0.7, statTargets: 0,
    receivingYards: 0, touchdowns: 0, catches30: 0, catches40: 0, catches50: 0, rushAttemptsPerGame: 0,
    rushYardsPerCarry: 6, rushFirstDownRate: 0.25, dvpPct: 0, dvpGames: 0, coverageAdj: 1, practice: 'none',
    notes: '', sources: [], dataFlags: [],
    ...init,
  }
}

/** Swift `JSONDecoder.KeyDecodingStrategy.convertFromSnakeCase` for one key. */
export function convertFromSnakeCase(key: string): string {
  const m = /^(_*)(.*?)(_*)$/.exec(key)!
  const [, lead, core, trail] = m
  if (!core!.includes('_')) return key
  const parts = core!.split('_').filter((p) => p.length > 0)
  // Foundation's `capitalized` starts a word after any non-letter ("30p" → "30P").
  const cap = (w: string) => w.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase())
  return lead! + parts[0]! + parts.slice(1).map(cap).join('') + trail!
}

type Raw = Record<string, unknown>

function field(raw: Raw, key: string): unknown {
  const v = raw[key]
  return v === null ? undefined : v
}
function optNum(raw: Raw, key: string): number | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'number') throw new TypeError(`WRCandidate.${key}: expected number`)
  return v
}
function optInt(raw: Raw, key: string): number | undefined {
  const v = optNum(raw, key)
  if (v !== undefined && !Number.isInteger(v)) throw new TypeError(`WRCandidate.${key}: expected integer`)
  return v
}
function optStr(raw: Raw, key: string): string | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw new TypeError(`WRCandidate.${key}: expected string`)
  return v
}
function optBool(raw: Raw, key: string): boolean | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw new TypeError(`WRCandidate.${key}: expected boolean`)
  return v
}
function optStrings(raw: Raw, key: string): string[] | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new TypeError(`WRCandidate.${key}: expected [String]`)
  return [...v] as string[]
}

/**
 * Decodes one candidate using Swift's CodingKeys (`opp`, `teamPassAtt`,
 * `tgtShareLast1`, `rzShare`, `rec`, `recYd`, `rec30P`, `playerId`, …) and the
 * same defaults. `snakeCase` first applies `convertFromSnakeCase` to the keys,
 * as the reference files (`team_pass_att`, `rec_30p`) are read.
 */
export function decodeWRCandidate(input: unknown, options: { snakeCase?: boolean } = {}): WRCandidate {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('WRCandidate: expected object')
  const raw: Raw = options.snakeCase
    ? Object.fromEntries(Object.entries(input as Raw).map(([k, v]) => [convertFromSnakeCase(k), v]))
    : (input as Raw)
  const name = optStr(raw, 'name'), team = optStr(raw, 'team'), role = field(raw, 'role')
  if (name === undefined) throw new TypeError('WRCandidate.name: missing')
  if (team === undefined) throw new TypeError('WRCandidate.team: missing')
  if (!isWRRole(role)) throw new TypeError(`WRCandidate.role: invalid ${String(role)}`)
  const practice = field(raw, 'practice')
  if (practice !== undefined && !isStreamPractice(practice)) throw new TypeError(`WRCandidate.practice: invalid ${String(practice)}`)
  const num = (key: string, fallback: number) => optNum(raw, key) ?? fallback
  return {
    name, team, role,
    opponent: optStr(raw, 'opp') ?? '',
    home: optBool(raw, 'home'),
    spreadOff: num('spreadOff', 0), total: num('total', 45),
    teamPassAttempts: num('teamPassAtt', 0),
    teamGames: optInt(raw, 'teamGames') ?? 0,
    targetShareLast1: optNum(raw, 'tgtShareLast1'), targetShareLast3: optNum(raw, 'tgtShareLast3'),
    targetShareEst: optNum(raw, 'tgtShareEst'), routeShare: optNum(raw, 'routeShare'),
    roleConf: num('roleConf', 0.7), redZoneShare: optNum(raw, 'rzShare'),
    statTargets: num('statTargets', 0), receptions: optNum(raw, 'rec'),
    receivingYards: num('recYd', 0), firstDowns: optNum(raw, 'recFd'),
    touchdowns: num('recTd', 0), catches30: num('rec30P', 0),
    catches40: num('rec40P', 0), catches50: num('rec50P', 0), adot: optNum(raw, 'adot'),
    rushAttemptsPerGame: num('rushAttPg', 0), rushYardsPerCarry: num('rushYpc', 6),
    rushFirstDownRate: num('rushFdRate', 0.25), dvpPct: num('dvpPct', 0),
    dvpGames: optInt(raw, 'dvpGames') ?? 0,
    coverageAdj: num('coverageAdj', 1),
    practice: (practice as StreamPractice | undefined) ?? 'none',
    rosterPct: optNum(raw, 'rosterPct'), available: optBool(raw, 'available'),
    notes: optStr(raw, 'notes') ?? '',
    sources: optStrings(raw, 'sources') ?? [],
    dataFlags: optStrings(raw, 'dataFlags') ?? [],
    playerID: optStr(raw, 'playerId'),
  }
}

// MARK: - Projection (output)

export interface WRProjection extends StreamProjection {
  role: WRRole
  expPassAttempts: number
  envMult: number
  targetShare: number
  expTargets: number
  dvpMult: number
  coverageMult: number
  redZoneMult: number
  eRec: number
  eRecYd: number
  eFirstDowns: number
  eTouchdowns: number
  e30: number
  e40: number
  e50: number
  eRushYd: number
  eRushFirstDowns: number
  eTouchdowns40: number
  eTouchdowns50: number
  adot?: number
  redZoneShare?: number
  rosterPct?: number
}

/** Expected points by scoring stat, largest first; sums to `meanIfPlays`. */
export function wrPointsBreakdown(p: WRProjection, scoring: WRScoring): StreamStatPoints[] {
  const yards = p.eRecYd * scoring.receivingYard + p.eRushYd * scoring.rushingYard
  return [
    { stat: 'Yards', count: p.eRecYd + p.eRushYd, points: yards },
    { stat: 'First downs', count: p.eFirstDowns + p.eRushFirstDowns, points: (p.eFirstDowns + p.eRushFirstDowns) * scoring.firstDown },
    { stat: 'TD', count: p.eTouchdowns, points: p.eTouchdowns * scoring.touchdown },
    { stat: 'Receptions', count: p.eRec, points: p.eRec * scoring.reception },
    { stat: 'Long catches', count: p.e30, points: p.e30 * scoring.bonus30 + p.e40 * scoring.bonus40 + p.e50 * scoring.bonus50 },
    { stat: 'Long TDs', count: p.eTouchdowns40, points: p.eTouchdowns40 * scoring.touchdownBonus40 + p.eTouchdowns50 * scoring.touchdownBonus50 },
    { stat: 'Fumbles', count: K.fumblesPerCatch * p.eRec, points: -(K.fumblesPerCatch * p.eRec) * Math.abs(scoring.fumble) },
  ]
    .filter((s) => s.points !== 0)
    .sort((a, b) => b.points - a.points)
}

// MARK: - Engine

/** Stage 1 — team pass attempts, scaled by the game environment. */
export function expectedPassAttempts(c: WRCandidate): { attempts: number; environment: number } {
  const perGame = c.teamGames > 0 ? c.teamPassAttempts / c.teamGames : undefined
  const base = shrink(perGame, c.teamGames, K.leagueAveragePassAttempts, K.passAttemptsShrinkGames)
  const [lo, hi] = K.environmentRange
  const env = clamp(1 + K.totalSlope * (c.total - 45) + K.spreadSlope * c.spreadOff, lo, hi)
  return { attempts: base * env, environment: env }
}

export function projectedTargetShare(c: WRCandidate): number {
  const w1 = K.recencyWeightLast1
  let observed: number
  if (c.targetShareLast1 !== undefined && c.targetShareLast3 !== undefined) {
    observed = w1 * c.targetShareLast1 + (1 - w1) * c.targetShareLast3
  } else if (c.targetShareLast1 !== undefined) {
    observed = c.targetShareLast1
  } else if (c.targetShareLast3 !== undefined) {
    observed = c.targetShareLast3
  } else if (c.targetShareEst !== undefined) {
    observed = c.targetShareEst
  } else {
    observed = WRStreamPriors.targetShare(c.role)
  }
  // A receiver running most routes with a small share is likelier to grow.
  let rolePrior = WRStreamPriors.targetShare(c.role)
  if (c.routeShare !== undefined) rolePrior = 0.5 * rolePrior + 0.5 * ((rolePrior * c.routeShare) / 0.8)
  const pull = K.rolePriorWeight * (1 - c.roleConf)
  return clamp((1 - pull) * observed + pull * rolePrior, 0.02, 0.45)
}

export interface WRRates {
  catchRate: number
  yardsPerCatch: number
  firstDowns: number
  touchdowns: number
  p30: number
  p40: number
  p50: number
}

/** Stage 2 — per-target conversion, each rate shrunk to the role prior. */
export function conversionRates(c: WRCandidate, prior: WRPrior): WRRates {
  const n = c.statTargets
  const receptions = c.receptions
  const catchRate = shrink(receptions !== undefined && n > 0 ? receptions / n : undefined, n, prior.catchRate, K.catchShrinkK)
  let ypc = shrink(receptions !== undefined && receptions > 0 ? c.receivingYards / receptions : undefined, receptions ?? 0,
    prior.yardsPerCatch, K.ypcShrinkK)
  // aDOT sanity: a "slot" running a 14-yard aDOT has the wrong YPC prior.
  if (c.adot !== undefined) ypc = 0.7 * ypc + 0.3 * (c.adot * 0.75 + 4.5)
  const perTarget = (x: number) => (n > 0 ? x / n : undefined)
  const firstDowns = shrink(c.firstDowns !== undefined ? perTarget(c.firstDowns) : undefined, n, prior.firstDowns, K.firstDownShrinkK)
  const touchdowns = shrink(perTarget(c.touchdowns), n, prior.touchdowns, K.touchdownShrinkK)
  const k = K.bigPlayShrinkK
  const p30 = shrink(perTarget(c.catches30), n, prior.p30, k)
  const p40 = Math.min(shrink(perTarget(c.catches40), n, prior.p40, k), p30)
  const p50 = Math.min(shrink(perTarget(c.catches50), n, prior.p50, k), p40)
  return { catchRate, yardsPerCatch: ypc, firstDowns, touchdowns, p30, p40, p50 }
}

export function matchupMultipliers(c: WRCandidate): { dvp: number; coverage: number; redZone: number } {
  let dvp = 1.0
  if (c.dvpGames > 0) {
    const w = c.dvpGames / (c.dvpGames + K.dvpFullWeightGames)
    dvp = 1 + clamp((w * c.dvpPct) / 100, -K.dvpCap, K.dvpCap)
  }
  const coverage = 1 + clamp(c.coverageAdj - 1, -K.coverageCap, K.coverageCap)
  const rz = c.redZoneShare ?? K.neutralRedZoneShare
  const neutral = K.neutralRedZoneShare
  const redZone = 1 + clamp((rz - neutral) / neutral, -K.redZoneMultCap, K.redZoneMultCap)
  return { dvp, coverage, redZone }
}

const fmt = (x: number, places: number) => formatFixed(x, places)
const pct = (x: number) => Math.trunc(roundAwayFromZero(x * 100))

export function projectWR(c: WRCandidate, scoring: WRScoring, risk: StreamRiskMode = 'neutral'): WRProjection {
  const prior = WRStreamPriors.prior(c.role)
  const { attempts, environment: env } = expectedPassAttempts(c)
  const share = projectedTargetShare(c)
  const targets = attempts * share
  const r = conversionRates(c, prior)
  const { dvp: dvpMult, coverage: covMult, redZone: rzMult } = matchupMultipliers(c)

  // The matchup acts on efficiency, not raw targets.
  const eff = dvpMult * covMult
  const eRec = targets * r.catchRate * (0.5 + 0.5 * eff)
  const eRecYd = eRec * r.yardsPerCatch * eff
  const eFd = targets * r.firstDowns * eff
  const eTd = targets * r.touchdowns * rzMult * (0.5 + 0.5 * eff)
  const e30 = targets * r.p30 * eff
  const e40 = targets * r.p40 * eff
  const e50 = targets * r.p50 * eff
  const eRushYd = c.rushAttemptsPerGame * c.rushYardsPerCarry
  const eRushFd = c.rushAttemptsPerGame * c.rushFirstDownRate
  const eTd40 = e40 * K.touchdownShareOf40
  const eTd50 = e50 * K.touchdownShareOf50

  // The reference scores rushing yards at the receiving rate (equal in this league).
  const yards = (eRecYd + eRushYd) * scoring.receivingYard
  const mean = yards
    + (eFd + eRushFd) * scoring.firstDown
    + eTd * scoring.touchdown
    + eRec * scoring.reception
    + e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50
    - (K.fumblesPerCatch * eRec) * Math.abs(scoring.fumble)
    + eTd40 * scoring.touchdownBonus40 + eTd50 * scoring.touchdownBonus50

  // Each scoring event roughly Poisson in count; yards compound and lumpy.
  let variance = scoring.firstDown * scoring.firstDown * (eFd + eRushFd)
    + scoring.touchdown * scoring.touchdown * eTd
    + scoring.bonus30 * scoring.bonus30 * e30 + scoring.bonus40 * scoring.bonus40 * e40
    + scoring.bonus50 * scoring.bonus50 * e50
    + scoring.receivingYard * scoring.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
  variance += scoring.touchdownBonus40 * scoring.touchdownBonus40 * eTd40
    + scoring.touchdownBonus50 * scoring.touchdownBonus50 * eTd50
  const usageSD = mean * 0.3 * (1 - c.roleConf)
  const sd = Math.sqrt(variance + usageSD * usageSD)

  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * mean
  const z = QUARTILE_Z
  const floor = Math.max(0, pPlay * (mean - z * sd))
  const ceiling = pPlay * (mean + z * sd)
  const utility = expPts + riskWeight(risk) * sd

  const rawFlags = [...c.dataFlags]
  if (c.statTargets < K.thinSampleTargets) rawFlags.push('thin target sample')
  if (c.targetShareLast1 === undefined && c.targetShareLast3 === undefined) rawFlags.push('target share estimated')
  if (c.firstDowns === undefined) rawFlags.push('first-down rate from role prior (not observed)')
  if (c.available === undefined) rawFlags.push('availability unverified')
  if (!hasLongCatchBonuses(scoring)) rawFlags.push('big-play bonuses = 0 (not yet set)')
  const flags = [...new Set(rawFlags)]

  const pace = c.teamGames > 0 ? fmt(c.teamPassAttempts / c.teamGames, 1) : 'n/a'
  const spread = c.spreadOff >= 0 ? `+${fmt(c.spreadOff, 1)}` : fmt(c.spreadOff, 1)
  const explain = [
    `${fmt(attempts, 1)} expected team pass attempts (pace ${pace}/gm, environment ×${fmt(env, 3)} from O/U ${fmt(c.total, 1)} and spread ${spread})`,
    `× ${pct(share)}% target share → ${fmt(targets, 1)} targets`,
    `Per target: catch ${pct(r.catchRate)}%, ${fmt(r.yardsPerCatch, 1)} yds/catch, first down ${pct(r.firstDowns)}%, 30+ catch ${fmt(r.p30 * 100, 1)}%`,
    `Matchup ×${fmt(dvpMult, 3)} · coverage ×${fmt(covMult, 2)} · red zone ×${fmt(rzMult, 2)} on TDs`,
    `P(plays) ${pct(pPlay)}% (${PRACTICE_STATUS_LABEL[c.practice]})`,
  ]

  return {
    id: wrCandidateID(c), name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
    platform: 'WR', roleLabel: WR_ROLE_LABEL[c.role],
    expPassAttempts: attempts, envMult: env, targetShare: share, expTargets: targets,
    dvpMult, coverageMult: covMult, redZoneMult: rzMult,
    eRec, eRecYd, eFirstDowns: eFd, eTouchdowns: eTd, e30, e40, e50,
    eRushYd, eRushFirstDowns: eRushFd, eTouchdowns40: eTd40, eTouchdowns50: eTd50,
    adot: c.adot, redZoneShare: c.redZoneShare,
    meanIfPlays: mean, sdIfPlays: sd, pPlay, expPts,
    floorP25: floor, ceilingP75: ceiling, utility,
    roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
    flags, notes: c.notes, sources: [...c.sources], explain,
  }
}

export type WRStreamReport = StreamReport<WRProjection>
export type WRComparison = StreamComparison<WRProjection>

/** Projects, compares with the incumbent and ranks in one call. */
export function wrStreamReport(
  candidates: readonly WRCandidate[], scoring: WRScoring,
  options: { incumbentID?: string; risk?: StreamRiskMode; onlyAvailable?: boolean } = {},
): WRStreamReport {
  const { incumbentID, risk = 'neutral', onlyAvailable = false } = options
  return streamReport(candidates.map((c) => projectWR(c, scoring, risk)), incumbentID, onlyAvailable)
}
