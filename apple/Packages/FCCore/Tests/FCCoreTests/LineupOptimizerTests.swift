import XCTest
@testable import FCCore

final class LineupOptimizerTests: XCTestCase {
    private let positions: [String: Position] = [
        "qb1": .qb, "qb2": .qb,
        "rb1": .rb, "rb2": .rb, "rb3": .rb,
        "wr1": .wr, "wr2": .wr, "wr3": .wr,
        "te1": .te, "te2": .te,
        "k1": .k, "def1": .def,
        "lb1": .lb, "db1": .db,
    ]

    private func optimize(
        template: SlotTemplate,
        starters: [String],
        roster: [String],
        values: [String: Double]
    ) -> LineupProposal {
        LineupOptimizer.optimize(
            currentStarterIDs: starters,
            playerIDs: roster,
            template: template,
            positions: { self.positions[$0] },
            valueOf: { values[$0] }
        )
    }

    /// A player the basis cannot value is excluded and reported, **never**
    /// silently scored as zero. That distinction is the whole reason this
    /// function is trustworthy (§5.9).
    func testANilValuedPlayerLandsInUnrankedAndIsNeverScoredAsZero() throws {
        let template = RosterSlots.parse(["QB", "RB", "FLEX"])
        let proposal = optimize(
            template: template,
            starters: ["qb1", "rb1", "wr1"],
            roster: ["qb1", "rb1", "wr1", "rb2", "wr2"],
            values: ["qb1": 20, "rb1": 12, "wr1": 9, "rb2": 11]  // wr2 has no value
        )

        XCTAssertEqual(proposal.unranked, ["wr2"])
        XCTAssertEqual(proposal.valuedCount, 4)
        XCTAssertFalse(proposal.proposedIDs.contains("wr2"))
        XCTAssertFalse(proposal.swaps.contains { $0.inID == "wr2" })

        // Zero would have made him the worst possible starter; unranked makes
        // him no starter at all, and the totals never see him.
        XCTAssertEqual(try XCTUnwrap(proposal.proposedTotal), 20 + 12 + 11, accuracy: 0.001)
    }

    /// When every player is unvalued there is nothing to propose — and still no
    /// zeros.
    func testABasisThatValuesNobodyProposesNothing() {
        let template = RosterSlots.parse(["QB", "RB"])
        let proposal = optimize(
            template: template, starters: ["qb1", "rb1"], roster: ["qb1", "rb1"], values: [:]
        )

        XCTAssertEqual(proposal.unranked.sorted(), ["qb1", "rb1"])
        XCTAssertEqual(proposal.valuedCount, 0)
        XCTAssertEqual(proposal.proposedIDs, [nil, nil])
        XCTAssertNil(proposal.currentTotal)
        XCTAssertNil(proposal.gain)
        XCTAssertTrue(proposal.swaps.isEmpty)
    }

    /// Overlapping flex eligibility, the case a two-pass greedy gets wrong: it
    /// seats the best receiver in the `{RB, WR}` slot, then has nothing legal
    /// for the `{WR}`-only slot and strands a better back on the bench.
    func testOverlappingEligibilityDoesNotStrandABetterPlayer() throws {
        let template = SlotTemplate(
            starters: [
                Slot(token: "WRRB_FLEX", dedicated: nil, eligible: [.rb, .wr]),
                Slot(token: "WR", dedicated: .wr, eligible: [.wr]),
            ],
            benchCount: 2
        )
        let proposal = optimize(
            template: template,
            starters: [],
            roster: ["wr1", "rb1", "wr2"],
            values: ["wr1": 10, "rb1": 9, "wr2": 3]
        )

        XCTAssertEqual(proposal.proposedIDs, ["rb1", "wr1"])
        XCTAssertEqual(try XCTUnwrap(proposal.proposedTotal), 19, accuracy: 0.001)
    }

