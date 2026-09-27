import XCTest
@testable import FCCore

/// Superflex-aware start lines, flex upgrade needs and team grades — the
/// pieces the Trade Desk values deals with.
final class FlexDemandTests: XCTestCase {
    private var template: SlotTemplate {
        RosterSlots.parse(["QB", "RB", "RB", "WR", "WR", "TE", "SUPER_FLEX", "K", "DEF", "IDP_FLEX", "IDP_FLEX", "BN", "BN"])
    }

    private func lineup(superflex: Position?, idp: [Position?] = [.lb, .db]) -> [Position?] {
        [.qb, .rb, .rb, .wr, .wr, .te, superflex, .k, .def] + idp
    }

    func testSuperflexDemandComesFromWhoManagersStart() {
        let lineups = Array(repeating: lineup(superflex: .qb), count: 7) + [lineup(superflex: .rb)]
        let demand = FlexDemand.observed(template: template, lineups: lineups)
        XCTAssertEqual(demand[.qb] ?? 0, 7.0 / 8.0, accuracy: 1e-9)
        XCTAssertEqual(demand[.rb] ?? 0, 1.0 / 8.0, accuracy: 1e-9)
        XCTAssertEqual(demand[.lb] ?? 0, 1, accuracy: 1e-9)
        XCTAssertEqual(demand[.db] ?? 0, 1, accuracy: 1e-9)
    }

    func testAnEmptyFlexSlotStillCountsAsDemand() {
        let lineups = [lineup(superflex: .qb), lineup(superflex: nil)]
        let demand = FlexDemand.observed(template: template, lineups: lineups)
        // Three filled flex slots out of six stand for all six.
        XCTAssertEqual((demand[.qb] ?? 0) + (demand[.lb] ?? 0) + (demand[.db] ?? 0), 3, accuracy: 1e-9)
    }

    func testTheQuarterbackLineMovesDownTheListInSuperflex() {
        let qbs = (1...20).map { Double(30 - $0) }
        let dedicated = Baselines.lines(byPosition: [.qb: qbs], template: template, teamCount: 8)
        let flexAware = Baselines.lines(byPosition: [.qb: qbs], template: template, teamCount: 8, flexDemand: [.qb: 1])
        XCTAssertEqual(dedicated[.qb]?.starters, 8)
        XCTAssertEqual(flexAware[.qb]?.starters, 16)
        XCTAssertEqual(flexAware[.qb]?.startLine, qbs[15])
        XCTAssertLessThan(try XCTUnwrap(flexAware[.qb]?.startLine), try XCTUnwrap(dedicated[.qb]?.startLine))
    }

    func testAWeakSuperflexQuarterbackIsANeedOnlyWhenAsked() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())
        let roster = [
            RosterEntry(id: "qb1", position: .qb, team: "BUF"),
            RosterEntry(id: "qb2", position: .qb, team: "NYJ"),
        ]
        let template = RosterSlots.parse(["QB", "SUPER_FLEX", "BN"])
        let baselines = Baselines.lines(byPosition: [.qb: [25, 22, 20, 18]], template: template, teamCount: 2, flexDemand: [.qb: 1])
        func build(_ flex: Bool) -> TeamNeeds {
            TeamNeedsBuilder.build(
                roster: roster, starters: ["qb1", "qb2"], template: template,
                values: ["qb1": 24, "qb2": 12], baselines: baselines,
                calendar: calendar, weeks: [], includeFlexStarters: flex
            )
        }
        XCTAssertTrue(build(false).needs.isEmpty)
        let need = try? XCTUnwrap(build(true).needs.first)
        XCTAssertEqual(need?.viaFlex, true)
        if case .weakStarter(let id, let gap) = need?.kind {
            XCTAssertEqual(id, "qb2")
            XCTAssertEqual(gap, 6, accuracy: 1e-9)
        } else {
            XCTFail("expected a weak superflex starter")
        }
    }
}

final class TeamGradesTests: XCTestCase {
    func testLineupAndDepthMakeTheGrade() {
        let grades = TeamGrades.grade([
            .init(rosterID: 1, lineupPoints: 150, shortWeeks: 0, remainingWeeks: 10),
            .init(rosterID: 2, lineupPoints: 100, shortWeeks: 5, remainingWeeks: 10),
            .init(rosterID: 3, lineupPoints: 125, shortWeeks: 0, remainingWeeks: 10),
            .init(rosterID: 4, lineupPoints: nil, shortWeeks: 0, remainingWeeks: 10),
        ])
        let byID = Dictionary(uniqueKeysWithValues: grades.map { ($0.rosterID, $0) })
        XCTAssertEqual(byID[1]?.lineupScore, 100)
        XCTAssertEqual(byID[1]?.score, 100)
        XCTAssertEqual(byID[1]?.letter, "A+")
        XCTAssertEqual(byID[1]?.rank, 1)
        XCTAssertEqual(byID[2]?.lineupScore, 0)
        XCTAssertEqual(byID[2]?.depthScore, 50)
        XCTAssertEqual(byID[2]?.score, Int((50 * TeamGrades.depthWeight).rounded()))
        XCTAssertEqual(byID[2]?.letter, "F")
        XCTAssertEqual(byID[3]?.lineupScore, 50)
        XCTAssertEqual(byID[3]?.letter, "B", "0.65 × 50 + 0.35 × 100 = 67.5, in the 60–70 band")
        XCTAssertNil(byID[4]?.letter, "no valued lineup, no grade")
        XCTAssertEqual(byID[4]?.depthScore, 100)
    }

    func testBands() {
        XCTAssertEqual(TeamGrades.letter(for: 90), "A+")
        XCTAssertEqual(TeamGrades.letter(for: 79.9), "B+")
        XCTAssertEqual(TeamGrades.letter(for: 0), "F")
    }
}
