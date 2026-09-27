/**
 * The decision layer every weekly stream model shares — a port of FCCore
 * `StreamDecision` and `StreamRestOfSeason`. Each model projects its players
 * its own way; from the projection on, "does he beat my starter, by how much,
 * how sure, what to bid" is answered here, once.
 */
import type { Position } from './Position'
import { formatFixed, normalCDF } from './numeric'

// MARK: - Status and risk

export const STREAM_PRACTICE = ['none', 'FP', 'LP', 'DNP', 'Q', 'D', 'OUT', 'IR'] as const
export type StreamPractice = (typeof STREAM_PRACTICE)[number]

export const PLAY_PROBABILITY: Readonly<Record<StreamPractice, number>> = {
  none: 0.97, FP: 0.93, LP: 0.8, DNP: 0.55, Q: 0.7, D: 0.2, OUT: 0, IR: 0,
}
export const PRACTICE_STATUS_LABEL: Readonly<Record<StreamPractice, string>> = {
  none: 'No report', FP: 'Full', LP: 'Limited', DNP: 'DNP', Q: 'Questionable', D: 'Doubtful', OUT: 'Out', IR: 'IR',
}
export const isStreamPractice = (v: unknown): v is StreamPractice => STREAM_PRACTICE.includes(v as StreamPractice)

export type StreamRiskMode = 'floor' | 'neutral' | 'ceiling'
export const RISK_LABEL: Readonly<Record<StreamRiskMode, string>> = { floor: 'Floor (favored)', neutral: 'Neutral', ceiling: 'Ceiling (underdog)' }

/** A FAAB bid band as a share of budget, from the expected gain over the incumbent. */
export interface StreamBidBand {
  lower: number
  upper: number
  label: string
}

export const isSpend = (b: StreamBidBand) => b.upper > 0.01

export function bidBandForGain(gain: number): StreamBidBand {
  if (gain < 1.5) return { lower: 0, upper: 0.01, label: "0–1% (don't spend)" }
  if (gain < 3.5) return { lower: 0.02, upper: 0.05, label: '2–5%' }
  if (gain < 6.0) return { lower: 0.06, upper: 0.1, label: '6–10%' }
  return { lower: 0.11, upper: 0.18, label: '11–18%' }
}

/** Whole-dollar range against a remaining budget, e.g. "$6–10". */
export function bidDollars(b: StreamBidBand, remaining: number): string {
  const lo = Math.floor(remaining * b.lower)
  const hi = Math.ceil(remaining * b.upper)
  return lo === hi ? `$${lo}` : `$${lo}–${hi}`
}

export interface StreamStatPoints {
  stat: string
  count: number
  points: number
}

// MARK: - Projection contract

/** What every stream model's projection exposes to the decision layer and views. */
export interface StreamProjection {
  id: string
  name: string
  team: string
  opponent: string
  playerID?: string
  /** Slot position — for chips, filters and colours. */
  platform: Position
  /** The model's finer role: "Box S", "EDGE", "DEEP". */
  roleLabel: string
  pPlay: number
  meanIfPlays: number
  sdIfPlays: number
  expPts: number
  floorP25: number
  ceilingP75: number
  utility: number
  roleConf: number
  practice: StreamPractice
  available?: boolean
  flags: string[]
  notes: string
  sources: string[]
  explain: string[]
  pBeatIncumbent?: number
  expGain?: number
  bidBand?: StreamBidBand
}

// MARK: - Decision layer

/** P(a outscores b), mixing over each player's play / no-play probability. */
export function pBeat(a: StreamProjection, b: StreamProjection): number {
  const da: [number, number, number][] = [[a.pPlay, a.meanIfPlays, a.sdIfPlays], [1 - a.pPlay, 0, 0.01]]
  const db: [number, number, number][] = [[b.pPlay, b.meanIfPlays, b.sdIfPlays], [1 - b.pPlay, 0, 0.01]]
  let total = 0
  for (const [wa, ma, sa] of da) {
    for (const [wb, mb, sb] of db) {
      const spread = Math.sqrt(sa * sa + sb * sb)
      const win = spread > 0 ? normalCDF((ma - mb) / spread) : ma > mb ? 1 : ma < mb ? 0 : 0.5
      total += wa * wb * win
    }
  }
  return total
}

/** Adds the incumbent comparison and sorts by utility, best first (stable on ties). */
export function rankStream<P extends StreamProjection>(projections: readonly P[], incumbent: P | undefined): P[] {
  const out = projections.map((p) => ({ ...p }))
  if (incumbent) {
    for (const p of out) {
      if (p.id === incumbent.id) continue
      const gain = p.expPts - incumbent.expPts
      p.pBeatIncumbent = pBeat(p, incumbent)
      p.expGain = gain
      p.bidBand = bidBandForGain(gain)
    }
  }
  return out.map((p, i) => [p, i] as const).sort((a, b) => (a[0].utility !== b[0].utility ? b[0].utility - a[0].utility : a[1] - b[1])).map(([p]) => p)
}

