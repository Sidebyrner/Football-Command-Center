/**
 * The one-line call on a comparison — a port of FCApp `CompareVerdict.swift`:
 * keep your player or go after someone, and whether the move is worth it — a
 * waiver claim under priority, a bid under FAAB. Your own players are ranked
 * with everyone else. Pure, and deliberately simple rules with the reasons
 * shown, so the call can be argued with.
 */
import { formatNumber } from '@core/numeric'
import {
  faabRemaining, isAcquirable, playoffWeeks, type Availability, type LeagueFacts, type WaiverSystem,
} from '../league/LeagueContext'
import type { PlayerComparison } from './PlayerComparison'

export interface VerdictInput {
  id: string
  name: string
  availability: Availability
  isBaseline?: boolean
  restOfSeason?: number
  projectedThisWeek?: number
  expectedPointsLast4?: number
  pointsPerGame?: number
  trendingAdds?: number
  playoffMatchups?: number
  injuryDesignation?: string
}

export interface VerdictLeague {
  waivers: WaiverSystem
  waiverPosition?: number
  teamCount: number
  faabRemaining?: number
  currentWeek: number
  playoffStartWeek: number
}

export function verdictLeague(facts: LeagueFacts, currentWeek: number): VerdictLeague {
  return {
    waivers: facts.waivers, waiverPosition: facts.waiverPosition, teamCount: facts.teamCount,
    faabRemaining: faabRemaining(facts), currentWeek, playoffStartWeek: playoffWeeks(facts)[0] ?? 15,
  }
}

export interface VerdictRanked {
  id: string
  name: string
  availability: Availability
  /** The user's player everyone else is measured against. */
  isBaseline: boolean
  /** 0…1, each measure as a share of the best player's, before the injury and availability adjustments. */
  score: number
  /** After them — what the order is sorted on. */
  adjustedScore: number
  reasons: string[]
  /** Some measures were missing and counted as middling. */
  thinData: boolean
}

export type VerdictPriority =
  /** Worth the claim or a real bid. */
  | { kind: 'spend'; text: string }
  /** Probably not worth it; wait. */
  | { kind: 'hold'; text: string }
  /** Your own player is the better hold — don't make the move. */
  | { kind: 'keep'; text: string }
  /** The top target is on a roster — a trade, not a claim. */
  | { kind: 'notAClaim'; text: string }
  /** Nothing in the comparison can be acquired. */
  | { kind: 'nothing'; text: string }

export interface FAABBid { low: number; high: number; note: string }

export interface CompareVerdict {
  /** Everyone compared, best first — the user's own players included. */
  ranked: VerdictRanked[]
  headline: string
  priority: VerdictPriority
  /** Only in FAAB leagues. */
  faab?: FAABBid
  /** The player the call lands on, and the one it passes over. */
  pickID?: string
  alternativeID?: string
  /** How far apart the two are on adjusted score, 0…1. */
  margin?: number
}

export const VERDICT_THRESHOLDS = {
  /** Rest-of-season points per game over the baseline that make a claim worth it. */
  overBaseline: 2.0,
  /** Over the next free agent in the comparison, without a baseline. */
  overNext: 1.5,
  /** Sleeper adds in a day that mean the rest of the league wants him. */
  contestedAdds: 5_000,
} as const

type Measure = 'restOfSeason' | 'expectedPointsLast4' | 'projectedThisWeek' | 'trendingAdds' | 'playoffMatchups'
const WEIGHTS: readonly [Measure, number][] = [
  ['restOfSeason', 0.40], ['expectedPointsLast4', 0.20], ['projectedThisWeek', 0.15],
  ['trendingAdds', 0.10], ['playoffMatchups', 0.15],
]

/** Rest of season per game, falling back to what he's scored. */
const outlook = (i: VerdictInput) => i.restOfSeason ?? i.pointsPerGame
const one = (v: number) => formatNumber(v, 1)
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const isMine = (a: Availability) => a.kind === 'mine'

/** Keeping costs nothing; a trade is discounted for how hard the ask is. */
export function availabilityFactor(a: Availability): number {
  switch (a.kind) {
    case 'freeAgent': case 'mine': return 1.0
    case 'rivalBench': return 0.85
    case 'rivalStarter': return 0.7
  }
}

