import Foundation

/// One proposed change to the starting lineup.
public struct LineupSwap: Hashable, Sendable {
    public let slotIndex: Int
    public let slot: Slot
    /// Who comes out, or `nil` when the slot was empty.
    public let outID: String?
    public let inID: String
    /// Value gained by this one move, under the active basis.
    public let delta: Double
}

/// The optimizer's answer, always under exactly one named basis.
public struct LineupProposal: Hashable, Sendable {
    /// Player id per slot, positionally aligned to the template's starters.
    public let proposedIDs: [String?]
    /// Every difference between the current lineup and `proposedIDs`. The two
    /// always agree — a swap is never hidden from a lineup that shows it.
    public let swaps: [LineupSwap]
    public let currentTotal: Double?
    public let proposedTotal: Double?
    public let gain: Double?
    /// Players the basis could not value. Excluded from the lineup and reported
    /// here — **never** silently scored as zero. That distinction is the whole
    /// reason this function is trustworthy (§5.9).
    public let unranked: [String]
    public let valuedCount: Int

    public static let empty = LineupProposal(
        proposedIDs: [], swaps: [], currentTotal: nil, proposedTotal: nil,
        gain: nil, unranked: [], valuedCount: 0
    )
}

/// Best legal starting lineup under ONE stated basis.
///
/// The basis is injected. That is the whole design: this type never decides what
/// "best" means, never averages a model score against a Vegas number, and never
/// returns a recommendation without the caller knowing which basis produced it.
/// Two bases disagreeing is information, not a problem to be smoothed away (§6).
public enum LineupOptimizer {
    /// How much a challenger must beat the incumbent by before the lineup moves.
    ///
    /// Applied as an incumbency bonus *during* the assignment rather than as a
    /// filter on the reported swaps, so the proposed lineup and the swap list
    /// can never disagree. Below this margin the "gain" is rounding noise and
    /// the recommendation reads as churn.
    public static let incumbencyMargin: Double = 0.05

    /// - Parameters:
    ///   - currentStarterIDs: Sleeper's `starters` array, positionally aligned to
    ///     `template.starters`. A `"0"` entry means the slot is not set.
    ///   - playerIDs: every player on the roster, starters included.
    ///   - template: the league's own slot template.
    ///   - positions: the position of a player id, or `nil` if unknown.
    ///   - valueOf: THE BASIS. Return `nil` for a player this basis cannot
    ///     value — they land in `unranked`, never scored as zero.
    ///   - locked: players whose game has kicked off. A locked starter stays in
    ///     his slot and a locked bench player cannot be started — Sleeper
    ///     rejects both moves, so proposing them is not advice. Locked players
    ///     are neither swapped nor reported as unranked.
    public static func optimize(
        currentStarterIDs: [String],
        playerIDs: [String],
        template: SlotTemplate,
        positions: (String) -> Position?,
        valueOf: (String) -> Double?,
        locked: Set<String>
    ) -> LineupProposal {
        guard !locked.isEmpty else {
            return optimize(
                currentStarterIDs: currentStarterIDs, playerIDs: playerIDs,
                template: template, positions: positions, valueOf: valueOf
            )
        }

        let slots = template.starters
        guard !slots.isEmpty else { return .empty }

        // Slots held by a locked starter are pinned; everything else is solved
        // as a smaller lineup and mapped back to the original slot indices.
        let pinned = Set(slots.indices.filter { index in
            index < currentStarterIDs.count && locked.contains(currentStarterIDs[index])
        })
        let free = slots.indices.filter { !pinned.contains($0) }

        let sub = optimize(
            currentStarterIDs: free.map { $0 < currentStarterIDs.count ? currentStarterIDs[$0] : "0" },
            playerIDs: playerIDs.filter { !locked.contains($0) },
            template: SlotTemplate(
                starters: free.map { slots[$0] },
                benchCount: template.benchCount,
                unrecognized: template.unrecognized
            ),
            positions: positions,
            valueOf: valueOf
        )

        var proposed = [String?](repeating: nil, count: slots.count)
        for index in pinned { proposed[index] = currentStarterIDs[index] }
        for (position, index) in free.enumerated() where position < sub.proposedIDs.count {
            proposed[index] = sub.proposedIDs[position]
        }

        let swaps = sub.swaps.map { swap in
            LineupSwap(
                slotIndex: free[swap.slotIndex], slot: swap.slot,
                outID: swap.outID, inID: swap.inID, delta: swap.delta
            )
        }

        // Totals over the whole lineup, locked starters included, at full
        // precision and rounded once — the same rule as the unlocked path.
        func rawSum(_ ids: [String?]) -> (Double, Bool) {
            var total: Double = 0
            var any = false
            for id in ids {
                guard let id, !id.isEmpty, id != "0", let value = valueOf(id), value.isFinite else { continue }
                total += value
                any = true
            }
            return (total, any)
        }
        let current = rawSum(currentStarterIDs.prefix(slots.count).map { Optional($0) })
        let proposedSum = rawSum(proposed)
        let pinnedValued = pinned.filter { valueOf(currentStarterIDs[$0])?.isFinite == true }.count

        return LineupProposal(
            proposedIDs: proposed,
            swaps: swaps,
            currentTotal: current.1 ? roundHalfUp(current.0, places: 1) : nil,
            proposedTotal: proposedSum.1 ? roundHalfUp(proposedSum.0, places: 1) : nil,
            gain: current.1 && proposedSum.1 ? roundHalfUp(proposedSum.0 - current.0, places: 1) : nil,
            unranked: sub.unranked,
            valuedCount: sub.valuedCount + pinnedValued
        )
    }

