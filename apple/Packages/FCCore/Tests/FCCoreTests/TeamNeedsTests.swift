import XCTest
@testable import FCCore

/// Needs and surplus on the real 2025 schedule. Week 8 byes: ARI, DET, JAX, LA,
/// LV, SEA. Week 5 byes: ATL, CHI, GB, PIT.
final class TeamNeedsTests: XCTestCase {
    private let template = RosterSlots.parse(["QB", "RB", "RB", "WR", "FLEX", "DEF", "BN", "BN", "BN"])

    private func baselines() -> [Position: PositionBaseline] {
        [
            .rb: PositionBaseline(position: .rb, starters: 24, startLine: 12, replacementLine: 10, pool: 60),
            .wr: PositionBaseline(position: .wr, starters: 24, startLine: 11, replacementLine: 9, pool: 80),
        ]
    }

    private func build(roster: [RosterEntry], starters: [String], values: [String: Double], weeks: [Int]) throws -> TeamNeeds {
        TeamNeedsBuilder.build(
            roster: roster, starters: starters, template: template, values: values,
            baselines: baselines(), calendar: ByeCalendar(schedule: try Fixtures.schedule2025()), weeks: weeks
        )
    }

    private let roster = [
        RosterEntry(id: "qb", position: .qb, team: "BUF"),
        RosterEntry(id: "rb_la", position: .rb, team: "LA"),
        RosterEntry(id: "rb_sea", position: .rb, team: "SEA"),
        RosterEntry(id: "rb_atl", position: .rb, team: "ATL"),
        RosterEntry(id: "wr_min", position: .wr, team: "MIN"),
        RosterEntry(id: "wr_dal", position: .wr, team: "DAL"),
        RosterEntry(id: "PHI", position: .def, team: "PHI"),
        RosterEntry(id: "DAL", position: .def, team: "DAL"),
    ]
    private let starters = ["qb", "rb_la", "rb_sea", "wr_min", "wr_dal", "PHI"]
    private let values: [String: Double] = ["qb": 20, "rb_la": 15, "rb_sea": 8, "rb_atl": 11, "wr_min": 13, "wr_dal": 10]

    /// Both starting backs are off in week 8; the ATL back covers one slot, so
    /// RB is short by one — a dedicated need, not a flex one.
    func testAShortDedicatedSlotIsANeedForThatPosition() throws {
        let needs = try build(roster: roster, starters: starters, values: values, weeks: [7, 8])
        let rb = try XCTUnwrap(needs.needs.first { $0.positions == [.rb] && $0.weeks != nil })
        XCTAssertEqual(rb.weeks, [8])
        XCTAssertFalse(rb.viaFlex)
    }

    /// The SEA back averages 8, four under the RB start line of 12.
    func testAStarterBelowTheStartLineIsAWeakStarterNeed() throws {
        let needs = try build(roster: roster, starters: starters, values: values, weeks: [7])
        let weak = needs.needs.compactMap { need -> (String, Double)? in
            if case .weakStarter(let id, let gap) = need.kind { return (id, gap) }
            return nil
        }
        XCTAssertEqual(weak.first?.0, "rb_sea")
        XCTAssertEqual(weak.first?.1 ?? 0, 4, accuracy: 0.001)
        XCTAssertFalse(weak.contains { $0.0 == "wr_dal" }, "a flex starter isn't measured against one position's line")
    }

    /// Three backs for two RB slots: the bench back is surplus, above the
    /// replacement line, and doesn't play in ATL's week 5 bye.
    func testABenchPlayerAtACoveredPositionIsSurplus() throws {
        let needs = try build(roster: roster, starters: starters, values: values, weeks: [5, 6])
        let atl = try XCTUnwrap(needs.surplus.first { $0.playerID == "rb_atl" })
        XCTAssertTrue(atl.aboveReplacement)
        XCTAssertEqual(atl.playsWeeks, [6])
    }

    /// Only two receivers, one starting at WR and one in the flex: nothing spare.
    func testNoSurplusWhenThePositionIsNotCovered() throws {
        let needs = try build(roster: roster, starters: starters, values: values, weeks: [7])
        XCTAssertTrue(needs.surplus(at: [.wr]).isEmpty)
    }

    /// A spare team defense is depth only — no production data, never a value.
    func testASpareDefenseIsDepthOnly() throws {
        let needs = try build(roster: roster, starters: starters, values: values, weeks: [7])
        let dal = try XCTUnwrap(needs.surplus.first { $0.playerID == "DAL" })
        XCTAssertTrue(dal.depthOnly)
        XCTAssertNil(dal.value)
        XCTAssertFalse(dal.aboveReplacement)
    }

    /// Surplus is listed best value first, with no-value players last.
    func testSurplusIsOrderedByValue() throws {
        let deeper = roster + [RosterEntry(id: "rb_kc", position: .rb, team: "KC")]
        var more = values
        more["rb_kc"] = 14
        let needs = try build(roster: deeper, starters: starters, values: more, weeks: [7])
        XCTAssertEqual(needs.surplus.first?.playerID, "rb_kc")
        XCTAssertEqual(needs.surplus.last?.value, nil)
    }
}