export function injuryPenalty(designation: string | undefined): number {
  switch (designation?.toLowerCase()) {
    case 'out': case 'ir': case 'pup': case 'doubtful': case 'sus': case 'na': return 0.25
    case 'questionable': case 'q': return 0.10
    default: return 0
  }
}

interface Call { headline: string; priority: VerdictPriority; pickID: string; alternativeID?: string }

export function computeVerdict(inputs: readonly VerdictInput[], league: VerdictLeague): CompareVerdict {
  if (inputs.length === 0) {
    return { ranked: [], headline: 'Nobody to compare', priority: { kind: 'nothing', text: 'Add players to compare.' } }
  }

  // Each measure as a share of the best player's, 0…1. Adds on a log scale.
  const transform = (m: Measure) => (m === 'trendingAdds' ? (v: number) => Math.log1p(Math.max(v, 0)) : (v: number) => Math.max(v, 0))
  const scaled = (m: Measure, input: VerdictInput): number | undefined => {
    const raw = input[m]
    if (raw === undefined) return undefined
    const t = transform(m)
    const best = Math.max(0, ...inputs.map((i) => i[m]).filter((v): v is number => v !== undefined).map(t))
    return best > 0 ? Math.min(t(raw) / best, 1) : 1
  }

  const scored = inputs.map((input) => {
    let score = 0
    let missing = 0
    for (const [m, weight] of WEIGHTS) {
      const value = scaled(m, input)
      if (value !== undefined) score += value * weight
      else { score += 0.5 * weight; missing += 1 }
    }
    const adjusted = score * availabilityFactor(input.availability) - injuryPenalty(input.injuryDesignation)
    return { input, score, adjusted, thin: missing >= 2 }
  }).sort((a, b) => (a.adjusted !== b.adjusted ? b.adjusted - a.adjusted : a.input.name < b.input.name ? -1 : a.input.name > b.input.name ? 1 : 0))

  // The yardstick: the one the user named, else his weakest player here.
  const baseline = inputs.find((i) => i.isBaseline) ?? [...scored].reverse().find((s) => isMine(s.input.availability))?.input
  const ranked: VerdictRanked[] = scored.map((s) => ({
    id: s.input.id, name: s.input.name, availability: s.input.availability,
    isBaseline: s.input.id === baseline?.id, score: s.score, adjustedScore: s.adjusted,
    reasons: reasons(s.input, baseline), thinData: s.thin,
  }))
  const byID = new Map(inputs.map((i) => [i.id, i]))
  const rankOf = new Map(ranked.map((r, index) => [r.id, index]))

  const topRanked = ranked.find((r) => isAcquirable(r.availability))
  const topTarget = topRanked ? byID.get(topRanked.id)! : undefined
  if (!topTarget) {
    const second = ranked[1]?.id
    return {
      ranked,
      headline: ranked.length === 1 ? `${ranked[0]!.name} is yours` : `${ranked[0]!.name} ranks highest of yours`,
      priority: { kind: 'nothing', text: 'Everyone in the comparison is already yours.' },
      pickID: ranked[0]!.id, alternativeID: second, margin: margin(ranked, ranked[0]!.id, second),
    }
  }

  let call: Call
  if (baseline) {
    call = callAgainst(baseline, topTarget, rankOf.get(topTarget.id)! < rankOf.get(baseline.id)!, league)
  } else {
    const targets = ranked.filter((r) => isAcquirable(r.availability))
    call = {
      headline: headline(targets, byID), priority: priorityWithoutBaseline(topTarget, targets, byID, league),
      pickID: topTarget.id, alternativeID: targets[1]?.id,
    }
  }
  let priority = call.priority
  // Near the back of a priority order, a claim costs little.
  if (priority.kind === 'hold' && isNearBack(league)) {
    priority = { kind: 'hold', text: `${priority.text} You're near the back of the order anyway, so a claim is cheap.` }
  }
  return {
    ranked, headline: call.headline, priority, faab: faabBid(topTarget, priority, league),
    pickID: call.pickID, alternativeID: call.alternativeID, margin: margin(ranked, call.pickID, call.alternativeID),
  }
}

