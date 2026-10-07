/**
 * The call for one lineup slot this week — a port of FCApp `StartVerdict.swift`
 * with its `StartSignal` and `MatchupPosture`. Not a blended score: every
 * candidate meets every other on each named signal, and the one who wins the
 * most head-to-heads starts. Pure, so the rules are tested on plain inputs.
 */
import type { PracticeStatus } from '@core/InSeasonFiles'
import { formatNumber } from '@core/numeric'
import type { Position } from '@core/Position'
import { startBadge, type StartAvailability } from '../league/LeagueContext'
import type { GutConfidence } from './CompareGutCheck'

// MARK: - Signals

/**
 * One of the separate, named numbers a start decision is argued over. Each is
 * a Sit/Start basis or a usage measure — the same values, so Decide and
 * Sit/Start never disagree about what a player is worth.
 */
export type StartSignal =
  | 'projected' | 'commandCenter' | 'thisSeason' | 'form' | 'usage' | 'environment' | 'floor' | 'ceiling'

/** Swift's `StartSignal.allCases`, in declaration order. */
export const START_SIGNALS: readonly StartSignal[] = [
  'projected', 'commandCenter', 'thisSeason', 'form', 'usage', 'environment', 'floor', 'ceiling',
]

export const START_SIGNAL_LABEL: Readonly<Record<StartSignal, string>> = {
  projected: 'Projected',
  commandCenter: 'Command Center',
  thisSeason: 'This season',
  form: 'Last 4',
  usage: 'Usage (xFP)',
  environment: 'Game environment',
  floor: 'Floor',
  ceiling: 'Ceiling',
}

export const START_SIGNAL_SOURCE: Readonly<Record<StartSignal, string>> = {
  projected: "Rotowire's line via Sleeper, in your scoring",
  commandCenter: 'our own: regressed production, usage trend and the matchup',
  thisSeason: "Sleeper's lines this season, else last season's average",
  form: 'points per game over his last 4',
  usage: 'ffopportunity expected points, last 4',
  environment: "his team's implied total, from the schedule file's lines",
  floor: 'his bad week (20th percentile)',
  ceiling: 'his big week (80th percentile)',
}

/** How far apart two values must be before one counts as ahead. */
export const startSignalTieBand = (s: StartSignal) => (s === 'environment' ? 1.0 : 0.5)

export type StartSignals = Partial<Record<StartSignal, number>>

// MARK: - Posture

/**
 * Whether the user is expected to win this week, which decides whether a safe
 * floor or a big ceiling matters. Only ever chooses which of the two counts —
 * it never adjusts a number.
 */
export type MatchupPosture =
  | { kind: 'favourite'; gap: number }
  | { kind: 'underdog'; gap: number }
  | { kind: 'close'; gap: number }
  | { kind: 'unknown' }

/** Projected points either side of zero that make a side a favourite. */
export const POSTURE_MARGIN = 8.0

export const posture = {
  favourite: (gap: number): MatchupPosture => ({ kind: 'favourite', gap }),
  underdog: (gap: number): MatchupPosture => ({ kind: 'underdog', gap }),
  close: (gap: number): MatchupPosture => ({ kind: 'close', gap }),
  unknown: { kind: 'unknown' } as MatchupPosture,
}

export function matchupPosture(mine: number | undefined, theirs: number | undefined): MatchupPosture {
  if (mine === undefined || theirs === undefined) return posture.unknown
  const gap = mine - theirs
  if (gap >= POSTURE_MARGIN) return posture.favourite(gap)
  if (gap <= -POSTURE_MARGIN) return posture.underdog(gap)
  return posture.close(gap)
}

/** Floor, ceiling, or neither. */
export function postureVotingRangeSignal(p: MatchupPosture): StartSignal | undefined {
  switch (p.kind) {
    case 'favourite': return 'floor'
    case 'underdog': return 'ceiling'
    default: return undefined
  }
}

