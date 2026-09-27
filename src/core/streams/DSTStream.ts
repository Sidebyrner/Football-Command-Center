/**
 * Team defense streaming model — a port of FCCore `DSTStreamModel`. Each
 * takeaway rate is the geometric blend of the defense's shrunk rate and the
 * opponent's giveaway rate; points allowed come from the market, scored as the
 * expected tier value over a normal. Plus the rest-of-season layer.
 */
import {
  PLAY_PROBABILITY, QUARTILE_Z, blendedUtility, clamp, dvpMult, intKeyed, rosSummary, shrink,
  type StreamHorizon, type StreamReport, type StreamRiskMode, type StreamROSProjection, type StreamStatPoints,
} from '../Stream'
import { normalCDF } from '../numeric'
import {
  byPointsDesc, candidateID, decDict, decInt, decNum, decOptBool, decStr, decTail, dedupeFlags, f, isNum, isStr,
  type StreamCandidateTail,
} from './QBStream'

// MARK: - Scoring

/** A points- or yards-allowed tier: this many or fewer allowed scores `points`. */
export interface DSTTier {
  upTo: number
  points: number
}

export interface DSTScoring {
  sack: number; interception: number; fumbleRecovery: number; forcedFumble: number; touchdown: number; safety: number; block: number
  pointsAllowed: DSTTier[]
  yardsAllowed: DSTTier[]
}

const tiers = (xs: readonly (readonly [number, number])[]): DSTTier[] => xs.map(([upTo, points]) => ({ upTo, points }))

/** Sleeper's defaults — the reference's placeholder. */
export const DST_SCORING_REFERENCE: Readonly<DSTScoring> = {
  sack: 1, interception: 2, fumbleRecovery: 2, forcedFumble: 0, touchdown: 6, safety: 2, block: 2,
  pointsAllowed: tiers([[0, 10], [6, 7], [13, 4], [20, 1], [27, 0], [34, -1], [999, -4]]),
  yardsAllowed: [99, 199, 299, 349, 399, 449, 499, 9999].map((upTo) => ({ upTo, points: 0 })),
}

const DST_MODELLED_KEYS: readonly string[] = [
  'sack', 'int', 'fum_rec', 'ff', 'def_td', 'safe', 'blk_kick',
  'pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27',
  'pts_allow_28_34', 'pts_allow_35p', 'yds_allow_0_100', 'yds_allow_100_199', 'yds_allow_200_299',
  'yds_allow_300_349', 'yds_allow_350_399', 'yds_allow_400_449', 'yds_allow_450_499',
  'yds_allow_500_549', 'yds_allow_550p',
]
const DST_MODELLED_SET: ReadonlySet<string> = new Set(DST_MODELLED_KEYS)

/** A league with no team-defense scoring at all gets Sleeper's defaults (a placeholder). */
export function dstScoringFromSleeper(s: Readonly<Record<string, number>>): DSTScoring {
  if (!DST_MODELLED_KEYS.some((k) => (s[k] ?? 0) !== 0)) return structuredClone(DST_SCORING_REFERENCE) as DSTScoring
  const v = (key: string) => s[key] ?? 0
  return {
    sack: v('sack'), interception: v('int'), fumbleRecovery: v('fum_rec'), forcedFumble: v('ff'),
    touchdown: v('def_td'), safety: v('safe'), block: v('blk_kick'),
    pointsAllowed: tiers([
      [0, v('pts_allow_0')], [6, v('pts_allow_1_6')], [13, v('pts_allow_7_13')], [20, v('pts_allow_14_20')],
      [27, v('pts_allow_21_27')], [34, v('pts_allow_28_34')], [999, v('pts_allow_35p')],
    ]),
    yardsAllowed: tiers([
      [99, v('yds_allow_0_100')], [199, v('yds_allow_100_199')], [299, v('yds_allow_200_299')],
      [349, v('yds_allow_300_349')], [399, v('yds_allow_350_399')], [449, v('yds_allow_400_449')],
      [499, v('yds_allow_450_499')], [549, v('yds_allow_500_549')], [9999, v('yds_allow_550p')],
    ]),
  }
}

