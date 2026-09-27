/**
 * IDP streaming model — a port of FCCore `IDPStreamModel`: a two-stage
 * opportunity × conversion projection for one week, in the league's own
 * points, handed to the shared decision layer in `Stream.ts`.
 *
 * Every prior and knob is heuristic until a backtest has data; every
 * projection carries an `explain` trail.
 */
import { IDP, positionFromSleeper, type Position } from '../Position'
import { formatFixed } from '../numeric'
import { roundAwayFromZero } from '../rounding'
import {
  PLAY_PROBABILITY, PRACTICE_STATUS_LABEL, QUARTILE_Z, clamp, compareStream, isStreamPractice, pBeat as streamPBeat,
  shrink, streamReport,
  type StreamComparison, type StreamPractice, type StreamProjection, type StreamReport, type StreamRiskMode,
  type StreamStatPoints,
} from '../Stream'

// MARK: - Positions

export const IDP_SUB_POSITIONS = ['LB', 'EDGE', 'IDL', 'S_BOX', 'S_FREE', 'CB'] as const
/** The alignment a defender actually plays; Sleeper only says LB/DL/DB. */
export type IDPSubPosition = (typeof IDP_SUB_POSITIONS)[number]

export const isIDPSubPosition = (v: unknown): v is IDPSubPosition => IDP_SUB_POSITIONS.includes(v as IDPSubPosition)

/** The platform position Sleeper slots him at. */
export const IDP_PLATFORM: Readonly<Record<IDPSubPosition, Position>> = {
  LB: 'LB', EDGE: 'DL', IDL: 'DL', S_BOX: 'DB', S_FREE: 'DB', CB: 'DB',
}

export const IDP_SUB_POSITION_LABEL: Readonly<Record<IDPSubPosition, string>> = {
  LB: 'LB', EDGE: 'EDGE', IDL: 'IDL', S_BOX: 'Box S', S_FREE: 'Free S', CB: 'CB',
}

/**
 * The alignment from Sleeper's position code and depth-chart position. The
 * platform position always wins. `inferred` is true when neither field states
 * the alignment and it was defaulted (bare DB → box safety, bare DL → edge).
 */
export function resolveIDPSubPosition(positionCode: string | null | undefined, depthChartPosition: string | null | undefined):
  { position: IDPSubPosition; inferred: boolean } | undefined {
  const platform = positionFromSleeper(positionCode)
  if (platform === undefined || !IDP.has(platform)) return undefined
  const code = positionCode?.toUpperCase() ?? ''
  const depth = depthChartPosition?.toUpperCase() ?? ''
  switch (platform) {
    case 'LB':
      return { position: 'LB', inferred: false }
    case 'DL':
      switch (depth) {
        case 'NT': case 'DT': case 'LDT': case 'RDT': return { position: 'IDL', inferred: false }
        case 'LDE': case 'RDE': case 'DE': case 'LOLB': case 'ROLB': case 'OLB': case 'EDGE': return { position: 'EDGE', inferred: false }
      }
      switch (code) {
        case 'DT': case 'NT': return { position: 'IDL', inferred: false }
        case 'DE': return { position: 'EDGE', inferred: false }
        default: return { position: 'EDGE', inferred: true }
      }
    default:
      switch (depth) {
        case 'SS': return { position: 'S_BOX', inferred: false }
        case 'FS': return { position: 'S_FREE', inferred: false }
        case 'LCB': case 'RCB': case 'CB': case 'NB': return { position: 'CB', inferred: false }
      }
      switch (code) {
        case 'CB': return { position: 'CB', inferred: false }
        case 'SS': return { position: 'S_BOX', inferred: false }
        case 'FS': return { position: 'S_FREE', inferred: false }
        default: return { position: 'S_BOX', inferred: true }
      }
  }
}

// MARK: - Priors and knobs

/** Per-defensive-snap priors for one sub-position. */
export interface IDPPrior {
  tackles: number
  soloShare: number
  sacks: number
  tfl: number
  passesDefended: number
  interceptions: number
  forcedFumbles: number
  qbHits: number
}