export interface StreamReport<P extends StreamProjection> {
  /** Everyone except the incumbent, best utility first. */
  ranked: P[]
  incumbent?: P
}

export function streamReport<P extends StreamProjection>(projections: readonly P[], incumbentID: string | undefined, onlyAvailable = false): StreamReport<P> {
  const incumbent = incumbentID === undefined ? undefined : projections.find((p) => p.id === incumbentID)
  let ranked = rankStream(projections, incumbent)
  if (onlyAvailable) ranked = ranked.filter((p) => p.available !== false || p.id === incumbent?.id)
  const incumbentRow = (incumbent && ranked.find((p) => p.id === incumbent.id)) ?? incumbent
  return { ranked: ranked.filter((p) => p.id !== incumbentRow?.id), incumbent: incumbentRow }
}

export const rankedAt = <P extends StreamProjection>(r: StreamReport<P>, position: Position | undefined) =>
  position === undefined ? r.ranked : r.ranked.filter((p) => p.platform === position)

export const projectionFor = <P extends StreamProjection>(r: StreamReport<P>, id: string) =>
  r.incumbent?.id === id ? r.incumbent : r.ranked.find((p) => p.id === id)

// MARK: - Comparison

export type VerdictConfidence = 'clear' | 'lean' | 'tossUp'

export interface StreamVerdict {
  /** Index into the compared players. */
  leader: number
  /** The leader's chance of outscoring each other player, in player order. */
  odds: { index: number; pBeats: number }[]
  /** Expected points over the next-best projection (can be negative). */
  margin: number
  runnerUp: number
  confidence: VerdictConfidence
}

export interface StreamComparison<P extends StreamProjection> {
  players: P[]
  /** `headToHead[i][j]` is P(players[i] outscores players[j]); `undefined` on the diagonal. */
  headToHead: (number | undefined)[][]
  verdict?: StreamVerdict
}

export function compareStream<P extends StreamProjection>(players: readonly P[]): StreamComparison<P> {
  const headToHead = players.map((a, i) => players.map((b, j) => (i === j ? undefined : pBeat(a, b))))
  const worst = (i: number) => {
    const row = headToHead[i]!.filter((v): v is number => v !== undefined)
    return row.length ? Math.min(...row) : 0.5
  }
  let verdict: StreamVerdict | undefined
  if (players.length > 1) {
    // Best worst head-to-head, so one high-variance projection can't win on
    // mean alone; ties go to E[pts]. Swift's `max(by:)` keeps the last maximum.
    let leader = 0
    for (let i = 1; i < players.length; i++) {
      const wl = worst(leader), wi = worst(i)
      const less = wl !== wi ? wl < wi : players[leader]!.expPts < players[i]!.expPts
      const greater = wl !== wi ? wi < wl : players[i]!.expPts < players[leader]!.expPts
      if (less || !greater) leader = i
    }
    const others = players.map((_, i) => i).filter((i) => i !== leader)
    const odds = others.map((i) => ({ index: i, pBeats: headToHead[leader]![i] ?? 0.5 }))
    let runnerUp = others[0]!
    for (const i of others.slice(1)) if (!(players[i]!.expPts < players[runnerUp]!.expPts)) runnerUp = i
    const closest = odds.length ? Math.min(...odds.map((o) => o.pBeats)) : 0.5
    verdict = {
      leader, odds, runnerUp,
      margin: players[leader]!.expPts - players[runnerUp]!.expPts,
      confidence: closest >= 0.65 ? 'clear' : closest >= 0.55 ? 'lean' : 'tossUp',
    }
  }
  return { players: [...players], headToHead, verdict }
}

// MARK: - Shared math

