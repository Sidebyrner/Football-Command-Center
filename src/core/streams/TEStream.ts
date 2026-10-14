/**
 * TE streaming model — a port of FCCore `TEStreamModel`: the WR stream's
 * two-stage opportunity × conversion projection, recalibrated for tight ends.
 * Routes (estimated from snap share by role) scale the target-share prior; the
 * per-target TD rate is shrunk harder than a receiver's; the coverage knob is
 * "seam coverage" (linebackers and safeties); TE premium (`bonus_rec_te`,
 * `bonus_fd_te`) is scored exactly. There is no reference engine: the Swift
 * fixture under `te-stream` pins this port. Every prior is heuristic.
 */
import { formatFixed } from '../numeric'
import { roundAwayFromZero } from '../rounding'
import {
  PLAY_PROBABILITY, PRACTICE_STATUS_LABEL, QUARTILE_Z, clamp, isStreamPractice, riskWeight, shrink, streamReport,
  type StreamComparison, type StreamPractice, type StreamProjection, type StreamReport,
  type StreamRiskMode, type StreamStatPoints,
} from '../Stream'

// MARK: - Roles

export const TE_ROLES = ['FEATURED', 'SEAM', 'CHECKDOWN', 'RED_ZONE', 'ROTATIONAL'] as const
/** How a tight end is used — the unit the priors are set on. */
export type TERole = (typeof TE_ROLES)[number]
export const isTERole = (v: unknown): v is TERole => TE_ROLES.includes(v as TERole)

export const TE_ROLE_LABEL: Readonly<Record<TERole, string>> = {
  FEATURED: 'Featured', SEAM: 'Seam', CHECKDOWN: 'Checkdown', RED_ZONE: 'Red zone', ROTATIONAL: 'Rotational',
}
export const TE_ROLE_SUMMARY: Readonly<Record<TERole, string>> = {
  FEATURED: 'TE1 and a top target, runs most routes',
  SEAM: 'Vertical TE, works the middle deep',
  CHECKDOWN: 'Short safety valve, high catch rate',
  RED_ZONE: 'Inline blocker, TD-dependent',
  ROTATIONAL: 'TE2 in a committee or 12 personnel',
}

/** Per-target priors for one role. */
export interface TEPrior {
  catchRate: number
  yardsPerCatch: number
  firstDowns: number
  touchdowns: number
  p30: number
  p40: number
  p50: number
}

const PRIORS: Readonly<Record<TERole, TEPrior>> = {
  FEATURED: { catchRate: 0.72, yardsPerCatch: 10.8, firstDowns: 0.38, touchdowns: 0.06, p30: 0.035, p40: 0.018, p50: 0.008 },
  SEAM: { catchRate: 0.62, yardsPerCatch: 13.0, firstDowns: 0.37, touchdowns: 0.065, p30: 0.06, p40: 0.032, p50: 0.015 },
  CHECKDOWN: { catchRate: 0.76, yardsPerCatch: 8.8, firstDowns: 0.33, touchdowns: 0.04, p30: 0.018, p40: 0.008, p50: 0.003 },
  RED_ZONE: { catchRate: 0.66, yardsPerCatch: 9.5, firstDowns: 0.32, touchdowns: 0.095, p30: 0.02, p40: 0.01, p50: 0.004 },
  ROTATIONAL: { catchRate: 0.68, yardsPerCatch: 10.0, firstDowns: 0.32, touchdowns: 0.05, p30: 0.025, p40: 0.012, p50: 0.005 },
}
const TARGET_SHARE: Readonly<Record<TERole, number>> = { FEATURED: 0.21, SEAM: 0.15, CHECKDOWN: 0.13, RED_ZONE: 0.09, ROTATIONAL: 0.08 }
/** Routes run per offensive snap: the rest are blocking snaps. */
const ROUTES_PER_SNAP: Readonly<Record<TERole, number>> = { FEATURED: 0.85, SEAM: 0.85, CHECKDOWN: 0.7, RED_ZONE: 0.55, ROTATIONAL: 0.55 }

