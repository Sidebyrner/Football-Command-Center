/**
 * Best legal starting lineup under ONE stated basis — a port of FCCore
 * `LineupOptimizer`. The basis is injected; this never decides what "best"
 * means, and a player the basis can't value is `unranked`, never zero.
 */
import type { Position } from './Position'
import { roundHalfUp } from './rounding'
import { accepts, isFlex, type Slot, type SlotTemplate } from './RosterSlots'

export interface LineupSwap {
  slotIndex: number
  slot: Slot
  /** Who comes out, or `undefined` when the slot was empty. */
  outID?: string
  inID: string
  /** Value gained by this one move, under the active basis. */
  delta: number
}

export interface LineupProposal {
  /** Player id per slot, aligned to the template's starters. */
  proposedIDs: (string | undefined)[]
  /** Every difference from the current lineup — never a hidden one. */
  swaps: LineupSwap[]
  currentTotal?: number
  proposedTotal?: number
  gain?: number
  /** Players the basis couldn't value: excluded and reported, never zero. */
  unranked: string[]
  valuedCount: number
}

const EMPTY: LineupProposal = { proposedIDs: [], swaps: [], unranked: [], valuedCount: 0 }

/**
 * How much a challenger must beat the incumbent by, applied during the
 * assignment so the lineup and the swap list can never disagree.
 */
export const INCUMBENCY_MARGIN = 0.05

export interface OptimizeInput {
  /** Sleeper's `starters`, aligned to the template; `"0"` is an unset slot. */
  currentStarterIDs: readonly string[]
  /** Everyone on the roster, starters included. */
  playerIDs: readonly string[]
  template: SlotTemplate
  positions: (id: string) => Position | undefined
  /** THE BASIS. `undefined` for a player it can't value. */
  valueOf: (id: string) => number | undefined
  /**
   * Players whose game has kicked off. A locked starter stays put and a
   * locked bench player can't come in — Sleeper rejects both.
   */
  locked?: ReadonlySet<string>
}

const isSet = (id: string | undefined): id is string => !!id && id !== '0'

export function optimizeLineup(input: OptimizeInput): LineupProposal {
  const { currentStarterIDs, playerIDs, template, positions, valueOf, locked } = input
  if (!locked || locked.size === 0) return optimizeUnlocked(input)
  const slots = template.starters
  if (slots.length === 0) return EMPTY

  const pinned = new Set(slots.map((_, i) => i).filter((i) => i < currentStarterIDs.length && locked.has(currentStarterIDs[i]!)))
  const free = slots.map((_, i) => i).filter((i) => !pinned.has(i))
  const sub = optimizeUnlocked({
    currentStarterIDs: free.map((i) => (i < currentStarterIDs.length ? currentStarterIDs[i]! : '0')),
    playerIDs: playerIDs.filter((id) => !locked.has(id)),
    template: { starters: free.map((i) => slots[i]!), benchCount: template.benchCount, unrecognized: template.unrecognized },
    positions,
    valueOf,
  })
  const proposed: (string | undefined)[] = slots.map(() => undefined)
  for (const i of pinned) proposed[i] = currentStarterIDs[i]
  free.forEach((slotIndex, p) => { if (p < sub.proposedIDs.length) proposed[slotIndex] = sub.proposedIDs[p] })
  const swaps = sub.swaps.map((s) => ({ ...s, slotIndex: free[s.slotIndex]! }))

  // Totals over the whole lineup, locked starters included, rounded once.
  const rawSum = (ids: readonly (string | undefined)[]): [number, boolean] => {
    let total = 0
    let any = false
    for (const id of ids) {
      if (!isSet(id)) continue
      const v = valueOf(id)
      if (v === undefined || !Number.isFinite(v)) continue
      total += v
      any = true
    }
    return [total, any]
  }
  const current = rawSum(currentStarterIDs.slice(0, slots.length))
  const proposedSum = rawSum(proposed)
  const pinnedValued = [...pinned].filter((i) => Number.isFinite(valueOf(currentStarterIDs[i]!) ?? NaN)).length
  return {
    proposedIDs: proposed,
    swaps,
    currentTotal: current[1] ? roundHalfUp(current[0], 1) : undefined,
    proposedTotal: proposedSum[1] ? roundHalfUp(proposedSum[0], 1) : undefined,
    gain: current[1] && proposedSum[1] ? roundHalfUp(proposedSum[0] - current[0], 1) : undefined,
    unranked: sub.unranked,
    valuedCount: sub.valuedCount + pinnedValued,
  }
}

interface Candidate {
  id: string
  position?: Position
  /** The basis's own number, for every reported total and delta. */
  value: number
  /** `value` plus any incumbency margin, only to order the assignment. */
  rank: number
}

