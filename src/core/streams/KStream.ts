/**
 * Kicker streaming model — a port of FCCore `KStreamModel`: attempts follow
 * the implied total and a "stall" factor, the distance mix is shrunk to the
 * league's, and make rates move with wind, rain, a dome and altitude. Plus the
 * rest-of-season layer with a venue factor per remaining game.
 */
import {
  PLAY_PROBABILITY, QUARTILE_Z, blendedUtility, clamp, dvpMult, intKeyed, rosSummary, shrink,
  type StreamHorizon, type StreamReport, type StreamRiskMode, type StreamROSProjection, type StreamStatPoints,
} from '../Stream'
import {
  byPointsDesc, candidateID, decDict, decInt, decNum, decOptBool, decStr, decTail, dedupeFlags, f, isBool, isNum, isStr,
  type StreamCandidateTail,
} from './QBStream'

// MARK: - Buckets and scoring

export const K_BUCKETS = ['0_39', '40_49', '50_59', '60'] as const
export type KBucket = (typeof K_BUCKETS)[number]

export const K_BUCKET_LABEL: Readonly<Record<KBucket, string>> = { '0_39': '0–39', '40_49': '40–49', '50_59': '50–59', '60': '60+' }
const LEAGUE_MIX: Readonly<Record<KBucket, number>> = { '0_39': 0.5, '40_49': 0.3, '50_59': 0.18, '60': 0.02 }
const LEAGUE_MAKE: Readonly<Record<KBucket, number>> = { '0_39': 0.95, '40_49': 0.8, '50_59': 0.66, '60': 0.3 }
const isLong = (b: KBucket) => b !== '0_39'
const isKBucket = (k: string): k is KBucket => (K_BUCKETS as readonly string[]).includes(k)

export type KBucketValues = Partial<Record<KBucket, number>>

export interface KScoring {
  /** Points for a make, by bucket. */
  make: KBucketValues
  /** Points for a miss (usually negative), by bucket. */
  miss: KBucketValues
  extraPoint: number
  extraPointMiss: number
}

export const kMake = (s: KScoring, b: KBucket) => s.make[b] ?? 0
export const kMiss = (s: KScoring, b: KBucket) => s.miss[b] ?? 0

/** The reference's values: 50–59 = 12 and 60+ = 15 confirmed, the rest Sleeper defaults. */
export const K_SCORING_REFERENCE: Readonly<KScoring> = {
  make: { '0_39': 3, '40_49': 4, '50_59': 12, '60': 15 },
  miss: { '0_39': -1, '40_49': -1, '50_59': -1, '60': -1 },
  extraPoint: 1, extraPointMiss: -1,
}

/** Share of 0–39 attempts from 0–19 and 20–29; the rest are 30–39. */
const SHORT_SPLIT = { under20: 0.02, twenties: 0.38 } as const

/** Sleeper sums every stat a kick records, so the per-kick value adds them. */
export function kScoringFromSleeper(s: Readonly<Record<string, number>>): KScoring {
  const v = (key: string) => s[key] ?? 0
  const { under20: u20, twenties: u30 } = SHORT_SPLIT
  const o30 = 1 - u20 - u30
  const every = v('fgm'), everyMiss = v('fgmiss')
  const shortMake = u20 * v('fgm_0_19') + u30 * v('fgm_20_29') + o30 * v('fgm_30_39')
  const shortMiss = u20 * v('fgmiss_0_19') + u30 * v('fgmiss_20_29') + o30 * v('fgmiss_30_39')
  // 50–59 and 60+ may be set as ranges, or as a 50+ threshold.
  const fifty = s.fgm_50_59 ?? v('fgm_50p')
  const sixty = s.fgm_60p ?? v('fgm_50p')
  const fiftyMiss = s.fgmiss_50_59 ?? v('fgmiss_50p')
  const sixtyMiss = s.fgmiss_60p ?? v('fgmiss_50p')
  return {
    make: { '0_39': every + shortMake, '40_49': every + v('fgm_40_49'), '50_59': every + fifty, '60': every + sixty },
    miss: { '0_39': everyMiss + shortMiss, '40_49': everyMiss + v('fgmiss_40_49'), '50_59': everyMiss + fiftyMiss, '60': everyMiss + sixtyMiss },
    extraPoint: v('xpm'), extraPointMiss: v('xpmiss'),
  }
}

const bucketsEqual = (a: KBucketValues, b: KBucketValues) => K_BUCKETS.every((k) => a[k] === b[k])

export const kScoringEqual = (a: KScoring, b: KScoring) =>
  bucketsEqual(a.make, b.make) && bucketsEqual(a.miss, b.miss) && a.extraPoint === b.extraPoint && a.extraPointMiss === b.extraPointMiss

export const kIsReferencePlaceholder = (s: KScoring) => kScoringEqual(s, K_SCORING_REFERENCE)