export const TEStreamPriors = {
  prior: (role: TERole): TEPrior => ({ ...PRIORS[role] }),
  targetShare: (role: TERole): number => TARGET_SHARE[role],
  routesPerSnap: (role: TERole): number => ROUTES_PER_SNAP[role],
}

export const TE_STREAM_KNOBS = {
  leagueAveragePassAttempts: 33.5,
  passAttemptsShrinkGames: 3.0,
  totalSlope: 0.006,
  spreadSlope: 0.008,
  environmentRange: [0.82, 1.18] as const,
  catchShrinkK: 30.0,
  ypcShrinkK: 20.0,
  firstDownShrinkK: 30.0,
  /** Harder than a receiver's 120: TE touchdown streaks regress. */
  touchdownShrinkK: 160.0,
  bigPlayShrinkK: 150.0,
  dvpFullWeightGames: 6.0,
  dvpCap: 0.18,
  coverageCap: 0.3,
  redZoneMultCap: 0.7,
  neutralRedZoneShare: 0.15,
  recencyWeightLast1: 0.5,
  rolePriorWeight: 0.3,
  /** A typical tight end's route share of team dropbacks. */
  typicalRouteShare: 0.75,
  shareRange: [0.02, 0.4] as const,
  vacatedBoostCap: 0.1,
  fumblesPerCatch: 0.015,
  thinSampleTargets: 12.0,
  usageSDWeight: 0.35,
  touchdownShareOf40: 0.3,
  touchdownShareOf50: 0.4,
} as const
const K = TE_STREAM_KNOBS

// MARK: - Scoring

/**
 * The league's receiving scoring as it applies to a tight end, long-catch
 * tiers stacked as in `WRScoring`, plus TE premium per catch and per first down.
 */
export interface TEScoring {
  reception: number
  receivingYard: number
  firstDown: number
  touchdown: number
  bonus30: number
  bonus40: number
  bonus50: number
  fumble: number
  fumbleLost: number
  touchdownBonus40: number
  touchdownBonus50: number
  /** `bonus_rec_te`: extra per TE catch. */
  premiumReception: number
  /** `bonus_fd_te`: extra per TE first down. */
  premiumFirstDown: number
}

export function makeTEScoring(init: Partial<TEScoring> = {}): TEScoring {
  return {
    reception: 0, receivingYard: 0, firstDown: 0, touchdown: 0, bonus30: 0, bonus40: 0, bonus50: 0,
    fumble: 0, fumbleLost: 0, touchdownBonus40: 0, touchdownBonus50: 0, premiumReception: 0, premiumFirstDown: 0,
    ...init,
  }
}

/** No PPR, 0.1/yd, 1/first down, 6/TD, fumble −3 — the WR reference's defaults. */
export const TE_SCORING_REFERENCE_DEFAULTS: Readonly<TEScoring> = Object.freeze(makeTEScoring({
  receivingYard: 0.1, firstDown: 1, touchdown: 6, fumble: -3, fumbleLost: -2,
}))

/** Sleeper's range/threshold keys → stacked tiers, plus the TE premium keys. */
export function teScoringFromSleeper(s: Readonly<Record<string, number>>): TEScoring {
  const range30 = s.rec_30_39 ?? 0
  const over40 = s.rec_40p ?? 0
  const over50 = s.rec_50p
  return makeTEScoring({
    reception: s.rec ?? 0,
    receivingYard: s.rec_yd ?? 0,
    firstDown: s.rec_fd ?? 0,
    touchdown: s.rec_td ?? 0,
    bonus30: range30,
    bonus40: over40 - range30,
    bonus50: over50 === undefined ? 0 : over50 - over40,
    fumble: s.fum ?? 0,
    fumbleLost: s.fum_lost ?? 0,
    touchdownBonus40: s.rec_td_40p ?? 0,
    touchdownBonus50: s.rec_td_50p ?? 0,
    premiumReception: s.bonus_rec_te ?? 0,
    premiumFirstDown: s.bonus_fd_te ?? 0,
  })
}

