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
 * @param {object} args
 * @param {string[]} args.currentStarterIds Sleeper's starters array, positionally
 *   aligned to template.starters (BN/IR/TAXI already removed by parseRosterPositions).
 * @param {string[]} args.playerIds every player on the roster, starters included
 * @param {object} args.template parseRosterPositions() output
 * @param {Record<string, object>} args.playersById
 * @param {(playerId: string) => number|null} args.valueOf THE BASIS. Return null
 *   for a player this basis cannot value — they are excluded and reported in
 *   `unranked`, never silently treated as zero.
 * @returns {{proposedIds, swaps, currentTotal, proposedTotal, gain, unranked, valuedCount}}
 */
export function optimizeLineup({ currentStarterIds = [], playerIds = [], template, playersById = {}, valueOf }) {
  const slots = template?.starters ?? []
  const empty = {
    proposedIds: [], swaps: [], currentTotal: null, proposedTotal: null,
    gain: 0, unranked: [], valuedCount: 0,
  }
  if (!slots.length || typeof valueOf !== 'function') return empty

  const unranked = []
  const candidates = []
  for (const id of playerIds) {
    if (!id || id === '0') continue
    const position = playersById[id]?.position
    const v = valueOf(id)
    if (v == null || !isFinite(v)) { unranked.push(id); continue }
    candidates.push({ id, position, value: v })
  }
  if (!candidates.length) return { ...empty, unranked }

  // Greedy: highest value first, into the most constrained slot it can fill.
  // Exact-position slots are strictly more constrained than flex, so filling
  // them first never costs a better arrangement.
  candidates.sort((a, b) => b.value - a.value)
  const filled = new Array(slots.length).fill(null)
  const used = new Set()

  for (const pass of ['starter', 'flex']) {
    for (const c of candidates) {
      if (used.has(c.id)) continue
      for (let i = 0; i < slots.length; i++) {
        if (filled[i] || slots[i].type !== pass) continue
        if (!eligibleFor(slots[i], c.position)) continue
        filled[i] = c
        used.add(c.id)
        break
      }
    }
  }

  // Greedy is optimal when flex eligibility sets are nested (FLEX ⊂ SUPER_FLEX)
  // but not when they merely overlap — a league running both WRRB_FLEX and
  // WRTE_FLEX can strand a WR in the wrong one. A bounded pairwise-swap pass
  // fixes that; with <=12 slots and ~20 candidates it costs microseconds.
  const byId = new Map(candidates.map((c) => [c.id, c]))
  for (let iter = 0; iter < 100; iter++) {
    let improved = false

    // Reshuffling two already-started players between slots cannot change the
    // total, so the only improving move is pulling someone off the bench into
    // a slot where he outranks the incumbent. Repeating that to a fixed point
    // is what recovers the arrangements greedy misses when flex eligibility
    // sets overlap rather than nest.
    for (let i = 0; i < slots.length && !improved; i++) {
      const cur = filled[i]
      const curVal = cur?.value ?? -Infinity
      for (const c of candidates) {
        if (used.has(c.id)) continue
        if (!eligibleFor(slots[i], c.position)) continue
        if (c.value <= curVal) continue
        if (cur) used.delete(cur.id)
        filled[i] = c
        used.add(c.id)
        improved = true
        break
      }
    }

    if (!improved) break
  }

  // Minimize churn before reporting anything. Greedy assigns purely by value,
  // so two interchangeable players (a QB in the QB slot and a QB in SUPER_FLEX)
  // routinely come back swapped with each other for zero net gain — which reads
  // as a recommendation when it is noise. If a player is in both the current
  // and proposed lineup, put him back in the slot he already occupies whenever
  // that is legal. Same total, no cosmetic moves.
  for (let i = 0; i < slots.length; i++) {
    const currentId = currentStarterIds[i]
    if (!currentId || currentId === '0') continue
    const at = filled.findIndex((c) => c?.id === currentId)
    if (at === -1 || at === i) continue
    const other = filled[i]
    // Only reshuffle when both players stay legal after the trade.
    if (!eligibleFor(slots[i], filled[at].position)) continue
    if (other && !eligibleFor(slots[at], other.position)) continue
    filled[at] = other
    filled[i] = candidates.find((c) => c.id === currentId) ?? null
  }

  const proposedIds = filled.map((c) => c?.id ?? null)
  const valueOrNull = (id) => (id && byId.has(id) ? byId.get(id).value : null)

  // Raw sums, rounded only for display. Rounding each total to one decimal and
  // then subtracting made the headline gain disagree with the sum of the
  // per-swap deltas it was supposedly built from.
  const rawSum = (ids) => {
    let t = 0
    let any = false
    for (const id of ids) {
      const v = valueOrNull(id)
      if (v != null) { t += v; any = true }
    }
    return any ? t : null
  }

  const rawCurrent = rawSum(currentStarterIds)
  const rawProposed = rawSum(proposedIds)
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
  const currentTotal = r1(rawCurrent)
  const proposedTotal = r1(rawProposed)

  const swaps = []
  for (let i = 0; i < slots.length; i++) {
    const outId = currentStarterIds[i] && currentStarterIds[i] !== '0' ? currentStarterIds[i] : null
    const inId = proposedIds[i]
    if (inId === outId) continue
    // Only report a swap that actually moves someone in; a slot the current
    // lineup left empty still counts as a real gain.
    if (!inId) continue
    const outVal = valueOrNull(outId)
    const inVal = valueOrNull(inId)
    if (inVal == null) continue
    swaps.push({
      slotIndex: i,
      slot: slots[i],
      outId,
      inId,
      delta: r1(outVal == null ? inVal : inVal - outVal),
    })
  }

  return {
    proposedIds,
    swaps: swaps.sort((a, b) => b.delta - a.delta),
    currentTotal,
    proposedTotal,
    gain: rawCurrent != null && rawProposed != null ? r1(rawProposed - rawCurrent) : null,
    unranked,
    valuedCount: candidates.length,
  }
}