/** Heuristic starting points. Replace with backtested values. */
export const IDP_PRIORS: Readonly<Record<IDPSubPosition, IDPPrior>> = {
  LB: { tackles: 0.115, soloShare: 0.60, sacks: 0.0030, tfl: 0.011, passesDefended: 0.005, interceptions: 0.0010, forcedFumbles: 0.0010, qbHits: 0.006 },
  EDGE: { tackles: 0.060, soloShare: 0.60, sacks: 0.0100, tfl: 0.014, passesDefended: 0.002, interceptions: 0.0003, forcedFumbles: 0.0025, qbHits: 0.022 },
  IDL: { tackles: 0.050, soloShare: 0.58, sacks: 0.0060, tfl: 0.012, passesDefended: 0.001, interceptions: 0.0001, forcedFumbles: 0.0010, qbHits: 0.014 },
  S_BOX: { tackles: 0.095, soloShare: 0.68, sacks: 0.0012, tfl: 0.006, passesDefended: 0.010, interceptions: 0.0018, forcedFumbles: 0.0010, qbHits: 0.003 },
  S_FREE: { tackles: 0.070, soloShare: 0.70, sacks: 0.0005, tfl: 0.004, passesDefended: 0.012, interceptions: 0.0022, forcedFumbles: 0.0007, qbHits: 0.001 },
  CB: { tackles: 0.065, soloShare: 0.75, sacks: 0.0003, tfl: 0.004, passesDefended: 0.020, interceptions: 0.0025, forcedFumbles: 0.0007, qbHits: 0.001 },
}

export const idpPrior = (position: IDPSubPosition): IDPPrior => IDP_PRIORS[position]

export const IDP_STREAM_KNOBS = {
  leagueAverageDefensivePlays: 62.0,
  playsShrinkGames: 3.0,
  totalSlope: 0.004,
  spreadSlope: 0.006,
  snapsShrinkK: 120.0,
  soloShrinkK: 20.0,
  bigPlayShrinkK: 400.0,
  dvpFullWeightGames: 6.0,
  dvpCap: 0.12,
  sackEnvironmentCap: 0.35,
  recencyWeightLast1: 0.6,
  rolePriorWeight: 0.25,
  /** Below this many snaps the conversion sample is flagged as thin. */
  thinSampleSnaps: 60.0,
} as const

/** SD weight added to expected points to form utility (IDP's own; not the shared ROS weights). */
export function idpRiskWeight(risk: StreamRiskMode): number {
  switch (risk) {
    case 'floor': return -0.5
    case 'neutral': return -0.2
    case 'ceiling': return 0.2
  }
}

// MARK: - Scoring

/**
 * The league's IDP scoring, per event. Sleeper pays `idp_tkl` on every tackle
 * on top of solo/assist. A key the league does not set is worth nothing.
 */
export interface IDPScoring {
  solo: number
  ast: number
  sack: number
  tfl: number
  pd: number
  int: number
  ff: number
  fr: number
  td: number
  qbHit: number
}

export function idpScoring(values: Partial<IDPScoring> = {}): IDPScoring {
  return {
    solo: values.solo ?? 0, ast: values.ast ?? 0, sack: values.sack ?? 0, tfl: values.tfl ?? 0,
    pd: values.pd ?? 0, int: values.int ?? 0, ff: values.ff ?? 0, fr: values.fr ?? 0,
    td: values.td ?? 0, qbHit: values.qbHit ?? 0,
  }
}

/** Builds from a league's `scoring_settings`. */
export function idpScoringFromSleeper(s: Readonly<Record<string, number>>): IDPScoring {
  const perTackle = s['idp_tkl'] ?? 0
  return {
    solo: perTackle + (s['idp_tkl_solo'] ?? 0),
    ast: perTackle + (s['idp_tkl_ast'] ?? 0),
    sack: s['idp_sack'] ?? 0,
    tfl: s['idp_tkl_loss'] ?? 0,
    pd: s['idp_pass_def'] ?? 0,
    int: s['idp_int'] ?? 0,
    ff: s['idp_ff'] ?? 0,
    fr: s['idp_fum_rec'] ?? 0,
    td: s['idp_def_td'] ?? 0,
    qbHit: s['idp_qb_hit'] ?? 0,
  }
}

/** Keys the engine reads, directly or folded into another field. */
export const IDP_MODELLED_KEYS: ReadonlySet<string> = new Set([
  'idp_tkl', 'idp_tkl_solo', 'idp_tkl_ast', 'idp_sack', 'idp_tkl_loss',
  'idp_pass_def', 'idp_int', 'idp_ff', 'idp_qb_hit',
])

/** Non-zero IDP keys the league pays for that the engine does not project, sorted. */
export function idpUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([k, v]) => k.startsWith('idp_') && v !== 0 && !IDP_MODELLED_KEYS.has(k))
    .map(([k]) => k)
    .sort()
}