export const teHasLongCatchBonuses = (s: TEScoring) => s.bonus30 !== 0 || s.bonus40 !== 0 || s.bonus50 !== 0
export const teHasPremium = (s: TEScoring) => s.premiumReception !== 0 || s.premiumFirstDown !== 0

const MODELLED_KEYS: ReadonlySet<string> = new Set([
  'rec', 'rec_yd', 'rec_fd', 'rec_td', 'rec_30_39', 'rec_40p', 'rec_50p',
  'rec_td_40p', 'rec_td_50p', 'fum', 'fum_lost', 'bonus_rec_te', 'bonus_fd_te',
])

/** Receiving keys the league pays for that are not projected, sorted. */
export function teUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !MODELLED_KEYS.has(key)
      && (key.startsWith('rec') || key.startsWith('bonus_rec') || key === 'bonus_fd_te')
      && key !== 'bonus_rec_wr' && key !== 'bonus_rec_rb')
    .map(([key]) => key)
    .sort()
}

/** Swift's synthesized `Decodable` for `TEScoring` (every key required). */
export function decodeTEScoring(input: unknown): TEScoring {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('TEScoring: expected object')
  const raw = input as Record<string, unknown>
  const out = makeTEScoring()
  for (const key of Object.keys(out) as (keyof TEScoring)[]) {
    const v = raw[key]
    if (typeof v !== 'number') throw new TypeError(`TEScoring.${key}: expected number`)
    out[key] = v
  }
  return out
}

// MARK: - Candidate (input)

export interface TECandidate {
  name: string
  team: string
  role: TERole
  opponent: string
  home?: boolean
  /** From the TE's team perspective: positive = his team is the underdog. */
  spreadOff: number
  total: number
  teamPassAttempts: number
  teamGames: number
  targetShareLast1?: number
  targetShareLast3?: number
  targetShareEst?: number
  /** Offensive snap share, last three games. Routes are estimated from it by role. */
  snapShare?: number
  roleConf: number
  /** Share of team red-zone targets; `undefined` uses the neutral 15%. */
  redZoneShare?: number
  statTargets: number
  receptions?: number
  receivingYards: number
  firstDowns?: number
  touchdowns: number
  catches30: number
  catches40: number
  catches50: number
  adot?: number
  dvpPct: number
  dvpGames: number
  /**
   * 1.0 neutral; above when the linebackers or safeties are hurt or poor in
   * coverage, below against a strong coverage linebacker or safety.
   */
  seamCoverageAdj: number
  /** Target share added because a teammate (a WR1, the other TE) is out; 0–0.10. */
  vacatedTargetBoost: number
  practice: StreamPractice
  rosterPct?: number
  available?: boolean
  notes: string
  sources: string[]
  dataFlags: string[]
  playerID?: string
}

export const teCandidateID = (c: Pick<TECandidate, 'playerID' | 'name'>) => c.playerID ?? c.name

/** Swift's memberwise init: required fields plus the same defaults. */
export function makeTECandidate(init: Pick<TECandidate, 'name' | 'team' | 'role' | 'opponent'> & Partial<TECandidate>): TECandidate {
  return {
    spreadOff: 0, total: 45, teamPassAttempts: 0, teamGames: 0, roleConf: 0.7, statTargets: 0,
    receivingYards: 0, touchdowns: 0, catches30: 0, catches40: 0, catches50: 0, dvpPct: 0, dvpGames: 0,
    seamCoverageAdj: 1, vacatedTargetBoost: 0, practice: 'none', notes: '', sources: [], dataFlags: [],
    ...init,
  }
}

type Raw = Record<string, unknown>

