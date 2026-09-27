/**
 * QB streaming model — a port of FCCore `QBStreamModel`: per-dropback
 * efficiency × dropbacks, in the league's own points, plus the rest-of-season
 * layer. Formulas and constants unchanged so the parity tests pin the port.
 */
import {
  PLAY_PROBABILITY, PRACTICE_STATUS_LABEL, QUARTILE_Z, blendedUtility, clamp, dvpMult, intKeyed, isStreamPractice,
  rosSummary, shrink,
  type StreamHorizon, type StreamPractice, type StreamReport, type StreamRiskMode, type StreamROS,
  type StreamROSProjection, type StreamStatPoints,
} from '../Stream'
import { formatFixed } from '../numeric'
import { roundAwayFromZero } from '../rounding'

// MARK: - Shared helpers (used by the D/ST and K ports too)

type Raw = Readonly<Record<string, unknown>>

/** Swift `String(format: "%.Nf", x)`. */
export const f = (x: number, places: number) => formatFixed(x, places)

/** Drops repeated flags, keeping the first occurrence. */
export function dedupeFlags(flags: readonly string[]): string[] {
  const seen = new Set<string>()
  return flags.filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
}

/** Swift `sorted { $0.points > $1.points }`. */
export const byPointsDesc = (xs: readonly StreamStatPoints[]) => [...xs].sort((a, b) => b.points - a.points)

const present = (v: unknown) => v !== undefined && v !== null

function fail(key: string, what: string): never {
  throw new TypeError(`stream candidate: ${key} ${what}`)
}

/** `decodeIfPresent(Double.self) ?? fallback`. */
export function decNum(o: Raw, key: string, fallback: number): number
export function decNum(o: Raw, key: string): number | undefined
export function decNum(o: Raw, key: string, fallback?: number): number | undefined {
  const v = o[key]
  if (!present(v)) return fallback
  if (typeof v !== 'number') fail(key, 'is not a number')
  return v
}

/** `decodeIfPresent(Int.self) ?? fallback`. */
export function decInt(o: Raw, key: string, fallback: number): number {
  const v = decNum(o, key, fallback)
  if (!Number.isInteger(v)) fail(key, 'is not an integer')
  return v
}

export function decStr(o: Raw, key: string): string {
  const v = o[key]
  if (typeof v !== 'string') fail(key, 'is missing')
  return v
}

export function decOptStr(o: Raw, key: string): string | undefined {
  const v = o[key]
  if (!present(v)) return undefined
  if (typeof v !== 'string') fail(key, 'is not a string')
  return v
}

export function decOptBool(o: Raw, key: string): boolean | undefined {
  const v = o[key]
  if (!present(v)) return undefined
  if (typeof v !== 'boolean') fail(key, 'is not a boolean')
  return v
}

export function decStrings(o: Raw, key: string): string[] {
  const v = o[key]
  if (!present(v)) return []
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) fail(key, 'is not a string array')
  return [...(v as string[])]
}

export function decDict<V>(o: Raw, key: string, isV: (x: unknown) => x is V): Record<string, V> {
  const v = o[key]
  if (!present(v)) return {}
  if (typeof v !== 'object' || Array.isArray(v)) fail(key, 'is not an object')
  const out: Record<string, V> = {}
  for (const [k, x] of Object.entries(v as Raw)) {
    if (!isV(x)) fail(key, `has a bad value at ${k}`)
    out[k] = x
  }
  return out
}

export const isNum = (x: unknown): x is number => typeof x === 'number'
export const isStr = (x: unknown): x is string => typeof x === 'string'
export const isBool = (x: unknown): x is boolean => typeof x === 'boolean'

export function decPractice(o: Raw): StreamPractice {
  const v = o.practice
  if (!present(v)) return 'none'
  if (!isStreamPractice(v)) fail('practice', 'is not a practice status')
  return v
}

/** The candidate fields every stream file shares. */
export interface StreamCandidateTail {
  currentWeek: number
  practice: StreamPractice
  rosterPct?: number
  available?: boolean
  notes: string
  sources: string[]
  dataFlags: string[]
  playerID?: string
}