/** Weight n/(n+k) on the observed rate, the rest on the prior. */
export function shrink(observed: number | undefined, n: number, prior: number, k: number): number {
  if (observed === undefined || !(n > 0)) return prior
  const w = n / (n + k)
  return w * observed + (1 - w) * prior
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** The 25th/75th percentile offset of a normal, in SDs. */
export const QUARTILE_Z = 0.6745

// MARK: - Rest of season

export type StreamHorizon = 'week' | 'balanced' | 'ros'

export const HORIZON: Readonly<Record<StreamHorizon, { label: string; hint: string; week: number; ros: number }>> = {
  week: { label: 'This week', hint: "Sunday's lineup call — this week only.", week: 1, ros: 0 },
  balanced: { label: 'Balanced', hint: "A waiver claim you'll hold a few weeks — half this week, half the rest of the season.", week: 0.5, ros: 0.5 },
  ros: { label: 'Rest of season', hint: 'One roster spot for the playoff run — mostly the rest of the season.', week: 0.15, ros: 0.85 },
}

export interface StreamROS {
  games: number
  /** Mean opponent generosity to his position, % vs average. */
  avgDvp: number
  /** Mean capped matchup multiplier over the remaining games. */
  mult: number
  perGame: number
  total: number
  /** Mean generosity in fantasy playoff weeks 15–17. */
  playoffAvgDvp: number
  playoffGames: number
  byeWeek?: number
  /** "W7 KC (-24%)" — the three toughest and three softest remaining games. */
  hardest: string[]
  easiest: string[]
}

export const PLAYOFF_WEEKS: ReadonlySet<number> = new Set([15, 16, 17])
export const LAST_WEEK = 18

/** Opponent generosity → multiplier, shrunk by games played and capped. */
export function dvpMult(dvpPct: number, games: number, fullWeightGames = 6, cap = 0.15): number {
  if (games <= 0) return 1
  const w = games / (games + fullWeightGames)
  return 1 + clamp((w * dvpPct) / 100, -cap, cap)
}

export interface ROSSummaryInput {
  currentWeek: number
  /** This team's opponent by week; a missing week is the bye. */
  schedule: ReadonlyMap<number, string> | Readonly<Record<number, string>>
  /** Each opponent's generosity to the position, % vs average. */
  oppDvp: Readonly<Record<string, number>>
  dvpGames: number
  /** Per-game projection in a neutral game. */
  neutralMean: number
  /** Optional per-week multiplier (a kicker's dome or cold). */
  venueAdj?: Readonly<Record<number, number>>
  fullWeightGames?: number
  cap?: number
}

export function rosSummary(input: ROSSummaryInput): StreamROS {
  const { currentWeek, oppDvp, dvpGames, neutralMean, venueAdj = {}, fullWeightGames = 6, cap = 0.15 } = input
  const entries: [number, string][] = input.schedule instanceof Map
    ? [...input.schedule.entries()]
    : Object.entries(input.schedule).map(([k, v]) => [Number(k), v as string])
  const remaining = entries.filter(([w]) => currentWeek < w && w <= LAST_WEEK).sort((a, b) => a[0] - b[0])
  const scheduled = new Set([...entries.map(([w]) => w), currentWeek])
  let bye: number | undefined
  if (currentWeek < LAST_WEEK) for (let w = currentWeek + 1; w <= LAST_WEEK; w++) if (!scheduled.has(w)) { bye = w; break }
  if (remaining.length === 0) {
    return { games: 0, avgDvp: 0, mult: 1, perGame: neutralMean, total: 0, playoffAvgDvp: 0, playoffGames: 0, byeWeek: bye, hardest: [], easiest: [] }
  }
  const mults: number[] = []
  const dvps: number[] = []
  const playoff: number[] = []
  for (const [week, opponent] of remaining) {
    const d = oppDvp[opponent] ?? 0
    mults.push(dvpMult(d, dvpGames, fullWeightGames, cap) * (venueAdj[week] ?? 1))
    dvps.push(d)
    if (PLAYOFF_WEEKS.has(week)) playoff.push(d)
  }
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0)
  const mult = sum(mults) / mults.length
  const ranked = remaining.map((g, i) => [g, i] as const).sort((a, b) => {
    const da = oppDvp[a[0][1]] ?? 0, db = oppDvp[b[0][1]] ?? 0
    return da !== db ? da - db : a[1] - b[1]
  }).map(([g]) => g)
  const label = ([week, opp]: [number, string]) => `W${week} ${opp} (${formatFixed(oppDvp[opp] ?? 0, 0, { sign: true })}%)`
  return {
    games: remaining.length,
    avgDvp: sum(dvps) / dvps.length,
    mult,
    perGame: neutralMean * mult,
    total: neutralMean * sum(mults),
    playoffAvgDvp: playoff.length ? sum(playoff) / playoff.length : 0,
    playoffGames: playoff.length,
    byeWeek: bye,
    hardest: ranked.slice(0, 3).map(label),
    easiest: ranked.slice(-3).reverse().map(label),
  }
}

export function riskWeight(risk: StreamRiskMode): number {
  return risk === 'floor' ? -0.5 : risk === 'neutral' ? -0.2 : 0.25
}

/** This week and the rest-of-season per-game projection, weighted by horizon, plus risk's pull on the spread. */
export function blendedUtility(expPts: number, sd: number, rosPerGame: number, pPlay: number, risk: StreamRiskMode, horizon: StreamHorizon): number {
  const { week: ww, ros: wr } = HORIZON[horizon]
  return ww * expPts + wr * rosPerGame * pPlay + riskWeight(risk) * sd * (ww + 0.5 * wr)
}

/** What the QB, D/ST and K projections add to the shared contract. */
export interface StreamROSProjection extends StreamProjection {
  ros: StreamROS
  /** Per-game projection in a neutral matchup. */
  neutralMean: number
}

/** `{"1": "HOU", ...}` → week → value. */
export function intKeyed<V>(o: Readonly<Record<string, V>>): Map<number, V> {
  const out = new Map<number, V>()
  for (const [k, v] of Object.entries(o)) if (/^[+-]?\d+$/.test(k)) out.set(Number(k), v)
  return out
}