function field(raw: Raw, key: string): unknown {
  const v = raw[key]
  return v === null ? undefined : v
}
function optNum(raw: Raw, key: string): number | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'number') throw new TypeError(`TECandidate.${key}: expected number`)
  return v
}
function reqNum(raw: Raw, key: string): number {
  const v = optNum(raw, key)
  if (v === undefined) throw new TypeError(`TECandidate.${key}: missing`)
  return v
}
function reqInt(raw: Raw, key: string): number {
  const v = reqNum(raw, key)
  if (!Number.isInteger(v)) throw new TypeError(`TECandidate.${key}: expected integer`)
  return v
}
function optStr(raw: Raw, key: string): string | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw new TypeError(`TECandidate.${key}: expected string`)
  return v
}
function reqStr(raw: Raw, key: string): string {
  const v = optStr(raw, key)
  if (v === undefined) throw new TypeError(`TECandidate.${key}: missing`)
  return v
}
function optBool(raw: Raw, key: string): boolean | undefined {
  const v = field(raw, key)
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw new TypeError(`TECandidate.${key}: expected boolean`)
  return v
}
function reqStrings(raw: Raw, key: string): string[] {
  const v = field(raw, key)
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new TypeError(`TECandidate.${key}: expected [String]`)
  return [...v] as string[]
}

/**
 * Swift's synthesized `Decodable` for `TECandidate`: property names as keys,
 * optionals may be absent or null, everything else required.
 */
export function decodeTECandidate(input: unknown): TECandidate {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('TECandidate: expected object')
  const raw = input as Raw
  const role = field(raw, 'role')
  if (!isTERole(role)) throw new TypeError(`TECandidate.role: invalid ${String(role)}`)
  const practice = field(raw, 'practice')
  if (!isStreamPractice(practice)) throw new TypeError(`TECandidate.practice: invalid ${String(practice)}`)
  return {
    name: reqStr(raw, 'name'), team: reqStr(raw, 'team'), role, opponent: reqStr(raw, 'opponent'),
    home: optBool(raw, 'home'),
    spreadOff: reqNum(raw, 'spreadOff'), total: reqNum(raw, 'total'),
    teamPassAttempts: reqNum(raw, 'teamPassAttempts'), teamGames: reqInt(raw, 'teamGames'),
    targetShareLast1: optNum(raw, 'targetShareLast1'), targetShareLast3: optNum(raw, 'targetShareLast3'),
    targetShareEst: optNum(raw, 'targetShareEst'), snapShare: optNum(raw, 'snapShare'),
    roleConf: reqNum(raw, 'roleConf'), redZoneShare: optNum(raw, 'redZoneShare'),
    statTargets: reqNum(raw, 'statTargets'), receptions: optNum(raw, 'receptions'),
    receivingYards: reqNum(raw, 'receivingYards'), firstDowns: optNum(raw, 'firstDowns'),
    touchdowns: reqNum(raw, 'touchdowns'), catches30: reqNum(raw, 'catches30'),
    catches40: reqNum(raw, 'catches40'), catches50: reqNum(raw, 'catches50'), adot: optNum(raw, 'adot'),
    dvpPct: reqNum(raw, 'dvpPct'), dvpGames: reqInt(raw, 'dvpGames'),
    seamCoverageAdj: reqNum(raw, 'seamCoverageAdj'), vacatedTargetBoost: reqNum(raw, 'vacatedTargetBoost'),
    practice,
    rosterPct: optNum(raw, 'rosterPct'), available: optBool(raw, 'available'),
    notes: reqStr(raw, 'notes'),
    sources: reqStrings(raw, 'sources'),
    dataFlags: reqStrings(raw, 'dataFlags'),
    playerID: optStr(raw, 'playerID'),
  }
}

// MARK: - Projection (output)

export interface TEProjection extends StreamProjection {
  role: TERole
  expPassAttempts: number
  envMult: number
  estRouteShare?: number
  vacatedTargetBoost: number
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
  eTouchdowns40: number
  eTouchdowns50: number
  adot?: number
  redZoneShare?: number
  rosterPct?: number
}