export function decTail(o: Raw): StreamCandidateTail {
  return {
    currentWeek: decInt(o, 'current_week', 3),
    practice: decPractice(o),
    rosterPct: decNum(o, 'roster_pct'),
    available: decOptBool(o, 'available'),
    notes: decOptStr(o, 'notes') ?? '',
    sources: decStrings(o, 'sources'),
    dataFlags: decStrings(o, 'data_flags'),
    playerID: decOptStr(o, 'player_id'),
  }
}

// MARK: - Role and knobs

export type QBRole = 'POCKET' | 'MOBILE' | 'DUAL'
export const QB_ROLES: readonly QBRole[] = ['POCKET', 'MOBILE', 'DUAL']
export const QB_ROLE_LABEL: Readonly<Record<QBRole, string>> = { POCKET: 'Pocket', MOBILE: 'Mobile', DUAL: 'Dual-threat' }

/** Rushing priors per game (attempts) and per attempt. */
export const QB_RUSH_PRIOR: Readonly<Record<QBRole, { att: number; ypc: number; fd: number; td: number }>> = {
  POCKET: { att: 2.5, ypc: 3.0, fd: 0.22, td: 0.02 },
  MOBILE: { att: 5.5, ypc: 4.8, fd: 0.28, td: 0.035 },
  DUAL: { att: 9.0, ypc: 5.3, fd: 0.3, td: 0.045 },
}

export const QB_KNOBS = {
  // Per-attempt priors for a league-average passer.
  priorComp: 0.655, priorYPA: 7.0, priorTD: 0.046, priorINT: 0.022, priorFD: 0.335,
  prior30: 0.03, prior40: 0.014, prior50: 0.006,
  priorSack: 0.065,
  pickSixShare: 0.11,
  leagueAverageDropbacks: 37.0,
  volumeShrinkGames: 3.0,
  totalSlope: 0.006, spreadSlope: 0.008,
  environmentRange: [0.82, 1.18] as const,
  compK: 120.0, ypaK: 150.0, tdK: 250.0, intK: 250.0, fdK: 120.0, sackK: 150.0, bigPlayK: 250.0,
  rushAttK: 8.0, rushYPCK: 25.0, rushFDK: 25.0, rushTDK: 60.0,
  oppCompCap: 0.06, oppSackCap: 0.35, oppIntCap: 0.4, dvpCap: 0.12,
  fumblePerSack: 0.12, fumblePerRush: 0.012, fumbleLostShare: 0.5,
  /** Share of 40+/50+ yard completions that are touchdowns — heuristic. */
  touchdownShareOf40: 0.3, touchdownShareOf50: 0.4,
} as const

// MARK: - Scoring

/** The league's passing and QB rushing scoring. */
export interface QBScoring {
  passYard: number; passTD: number; passFirstDown: number; incompletion: number; sack: number; interception: number
  pickSixExtra: number; rushYard: number; rushFirstDown: number; rushTD: number; fumble: number; fumbleLost: number
  bonus30: number; bonus40: number; bonus50: number; touchdownBonus40: number; touchdownBonus50: number
}

const zeroQBScoring: QBScoring = {
  passYard: 0, passTD: 0, passFirstDown: 0, incompletion: 0, sack: 0, interception: 0, pickSixExtra: 0, rushYard: 0,
  rushFirstDown: 0, rushTD: 0, fumble: 0, fumbleLost: 0, bonus30: 0, bonus40: 0, bonus50: 0, touchdownBonus40: 0, touchdownBonus50: 0,
}

/** The reference's defaults: Connor's passing scoring as it read it. */
export const QB_SCORING_REFERENCE: Readonly<QBScoring> = {
  ...zeroQBScoring,
  passYard: 0.05, passTD: 6, passFirstDown: 1, incompletion: -1, sack: -1, interception: -5, pickSixExtra: -5,
  rushYard: 0.1, rushFirstDown: 1, rushTD: 6, fumble: -3, fumbleLost: -2,
}