const tiersEqual = (a: readonly DSTTier[], b: readonly DSTTier[]) =>
  a.length === b.length && a.every((t, i) => t.upTo === b[i]!.upTo && t.points === b[i]!.points)

export const dstIsReferencePlaceholder = (s: DSTScoring) => tiersEqual(s.pointsAllowed, DST_SCORING_REFERENCE.pointsAllowed)

export function dstScoringEqual(a: DSTScoring, b: DSTScoring): boolean {
  return a.sack === b.sack && a.interception === b.interception && a.fumbleRecovery === b.fumbleRecovery
    && a.forcedFumble === b.forcedFumble && a.touchdown === b.touchdown && a.safety === b.safety && a.block === b.block
    && tiersEqual(a.pointsAllowed, b.pointsAllowed) && tiersEqual(a.yardsAllowed, b.yardsAllowed)
}

/** Team-defense keys the league pays that aren't projected, named on screen. */
export function dstUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  const prefixes = ['def_', 'st_', 'pts_allow', 'yds_allow', 'bonus_def', 'fum_rec_td', 'int_ret', 'blk_kick_', 'safe']
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !DST_MODELLED_SET.has(key) && prefixes.some((p) => key.startsWith(p)))
    .map(([key]) => key)
    .sort()
}

// MARK: - Candidate

export interface DSTCandidate extends StreamCandidateTail {
  name: string
  team: string
  opp: string
  home?: boolean
  /** This team's spread: positive = underdog. */
  spreadDef: number
  total: number
  games: number
  sacks: number; ints: number; fr: number; ff: number; defTd: number; retTd: number; safeties: number; blocks: number
  paTotal: number; yaTotal: number; dropbacksFaced: number; playsFaced: number
  oppGames: number
  oppDropbacks: number; oppPlays: number; oppSacksTaken: number; oppIntsThrown: number; oppFumLost: number
  oppPpg: number; oppYpg: number; oppQbAdj: number
  /** Fantasy points this opponent's offense allows to D/STs, % vs average. */
  dvpPct: number
  dvpGames: number
  schedule: Map<number, string>
  oppDvp: Record<string, number>
  /** Opponent → points per game, for the rest-of-season points-allowed shift. */
  oppPpgMap: Record<string, number>
}

/** Decodes one candidate with Swift's CodingKeys and defaults. */
export function decodeDSTCandidate(raw: unknown): DSTCandidate {
  const o = raw as Readonly<Record<string, unknown>>
  const d = (k: string, fallback = 0) => decNum(o, k, fallback)
  return {
    name: decStr(o, 'name'), team: decStr(o, 'team'), opp: decStr(o, 'opp'), home: decOptBool(o, 'home'),
    spreadDef: d('spread_def'), total: d('total', 45),
    games: decInt(o, 'games', 0),
    sacks: d('sacks'), ints: d('ints'), fr: d('fr'), ff: d('ff'), defTd: d('def_td'),
    retTd: d('ret_td'), safeties: d('safeties'), blocks: d('blocks'),
    paTotal: d('pa_total'), yaTotal: d('ya_total'),
    dropbacksFaced: d('dropbacks_faced'), playsFaced: d('plays_faced'),
    oppGames: decInt(o, 'opp_games', 0),
    oppDropbacks: d('opp_dropbacks'), oppPlays: d('opp_plays'), oppSacksTaken: d('opp_sacks_taken'),
    oppIntsThrown: d('opp_ints_thrown'), oppFumLost: d('opp_fum_lost'),
    oppPpg: d('opp_ppg', 22.5), oppYpg: d('opp_ypg', 330), oppQbAdj: d('opp_qb_adj', 1),
    dvpPct: d('dvp_pct'), dvpGames: decInt(o, 'dvp_games', 0),
    schedule: intKeyed(decDict(o, 'schedule', isStr)),
    oppDvp: decDict(o, 'opp_dvp', isNum),
    oppPpgMap: decDict(o, 'opp_ppg_map', isNum),
    ...decTail(o),
  }
}