/** The adapter from a built comparison. */
export function verdictInputs(comparison: PlayerComparison): VerdictInput[] {
  return comparison.players.map((p) => ({
    id: p.id, name: p.name, availability: p.availability ?? { kind: 'freeAgent' }, isBaseline: p.isBaseline ?? false,
    restOfSeason: p.values.restOfSeason, projectedThisWeek: p.values.projectedThisWeek,
    expectedPointsLast4: p.values.expectedPointsLast4, pointsPerGame: p.values.pointsPerGame,
    trendingAdds: p.trendingAdds, playoffMatchups: p.playoffMatchups, injuryDesignation: p.injuryDesignation,
  }))
}

function margin(ranked: readonly VerdictRanked[], pick?: string, alternative?: string): number | undefined {
  const a = ranked.find((r) => r.id === pick)
  const b = ranked.find((r) => r.id === alternative)
  return a && b ? Math.abs(a.adjustedScore - b.adjustedScore) : undefined
}

/** One of the user's players against the best thing he could get: keep, or make the move. */
function callAgainst(baseline: VerdictInput, target: VerdictInput, targetAhead: boolean, league: VerdictLeague): Call {
  const theirs = outlook(target)
  const mine = outlook(baseline)
  const gap = theirs !== undefined && mine !== undefined ? theirs - mine : undefined
  const amount = gap !== undefined ? one(Math.abs(gap)) : undefined
  const keep = (text: string): Call => ({
    headline: `Keep ${baseline.name} over ${target.name}`, priority: { kind: 'keep', text },
    pickID: baseline.id, alternativeID: target.id,
  })
  if (!targetAhead) {
    if (gap === undefined) return keep(`Keep ${baseline.name} — he rates ahead of ${target.name} on what's here.`)
    return gap > 0
      ? keep(`Keep ${baseline.name} — ${target.name}'s +${amount} pts/gm outlook doesn't outweigh the rest of his numbers.`)
      : keep(`Keep ${baseline.name} — ${target.name} projects ${amount} pts/gm less the rest of the way.`)
  }
  const a = target.availability
  if (a.kind === 'rivalBench' || a.kind === 'rivalStarter') {
    return {
      headline: `Best target: ${target.name} (trade — ${a.manager}), over ${baseline.name}`,
      priority: { kind: 'notAClaim', text: `${target.name} is on a roster — this is a trade, not a waiver claim.` },
      pickID: target.id, alternativeID: baseline.id,
    }
  }
  if (gap === undefined) {
    return {
      headline: `Lean ${target.name} over ${baseline.name}`,
      priority: { kind: 'hold', text: `${target.name} rates ahead, but there's no rest-of-season number to size the gap — a cheap claim at most.` },
      pickID: target.id, alternativeID: baseline.id,
    }
  }
  if (gap >= VERDICT_THRESHOLDS.overBaseline) {
    return {
      headline: `Add ${target.name}, drop ${baseline.name}`,
      priority: { kind: 'spend', text: `Worth your ${claimWord(league)}: +${amount} pts/gm over ${baseline.name}.` },
      pickID: target.id, alternativeID: baseline.id,
    }
  }
  return keep(gap > 0
    ? `Keep ${baseline.name} — ${target.name} is only +${amount} pts/gm better, not worth your ${claimWord(league)}.`
    : `Keep ${baseline.name} — ${target.name} projects ${amount} pts/gm less the rest of the way.`)
}

function headline(targets: readonly VerdictRanked[], byID: ReadonlyMap<string, VerdictInput>): string {
  const top = targets[0]!
  const a = byID.get(top.id)!.availability
  const first = a.kind === 'freeAgent' ? `Best add: ${top.name}`
    : a.kind === 'rivalBench' || a.kind === 'rivalStarter' ? `Best target: ${top.name} (trade — ${a.manager})`
    : top.name
  return targets.length > 1 ? `${first}, then ${targets[1]!.name}` : first
}