/** Sleeper sums every stat a play records, so tiers stack. */
export function qbScoringFromSleeper(s: Readonly<Record<string, number>>): QBScoring {
  const range30 = s.pass_cmp_30_39 ?? 0
  const over40 = s.pass_cmp_40p ?? 0
  const over50 = s.pass_cmp_50p
  return {
    passYard: s.pass_yd ?? 0, passTD: s.pass_td ?? 0, passFirstDown: s.pass_fd ?? 0,
    incompletion: s.pass_inc ?? 0, sack: s.pass_sack ?? 0, interception: s.pass_int ?? 0,
    pickSixExtra: s.pass_int_td ?? 0,
    rushYard: s.rush_yd ?? 0, rushFirstDown: s.rush_fd ?? 0, rushTD: s.rush_td ?? 0,
    fumble: s.fum ?? 0, fumbleLost: s.fum_lost ?? 0,
    bonus30: range30, bonus40: over40 - range30, bonus50: over50 !== undefined ? over50 - over40 : 0,
    touchdownBonus40: s.pass_td_40p ?? 0, touchdownBonus50: s.pass_td_50p ?? 0,
  }
}

const QB_MODELLED_KEYS: ReadonlySet<string> = new Set([
  'pass_yd', 'pass_td', 'pass_fd', 'pass_inc', 'pass_sack', 'pass_int', 'pass_int_td',
  'pass_cmp_30_39', 'pass_cmp_40p', 'pass_cmp_50p', 'pass_td_40p', 'pass_td_50p',
  'rush_yd', 'rush_fd', 'rush_td', 'fum', 'fum_lost', 'pass_att', 'pass_cmp',
])

/** Passing keys the league pays that aren't projected, named on screen. */
export function qbUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !QB_MODELLED_KEYS.has(key) && (key.startsWith('pass') || key.startsWith('bonus_pass')))
    .map(([key]) => key)
    .sort()
}

// MARK: - Candidate

export interface QBCandidate extends StreamCandidateTail {
  name: string
  team: string
  role: QBRole
  opp: string
  home?: boolean
  /** His team's spread: positive = underdog. */
  spreadOff: number
  total: number
  teamDropbacks: number
  teamGames: number
  /** P(he takes ~all dropbacks if active). */
  starterConf: number
  att: number; comp: number; passYd: number; passTd: number; ints: number; sacks: number
  passFd?: number
  pickSix: number; comp30p: number; comp40p: number; comp50p: number
  games: number
  rushAtt: number; rushYd: number; rushTd: number
  rushFd?: number
  fumblesLost: number
  dvpPct: number
  dvpGames: number
  oppCompAllowed?: number
  oppSackRate?: number
  oppIntRate?: number
  leagueComp: number; leagueSack: number; leagueInt: number
  /** Week → opponent for the whole season (the bye is missing). */
  schedule: Map<number, string>
  /** Opponent → generosity to QBs, % vs average. */
  oppDvp: Record<string, number>
}

export const candidateID = (c: { playerID?: string; name: string }) => c.playerID ?? c.name

/** Decodes one candidate with Swift's CodingKeys and defaults. */
export function decodeQBCandidate(raw: unknown): QBCandidate {
  const o = raw as Raw
  const role = o.role
  if (!QB_ROLES.includes(role as QBRole)) fail('role', 'is not a QB role')
  return {
    name: decStr(o, 'name'), team: decStr(o, 'team'), role: role as QBRole, opp: decStr(o, 'opp'),
    home: decOptBool(o, 'home'),
    spreadOff: decNum(o, 'spread_off', 0), total: decNum(o, 'total', 45),
    teamDropbacks: decNum(o, 'team_dropbacks', 0), teamGames: decInt(o, 'team_games', 0),
    starterConf: decNum(o, 'starter_conf', 0.9),
    att: decNum(o, 'att', 0), comp: decNum(o, 'comp', 0), passYd: decNum(o, 'pass_yd', 0), passTd: decNum(o, 'pass_td', 0),
    ints: decNum(o, 'ints', 0), sacks: decNum(o, 'sacks', 0), passFd: decNum(o, 'pass_fd'),
    pickSix: decNum(o, 'pick_six', 0), comp30p: decNum(o, 'comp_30p', 0), comp40p: decNum(o, 'comp_40p', 0),
    comp50p: decNum(o, 'comp_50p', 0),
    games: decInt(o, 'games', 0),
    rushAtt: decNum(o, 'rush_att', 0), rushYd: decNum(o, 'rush_yd', 0), rushTd: decNum(o, 'rush_td', 0),
    rushFd: decNum(o, 'rush_fd'), fumblesLost: decNum(o, 'fumbles_lost', 0),
    dvpPct: decNum(o, 'dvp_pct', 0), dvpGames: decInt(o, 'dvp_games', 0),
    oppCompAllowed: decNum(o, 'opp_comp_allowed'), oppSackRate: decNum(o, 'opp_sack_rate'), oppIntRate: decNum(o, 'opp_int_rate'),
    leagueComp: decNum(o, 'league_comp', 0.655), leagueSack: decNum(o, 'league_sack', 0.065), leagueInt: decNum(o, 'league_int', 0.022),
    schedule: intKeyed(decDict(o, 'schedule', isStr)),
    oppDvp: decDict(o, 'opp_dvp', isNum),
    ...decTail(o),
  }
}