/** Expected points by scoring stat, largest first; sums to `meanIfPlays`. */
export function tePointsBreakdown(p: TEProjection, scoring: TEScoring): StreamStatPoints[] {
  return [
    { stat: 'Yards', count: p.eRecYd, points: p.eRecYd * scoring.receivingYard },
    { stat: 'First downs', count: p.eFirstDowns, points: p.eFirstDowns * scoring.firstDown },
    { stat: 'TD', count: p.eTouchdowns, points: p.eTouchdowns * scoring.touchdown },
    { stat: 'Receptions', count: p.eRec, points: p.eRec * scoring.reception },
    { stat: 'TE premium', count: p.eRec, points: p.eRec * scoring.premiumReception + p.eFirstDowns * scoring.premiumFirstDown },
    { stat: 'Long catches', count: p.e30, points: p.e30 * scoring.bonus30 + p.e40 * scoring.bonus40 + p.e50 * scoring.bonus50 },
    { stat: 'Long TDs', count: p.eTouchdowns40, points: p.eTouchdowns40 * scoring.touchdownBonus40 + p.eTouchdowns50 * scoring.touchdownBonus50 },
    { stat: 'Fumbles', count: K.fumblesPerCatch * p.eRec, points: -(K.fumblesPerCatch * p.eRec) * Math.abs(scoring.fumble) },
  ]
    .filter((s) => s.points !== 0)
    .sort((a, b) => b.points - a.points)
}

// MARK: - Engine

/** Stage 1 — team pass attempts, scaled by the game environment. */
export function teExpectedPassAttempts(c: TECandidate): { attempts: number; environment: number } {
  const perGame = c.teamGames > 0 ? c.teamPassAttempts / c.teamGames : undefined
  const base = shrink(perGame, c.teamGames, K.leagueAveragePassAttempts, K.passAttemptsShrinkGames)
  const [lo, hi] = K.environmentRange
  const env = clamp(1 + K.totalSlope * (c.total - 45) + K.spreadSlope * c.spreadOff, lo, hi)
  return { attempts: base * env, environment: env }
}

/** Routes run per team dropback, estimated from snap share and role. */
export function teEstimatedRouteShare(c: TECandidate): number | undefined {
  return c.snapShare === undefined ? undefined : c.snapShare * TEStreamPriors.routesPerSnap(c.role)
}

export function teProjectedTargetShare(c: TECandidate): number {
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
    observed = TEStreamPriors.targetShare(c.role)
  }
  // A tight end out on most routes with a small share is likelier to grow;
  // one blocking most snaps is not, however many snaps he plays.
  let rolePrior = TEStreamPriors.targetShare(c.role)
  const routes = teEstimatedRouteShare(c)
  if (routes !== undefined) rolePrior = 0.5 * rolePrior + 0.5 * ((rolePrior * routes) / K.typicalRouteShare)
  const pull = K.rolePriorWeight * (1 - c.roleConf)
  const boost = clamp(c.vacatedTargetBoost, 0, K.vacatedBoostCap)
  const [lo, hi] = K.shareRange
  return clamp((1 - pull) * observed + pull * rolePrior + boost, lo, hi)
}

export interface TERates {
  catchRate: number
  yardsPerCatch: number
  firstDowns: number
  touchdowns: number
  p30: number
  p40: number
  p50: number
}