// MARK: - Candidate (input)

/**
 * One defender's evidence for one week. Stats are season-to-date over
 * `statSnaps`; game environment is from the defender's team's perspective.
 */
export interface IDPCandidate {
  name: string
  team: string
  position: IDPSubPosition
  opponent: string
  home?: boolean
  /** Positive = his team is the underdog. */
  spreadDef: number
  total: number
  teamDefPlays: number
  teamGames: number
  snapShareLast1?: number
  snapShareLast3?: number
  snapShareEst?: number
  roleConf: number
  statSnaps: number
  solo?: number
  ast?: number
  comb?: number
  sacks: number
  tfl: number
  pd: number
  int: number
  ff: number
  qbHits: number
  pressures?: number
  dvpPct: number
  dvpGames: number
  oppSackEnv: number
  practice: StreamPractice
  rosterPct?: number
  available?: boolean
  notes: string
  sources: string[]
  dataFlags: string[]
  playerID?: string
}

export const idpCandidateID = (c: IDPCandidate) => c.playerID ?? c.name

/** A candidate with Swift's memberwise-init defaults for anything omitted. */
export function idpCandidate(values: Pick<IDPCandidate, 'name' | 'team' | 'position' | 'opponent'> & Partial<IDPCandidate>): IDPCandidate {
  return {
    spreadDef: 0, total: 45, teamDefPlays: 0, teamGames: 0, roleConf: 0.7, statSnaps: 0,
    sacks: 0, tfl: 0, pd: 0, int: 0, ff: 0, qbHits: 0, dvpPct: 0, dvpGames: 0, oppSackEnv: 1,
    practice: 'none', notes: '', sources: [], dataFlags: [],
    ...values,
  }
}

export interface IDPDecodeOptions {
  /** Mirror `JSONDecoder.keyDecodingStrategy = .convertFromSnakeCase`. */
  convertFromSnakeCase?: boolean
}

/** Foundation's `convertFromSnakeCase` for one key. */
export function convertFromSnakeCase(key: string): string {
  if (!key.includes('_')) return key
  const first = key.search(/[^_]/)
  if (first < 0) return key
  let last = key.length - 1
  while (last > first && key[last] === '_') last--
  const leading = key.slice(0, first)
  const trailing = key.slice(last + 1)
  const parts = key.slice(first, last + 1).split('_').filter((p) => p.length > 0)
  const joined = parts[0]! + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('')
  return leading + joined + trailing
}

type Raw = Record<string, unknown>

function keyed(raw: unknown, options: IDPDecodeOptions): Raw {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('expected a JSON object')
  if (!options.convertFromSnakeCase) return raw as Raw
  const out: Raw = {}
  for (const [k, v] of Object.entries(raw as Raw)) out[convertFromSnakeCase(k)] = v
  return out
}

function optNumber(o: Raw, key: string): number | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number') throw new TypeError(`${key}: expected a number`)
  return v
}

function optInt(o: Raw, key: string): number | undefined {
  const v = optNumber(o, key)
  if (v !== undefined && !Number.isInteger(v)) throw new TypeError(`${key}: expected an integer`)
  return v
}

function optString(o: Raw, key: string): string | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new TypeError(`${key}: expected a string`)
  return v
}

function optBool(o: Raw, key: string): boolean | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new TypeError(`${key}: expected a boolean`)
  return v
}

function optStrings(o: Raw, key: string): string[] | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new TypeError(`${key}: expected [String]`)
  return v as string[]
}

function required<T>(v: T | undefined, key: string): T {
  if (v === undefined) throw new TypeError(`${key}: missing`)
  return v
}

/** `IDPScoring.init(from:)`: every key optional, defaulting to 0. */
export function decodeIDPScoring(raw: unknown, options: IDPDecodeOptions = {}): IDPScoring {
  const o = keyed(raw, options)
  const v = (k: keyof IDPScoring) => optNumber(o, k) ?? 0
  return {
    solo: v('solo'), ast: v('ast'), sack: v('sack'), tfl: v('tfl'), pd: v('pd'),
    int: v('int'), ff: v('ff'), fr: v('fr'), td: v('td'), qbHit: v('qbHit'),
  }
}