    public static func optimize(
        currentStarterIDs: [String],
        playerIDs: [String],
        template: SlotTemplate,
        positions: (String) -> Position?,
        valueOf: (String) -> Double?
    ) -> LineupProposal {
        let slots = template.starters
        guard !slots.isEmpty else { return .empty }

        let incumbents = Set(currentStarterIDs.filter { !$0.isEmpty && $0 != "0" })

        var unranked: [String] = []
        var candidates: [Candidate] = []
        var seen: Set<String> = []

        for id in playerIDs {
            guard !id.isEmpty, id != "0", seen.insert(id).inserted else { continue }
            guard let value = valueOf(id), value.isFinite else {
                unranked.append(id)
                continue
            }
            candidates.append(
                Candidate(
                    id: id,
                    position: positions(id),
                    value: value,
                    rank: value + (incumbents.contains(id) ? incumbencyMargin : 0)
                )
            )
        }

        guard !candidates.isEmpty else {
            return LineupProposal(
                proposedIDs: Array(repeating: nil, count: slots.count),
                swaps: [], currentTotal: nil, proposedTotal: nil, gain: nil,
                unranked: unranked, valuedCount: 0
            )
        }

        // Descending, ties broken on id so the answer is deterministic.
        candidates.sort { $0.rank == $1.rank ? $0.id < $1.id : $0.rank > $1.rank }

        var filled = assignMaximisingValue(candidates: candidates, slots: slots)

        var positionOf: [String: Position] = [:]
        var valueByID: [String: Double] = [:]
        for candidate in candidates {
            valueByID[candidate.id] = candidate.value
            if let position = candidate.position { positionOf[candidate.id] = position }
        }

        // Put a kept player back in the slot he already occupies whenever that
        // is legal. The assignment above seats purely by value, so two
        // interchangeable players (a QB in the QB slot and a QB in SUPER_FLEX)
        // routinely come back swapped with each other for zero net gain — which
        // reads as a recommendation when it is noise. Same total, no cosmetic
        // moves.
        for index in slots.indices {
            guard index < currentStarterIDs.count else { break }
            let currentID = currentStarterIDs[index]
            guard !currentID.isEmpty, currentID != "0" else { continue }
            guard let at = filled.firstIndex(where: { $0 == currentID }), at != index else {
                continue
            }
            guard slots[index].accepts(positionOf[currentID]) else { continue }
            let displaced = filled[index]
            if let displaced, !slots[at].accepts(positionOf[displaced]) { continue }
            filled[at] = displaced
            filled[index] = currentID
        }

        func value(of id: String?) -> Double? {
            guard let id, !id.isEmpty, id != "0" else { return nil }
            return valueByID[id]
        }

        // Raw sums, rounded only for display. Rounding each total first and then
        // subtracting made the headline gain disagree with the sum of the
        // per-swap deltas it was supposedly built from.
        func rawSum(_ ids: [String?]) -> Double? {
            var total: Double = 0
            var any = false
            for id in ids {
                guard let v = value(of: id) else { continue }
                total += v
                any = true
            }
            return any ? total : nil
        }

        let rawCurrent = rawSum(currentStarterIDs.map { Optional($0) })
        let rawProposed = rawSum(filled)

        var swaps: [LineupSwap] = []
        for index in slots.indices {
            var outID: String?
            if index < currentStarterIDs.count {
                let id = currentStarterIDs[index]
                outID = (id.isEmpty || id == "0") ? nil : id
            }
            guard let inID = filled[index], inID != outID else { continue }
            guard let inValue = value(of: inID) else { continue }
            let delta: Double
            if let outValue = value(of: outID) {
                delta = inValue - outValue
            } else {
                // A slot the current lineup left empty still counts as a real gain.
                delta = inValue
            }
            swaps.append(
                LineupSwap(
                    slotIndex: index, slot: slots[index], outID: outID, inID: inID,
                    delta: roundHalfUp(delta, places: 1)
                )
            )
        }

        var gain: Double?
        if let rawCurrent, let rawProposed {
            gain = roundHalfUp(rawProposed - rawCurrent, places: 1)
        }

        return LineupProposal(
            proposedIDs: filled,
            swaps: swaps.sorted { $0.delta > $1.delta },
            currentTotal: rawCurrent.map { roundHalfUp($0, places: 1) },
            proposedTotal: rawProposed.map { roundHalfUp($0, places: 1) },
            gain: gain,
            unranked: unranked,
            valuedCount: candidates.count
        )
    }