export function postureLine(p: MatchupPosture): string {
  switch (p.kind) {
    case 'favourite': return `You're projected +${startOne(p.gap)}, so Floor counts — protect the lead.`
    case 'underdog': return `You're projected −${startOne(-p.gap)}, so Ceiling counts — you need a big week.`
    case 'close': return `Your matchup projects within ${Math.trunc(POSTURE_MARGIN)} points, so floor and ceiling are context only.`
    case 'unknown': return 'No matchup projection, so floor and ceiling are context only.'
  }
}

// MARK: - The verdict

export interface StartInput {
  id: string
  name: string
  position?: Position
  isFreeAgent?: boolean
  /** On a rival's roster — shown, but he can't start for you. */
  rivalManager?: string
  /** Holds this slot now. */
  isIncumbent?: boolean
  availability?: StartAvailability
  onBye?: boolean
  /** His game has kicked off. */
  isLocked?: boolean
  practice?: PracticeStatus
  /** Epoch ms. */
  kickoff?: number
  signals: StartSignals
}

/** Why he can't start this week, or `undefined` when he can. */
export function startBlocker(input: StartInput): string | undefined {
  if (input.rivalManager !== undefined) return `On ${input.rivalManager}'s roster`
  if (input.onBye) return 'On bye'
  if (input.availability?.kind === 'unavailable') return input.availability.label
  if (input.isLocked) return 'Game has started'
  return undefined
}

export interface StartRanked {
  id: string
  name: string
  isIncumbent: boolean
  isFreeAgent: boolean
  /** Head-to-heads won: 1 per candidate beaten, ½ per draw. */
  wins: number
  /** Signals he is outright best on. */
  topOn: StartSignal[]
  badge?: string
}

export interface StartBlocked {
  id: string
  name: string
  reason: string
}

export const START_THRESHOLDS = {
  /** Share of the deciding signals the pick must win to be clear… */
  clearShare: 0.75,
  /** …on at least this many of them… */
  clearDecisive: 3,
  /** …and this far ahead on the projection, when both have one. */
  clearProjectionGap: 1.5,
  /** At or under this share, a coin flip. */
  coinFlipShare: 0.55,
  /** Under this projection gap, without a clear signal edge, a coin flip. */
  coinFlipProjectionGap: 0.75,
  /** Fewer usable signals than this is thin data. */
  minimumSignals: 3,
} as const

export interface StartVerdict {
  ranked: StartRanked[]
  blocked: StartBlocked[]
  headline: string
  pickID?: string
  alternativeID?: string
  confidence: GutConfidence
  thinData: boolean
  /** "Beats Pittman on 5 of 7 signals." */
  edgeLine?: string
  postureLine: string
  /** The signals that decided it, in display order. */
  votingSignals: StartSignal[]
  /** Per signal, the candidate with the best value — absent when tied or fewer than two have one. */
  signalLeaders: Partial<Record<StartSignal, string>>
  /** What to do if a Questionable pick is ruled out. */
  contingency?: string
  /** Waivers, mixed positions — said once, under the call. */
  notes: string[]
}

export const startPickIsFreeAgent = (v: StartVerdict) => v.ranked.find((r) => r.id === v.pickID)?.isFreeAgent ?? false

export const startOne = (value: number) => formatNumber(value, 1)

/** The signals that count: always the six point measures, plus floor or ceiling as the matchup says. */
export function startVotingSignals(p: MatchupPosture): StartSignal[] {
  const out: StartSignal[] = ['projected', 'commandCenter', 'thisSeason', 'form', 'usage', 'environment']
  const range = postureVotingRangeSignal(p)
  if (range !== undefined) out.push(range)
  return out
}

/** Signals each is ahead on, by more than the signal's tie band. */
export function startHeadToHead(a: StartInput, b: StartInput, signals: readonly StartSignal[]): [number, number] {
  let aAhead = 0, bAhead = 0
  for (const signal of signals) {
    const va = a.signals[signal], vb = b.signals[signal]
    if (va === undefined || vb === undefined) continue
    if (va - vb > startSignalTieBand(signal)) aAhead += 1
    else if (vb - va > startSignalTieBand(signal)) bAhead += 1
  }
  return [aAhead, bAhead]
}