// MARK: - Projection

export interface DSTProjection extends StreamROSProjection {
  expDropbacks: number
  eSacks: number
  eInt: number
  eFr: number
  eTd: number
  /** Points the opponent is expected to score. */
  impliedOpp: number
  paMean: number
  paPts: number
  yaMean: number
  yaPts: number
  dvpMult: number
  qbAdj: number
  /** Mean points per game of the remaining opponents. */
  rosAvgOppPpg: number
  rosterPct?: number
  breakdown: StreamStatPoints[]
}

export const dstTakeaways = (p: DSTProjection) => p.eInt + p.eFr

// MARK: - Engine

export const DST_LEAGUE = {
  sackRate: 0.065, intRate: 0.022, fumbleLostRate: 0.01,
  dropbacks: 37.0, plays: 63.0, ppg: 22.5, ypg: 330.0,
  touchdownPerTakeaway: 0.1, returnTouchdownsPerGame: 0.03,
  safetiesPerGame: 0.03, blocksPerGame: 0.05,
} as const

export const DST_KNOBS = {
  volumeShrinkK: 3.0, rateKDefense: 120.0, rateKOffense: 120.0, fumbleK: 100.0,
  impliedWeight: 0.7, pointsAllowedSD: 9.5, yardsAllowedSD: 65.0,
  pointsAllowedRange: [6.0, 45.0] as const,
  dvpCap: 0.1, rosCap: 0.15,
} as const

/** Expected tier points when the stat is ~Normal(mean, sd), integrated over the buckets. */
export function tierEV(mean: number, sd: number, ts: readonly DSTTier[]): number {
  let ev = 0
  let lo = -Infinity
  for (const tier of ts) {
    const pHi = tier.upTo < 999 ? normalCDF((tier.upTo + 0.5 - mean) / sd) : 1
    const pLo = lo > -Infinity ? normalCDF((lo + 0.5 - mean) / sd) : 0
    ev += tier.points * Math.max(0, pHi - pLo)
    lo = tier.upTo
  }
  return ev
}

interface DSTCore {
  dropbacks: number; eSacks: number; eInt: number; eFr: number; eTd: number; impliedOpp: number; paMean: number; yaMean: number
  paPts: number; yaPts: number; dvp: number; qbAdj: number; mean: number; sd: number
  breakdown: StreamStatPoints[]
}