const K_MODELLED_KEYS: ReadonlySet<string> = new Set([
  'fgm', 'fgmiss', 'fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_50p', 'fgm_60p',
  'fgmiss_0_19', 'fgmiss_20_29', 'fgmiss_30_39', 'fgmiss_40_49', 'fgmiss_50_59', 'fgmiss_50p', 'fgmiss_60p',
  'xpm', 'xpmiss',
])

export function kUnmodelledKeys(s: Readonly<Record<string, number>>): string[] {
  return Object.entries(s)
    .filter(([key, value]) => value !== 0 && !K_MODELLED_KEYS.has(key) && (key.startsWith('fg') || key.startsWith('xp')))
    .map(([key]) => key)
    .sort()
}

export type KVenue = 'outdoor' | 'dome' | 'retractable'
export const K_VENUES: readonly KVenue[] = ['outdoor', 'dome', 'retractable']
export const K_VENUE_LABEL: Readonly<Record<KVenue, string>> = { outdoor: 'Outdoors', dome: 'Dome', retractable: 'Retractable roof' }

// MARK: - Candidate

export interface KCandidate extends StreamCandidateTail {
  name: string
  team: string
  opp: string
  home?: boolean
  spreadOff: number
  total: number
  games: number
  /** Attempts and makes by distance bucket. */
  fga: KBucketValues
  fgm: KBucketValues
  xpa: number
  xpm: number
  teamFga: number
  teamOffTd: number
  teamGames: number
  venue: KVenue
  windMph: number
  precipPct: number
  altitude: boolean
  dvpPct: number
  dvpGames: number
  schedule: Map<number, string>
  oppDvp: Record<string, number>
  /** Week → whether his team is at home, for the rest-of-season venue factors. */
  homeMap: Map<number, boolean>
}

function buckets(raw: Record<string, number>): KBucketValues {
  const out: KBucketValues = {}
  for (const [k, v] of Object.entries(raw)) if (isKBucket(k)) out[k] = v
  return out
}

/** Decodes one candidate with Swift's CodingKeys and defaults. */
export function decodeKCandidate(raw: unknown): KCandidate {
  const o = raw as Readonly<Record<string, unknown>>
  const d = (k: string, fallback = 0) => decNum(o, k, fallback)
  const venue = o.venue ?? undefined
  if (venue !== undefined && venue !== null && !K_VENUES.includes(venue as KVenue)) throw new TypeError('stream candidate: venue is not a venue')
  return {
    name: decStr(o, 'name'), team: decStr(o, 'team'), opp: decStr(o, 'opp'), home: decOptBool(o, 'home'),
    spreadOff: d('spread_off'), total: d('total', 45),
    games: decInt(o, 'games', 0),
    fga: buckets(decDict(o, 'fga', isNum)),
    fgm: buckets(decDict(o, 'fgm', isNum)),
    xpa: d('xpa'), xpm: d('xpm'),
    teamFga: d('team_fga'), teamOffTd: d('team_off_td'),
    teamGames: decInt(o, 'team_games', 0),
    venue: (venue as KVenue | null | undefined) ?? 'outdoor',
    windMph: d('wind_mph'), precipPct: d('precip_pct'),
    altitude: decOptBool(o, 'altitude') ?? false,
    dvpPct: d('dvp_pct'), dvpGames: decInt(o, 'dvp_games', 0),
    schedule: intKeyed(decDict(o, 'schedule', isStr)),
    oppDvp: decDict(o, 'opp_dvp', isNum),
    homeMap: intKeyed(decDict(o, 'home_map', isBool)),
    ...decTail(o),
  }
}

// MARK: - Projection

export interface KProjection extends StreamROSProjection {
  venue: KVenue
  implied: number
  eFga: number
  eFgm: number
  eMiss: number
  eXpa: number
  eXpm: number
  /** Expected attempts of 50+ yards. */
  e50pAtt: number
  stall: number
  dvpMult: number
  /** Wind over the 12 mph threshold. */
  windOver: number
  rosterPct?: number
  breakdown: StreamStatPoints[]
}

// MARK: - Engine

export const K_LEAGUE = { fgaPerGame: 1.9, xpaPerGame: 2.4, implied: 22.5, xpMake: 0.95 } as const

export const K_KNOBS = {
  fgaK: 4.0, xpaK: 4.0, mixK: 12.0, makeK: 10.0, impliedExponent: 0.5, stallCap: 0.25,
  windThreshold: 12.0, windLongPenalty: 0.012, windMixShift: 0.25,
  rainPenalty: 0.04, domeBonus: 0.02, altitudeLongBonus: 0.06, altitudeMixBonus: 0.3,
  dvpCap: 0.15, rosCap: 0.15, rosDome: 1.03, rosColdLate: 0.94, lateWeek: 13,
} as const