function leader(signal: StartSignal, inputs: readonly StartInput[]): string | undefined {
  const present: [string, number][] = []
  for (const input of inputs) {
    const v = input.signals[signal]
    if (v !== undefined) present.push([input.id, v])
  }
  if (present.length < 2) return undefined
  const sorted = [...present].sort((a, b) => b[1] - a[1])
  return sorted[0]![1] > sorted[1]![1] ? sorted[0]![0] : undefined
}

function headline(pick: StartInput, incumbent: StartInput | undefined, runnerUp: StartInput | undefined, slot: string | undefined): string {
  const at = slot !== undefined ? ` at ${slot}` : ''
  if (incumbent) {
    if (incumbent.id === pick.id) return `Keep ${pick.name} in${at}`
    return pick.isFreeAgent ? `Add ${pick.name}, start over ${incumbent.name}` : `Start ${pick.name} over ${incumbent.name}`
  }
  if (slot === undefined && runnerUp) {
    return pick.isFreeAgent ? `Add ${pick.name}, start over ${runnerUp.name}` : `Start ${pick.name} over ${runnerUp.name}`
  }
  return pick.isFreeAgent ? `Add ${pick.name}, start${at}` : `Start ${pick.name}${at}`
}

/** A Questionable pick: a later-kicking pivot if there is one, else the honest warning that there isn't. */
function contingency(pick: StartInput, others: readonly StartInput[]): string | undefined {
  if (pick.availability?.kind !== 'questionable' || others.length === 0) return undefined
  const kickoff = pick.kickoff
  if (kickoff === undefined) {
    return `${pick.name} is questionable — check inactives about 90 minutes before his kickoff.`
  }
  const pivot = others.find((o) => (o.kickoff ?? -Infinity) > kickoff)
  if (pivot) {
    return `${pick.name} is questionable. Inactives come out about 90 minutes before his kickoff — if he's out, swap to ${pivot.name}, who plays later.`
  }
  return `${pick.name} is questionable and there's no later pivot — ${others[0]!.name} doesn't play after him. If you can't wait on him, start ${others[0]!.name}.`
}

/**
 * @param slot the slot being filled, "FLEX" or "RB"; `undefined` when
 *   comparing outside a lineup.
 */