/** `IDPCandidate.init(from:)`: tolerant, same keys (`pos`, `opp`, `playerId`) and defaults. */
export function decodeIDPCandidate(raw: unknown, options: IDPDecodeOptions = {}): IDPCandidate {
  const o = keyed(raw, options)
  const pos = required(optString(o, 'pos'), 'pos')
  if (!isIDPSubPosition(pos)) throw new TypeError(`pos: unknown sub-position ${pos}`)
  const practice = optString(o, 'practice')
  if (practice !== undefined && !isStreamPractice(practice)) throw new TypeError(`practice: unknown status ${practice}`)
  return {
    name: required(optString(o, 'name'), 'name'),
    team: required(optString(o, 'team'), 'team'),
    position: pos,
    opponent: optString(o, 'opp') ?? '',
    home: optBool(o, 'home'),
    spreadDef: optNumber(o, 'spreadDef') ?? 0,
    total: optNumber(o, 'total') ?? 45,
    teamDefPlays: optNumber(o, 'teamDefPlays') ?? 0,
    teamGames: optInt(o, 'teamGames') ?? 0,
    snapShareLast1: optNumber(o, 'snapShareLast1'),
    snapShareLast3: optNumber(o, 'snapShareLast3'),
    snapShareEst: optNumber(o, 'snapShareEst'),
    roleConf: optNumber(o, 'roleConf') ?? 0.7,
    statSnaps: optNumber(o, 'statSnaps') ?? 0,
    solo: optNumber(o, 'solo'),
    ast: optNumber(o, 'ast'),
    comb: optNumber(o, 'comb'),
    sacks: optNumber(o, 'sacks') ?? 0,
    tfl: optNumber(o, 'tfl') ?? 0,
    pd: optNumber(o, 'pd') ?? 0,
    int: optNumber(o, 'int') ?? 0,
    ff: optNumber(o, 'ff') ?? 0,
    qbHits: optNumber(o, 'qbHits') ?? 0,
    pressures: optNumber(o, 'pressures'),
    dvpPct: optNumber(o, 'dvpPct') ?? 0,
    dvpGames: optInt(o, 'dvpGames') ?? 0,
    oppSackEnv: optNumber(o, 'oppSackEnv') ?? 1,
    practice: practice ?? 'none',
    rosterPct: optNumber(o, 'rosterPct'),
    available: optBool(o, 'available'),
    notes: optString(o, 'notes') ?? '',
    sources: optStrings(o, 'sources') ?? [],
    dataFlags: optStrings(o, 'dataFlags') ?? [],
    playerID: optString(o, 'playerId'),
  }
}

// MARK: - Projection (output)

export interface IDPProjection extends StreamProjection {
  position: IDPSubPosition
  expPlays: number
  envMult: number
  snapShare: number
  expSnaps: number
  tklMult: number
  sackMult: number
  eSolo: number
  eAst: number
  eSack: number
  eTfl: number
  ePd: number
  eInt: number
  eFf: number
  eQbHit: number
  rosterPct?: number
}

export const expTackles = (p: IDPProjection) => p.eSolo + p.eAst

/** Expected count and points per paid stat, largest first; sums to `meanIfPlays`. */
export function pointsBreakdown(p: IDPProjection, scoring: IDPScoring): StreamStatPoints[] {
  return [
    { stat: 'Solo', count: p.eSolo, points: p.eSolo * scoring.solo },
    { stat: 'Assist', count: p.eAst, points: p.eAst * scoring.ast },
    { stat: 'Sack', count: p.eSack, points: p.eSack * scoring.sack },
    { stat: 'TFL', count: p.eTfl, points: p.eTfl * scoring.tfl },
    { stat: 'QB hit', count: p.eQbHit, points: p.eQbHit * scoring.qbHit },
    { stat: 'Pass def', count: p.ePd, points: p.ePd * scoring.pd },
    { stat: 'INT', count: p.eInt, points: p.eInt * scoring.int },
    { stat: 'FF', count: p.eFf, points: p.eFf * scoring.ff },
  ]
    .filter((s) => s.points !== 0)
    .sort((a, b) => b.points - a.points)
}

export type IDPStreamReport = StreamReport<IDPProjection>
export type IDPComparison = StreamComparison<IDPProjection>

// MARK: - Engine

/** Stage 1 — opportunity: expected defensive plays and the game-environment multiplier. */
export function expectedDefensivePlays(c: IDPCandidate): { plays: number; environment: number } {
  const K = IDP_STREAM_KNOBS
  const perGame = c.teamGames > 0 ? c.teamDefPlays / c.teamGames : undefined
  const base = shrink(perGame, c.teamGames, K.leagueAverageDefensivePlays, K.playsShrinkGames)
  const env = clamp(1 + K.totalSlope * (c.total - 45) + K.spreadSlope * c.spreadDef, 0.85, 1.15)
  return { plays: base * env, environment: env }
}