/** Stage 2 — per-target conversion, each rate shrunk to the role prior. */
export function teConversionRates(c: TECandidate, prior: TEPrior): TERates {
  const n = c.statTargets
  const receptions = c.receptions
  const catchRate = shrink(receptions !== undefined && n > 0 ? receptions / n : undefined, n, prior.catchRate, K.catchShrinkK)
  let ypc = shrink(receptions !== undefined && receptions > 0 ? c.receivingYards / receptions : undefined, receptions ?? 0,
    prior.yardsPerCatch, K.ypcShrinkK)
  // Tight ends gain more after the catch per air yard than receivers.
  if (c.adot !== undefined) ypc = 0.7 * ypc + 0.3 * (c.adot * 0.7 + 5.0)
  const perTarget = (x: number) => (n > 0 ? x / n : undefined)
  const firstDowns = shrink(c.firstDowns !== undefined ? perTarget(c.firstDowns) : undefined, n, prior.firstDowns, K.firstDownShrinkK)
  const touchdowns = shrink(perTarget(c.touchdowns), n, prior.touchdowns, K.touchdownShrinkK)
  const k = K.bigPlayShrinkK
  const p30 = shrink(perTarget(c.catches30), n, prior.p30, k)
  const p40 = Math.min(shrink(perTarget(c.catches40), n, prior.p40, k), p30)
  const p50 = Math.min(shrink(perTarget(c.catches50), n, prior.p50, k), p40)
  return { catchRate, yardsPerCatch: ypc, firstDowns, touchdowns, p30, p40, p50 }
}

export function teMatchupMultipliers(c: TECandidate): { dvp: number; coverage: number; redZone: number } {
  let dvp = 1.0
  if (c.dvpGames > 0) {
    const w = c.dvpGames / (c.dvpGames + K.dvpFullWeightGames)
    dvp = 1 + clamp((w * c.dvpPct) / 100, -K.dvpCap, K.dvpCap)
  }
  const coverage = 1 + clamp(c.seamCoverageAdj - 1, -K.coverageCap, K.coverageCap)
  const neutral = K.neutralRedZoneShare
  const rz = c.redZoneShare ?? neutral
  const redZone = 1 + clamp((rz - neutral) / neutral, -K.redZoneMultCap, K.redZoneMultCap)
  return { dvp, coverage, redZone }
}

const fmt = (x: number, places: number) => formatFixed(x, places)
const pct = (x: number) => `${Math.trunc(roundAwayFromZero(x * 100))}%`

