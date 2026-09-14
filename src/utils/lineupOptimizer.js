// Best legal starting lineup under ONE stated basis.
//
// The basis is injected as `valueOf`. That is the whole design: this file never
// decides what "best" means, never averages a model score against a Vegas
// number, and never returns a recommendation without the caller knowing which
// basis produced it. Two bases disagreeing is information, not a problem to be
// smoothed away — see the disagreement banner in MatchupPlanner.jsx.

function eligibleFor(slot, position) {
  if (!position) return false
  if (slot.type === 'starter') return slot.pos === position
  return (slot.eligible ?? []).includes(position)
}

/**
 * How much a challenger must beat the incumbent by before the lineup moves.
 * Applied as a bonus *during* the assignment rather than as a filter on the
 * reported swaps, so the proposed lineup and the swap list can never disagree.
 * Below this margin the "gain" is rounding noise and reads as churn.
 */
export const INCUMBENCY_MARGIN = 0.05

/**
 * @param {object} args
 * @param {string[]} args.currentStarterIds Sleeper's starters array, positionally
 *   aligned to template.starters (BN/IR/TAXI already removed by parseRosterPositions).
 * @param {string[]} args.playerIds every player on the roster, starters included
 * @param {object} args.template parseRosterPositions() output
 * @param {Record<string, object>} args.playersById
 * @param {(playerId: string) => number|null} args.valueOf THE BASIS. Return null
 *   for a player this basis cannot value — they are excluded and reported in
 *   `unranked`, never silently treated as zero.
 * @param {Iterable<string>} [args.locked] players whose game has kicked off. A
 *   locked starter stays in his slot and a locked bench player can't be started
 *   — Sleeper rejects both moves, so proposing them isn't advice. Locked players
 *   are neither swapped nor reported as unranked.
 * @returns {{proposedIds, swaps, currentTotal, proposedTotal, gain, unranked, valuedCount}}
 */
export function optimizeLineup({ currentStarterIds = [], playerIds = [], template, playersById = {}, valueOf, locked }) {
  const slots = template?.starters ?? []
  const empty = {
    proposedIds: [], swaps: [], currentTotal: null, proposedTotal: null,
    gain: 0, unranked: [], valuedCount: 0,
  }
  if (!slots.length || typeof valueOf !== 'function') return empty

  const lockedSet = new Set(locked ?? [])
  if (lockedSet.size) {
    return optimizeAroundLocks({ currentStarterIds, playerIds, template, playersById, valueOf, lockedSet })
  }

  const incumbents = new Set(currentStarterIds.filter((id) => id && id !== '0'))
  const unranked = []
  const candidates = []
  const seen = new Set()
  for (const id of playerIds) {
    if (!id || id === '0' || seen.has(id)) continue
    seen.add(id)
    const position = playersById[id]?.position
    const v = valueOf(id)
    if (v == null || !isFinite(v)) { unranked.push(id); continue }
    candidates.push({ id, position, value: v, rank: v + (incumbents.has(id) ? INCUMBENCY_MARGIN : 0) })
  }
  if (!candidates.length) return { ...empty, unranked }

  // Best first, ties broken on id so the answer is deterministic. Taking
  // candidates in descending value and admitting each one an augmenting path
  // can seat is provably optimal: a candidate's value doesn't depend on which
  // slot he fills. The previous greedy-plus-hill-climb was not — given a
  // {RB, WR} slot and a {WR}-only slot it could seat the best receiver in the
  // flex and strand a better back, and no bench-to-slot move recovered it.
  candidates.sort((a, b) => (b.rank === a.rank ? (a.id < b.id ? -1 : 1) : b.rank - a.rank))
  const filled = assignMaximisingValue(candidates, slots)

  // Put a kept player back in the slot he already occupies whenever that is
  // legal, so interchangeable players don't come back swapped for zero gain.
  const positionOf = new Map(candidates.map((c) => [c.id, c.position]))
  for (let i = 0; i < slots.length; i++) {
    const currentId = currentStarterIds[i]
    if (!currentId || currentId === '0') continue
    const at = filled.indexOf(currentId)
    if (at === -1 || at === i) continue
    if (!eligibleFor(slots[i], positionOf.get(currentId))) continue
    const displaced = filled[i]
    if (displaced && !eligibleFor(slots[at], positionOf.get(displaced))) continue
    filled[at] = displaced
    filled[i] = currentId
  }

  return summarise({ slots, currentStarterIds, proposedIds: filled, valueOf, unranked, valuedCount: candidates.length })
}