export function projectedSnapShare(c: IDPCandidate): number {
  const K = IDP_STREAM_KNOBS
  let observed: number
  if (c.snapShareLast1 !== undefined && c.snapShareLast3 !== undefined) {
    observed = K.recencyWeightLast1 * c.snapShareLast1 + (1 - K.recencyWeightLast1) * c.snapShareLast3
  } else if (c.snapShareLast1 !== undefined) {
    observed = c.snapShareLast1
  } else if (c.snapShareLast3 !== undefined) {
    observed = c.snapShareLast3
  } else if (c.snapShareEst !== undefined) {
    observed = c.snapShareEst
  } else {
    observed = 0.55
  }
  // Full-timers regress toward 0.85, rotational players toward 0.5.
  const rolePrior = observed >= 0.7 ? 0.85 : 0.5
  const pull = K.rolePriorWeight * (1 - c.roleConf)
  return clamp((1 - pull) * observed + pull * rolePrior, 0.05, 1.0)
}

export interface IDPRates {
  tackles: number
  soloShare: number
  sacks: number
  tfl: number
  pd: number
  int: number
  ff: number
  qbHits: number
}

/** Stage 2 — conversion: per-snap rates shrunk toward the sub-position prior. */
export function conversionRates(c: IDPCandidate, prior: IDPPrior): IDPRates {
  const n = c.statSnaps
  let combined: number | undefined
  let soloShareObserved: number | undefined
  let tackleSample = 0.0
  if (c.solo !== undefined && c.ast !== undefined) {
    const comb = c.solo + c.ast
    combined = comb
    soloShareObserved = comb > 0 ? c.solo / comb : undefined
    tackleSample = comb
  } else if (c.comb !== undefined) {
    combined = c.comb
  }
  const perSnap = (x: number): number | undefined => (n > 0 ? x / n : undefined)
  const big = IDP_STREAM_KNOBS.bigPlayShrinkK
  let sacks = shrink(perSnap(c.sacks), n, prior.sacks, big)
  // Pressures predict sacks more stably than sacks do; ~6.5 pressures per sack.
  if (c.pressures !== undefined && n > 0) {
    const fromPressure = (c.pressures / n) / 6.5
    sacks = 0.5 * sacks + 0.5 * shrink(fromPressure, n, prior.sacks, big / 2)
  }
  return {
    tackles: shrink(combined === undefined ? undefined : perSnap(combined), n, prior.tackles, IDP_STREAM_KNOBS.snapsShrinkK),
    soloShare: shrink(soloShareObserved, tackleSample, prior.soloShare, IDP_STREAM_KNOBS.soloShrinkK),
    sacks,
    tfl: shrink(perSnap(c.tfl), n, prior.tfl, big),
    pd: shrink(perSnap(c.pd), n, prior.passesDefended, big),
    int: shrink(perSnap(c.int), n, prior.interceptions, big),
    ff: shrink(perSnap(c.ff), n, prior.forcedFumbles, big),
    qbHits: shrink(perSnap(c.qbHits), n, prior.qbHits, big),
  }
}

export function matchupMultipliers(c: IDPCandidate): { tackle: number; sack: number } {
  const K = IDP_STREAM_KNOBS
  let tackle = 1.0
  if (c.dvpGames > 0) {
    const w = c.dvpGames / (c.dvpGames + K.dvpFullWeightGames)
    tackle = 1 + clamp((w * c.dvpPct) / 100, -K.dvpCap, K.dvpCap)
  }
  const sack = 1 + clamp(c.oppSackEnv - 1, -K.sackEnvironmentCap, K.sackEnvironmentCap)
  return { tackle, sack }
}

const fmt = (x: number, places: number) => formatFixed(x, places)