/** nflverse codes of teams that play home games under a roof. */
export const DOME_HOME: ReadonlySet<string> = new Set(['ATL', 'ARI', 'DAL', 'DET', 'HOU', 'IND', 'LV', 'LA', 'LAR', 'LAC', 'MIN', 'NO'])
export const COLD_OUTDOOR: ReadonlySet<string> = new Set(['BUF', 'GB', 'CHI', 'CLE', 'PIT', 'NE', 'DEN', 'KC', 'NYJ', 'NYG',
  'PHI', 'BAL', 'WAS', 'CIN', 'SEA', 'TEN'])

interface KCore {
  implied: number; eFga: number; eXpa: number; eMade: number; eMiss: number; eXpm: number; stall: number; dvp: number; wind: number
  mean: number; sd: number
  mix: Record<KBucket, number>
  byBucket: Record<KBucket, number>
  xpPoints: number
}

function core(c: KCandidate, s: KScoring, neutral: boolean): KCore {
  const K = K_KNOBS, L = K_LEAGUE
  const g = c.games, tg = c.teamGames
  const implied = neutral ? L.implied : (c.total - c.spreadOff) / 2
  const baseFga = shrink(c.teamGames > 0 ? c.teamFga / tg : undefined, tg, L.fgaPerGame, K.fgaK)
  const ratio = c.teamOffTd > 0 ? c.teamFga / c.teamOffTd : undefined
  const stall = 1 + clamp(((shrink(ratio, tg, 0.8, K.fgaK) - 0.8) / 0.8) * 0.5, -K.stallCap, K.stallCap)
  const m = neutral ? 1 : dvpMult(c.dvpPct, c.dvpGames, 6, K.dvpCap)
  const eFga = baseFga * Math.pow(implied / L.implied, K.impliedExponent) * stall * m
  const eXpa = (shrink(c.games > 0 ? c.xpa / g : undefined, g, L.xpaPerGame, K.xpaK) * (implied / L.implied)) / Math.sqrt(stall)

  const totalAttempts = K_BUCKETS.reduce((acc, b) => acc + (c.fga[b] ?? 0), 0)
  const mix = {} as Record<KBucket, number>
  for (const b of K_BUCKETS) {
    mix[b] = shrink(totalAttempts > 0 ? (c.fga[b] ?? 0) / totalAttempts : undefined, totalAttempts, LEAGUE_MIX[b], K.mixK)
  }
  const indoors = c.venue === 'dome'
  const wind = neutral || indoors ? 0 : Math.max(0, c.windMph - K.windThreshold)
  const rain = neutral || indoors ? 0 : c.precipPct / 100
  const altitude = !neutral && c.altitude
  if (wind > 0) {
    const shift = Math.min(K.windMixShift, wind * 0.03)
    const moved = (mix['50_59'] + mix['60']) * shift
    mix['50_59'] *= 1 - shift; mix['60'] *= 1 - shift; mix['40_49'] += moved
  }
  if (altitude) {
    const bump = mix['40_49'] * K.altitudeMixBonus * 0.5
    mix['40_49'] -= bump; mix['50_59'] += bump * 0.8; mix['60'] += bump * 0.2
  }
  const mixTotal = K_BUCKETS.reduce((acc, b) => acc + mix[b], 0)
  for (const b of K_BUCKETS) mix[b] /= mixTotal

  const make = {} as Record<KBucket, number>
  for (const b of K_BUCKETS) {
    const attempts = c.fga[b] ?? 0
    const base = shrink(attempts > 0 ? (c.fgm[b] ?? 0) / attempts : undefined, attempts, LEAGUE_MAKE[b], K.makeK)
    let adj = 1.0
    if (isLong(b)) {
      adj -= wind * K.windLongPenalty
      if (altitude) adj += K.altitudeLongBonus
    }
    adj -= rain * K.rainPenalty
    if (!neutral && indoors) adj += K.domeBonus
    make[b] = clamp(base * adj, 0.1, 0.99)
  }
  const xpMake = clamp(shrink(c.xpa > 0 ? c.xpm / c.xpa : undefined, c.xpa, L.xpMake, K.makeK) - rain * 0.02 - wind * 0.004, 0.8, 0.995)

  const byBucket = {} as Record<KBucket, number>
  let eMade = 0, eMiss = 0, v = 0
  for (const b of K_BUCKETS) {
    const att = eFga * mix[b], mk = att * make[b], ms = att - mk
    const hit = kMake(s, b), miss = kMiss(s, b)
    byBucket[b] = mk * hit + ms * miss
    eMade += mk; eMiss += ms
    v += att * make[b] * (1 - make[b]) * (hit - miss) * (hit - miss)
      + att * Math.pow(make[b] * hit + (1 - make[b]) * miss, 2)
  }
  const eXpm = eXpa * xpMake
  const xpPoints = eXpm * s.extraPoint + (eXpa - eXpm) * s.extraPointMiss
  v += eXpa * s.extraPoint * s.extraPoint
  const mean = K_BUCKETS.reduce((acc, b) => acc + byBucket[b], 0) + xpPoints
  return { implied, eFga, eXpa, eMade, eMiss, eXpm, stall, dvp: m, wind, mean, sd: Math.sqrt(v), mix, byBucket, xpPoints }
}