// MARK: - Projection

export interface QBProjection extends StreamROSProjection {
  role: QBRole
  expDropbacks: number
  envMult: number
  expAtt: number
  eComp: number
  eInc: number
  compRate: number
  ePassYd: number
  ePassTd: number
  eInt: number
  eSacks: number
  ePassFd: number
  eRushAtt: number
  eRushYd: number
  eRushFd: number
  eRushTd: number
  dvpMult: number
  compAdj: number
  sackAdj: number
  intAdj: number
  ros: StreamROS
  starterConf: number
  rosterPct?: number
  /** Points by stat, if he plays. */
  breakdown: StreamStatPoints[]
}

// MARK: - Engine

interface Rates {
  comp: number; ypa: number; td: number; int: number; fd: number; p30: number; p40: number; p50: number; sack: number
  rushAtt: number; rushYPC: number; rushFD: number; rushTD: number
}

function rates(c: QBCandidate): Rates {
  const K = QB_KNOBS
  const a = c.att
  const per = (x: number) => (a > 0 ? x / a : undefined)
  const comp = shrink(per(c.comp), a, K.priorComp, K.compK)
  const ypa = shrink(per(c.passYd), a, K.priorYPA, K.ypaK)
  const td = shrink(per(c.passTd), a, K.priorTD, K.tdK)
  const int = shrink(per(c.ints), a, K.priorINT, K.intK)
  const fd = shrink(c.passFd === undefined ? undefined : per(c.passFd), a, K.priorFD, K.fdK)
  const p30 = shrink(per(c.comp30p), a, K.prior30, K.bigPlayK)
  let p40 = shrink(per(c.comp40p), a, K.prior40, K.bigPlayK)
  let p50 = shrink(per(c.comp50p), a, K.prior50, K.bigPlayK)
  const db = a + c.sacks
  const sack = shrink(db > 0 ? c.sacks / db : undefined, db, K.priorSack, K.sackK)
  p40 = Math.min(p40, p30); p50 = Math.min(p50, p40)
  const rp = QB_RUSH_PRIOR[c.role], g = c.games
  const rushAtt = shrink(c.games > 0 ? c.rushAtt / g : undefined, g, rp.att, K.rushAttK)
  const rushYPC = shrink(c.rushAtt > 0 ? c.rushYd / c.rushAtt : undefined, c.rushAtt, rp.ypc, K.rushYPCK)
  const rushFD = shrink(c.rushAtt > 0 && c.rushFd !== undefined ? c.rushFd / c.rushAtt : undefined, c.rushAtt, rp.fd, K.rushFDK)
  const rushTD = shrink(c.rushAtt > 0 ? c.rushTd / c.rushAtt : undefined, c.rushAtt, rp.td, K.rushTDK)
  return { comp, ypa, td, int, fd, p30, p40, p50, sack, rushAtt, rushYPC, rushFD, rushTD }
}

function matchup(c: QBCandidate): [number, number, number, number] {
  const K = QB_KNOBS
  const m = dvpMult(c.dvpPct, c.dvpGames, 6, K.dvpCap)
  const comp = c.oppCompAllowed !== undefined ? 1 + clamp(((c.oppCompAllowed - c.leagueComp) / c.leagueComp) * 0.5, -K.oppCompCap, K.oppCompCap) : 1
  const sack = c.oppSackRate !== undefined ? 1 + clamp((c.oppSackRate / c.leagueSack - 1) * 0.5, -K.oppSackCap, K.oppSackCap) : 1
  const int = c.oppIntRate !== undefined ? 1 + clamp((c.oppIntRate / c.leagueInt - 1) * 0.5, -K.oppIntCap, K.oppIntCap) : 1
  return [m, comp, sack, int]
}