function core(c: DSTCandidate, s: DSTScoring, neutral: boolean): DSTCore {
  const L = DST_LEAGUE, K = DST_KNOBS
  const g = c.games, og = c.oppGames
  const oppDB = shrink(c.oppGames > 0 ? c.oppDropbacks / og : undefined, og, L.dropbacks, K.volumeShrinkK)
  const facedDB = shrink(c.games > 0 ? c.dropbacksFaced / g : undefined, g, L.dropbacks, K.volumeShrinkK)
  let dropbacks = 0.6 * oppDB + 0.4 * facedDB
  let oppPlays = shrink(c.oppGames > 0 ? c.oppPlays / og : undefined, og, L.plays, K.volumeShrinkK)
  const defSack = shrink(c.dropbacksFaced > 0 ? c.sacks / c.dropbacksFaced : undefined, c.dropbacksFaced, L.sackRate, K.rateKDefense)
  let offSack = shrink(c.oppDropbacks > 0 ? c.oppSacksTaken / c.oppDropbacks : undefined, c.oppDropbacks, L.sackRate, K.rateKOffense)
  const defInt = shrink(c.dropbacksFaced > 0 ? c.ints / c.dropbacksFaced : undefined, c.dropbacksFaced, L.intRate, K.rateKDefense)
  let offInt = shrink(c.oppDropbacks > 0 ? c.oppIntsThrown / c.oppDropbacks : undefined, c.oppDropbacks, L.intRate, K.rateKOffense)
  const defFl = shrink(c.playsFaced > 0 ? c.fr / c.playsFaced : undefined, c.playsFaced, L.fumbleLostRate, K.fumbleK)
  let offFl = shrink(c.oppPlays > 0 ? c.oppFumLost / c.oppPlays : undefined, c.oppPlays, L.fumbleLostRate, K.fumbleK)
  const qbAdj = neutral ? 1 : c.oppQbAdj
  const m = neutral ? 1 : dvpMult(c.dvpPct, c.dvpGames, 6, K.dvpCap)
  if (neutral) {
    offSack = L.sackRate; offInt = L.intRate; offFl = L.fumbleLostRate
    dropbacks = facedDB; oppPlays = L.plays
  }
  const sackRate = Math.sqrt(defSack * offSack) * qbAdj
  const intRate = Math.sqrt(defInt * offInt) * qbAdj
  const flRate = Math.sqrt(defFl * offFl) * qbAdj
  const eSacks = dropbacks * sackRate * m
  const eInt = dropbacks * intRate * m
  const eFr = oppPlays * flRate * m
  const takeaways = eInt + eFr
  const eTd = takeaways * L.touchdownPerTakeaway + L.returnTouchdownsPerGame
    + shrink(c.games > 0 ? c.defTd / g : undefined, g, 0, 10) * 0.5
  const eSaf = L.safetiesPerGame, eBlk = L.blocksPerGame
  const impliedOpp = (c.total + c.spreadDef) / 2
  const ownPA = shrink(c.games > 0 ? c.paTotal / g : undefined, g, L.ppg, K.volumeShrinkK)
  const paMean = neutral ? ownPA : clamp(K.impliedWeight * impliedOpp + (1 - K.impliedWeight) * ownPA,
    K.pointsAllowedRange[0], K.pointsAllowedRange[1])
  const ownYA = shrink(c.games > 0 ? c.yaTotal / g : undefined, g, L.ypg, K.volumeShrinkK)
  const oppYA = shrink(c.oppGames > 0 ? c.oppYpg : undefined, og, L.ypg, K.volumeShrinkK)
  const yaMean = neutral ? ownYA : 0.5 * ownYA + 0.5 * oppYA
  const paPts = tierEV(paMean, K.pointsAllowedSD, s.pointsAllowed)
  const yaPts = tierEV(yaMean, K.yardsAllowedSD, s.yardsAllowed)
  const parts: [string, number, number][] = [
    ['Sacks', eSacks, eSacks * s.sack],
    ['Interceptions', eInt, eInt * s.interception],
    ['Fumbles', eFr, eFr * s.fumbleRecovery + eFr * 1.3 * s.forcedFumble],
    ['Touchdowns', eTd, eTd * s.touchdown],
    ['Safeties & blocks', eSaf + eBlk, eSaf * s.safety + eBlk * s.block],
    ['Points allowed', paMean, paPts],
    ['Yards allowed', yaMean, yaPts],
  ]
  const mean = parts.reduce((acc, p) => acc + p[2], 0)
  let v = s.sack * s.sack * eSacks + s.interception * s.interception * eInt
    + s.fumbleRecovery * s.fumbleRecovery * eFr + s.touchdown * s.touchdown * eTd
  v += s.safety * s.safety * eSaf + s.block * s.block * eBlk
  const paSquares = s.pointsAllowed.map((t) => ({ upTo: t.upTo, points: t.points * t.points }))
  v += Math.max(0, tierEV(paMean, K.pointsAllowedSD, paSquares) - paPts * paPts)
  const yaSquares = s.yardsAllowed.map((t) => ({ upTo: t.upTo, points: t.points * t.points }))
  v += Math.max(0, tierEV(yaMean, K.yardsAllowedSD, yaSquares) - yaPts * yaPts)
  return {
    dropbacks, eSacks, eInt, eFr, eTd, impliedOpp, paMean, yaMean, paPts, yaPts, dvp: m, qbAdj,
    mean, sd: Math.sqrt(v),
    breakdown: parts.map(([stat, count, points]) => ({ stat, count, points })).filter((p) => p.points !== 0),
  }
}