/** Per remaining game: a dome helps, late-season cold outdoors hurts. */
export function kVenueAdjustments(c: KCandidate): Record<number, number> {
  const out: Record<number, number> = {}
  for (const [week, opponent] of c.schedule) {
    if (!(week > c.currentWeek)) continue
    const site = c.homeMap.get(week) === true ? c.team : opponent.replaceAll('@', '')
    let factor = 1.0
    if (DOME_HOME.has(site)) {
      factor *= K_KNOBS.rosDome
    } else if (week >= K_KNOBS.lateWeek && COLD_OUTDOOR.has(site)) {
      factor *= K_KNOBS.rosColdLate
    }
    out[week] = factor
  }
  return out
}

export function projectK(c: KCandidate, s: KScoring, risk: StreamRiskMode = 'neutral', horizon: StreamHorizon = 'week'): KProjection {
  const x = core(c, s, false)
  const n = core(c, s, true)
  const pPlay = PLAY_PROBABILITY[c.practice]
  const expPts = pPlay * x.mean
  const z = QUARTILE_Z
  const ros = rosSummary({
    currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp, dvpGames: c.dvpGames, neutralMean: n.mean,
    venueAdj: kVenueAdjustments(c), cap: K_KNOBS.rosCap,
  })
  const utility = blendedUtility(expPts, x.sd, ros.perGame, pPlay, risk, horizon)
  const raw = [...c.dataFlags]
  if (K_BUCKETS.reduce((acc, b) => acc + (c.fga[b] ?? 0), 0) < 5) raw.push('thin FG sample')
  if (c.available === undefined) raw.push('availability unverified')
  if (kMake(s, '0_39') === 3 && kMake(s, '40_49') === 4) raw.push('0–39 / 40–49 / XP / miss values are placeholders')
  if (c.schedule.size === 0) raw.push('no remaining schedule → ROS = neutral')
  const flags = dedupeFlags(raw)

  const e50 = x.eFga * (x.mix['50_59'] + x.mix['60'])
  let venue = `Venue ${K_VENUE_LABEL[c.venue]}`
  if (x.wind > 0) venue += `, wind ${f(x.wind, 0)} mph over 12`
  if (c.precipPct > 0) venue += `, rain ${f(c.precipPct, 0)}%`
  if (c.altitude) venue += ', altitude'
  let rosLine = `Rest of season ${f(ros.perGame, 1)}/g over ${ros.games} games`
  if (ros.byeWeek !== undefined) rosLine += ` (bye W${ros.byeWeek})`
  const explain = [
    `${f(x.eFga, 2)} field-goal attempts (implied ${f(x.implied, 1)}, stall ×${f(x.stall, 2)}, matchup ×${f(x.dvp, 3)}) → ${f(x.eMade, 2)} makes`,
    `${f(e50, 2)} attempts of 50+ yards · ${f(x.eXpa, 2)} extra points`,
    venue,
    rosLine,
  ]
  if (c.windMph === 0 && c.precipPct === 0 && c.venue !== 'dome') explain.push('No weather entered — calm and dry assumed.')
  const breakdown: StreamStatPoints[] = [
    ...K_BUCKETS.map((b) => ({ stat: `FG ${K_BUCKET_LABEL[b]}`, count: x.eFga * x.mix[b], points: x.byBucket[b] })),
    { stat: 'Extra points', count: x.eXpa, points: x.xpPoints },
  ]
  return {
    id: candidateID(c), name: c.name, team: c.team, opponent: c.opp, playerID: c.playerID,
    platform: 'K', roleLabel: K_VENUE_LABEL[c.venue], roleConf: 1,
    venue: c.venue, implied: x.implied,
    eFga: x.eFga, eFgm: x.eMade, eMiss: x.eMiss, eXpa: x.eXpa, eXpm: x.eXpm, e50pAtt: e50, stall: x.stall,
    dvpMult: x.dvp, windOver: x.wind, meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay, expPts,
    floorP25: Math.max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
    utility, neutralMean: n.mean, ros, practice: c.practice, rosterPct: c.rosterPct,
    available: c.available, flags, notes: c.notes, sources: c.sources, explain,
    breakdown: byPointsDesc(breakdown.filter((p) => p.points !== 0)),
  }
}

export type KStreamReport = StreamReport<KProjection>