interface QBCore {
  dropbacks: number; env: number; attempts: number; eComp: number; eInc: number; eYds: number; eTd: number; eInt: number
  eSacks: number; eFd: number; eRushAtt: number; eRushYd: number; eRushFd: number; eRushTd: number
  compRate: number; sackRate: number; dvp: number; compAdj: number; sackAdj: number; intAdj: number; mean: number; sd: number
  breakdown: StreamStatPoints[]
}

function core(c: QBCandidate, s: QBScoring, neutral: boolean): QBCore {
  const K = QB_KNOBS
  const g = c.teamGames
  const baseDB = shrink(c.teamGames > 0 ? c.teamDropbacks / g : undefined, g, K.leagueAverageDropbacks, K.volumeShrinkGames)
  const env = neutral ? 1 : clamp(1 + K.totalSlope * (c.total - 45) + K.spreadSlope * c.spreadOff, K.environmentRange[0], K.environmentRange[1])
  const dropbacks = baseDB * env * c.starterConf
  const r = rates(c)
  const [m, compAdj, sackAdj, intAdj] = neutral ? [1, 1, 1, 1] : matchup(c)

  const sackRate = clamp(r.sack * sackAdj, 0.01, 0.2)
  const eSacks = dropbacks * sackRate
  const attempts = dropbacks - eSacks
  const compRate = clamp(r.comp * compAdj, 0.45, 0.8)
  const eComp = attempts * compRate
  const eInc = attempts - eComp
  const eYds = attempts * r.ypa * m
  const eTd = attempts * r.td * m
  const eInt = attempts * r.int * intAdj
  const eP6 = eInt * K.pickSixShare
  const eFd = attempts * r.fd * (0.5 + 0.5 * m) * (compRate / r.comp)
  const e30 = attempts * r.p30 * m, e40 = attempts * r.p40 * m, e50 = attempts * r.p50 * m
  const eRAtt = r.rushAtt * env * c.starterConf
  const eRYd = eRAtt * r.rushYPC
  const eRFd = eRAtt * r.rushFD
  const eRTd = eRAtt * r.rushTD
  const eFum = eSacks * K.fumblePerSack + eRAtt * K.fumblePerRush
  const eTd40 = e40 * K.touchdownShareOf40, eTd50 = e50 * K.touchdownShareOf50

  const parts: [string, number, number][] = [
    ['Pass yards', eYds, eYds * s.passYard],
    ['Pass first downs', eFd, eFd * s.passFirstDown],
    ['Pass TD', eTd, eTd * s.passTD],
    ['Incompletions', eInc, eInc * s.incompletion],
    ['Sacks', eSacks, eSacks * s.sack],
    ['Interceptions', eInt, eInt * s.interception + eP6 * s.pickSixExtra],
    ['Rushing', eRAtt, eRYd * s.rushYard + eRFd * s.rushFirstDown + eRTd * s.rushTD],
    ['Fumbles', eFum, eFum * (s.fumble + K.fumbleLostShare * s.fumbleLost)],
    ['Long completions', e30, e30 * s.bonus30 + e40 * s.bonus40 + e50 * s.bonus50],
    ['Long TDs', eTd40, eTd40 * s.touchdownBonus40 + eTd50 * s.touchdownBonus50],
  ]
  const mean = parts.reduce((acc, p) => acc + p[2], 0)
  let v = s.passTD * s.passTD * eTd
  const intPts = s.interception + K.pickSixShare * s.pickSixExtra
  v += intPts * intPts * eInt
  v += s.incompletion * s.incompletion * attempts * compRate * (1 - compRate) * 1.3
  v += s.sack * s.sack * eSacks + s.passFirstDown * s.passFirstDown * eFd * 0.6
  v += s.passYard * s.passYard * (attempts * r.ypa * r.ypa * 1.8)
  v += s.rushTD * s.rushTD * eRTd + s.rushYard * s.rushYard * eRAtt * r.rushYPC * r.rushYPC * 2.0
    + s.rushFirstDown * s.rushFirstDown * eRFd
  v += s.fumble * s.fumble * eFum
  v += s.bonus30 * s.bonus30 * e30 + s.bonus40 * s.bonus40 * e40 + s.bonus50 * s.bonus50 * e50
  v += s.touchdownBonus40 * s.touchdownBonus40 * eTd40 + s.touchdownBonus50 * s.touchdownBonus50 * eTd50
  const usageSD = mean * 0.25 * (1 - c.starterConf)
  const sd = Math.sqrt(v + usageSD * usageSD)
  return {
    dropbacks, env, attempts, eComp, eInc, eYds, eTd, eInt, eSacks, eFd, eRushAtt: eRAtt, eRushYd: eRYd, eRushFd: eRFd, eRushTd: eRTd,
    compRate, sackRate, dvp: m, compAdj, sackAdj, intAdj, mean, sd,
    breakdown: parts.map(([stat, count, points]) => ({ stat, count, points })).filter((p) => p.points !== 0),
  }
}