export function projectDST(c: DSTCandidate, s: DSTScoring, risk: StreamRiskMode = 'neutral', horizon: StreamHorizon = 'week'): DSTProjection {
  const x = core(c, s, false)
  const n = core(c, s, true)
  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * x.mean
  const z = QUARTILE_Z
  const base = rosSummary({
    currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp, dvpGames: c.dvpGames, neutralMean: n.mean, cap: DST_KNOBS.rosCap,
  })
  const remaining = [...c.schedule.entries()].filter(([w]) => w > c.currentWeek).sort((a, b) => a[0] - b[0])
    .map(([, opp]) => c.oppPpgMap[opp] ?? DST_LEAGUE.ppg)
  const rosOppPpg = remaining.length === 0 ? DST_LEAGUE.ppg : remaining.reduce((a, b) => a + b, 0) / remaining.length
  // The remaining slate's scoring shifts the points-allowed term.
  const tierShift = tierEV(0.7 * rosOppPpg + 0.3 * n.paMean, DST_KNOBS.pointsAllowedSD, s.pointsAllowed) - n.paPts
  const ros = { ...base }
  ros.perGame = base.perGame + tierShift
  ros.total = ros.perGame * base.games
  const utility = blendedUtility(expPts, x.sd, ros.perGame, pPlay, risk, horizon)
  const raw = [...c.dataFlags]
  if (c.games < 3) raw.push('2-game sample — rates heavily shrunk')
  if (c.schedule.size === 0) raw.push('no remaining schedule → ROS = neutral')
  if (dstIsReferencePlaceholder(s)) raw.push('scoring = Sleeper defaults (placeholder)')
  const flags = dedupeFlags(raw)

  const explain = [
    `${f(x.dropbacks, 1)} opponent dropbacks → ${f(x.eSacks, 2)} sacks, ${f(x.eInt, 2)} INT; ${f(x.eFr, 2)} fumble recoveries`,
    `Opponent implied ${f(x.impliedOpp, 1)} → points allowed ~${f(x.paMean, 1)} → ${f(x.paPts, 1)} tier pts (expected value)`,
    `Yards allowed ~${f(x.yaMean, 0)} → ${f(x.yaPts, 1)} tier pts · matchup ×${f(x.dvp, 3)} · QB adj ×${f(x.qbAdj, 2)}`,
    `Rest of season ${f(ros.perGame, 1)}/g over ${ros.games} games vs offenses scoring ${f(rosOppPpg, 1)} ppg`
      + (ros.byeWeek !== undefined ? ` (bye W${ros.byeWeek})` : ''),
  ]
  return {
    id: candidateID(c), name: c.name, team: c.team, opponent: c.opp, playerID: c.playerID,
    platform: 'DEF', roleLabel: 'D/ST', roleConf: 1,
    expDropbacks: x.dropbacks, eSacks: x.eSacks, eInt: x.eInt, eFr: x.eFr, eTd: x.eTd, impliedOpp: x.impliedOpp,
    paMean: x.paMean, paPts: x.paPts, yaMean: x.yaMean, yaPts: x.yaPts, dvpMult: x.dvp, qbAdj: x.qbAdj,
    meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay, expPts,
    floorP25: Math.max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
    utility, neutralMean: n.mean, ros, rosAvgOppPpg: rosOppPpg, practice: c.practice,
    rosterPct: c.rosterPct, available: c.available, flags, notes: c.notes, sources: c.sources,
    explain, breakdown: byPointsDesc(x.breakdown),
  }
}

export type DSTStreamReport = StreamReport<DSTProjection>
