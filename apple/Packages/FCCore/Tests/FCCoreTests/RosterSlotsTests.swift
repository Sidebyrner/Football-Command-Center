import XCTest
@testable import FCCore

final class RosterSlotsTests: XCTestCase {
    func testParsesTheLeaguesOwnTemplate() {
        let template = Fixtures.leagueTemplate

        XCTAssertEqual(template.totalStarterSlots, 11)
        XCTAssertEqual(template.benchCount, 6)
        XCTAssertEqual(template.unrecognized, [])

        XCTAssertEqual(
            template.starters.map(\.token),
            ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "IDP_FLEX", "IDP_FLEX"]
        )
        XCTAssertEqual(
            template.dedicatedCounts(),
            [.qb: 1, .rb: 2, .wr: 2, .te: 1, .k: 1, .def: 1]
        )
        XCTAssertEqual(template.flexSlots.count, 3)
    }

    /// IR and taxi slots are not part of the active lineup or a countable bench
    /// spot, and must not inflate either count.
    func testIgnoresIRAndTaxiButCountsBench() {
        let template = RosterSlots.parse(["QB", "BN", "BN", "IR", "TAXI", "IR"])
        XCTAssertEqual(template.totalStarterSlots, 1)
        XCTAssertEqual(template.benchCount, 2)
        XCTAssertEqual(template.unrecognized, [])
    }

    func testFlexEligibilitySets() {
        let template = RosterSlots.parse(
            ["FLEX", "SUPER_FLEX", "WRRB_FLEX", "WRTE_FLEX", "REC_FLEX", "IDP_FLEX"]
        )
        let eligibility = Dictionary(
            template.starters.map { ($0.token, $0.eligible) }, uniquingKeysWith: { first, _ in first }
        )

        XCTAssertEqual(eligibility["FLEX"], [.rb, .wr, .te])
        XCTAssertEqual(eligibility["SUPER_FLEX"], [.qb, .rb, .wr, .te])
        XCTAssertEqual(eligibility["WRRB_FLEX"], [.rb, .wr])
        XCTAssertEqual(eligibility["WRTE_FLEX"], [.wr, .te])
        XCTAssertEqual(eligibility["REC_FLEX"], [.wr, .te])
        XCTAssertEqual(eligibility["IDP_FLEX"], [.lb, .dl, .db])
        XCTAssertTrue(template.starters.allSatisfy(\.isFlex))
    }

    /// A dropped slot corrupts every roster-construction calculation
    /// downstream, so an unknown flex-shaped token still occupies a slot — and
    /// is reported (§5.3).
    func testUnknownFlexTokenKeepsItsSlotAndIsReported() {
        let template = RosterSlots.parse(["QB", "OP_FLEX"])

        XCTAssertEqual(template.totalStarterSlots, 2)
        XCTAssertEqual(template.unrecognized, ["OP_FLEX"])
        let hybrid = template.starters[1]
        XCTAssertTrue(hybrid.isFlex)
        XCTAssertEqual(hybrid.eligible, [.rb, .wr, .te])
    }

    /// A token that is neither a position nor flex-shaped is reported and
    /// creates no slot — inventing one would be worse than admitting we do not
    /// know what it is.
    func testWhollyUnknownTokenIsReportedWithoutInventingASlot() {
        let template = RosterSlots.parse(["QB", "WHAT"])
        XCTAssertEqual(template.totalStarterSlots, 1)
        XCTAssertEqual(template.unrecognized, ["WHAT"])
    }

    func testEmptyRosterPositionsProducesAnEmptyTemplate() {
        let template = RosterSlots.parse(nil)
        XCTAssertEqual(template.totalStarterSlots, 0)
        XCTAssertEqual(template.benchCount, 0)
    }

    /// Greedy assignment fills exact positions before flex, then bench, then
    /// overflow.
    func testAssignmentPrefersDedicatedSlotsThenFlex() {
        let template = RosterSlots.parse(["QB", "RB", "WR", "FLEX", "BN"])
        let positions: [String: Position] = [
            "qb1": .qb, "rb1": .rb, "rb2": .rb, "wr1": .wr, "te1": .te, "wr2": .wr,
        ]
        let assignment = RosterSlots.assign(
            playerIDs: ["rb2", "qb1", "wr1", "rb1", "te1", "wr2"],
            template: template,
            positions: { positions[$0] }
        )

        XCTAssertEqual(assignment.filled, ["qb1", "rb2", "wr1", "rb1"])
        XCTAssertEqual(assignment.bench, ["te1"])
        XCTAssertEqual(assignment.overflow, ["wr2"])
    }

    /// A `"0"` entry means "slot not set" and must never be treated as a player.
    func testUnsetSlotPlaceholderIsNotAPlayer() {
        let template = RosterSlots.parse(["QB", "RB"])
        let assignment = RosterSlots.assign(
            playerIDs: ["0", "qb1"], template: template, positions: { $0 == "qb1" ? .qb : nil }
        )
        XCTAssertEqual(assignment.filled, ["qb1", nil])
        XCTAssertTrue(assignment.overflow.isEmpty)
    }
}