export function projectQB(c: QBCandidate, s: QBScoring, risk: StreamRiskMode = 'neutral', horizon: StreamHorizon = 'week'): QBProjection {
  const x = core(c, s, false)
  const n = core(c, s, true)
  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * x.mean
  const z = QUARTILE_Z
  const ros = rosSummary({
    currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp, dvpGames: c.dvpGames, neutralMean: n.mean, cap: QB_KNOBS.dvpCap,
  })
  const utility = blendedUtility(expPts, x.sd, ros.perGame, pPlay, risk, horizon)
  const raw = [...c.dataFlags]
  if (c.att < 40) raw.push('thin passing sample')
  if (c.passFd === undefined) raw.push('pass first-down rate from league prior')
  if (c.available === undefined) raw.push('availability unverified')
  if (c.schedule.size === 0) raw.push('no remaining schedule → ROS = neutral')
  const flags = dedupeFlags(raw)

  const spread = c.spreadOff >= 0 ? `+${f(c.spreadOff, 1)}` : f(c.spreadOff, 1)
  const explain = [
    `${f(x.dropbacks, 1)} dropbacks (script ×${f(x.env, 3)} from O/U ${f(c.total, 1)}, spread ${spread}) → ${f(x.attempts, 1)} attempts, ${f(x.eSacks, 1)} sacks`,
    `Completion ${roundAwayFromZero(x.compRate * 100)}% → ${f(x.eInc, 1)} incompletions; ${f(x.eFd, 1)} passing first downs`,
    `${f(x.eYds, 0)} pass yds, ${f(x.eTd, 2)} TD, ${f(x.eInt, 2)} INT · rushing ${f(x.eRushYd, 0)} yds, ${f(x.eRushFd, 1)} first downs`,
    `Matchup: QB points ×${f(x.dvp, 3)} · completions ×${f(x.compAdj, 3)} · sacks ×${f(x.sackAdj, 3)} · INTs ×${f(x.intAdj, 3)}`,
    `Rest of season ${f(ros.perGame, 1)}/g over ${ros.games} games` + (ros.byeWeek !== undefined ? ` (bye W${ros.byeWeek})` : ''),
    `P(plays) ${roundAwayFromZero(pPlay * 100)}% (${PRACTICE_STATUS_LABEL[c.practice]}) · starter confidence ${f(c.starterConf, 2)}`,
  ]
  return {
    id: candidateID(c), name: c.name, team: c.team, role: c.role, opponent: c.opp, playerID: c.playerID,
    platform: 'QB', roleLabel: QB_ROLE_LABEL[c.role], roleConf: c.starterConf,
    expDropbacks: x.dropbacks, envMult: x.env, expAtt: x.attempts, eComp: x.eComp, eInc: x.eInc,
    compRate: x.compRate, ePassYd: x.eYds, ePassTd: x.eTd, eInt: x.eInt, eSacks: x.eSacks, ePassFd: x.eFd,
    eRushAtt: x.eRushAtt, eRushYd: x.eRushYd, eRushFd: x.eRushFd, eRushTd: x.eRushTd,
    dvpMult: x.dvp, compAdj: x.compAdj, sackAdj: x.sackAdj, intAdj: x.intAdj,
    meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay, expPts,
    floorP25: Math.max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
    utility, neutralMean: n.mean, ros, starterConf: c.starterConf, practice: c.practice,
    rosterPct: c.rosterPct, available: c.available, flags, notes: c.notes, sources: c.sources,
    explain, breakdown: byPointsDesc(x.breakdown),
  }
}

export type QBStreamReport = StreamReport<QBProjection>