    struct Candidate {
        let id: String
        let position: Position?
        /// The basis's own number, used for every reported total and delta.
        let value: Double
        /// `value` plus any incumbency margin, used only to order the assignment.
        let rank: Double
    }

    /// Maximum-value legal assignment of candidates to slots.
    ///
    /// A candidate's value does not depend on which slot he fills, so taking
    /// candidates in descending value and admitting each one an augmenting path
    /// can seat is provably optimal — the greedy algorithm on a transversal
    /// matroid, not a heuristic. The web app's two-pass greedy plus hill-climb
    /// is not: given a `{RB, WR}` slot and a `{WR}` slot it seats the best
    /// receiver in the flex, strands a better back, and no bench-to-slot
    /// improvement can recover it.
    ///
    /// - Parameter candidates: already sorted by descending `rank`.
    /// - Returns: player id per slot, positionally aligned to `slots`.
    static func assignMaximisingValue(candidates: [Candidate], slots: [Slot]) -> [String?] {
        var slotForCandidate = [Int?](repeating: nil, count: candidates.count)
        var visited = [Bool](repeating: false, count: slots.count)

        // Exact-position slots before flex ones: a candidate who fits both
        // should take the more constrained seat and leave flex open.
        let slotOrder = slots.indices.sorted { lhs, rhs in
            let lhsFlex = slots[lhs].isFlex
            let rhsFlex = slots[rhs].isFlex
            if lhsFlex != rhsFlex { return !lhsFlex }
            return lhs < rhs
        }

        func occupant(of slotIndex: Int) -> Int? {
            slotForCandidate.firstIndex { $0 == slotIndex }
        }

        func augment(_ candidateIndex: Int) -> Bool {
            for slotIndex in slotOrder {
                guard !visited[slotIndex] else { continue }
                guard slots[slotIndex].accepts(candidates[candidateIndex].position) else {
                    continue
                }
                visited[slotIndex] = true
                var freed = true
                if let occupied = occupant(of: slotIndex) {
                    freed = augment(occupied)
                }
                if freed {
                    slotForCandidate[candidateIndex] = slotIndex
                    return true
                }
            }
            return false
        }

        for candidateIndex in candidates.indices {
            visited = Array(repeating: false, count: slots.count)
            _ = augment(candidateIndex)
        }

        var filled = [String?](repeating: nil, count: slots.count)
        for (candidateIndex, slotIndex) in slotForCandidate.enumerated() {
            guard let slotIndex else { continue }
            filled[slotIndex] = candidates[candidateIndex].id
        }
        return filled
    }
}