function optimizeUnlocked({ currentStarterIDs, playerIDs, template, positions, valueOf }: OptimizeInput): LineupProposal {
  const slots = template.starters
  if (slots.length === 0) return EMPTY
  const incumbents = new Set(currentStarterIDs.filter(isSet))
  const unranked: string[] = []
  const candidates: Candidate[] = []
  const seen = new Set<string>()
  for (const id of playerIDs) {
    if (!isSet(id) || seen.has(id)) continue
    seen.add(id)
    const value = valueOf(id)
    if (value === undefined || !Number.isFinite(value)) { unranked.push(id); continue }
    candidates.push({ id, position: positions(id), value, rank: value + (incumbents.has(id) ? INCUMBENCY_MARGIN : 0) })
  }
  if (candidates.length === 0) return { proposedIDs: slots.map(() => undefined), swaps: [], unranked, valuedCount: 0 }

  // Descending, ties broken on id so the answer is deterministic.
  candidates.sort((a, b) => (a.rank === b.rank ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : b.rank - a.rank))
  const filled = assignMaximisingValue(candidates, slots)
  const positionOf = new Map<string, Position>()
  const valueByID = new Map<string, number>()
  for (const c of candidates) {
    valueByID.set(c.id, c.value)
    if (c.position) positionOf.set(c.id, c.position)
  }

  // Put a kept player back in the slot he already holds whenever that's legal,
  // so interchangeable players don't come back swapped for zero gain.
  for (let index = 0; index < slots.length && index < currentStarterIDs.length; index++) {
    const currentID = currentStarterIDs[index]!
    if (!isSet(currentID)) continue
    const at = filled.indexOf(currentID)
    if (at < 0 || at === index) continue
    if (!accepts(slots[index]!, positionOf.get(currentID))) continue
    const displaced = filled[index]
    if (displaced !== undefined && !accepts(slots[at]!, positionOf.get(displaced))) continue
    filled[at] = displaced
    filled[index] = currentID
  }

  const value = (id: string | undefined) => (isSet(id) ? valueByID.get(id) : undefined)
  // Raw sums, rounded only for display, so the gain matches the swap deltas.
  const rawSum = (ids: readonly (string | undefined)[]) => {
    let total = 0
    let any = false
    for (const id of ids) {
      const v = value(id)
      if (v === undefined) continue
      total += v
      any = true
    }
    return any ? total : undefined
  }
  const rawCurrent = rawSum(currentStarterIDs)
  const rawProposed = rawSum(filled)

  const swaps: LineupSwap[] = []
  slots.forEach((slot, index) => {
    const current = index < currentStarterIDs.length ? currentStarterIDs[index] : undefined
    const outID = isSet(current) ? current : undefined
    const inID = filled[index]
    if (inID === undefined || inID === outID) return
    const inValue = value(inID)
    if (inValue === undefined) return
    const outValue = value(outID)
    // A slot left empty still counts as a real gain.
    const delta = outValue !== undefined ? inValue - outValue : inValue
    swaps.push({ slotIndex: index, slot, outID, inID, delta: roundHalfUp(delta, 1) })
  })

  return {
    proposedIDs: filled,
    swaps: swaps.sort((a, b) => b.delta - a.delta),
    currentTotal: rawCurrent === undefined ? undefined : roundHalfUp(rawCurrent, 1),
    proposedTotal: rawProposed === undefined ? undefined : roundHalfUp(rawProposed, 1),
    gain: rawCurrent !== undefined && rawProposed !== undefined ? roundHalfUp(rawProposed - rawCurrent, 1) : undefined,
    unranked,
    valuedCount: candidates.length,
  }
}

/**
 * Maximum-value legal assignment. Taking candidates in descending value and
 * admitting each one an augmenting path can seat is provably optimal — the
 * greedy algorithm on a transversal matroid. The old web optimizer's greedy
 * pass wasn't: it could strand a better back behind a receiver in the flex.
 */
export function assignMaximisingValue(candidates: readonly Candidate[], slots: readonly Slot[]): (string | undefined)[] {
  const slotForCandidate: (number | undefined)[] = candidates.map(() => undefined)
  let visited: boolean[] = slots.map(() => false)
  // Exact-position slots before flex, so flex stays open.
  const slotOrder = slots.map((_, i) => i).sort((l, r) => {
    const lf = isFlex(slots[l]!)
    const rf = isFlex(slots[r]!)
    return lf !== rf ? (lf ? 1 : -1) : l - r
  })
  const occupant = (slotIndex: number) => {
    const i = slotForCandidate.indexOf(slotIndex)
    return i < 0 ? undefined : i
  }
  const augment = (candidateIndex: number): boolean => {
    for (const slotIndex of slotOrder) {
      if (visited[slotIndex]) continue
      if (!accepts(slots[slotIndex]!, candidates[candidateIndex]!.position)) continue
      visited[slotIndex] = true
      const occupied = occupant(slotIndex)
      const freed = occupied === undefined ? true : augment(occupied)
      if (freed) {
        slotForCandidate[candidateIndex] = slotIndex
        return true
      }
    }
    return false
  }
  candidates.forEach((_, i) => {
    visited = slots.map(() => false)
    augment(i)
  })
  const filled: (string | undefined)[] = slots.map(() => undefined)
  slotForCandidate.forEach((slotIndex, i) => { if (slotIndex !== undefined) filled[slotIndex] = candidates[i]!.id })
  return filled
}