    /// Greedy-plus-hill-climb also fails when a super flex competes with a
    /// dedicated slot; the assignment must seat both quarterbacks.
    func testSuperFlexAndDedicatedSlotBothFill() throws {
        let template = RosterSlots.parse(["QB", "SUPER_FLEX"])
        let proposal = optimize(
            template: template,
            starters: [],
            roster: ["qb1", "qb2", "rb1"],
            values: ["qb1": 25, "qb2": 22, "rb1": 14]
        )

        XCTAssertEqual(Set(proposal.proposedIDs.compactMap { $0 }), ["qb1", "qb2"])
        XCTAssertFalse(proposal.proposedIDs.contains(nil), "both slots must be filled")
        XCTAssertEqual(try XCTUnwrap(proposal.proposedTotal), 47, accuracy: 0.001)
    }

    /// Two interchangeable players routinely come back swapped with each other
    /// for zero net gain, which reads as a recommendation when it is noise.
    func testNoCosmeticSwapBetweenInterchangeableSlots() {
        let template = RosterSlots.parse(["QB", "SUPER_FLEX"])
        let proposal = optimize(
            template: template,
            starters: ["qb2", "qb1"],
            roster: ["qb1", "qb2"],
            values: ["qb1": 25, "qb2": 22]
        )

        XCTAssertEqual(proposal.proposedIDs, ["qb2", "qb1"], "both are already started")
        XCTAssertTrue(proposal.swaps.isEmpty)
        XCTAssertEqual(proposal.gain, 0)
    }

    /// A marginal upgrade is not a recommendation. The incumbent keeps the slot
    /// unless the challenger clears the margin.
    func testAMarginalUpgradeIsNotProposed() {
        let template = RosterSlots.parse(["RB"])
        let proposal = optimize(
            template: template,
            starters: ["rb1"],
            roster: ["rb1", "rb2"],
            values: ["rb1": 12.00, "rb2": 12.02]
        )

        XCTAssertEqual(proposal.proposedIDs, ["rb1"])
        XCTAssertTrue(proposal.swaps.isEmpty)
    }

    func testARealUpgradeIsProposed() throws {
        let template = RosterSlots.parse(["RB"])
        let proposal = optimize(
            template: template,
            starters: ["rb1"],
            roster: ["rb1", "rb2"],
            values: ["rb1": 12, "rb2": 18]
        )

        XCTAssertEqual(proposal.proposedIDs, ["rb2"])
        XCTAssertEqual(proposal.swaps.count, 1)
        let swap = try XCTUnwrap(proposal.swaps.first)
        XCTAssertEqual(swap.outID, "rb1")
        XCTAssertEqual(swap.inID, "rb2")
        XCTAssertEqual(swap.delta, 6, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(proposal.gain), 6, accuracy: 0.001)
    }

    /// A slot the current lineup left unset is a real gain, reported against no
    /// outgoing player.
    func testAnUnsetSlotIsFilledAndCountsAsGain() throws {
        let template = RosterSlots.parse(["QB", "RB"])
        let proposal = optimize(
            template: template,
            starters: ["qb1", "0"],
            roster: ["qb1", "rb1"],
            values: ["qb1": 20, "rb1": 14]
        )

        XCTAssertEqual(proposal.proposedIDs, ["qb1", "rb1"])
        let swap = try XCTUnwrap(proposal.swaps.first)
        XCTAssertNil(swap.outID)
        XCTAssertEqual(swap.inID, "rb1")
        XCTAssertEqual(swap.delta, 14, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(proposal.gain), 14, accuracy: 0.001)
    }