/** No player of the user's in the comparison: demand and the gap to the next free agent decide. */
function priorityWithoutBaseline(
  top: VerdictInput, targets: readonly VerdictRanked[], byID: ReadonlyMap<string, VerdictInput>, league: VerdictLeague,
): VerdictPriority {
  if (top.availability.kind !== 'freeAgent') {
    return { kind: 'notAClaim', text: `${top.name} is on a roster — this is a trade, not a waiver claim.` }
  }
  const name = top.name
  const nextFreeAgent = targets.slice(1).map((r) => byID.get(r.id)!).find((i) => i.availability.kind === 'freeAgent')
  const mine = outlook(top)
  const next = nextFreeAgent ? outlook(nextFreeAgent) : undefined
  const gap = mine !== undefined && next !== undefined ? mine - next : undefined
  const contested = (top.trendingAdds ?? 0) >= VERDICT_THRESHOLDS.contestedAdds
  const clearlyBetter = gap !== undefined ? gap >= VERDICT_THRESHOLDS.overNext : nextFreeAgent === undefined
  if (clearlyBetter && contested) return { kind: 'spend', text: `Worth your ${claimWord(league)}: ${name} is clearly best here and others are adding him.` }
  if (contested) return { kind: 'spend', text: `Others are adding ${name} — claim now if you want him.` }
  if (clearlyBetter) return { kind: 'hold', text: `${name} is best here but few are adding him — he'll likely clear waivers.` }
  return { kind: 'hold', text: `Close call and nobody's rushing — save your ${claimWord(league)}.` }
}

const claimWord = (league: VerdictLeague) => (league.waivers.kind === 'faab' ? 'FAAB' : 'waiver priority')

function isNearBack(league: VerdictLeague): boolean {
  switch (league.waivers.kind) {
    case 'rolling': case 'reverseStandings':
      if (league.waiverPosition === undefined || league.teamCount <= 1) return false
      return league.waiverPosition >= league.teamCount - 1
    default: return false
  }
}

/** A share of what's left, scaled up as the season runs out of weeks to spend on. */
function faabBid(top: VerdictInput, priority: VerdictPriority, league: VerdictLeague): FAABBid | undefined {
  if (league.waivers.kind !== 'faab' || league.faabRemaining === undefined || league.faabRemaining <= 0) return undefined
  if (top.availability.kind !== 'freeAgent' || priority.kind === 'keep') return undefined
  const remaining = league.faabRemaining
  const contested = (top.trendingAdds ?? 0) >= VERDICT_THRESHOLDS.contestedAdds
  let range: [number, number]
  let note: string
  if (priority.kind === 'spend' && contested) { range = [0.25, 0.35]; note = 'Contested and a real upgrade — bid to win.' }
  else if (priority.kind === 'spend') { range = [0.10, 0.20]; note = 'A real upgrade.' }
  else { range = [0.01, 0.05]; note = 'A speculative bid at most.' }
  const weeksLeft = Math.max(league.playoffStartWeek - league.currentWeek, 1)
  const urgency = Math.min(1.5, Math.max(1.0, 8.0 / weeksLeft))
  // Swift's `.rounded()` rounds halves away from zero; these are positive.
  const dollars = (share: number) => Math.min(remaining, Math.max(share > 0.01 ? 1 : 0, Math.round(remaining * share * urgency)))
  const low = dollars(range[0])
  return { low, high: Math.max(dollars(range[1]), low), note }
}

function reasons(input: VerdictInput, baseline: VerdictInput | undefined): string[] {
  const out: string[] = []
  const theirs = outlook(input)
  const mine = baseline ? outlook(baseline) : undefined
  if (baseline && baseline.id !== input.id && mine !== undefined && theirs !== undefined) {
    const gap = theirs - mine
    out.push(`${gap >= 0 ? '+' : ''}${one(gap)} RoS/gm vs ${baseline.name}`)
  } else if (theirs !== undefined) {
    out.push(`${one(theirs)} RoS/gm`)
  }
  if (input.playoffMatchups !== undefined) {
    if (input.playoffMatchups >= 1.08) out.push('soft playoff schedule')
    else if (input.playoffMatchups <= 0.92) out.push('tough playoff schedule')
  }
  if (input.trendingAdds !== undefined && input.trendingAdds >= VERDICT_THRESHOLDS.contestedAdds) {
    out.push(`contested: ${compactFormat.format(input.trendingAdds)} adds`)
  }
  if (input.injuryDesignation !== undefined && injuryPenalty(input.injuryDesignation) > 0) out.push(input.injuryDesignation)
  return out.slice(0, 3)
}