export function project(c: IDPCandidate, scoring: IDPScoring, risk: StreamRiskMode = 'neutral'): IDPProjection {
  const prior = idpPrior(c.position)
  const { plays, environment: env } = expectedDefensivePlays(c)
  const share = projectedSnapShare(c)
  const snaps = plays * share
  const r = conversionRates(c, prior)
  const { tackle: tklMult, sack: sackMult } = matchupMultipliers(c)

  const eComb = snaps * r.tackles * tklMult
  const eSolo = eComb * r.soloShare
  const eAst = eComb - eSolo
  const eSack = snaps * r.sacks * sackMult
  const eTfl = snaps * r.tfl * (0.5 + 0.5 * tklMult) // half-tied to the tackle environment
  const ePd = snaps * r.pd
  const eInt = snaps * r.int
  const eFf = snaps * r.ff
  const eQbHit = snaps * r.qbHits * sackMult

  const counts: [number, number][] = [
    [eSolo, scoring.solo], [eAst, scoring.ast], [eSack, scoring.sack], [eTfl, scoring.tfl],
    [ePd, scoring.pd], [eInt, scoring.int], [eFf, scoring.ff], [eQbHit, scoring.qbHit],
  ]
  const mean = counts.reduce((s, [n, pts]) => s + n * pts, 0)
  // Poisson variance per stat, plus role doubt that scales with the projection.
  const statVariance = counts.reduce((s, [n, pts]) => s + pts * pts * n, 0)
  const usageSD = mean * 0.25 * (1 - c.roleConf)
  const sd = Math.sqrt(statVariance + usageSD * usageSD)

  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * mean
  const floor = Math.max(0, pPlay * (mean - QUARTILE_Z * sd))
  const ceiling = pPlay * (mean + QUARTILE_Z * sd)
  const utility = expPts + idpRiskWeight(risk) * sd

  let flags = [...c.dataFlags]
  if (c.statSnaps < IDP_STREAM_KNOBS.thinSampleSnaps) flags.push('thin conversion sample')
  if (c.snapShareLast1 === undefined && c.snapShareLast3 === undefined) flags.push('snap share estimated')
  if (c.available === undefined) flags.push('availability unverified')
  flags = flags.filter((f, i) => flags.indexOf(f) === i)

  const pace = c.teamGames > 0 ? formatFixed(c.teamDefPlays / c.teamGames, 1) : 'n/a'
  const spread = c.spreadDef >= 0 ? `+${fmt(c.spreadDef, 1)}` : fmt(c.spreadDef, 1)
  const pct = (x: number) => Math.trunc(roundAwayFromZero(x * 100))
  const explain = [
    `${fmt(plays, 1)} expected defensive plays (team pace ${pace}/gm, environment ×${fmt(env, 3)} from O/U ${fmt(c.total, 1)} and spread ${spread})`,
    `× ${pct(share)}% snap share → ${Math.trunc(roundAwayFromZero(snaps))} snaps`,
    `Tackle rate ${fmt(r.tackles * 100, 1)}/100 snaps (solo share ${pct(r.soloShare)}%), matchup ×${fmt(tklMult, 3)}`,
    `Sack rate ${fmt(r.sacks * 100, 2)}/100 snaps, opponent pass protection ×${fmt(sackMult, 2)}`,
    `P(plays) ${pct(pPlay)}% (${PRACTICE_STATUS_LABEL[c.practice]})`,
  ]

  return {
    id: idpCandidateID(c),
    name: c.name, team: c.team, position: c.position, opponent: c.opponent, playerID: c.playerID,
    platform: IDP_PLATFORM[c.position], roleLabel: IDP_SUB_POSITION_LABEL[c.position],
    expPlays: plays, envMult: env, snapShare: share, expSnaps: snaps,
    tklMult, sackMult,
    eSolo, eAst, eSack, eTfl, ePd, eInt, eFf, eQbHit,
    meanIfPlays: mean, sdIfPlays: sd, pPlay, expPts,
    floorP25: floor, ceilingP75: ceiling, utility,
    roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
    flags, notes: c.notes, sources: c.sources, explain,
    pBeatIncumbent: undefined, expGain: undefined, bidBand: undefined,
  }
}

/** Projects, compares with the incumbent and ranks in one call. */
export function report(candidates: readonly IDPCandidate[], scoring: IDPScoring, options: {
  incumbentID?: string
  risk?: StreamRiskMode
  onlyAvailable?: boolean
} = {}): IDPStreamReport {
  const { incumbentID, risk = 'neutral', onlyAvailable = false } = options
  return streamReport(candidates.map((c) => project(c, scoring, risk)), incumbentID, onlyAvailable)
}

/** Head-to-head comparison of chosen projections. */
export const compare = (players: readonly IDPProjection[]): IDPComparison => compareStream(players)

/** Kept for call sites written against the IDP engine. */
export const pBeat = (a: IDPProjection, b: IDPProjection): number => streamPBeat(a, b)