    /// The swap list and the proposed lineup can never disagree: every
    /// difference between the current lineup and the proposal is reported.
    func testSwapsFullyExplainTheProposedLineup() {
        let template = Fixtures.leagueTemplate
        let starters = ["qb1", "rb1", "rb2", "wr1", "wr2", "te1", "wr3", "k1", "def1", "lb1", "0"]
        let roster = starters.filter { $0 != "0" } + ["rb3", "te2", "db1", "qb2"]
        let values: [String: Double] = [
            "qb1": 24, "qb2": 9, "rb1": 18, "rb2": 11, "rb3": 16, "wr1": 15, "wr2": 12,
            "wr3": 10, "te1": 8, "te2": 13, "k1": 7, "def1": 6, "lb1": 5, "db1": 4,
        ]
        let proposal = optimize(
            template: template, starters: starters, roster: roster, values: values
        )

        XCTAssertEqual(proposal.unranked, [])
        XCTAssertEqual(proposal.proposedIDs.count, starters.count)

        for index in proposal.proposedIDs.indices {
            let current: String? = starters[index] == "0" ? nil : starters[index]
            let proposed = proposal.proposedIDs[index]
            let swap = proposal.swaps.first { $0.slotIndex == index }

            if proposed == current {
                XCTAssertNil(swap, "slot \(index) is unchanged but reported a swap")
            } else if proposed != nil {
                XCTAssertNotNil(swap, "slot \(index) changed without a reported swap")
                XCTAssertEqual(swap?.inID, proposed)
                XCTAssertEqual(swap?.outID, current)
            }
        }
    }

    /// Swaps are ordered by what they gain, so the UI leads with the move that
    /// matters.
    func testSwapsAreOrderedByGain() {
        let template = RosterSlots.parse(["QB", "RB", "WR"])
        let proposal = optimize(
            template: template,
            starters: ["qb1", "rb1", "wr1"],
            roster: ["qb1", "qb2", "rb1", "rb2", "wr1", "wr2"],
            values: ["qb1": 10, "qb2": 30, "rb1": 10, "rb2": 14, "wr1": 10, "wr2": 11]
        )

        XCTAssertEqual(proposal.swaps.map(\.inID), ["qb2", "rb2", "wr2"])
        XCTAssertEqual(proposal.swaps.map(\.delta), [20, 4, 1])
    }

    /// The basis is injected, and two bases disagreeing is information rather
    /// than something to smooth away (§6).
    func testTheSameRosterUnderTwoBasesCanDisagree() {
        let template = RosterSlots.parse(["FLEX"])
        let roster = ["rb1", "wr1"]

        let byPoints = optimize(
            template: template, starters: ["rb1"], roster: roster,
            values: ["rb1": 14, "wr1": 12]
        )
        let byCeiling = optimize(
            template: template, starters: ["rb1"], roster: roster,
            values: ["rb1": 18, "wr1": 26]
        )

        XCTAssertEqual(byPoints.proposedIDs, ["rb1"])
        XCTAssertEqual(byCeiling.proposedIDs, ["wr1"])
    }

    func testAnEmptyTemplateProposesNothing() {
        let proposal = optimize(
            template: RosterSlots.parse([]), starters: [], roster: ["qb1"], values: ["qb1": 10]
        )
        XCTAssertEqual(proposal.proposedIDs, [])
        XCTAssertTrue(proposal.swaps.isEmpty)
    }

    /// Ends to end against real scoring: the optimizer is only as good as the
    /// basis, so run it on one the rest of the package produces.
    func testAgainstRealSeasonPaceValues() throws {
        let file = try Fixtures.weekly2025()
        let template = RosterSlots.parse(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"])

        let allen = Fixtures.Player.joshAllen
        let bijan = Fixtures.Player.bijanRobinson
        let rodgers = Fixtures.Player.aaronRodgers

        var paceByID: [String: Double] = [:]
        var positionByID: [String: Position] = [:]
        for id in [allen, bijan, rodgers] {
            let position = try XCTUnwrap(file.position(for: id))
            positionByID[id] = position
            paceByID[id] = ScoringEngine.score(
                weeks: file.rows(for: id), profile: .leagueDefault, position: position
            ).pointsPerGame
        }

        let proposal = LineupOptimizer.optimize(
            currentStarterIDs: [rodgers, bijan, "0", "0", "0", "0", "0"],
            playerIDs: [allen, bijan, rodgers],
            template: template,
            positions: { positionByID[$0] },
            valueOf: { paceByID[$0] }
        )

        // Allen outpaces Rodgers by a distance, so he takes the quarterback slot.
        XCTAssertEqual(proposal.proposedIDs.first ?? nil, allen)
        XCTAssertEqual(try XCTUnwrap(proposal.gain), 14.8, accuracy: 0.05)
        XCTAssertTrue(proposal.unranked.isEmpty)
    }
}