export function projectTE(c: TECandidate, scoring: TEScoring, risk: StreamRiskMode = 'neutral'): TEProjection {
  const prior = TEStreamPriors.prior(c.role)
  const { attempts, environment: env } = teExpectedPassAttempts(c)
  const share = teProjectedTargetShare(c)
  const targets = attempts * share
  const r = teConversionRates(c, prior)
  const { dvp: dvpMult, coverage: covMult, redZone: rzMult } = teMatchupMultipliers(c)

  // The matchup acts on efficiency, not raw targets.
  const eff = dvpMult * covMult
  const eRec = targets * r.catchRate * (0.5 + 0.5 * eff)
  const eRecYd = eRec * r.yardsPerCatch * eff
  const eFd = targets * r.firstDowns * eff
  const eTd = targets * r.touchdowns * rzMult * (0.5 + 0.5 * eff)
  const e30 = targets * r.p30 * eff
  const e40 = targets * r.p40 * eff
  const e50 = targets * r.p50 * eff
  const eTd40 = e40 * K.touchdownShareOf40
  const eTd50 = e50 * K.touchdownShareOf50

  const perCatch = scoring.reception + scoring.premiumReception
  const perFirstDown = scoring.firstDown + scoring.premiumFirstDown
  const mean = eRecYd * scoring.receivingYard
    + eFd * perFirstDown
    + eTd * scoring.touchdown
    + eRec * perCatch
    + e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50
    - (K.fumblesPerCatch * eRec) * Math.abs(scoring.fumble)
    + eTd40 * scoring.touchdownBonus40 + eTd50 * scoring.touchdownBonus50

  // Each scoring event roughly Poisson in count; yards compound and lumpy.
  let variance = perFirstDown * perFirstDown * eFd
    + scoring.touchdown * scoring.touchdown * eTd
    + perCatch * perCatch * eRec * (1 - r.catchRate)
    + scoring.bonus30 * scoring.bonus30 * e30 + scoring.bonus40 * scoring.bonus40 * e40
    + scoring.bonus50 * scoring.bonus50 * e50
    + scoring.receivingYard * scoring.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
  variance += scoring.touchdownBonus40 * scoring.touchdownBonus40 * eTd40
    + scoring.touchdownBonus50 * scoring.touchdownBonus50 * eTd50
  const usageSD = mean * K.usageSDWeight * (1 - c.roleConf)
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
  if (c.statTargets > 0 && c.touchdowns / c.statTargets > 0.12) rawFlags.push('TD rate well above norm — regressed')
  const flags = [...new Set(rawFlags)]

  const routes = teEstimatedRouteShare(c)
  const pace = c.teamGames > 0 ? fmt(c.teamPassAttempts / c.teamGames, 1) : 'n/a'
  const spread = c.spreadOff >= 0 ? `+${fmt(c.spreadOff, 1)}` : fmt(c.spreadOff, 1)
  let shareLine = `× ${pct(share)} target share → ${fmt(targets, 1)} targets`
  if (routes !== undefined) shareLine += ` (est. route share ${pct(routes)})`
  if (c.vacatedTargetBoost > 0) shareLine += `, +${pct(Math.min(c.vacatedTargetBoost, K.vacatedBoostCap))} vacated`
  const explain = [
    `${fmt(attempts, 1)} expected team pass attempts (pace ${pace}/gm, environment ×${fmt(env, 3)} from O/U ${fmt(c.total, 1)} and spread ${spread})`,
    shareLine,
    `Per target: catch ${pct(r.catchRate)}, ${fmt(r.yardsPerCatch, 1)} yds/catch, first down ${pct(r.firstDowns)}, TD ${fmt(r.touchdowns * 100, 1)}%`,
    `TE matchup ×${fmt(dvpMult, 3)} · seam coverage ×${fmt(covMult, 2)} · red zone ×${fmt(rzMult, 2)} on TDs`,
    `P(plays) ${pct(pPlay)} (${PRACTICE_STATUS_LABEL[c.practice]})`,
  ]

  return {
    id: teCandidateID(c), name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
    platform: 'TE', roleLabel: TE_ROLE_LABEL[c.role],
    expPassAttempts: attempts, envMult: env, estRouteShare: routes, vacatedTargetBoost: c.vacatedTargetBoost,
    targetShare: share, expTargets: targets,
    dvpMult, coverageMult: covMult, redZoneMult: rzMult,
    eRec, eRecYd, eFirstDowns: eFd, eTouchdowns: eTd, e30, e40, e50,
    eTouchdowns40: eTd40, eTouchdowns50: eTd50,
    adot: c.adot, redZoneShare: c.redZoneShare,
    meanIfPlays: mean, sdIfPlays: sd, pPlay, expPts,
    floorP25: floor, ceilingP75: ceiling, utility,
    roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
    flags, notes: c.notes, sources: [...c.sources], explain,
  }
}

export type TEStreamReport = StreamReport<TEProjection>
export type TEComparison = StreamComparison<TEProjection>

/** Projects, compares with the incumbent and ranks in one call. */
export function teStreamReport(
  candidates: readonly TECandidate[], scoring: TEScoring,
  options: { incumbentID?: string; risk?: StreamRiskMode; onlyAvailable?: boolean } = {},
): TEStreamReport {
  const { incumbentID, risk = 'neutral', onlyAvailable = false } = options
  return streamReport(candidates.map((c) => projectTE(c, scoring, risk)), incumbentID, onlyAvailable)
}

/**
 * The role a tight end's usage points to: a top share, an inline TD role,
 * a part-time TE2, then aDOT for the rest.
 */
export function inferTERole(input: { targetShare?: number; adot?: number; redZoneShare?: number; snapShare?: number }): TERole {
  const share = input.targetShare ?? 0
  if (share >= 0.2) return 'FEATURED'
  if (share < 0.14 && (input.redZoneShare ?? 0) >= 0.22) return 'RED_ZONE'
  if (input.snapShare !== undefined && input.snapShare < 0.55) return 'ROTATIONAL'
  if (input.adot !== undefined && input.adot >= 9) return 'SEAM'
  return 'CHECKDOWN'
}