export function computeStartVerdict(inputs: readonly StartInput[], p: MatchupPosture, slot?: string): StartVerdict {
  const voting = startVotingSignals(p)
  const blocked: StartBlocked[] = []
  for (const input of inputs) {
    const reason = startBlocker(input)
    if (reason !== undefined) blocked.push({ id: input.id, name: input.name, reason })
  }
  const eligible = inputs.filter((i) => startBlocker(i) === undefined)
  const leaders: Partial<Record<StartSignal, string>> = {}
  for (const signal of START_SIGNALS) {
    const id = leader(signal, eligible)
    if (id !== undefined) leaders[signal] = id
  }

  if (eligible.length === 0) {
    return {
      ranked: [], blocked, headline: 'Nobody here can start this week', pickID: undefined, alternativeID: undefined,
      confidence: 'coinFlip', thinData: true, edgeLine: undefined, postureLine: postureLine(p), votingSignals: voting,
      signalLeaders: leaders, contingency: undefined, notes: [],
    }
  }

  const wins = new Map<string, number>()
  const add = (id: string, v: number) => wins.set(id, (wins.get(id) ?? 0) + v)
  eligible.forEach((a, i) => {
    for (const b of eligible.slice(i + 1)) {
      const [aAhead, bAhead] = startHeadToHead(a, b, voting)
      if (aAhead > bAhead) add(a.id, 1)
      else if (bAhead > aAhead) add(b.id, 1)
      else { add(a.id, 0.5); add(b.id, 0.5) }
    }
  })
  // Explicit tie-breaks: wins, then projected, then Command Center, then name.
  const order = [...eligible].sort((a, b) => {
    const wa = wins.get(a.id) ?? 0, wb = wins.get(b.id) ?? 0
    if (wa !== wb) return wb - wa
    for (const signal of ['projected', 'commandCenter'] as const) {
      const va = a.signals[signal] ?? -Infinity, vb = b.signals[signal] ?? -Infinity
      if (va !== vb) return va > vb ? -1 : 1
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  const ranked: StartRanked[] = order.map((input) => ({
    id: input.id, name: input.name, isIncumbent: input.isIncumbent ?? false, isFreeAgent: input.isFreeAgent ?? false,
    wins: wins.get(input.id) ?? 0,
    topOn: voting.filter((s) => leaders[s] === input.id),
    badge: input.availability ? startBadge(input.availability) : undefined,
  }))

  const pick = order[0]!
  const incumbent = inputs.find((i) => i.isIncumbent)
  const alternative: StartInput | undefined =
    incumbent && incumbent.id !== pick.id ? incumbent : order.length > 1 ? order[1] : undefined

  // How sure: the pick against the alternative, signal by signal.
  let confidence: GutConfidence = 'clear'
  let thin = true
  let edgeLine: string | undefined
  if (alternative && startBlocker(alternative) === undefined) {
    const shared = voting.filter((s) => pick.signals[s] !== undefined && alternative.signals[s] !== undefined)
    thin = shared.length < START_THRESHOLDS.minimumSignals
    const [pickAhead, altAhead] = startHeadToHead(pick, alternative, voting)
    const decisive = pickAhead + altAhead
    const share = decisive > 0 ? pickAhead / decisive : 0
    const pp = pick.signals.projected, ap = alternative.signals.projected
    const gap = pp !== undefined && ap !== undefined ? pp - ap : undefined
    if (share <= START_THRESHOLDS.coinFlipShare || decisive < 2
      || ((gap !== undefined ? gap < START_THRESHOLDS.coinFlipProjectionGap : false) && share < START_THRESHOLDS.clearShare)) {
      confidence = 'coinFlip'
    } else if (share >= START_THRESHOLDS.clearShare && decisive >= START_THRESHOLDS.clearDecisive
      && (gap !== undefined ? gap >= START_THRESHOLDS.clearProjectionGap : true)) {
      confidence = 'clear'
    } else {
      confidence = 'lean'
    }
    edgeLine = `Beats ${alternative.name} on ${pickAhead} of ${shared.length} signal${shared.length === 1 ? '' : 's'}`
      + (altAhead > 0 ? `, trails on ${altAhead}.` : '.')
  } else {
    // Nobody else can start — the call is forced, and clear for it.
    thin = voting.filter((s) => pick.signals[s] !== undefined).length < START_THRESHOLDS.minimumSignals
    confidence = 'clear'
  }
  if (thin && confidence === 'clear') confidence = 'lean'
  if (pick.availability?.kind === 'questionable' && pick.practice === 'DNP' && confidence === 'clear') {
    confidence = 'lean'
  }

  const notes: string[] = []
  if (pick.isFreeAgent) {
    notes.push(`Check ${pick.name} can be added before his kickoff — he may still be on waivers.`)
  }
  if (new Set(eligible.map((e) => e.position).filter((x) => x !== undefined)).size > 1) {
    notes.push('Mixed positions: usage (xFP) compares less well across positions than points do.')
  }

  return {
    ranked, blocked,
    headline: headline(pick, incumbent, order.length > 1 ? order[1] : undefined, slot),
    pickID: pick.id, alternativeID: alternative?.id, confidence, thinData: thin,
    edgeLine, postureLine: postureLine(p), votingSignals: voting, signalLeaders: leaders,
    contingency: contingency(pick, order.slice(1)), notes,
  }
}