/** Augmenting-path assignment. Exact-position slots are tried before flex ones. */
function assignMaximisingValue(candidates, slots) {
  const slotForCandidate = new Array(candidates.length).fill(null)
  const slotOrder = slots
    .map((s, i) => i)
    .sort((a, b) => {
      const af = slots[a].type === 'flex'
      const bf = slots[b].type === 'flex'
      return af === bf ? a - b : af ? 1 : -1
    })
  let visited

  const occupant = (slotIndex) => {
    const i = slotForCandidate.indexOf(slotIndex)
    return i === -1 ? null : i
  }

  const augment = (ci) => {
    for (const si of slotOrder) {
      if (visited[si]) continue
      if (!eligibleFor(slots[si], candidates[ci].position)) continue
      visited[si] = true
      const occ = occupant(si)
      if (occ === null || augment(occ)) {
        slotForCandidate[ci] = si
        return true
      }
    }
    return false
  }

  for (let ci = 0; ci < candidates.length; ci++) {
    visited = new Array(slots.length).fill(false)
    augment(ci)
  }

  const filled = new Array(slots.length).fill(null)
  slotForCandidate.forEach((si, ci) => {
    if (si !== null) filled[si] = candidates[ci].id
  })
  return filled
}

/** Pins locked starters and optimizes the unlocked slots as a smaller lineup. */
function optimizeAroundLocks({ currentStarterIds, playerIds, template, playersById, valueOf, lockedSet }) {
  const slots = template.starters
  const pinned = new Set(slots.map((s, i) => i).filter((i) => lockedSet.has(currentStarterIds[i])))
  const free = slots.map((s, i) => i).filter((i) => !pinned.has(i))

  const sub = optimizeLineup({
    currentStarterIds: free.map((i) => currentStarterIds[i] ?? '0'),
    playerIds: playerIds.filter((id) => !lockedSet.has(id)),
    template: { ...template, starters: free.map((i) => slots[i]) },
    playersById,
    valueOf,
  })

  const proposedIds = slots.map((s, i) => (pinned.has(i) ? currentStarterIds[i] : null))
  free.forEach((slotIndex, position) => {
    proposedIds[slotIndex] = sub.proposedIds[position] ?? null
  })

  const pinnedValued = [...pinned].filter((i) => {
    const v = valueOf(currentStarterIds[i])
    return v != null && isFinite(v)
  }).length

  return summarise({
    slots,
    currentStarterIds,
    proposedIds,
    valueOf,
    unranked: sub.unranked,
    valuedCount: sub.valuedCount + pinnedValued,
  })
}

/**
 * Totals and swaps for a proposal. Raw sums, rounded only for display —
 * rounding each total first made the headline gain disagree with the sum of the
 * per-swap deltas it was built from.
 */
function summarise({ slots, currentStarterIds, proposedIds, valueOf, unranked, valuedCount }) {
  const valueOrNull = (id) => {
    if (!id || id === '0') return null
    const v = valueOf(id)
    return v == null || !isFinite(v) ? null : v
  }
  const rawSum = (ids) => {
    let t = 0
    let any = false
    for (const id of ids) {
      const v = valueOrNull(id)
      if (v != null) { t += v; any = true }
    }
    return any ? t : null
  }

  const rawCurrent = rawSum(currentStarterIds.slice(0, slots.length))
  const rawProposed = rawSum(proposedIds)
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

  const swaps = []
  for (let i = 0; i < slots.length; i++) {
    const outId = currentStarterIds[i] && currentStarterIds[i] !== '0' ? currentStarterIds[i] : null
    const inId = proposedIds[i]
    if (!inId || inId === outId) continue
    const inVal = valueOrNull(inId)
    if (inVal == null) continue
    const outVal = valueOrNull(outId)
    swaps.push({ slotIndex: i, slot: slots[i], outId, inId, delta: r1(outVal == null ? inVal : inVal - outVal) })
  }

  return {
    proposedIds,
    swaps: swaps.sort((a, b) => b.delta - a.delta),
    currentTotal: r1(rawCurrent),
    proposedTotal: r1(rawProposed),
    gain: rawCurrent != null && rawProposed != null ? r1(rawProposed - rawCurrent) : null,
    unranked,
    valuedCount,
  }
}
