import XCTest
@testable import FCCore

final class ByeCrunchTests: XCTestCase {
    private let template = Fixtures.leagueTemplate

    private func entry(_ id: String, _ position: Position, _ team: String) -> RosterEntry {
        RosterEntry(id: id, position: position, team: team)
    }

    /// A full, legal roster with nobody on bye is short of nothing.
    private func fullRoster(teams: [Position: String] = [:]) -> [RosterEntry] {
        func team(_ position: Position, _ fallback: String) -> String {
            teams[position] ?? fallback
        }
        return [
            entry("qb1", .qb, team(.qb, "BUF")),
            entry("rb1", .rb, team(.rb, "ATL")),
            entry("rb2", .rb, team(.rb, "DET")),
            entry("wr1", .wr, team(.wr, "MIN")),
            entry("wr2", .wr, team(.wr, "CIN")),
            entry("wr3", .wr, team(.wr, "PHI")),   // covers FLEX
            entry("te1", .te, team(.te, "KC")),
            entry("k1", .k, team(.k, "BAL")),
            entry("def1", .def, team(.def, "PIT")),
            entry("lb1", .lb, team(.lb, "SF")),    // covers IDP_FLEX
            entry("db1", .db, team(.db, "NYJ")),   // covers IDP_FLEX
        ]
    }

    func testAFullRosterIsShortOfNothing() {
        let report = ByeCrunch.forWeek(
            roster: fullRoster(), template: template, byeTeams: []
        )
        XCTAssertEqual(report.totalShortfall, 0)
        XCTAssertTrue(report.isFeasible)
        XCTAssertTrue(report.onBye.isEmpty)
        XCTAssertEqual(report.flexFilled, 3)
    }

    /// A position flags short only when the non-bye players genuinely cannot
    /// fill its slots.
    func testAPositionFlagsShortOnlyWhenItActuallyIs() throws {
        // Both running backs are off in the same week.
        let roster = fullRoster(teams: [.rb: "GB"])
        let report = ByeCrunch.forWeek(
            roster: roster, template: template, byeTeams: ["GB"]
        )

        let rb = try XCTUnwrap(report.byPosition[.rb])
        XCTAssertEqual(rb.required, 2)
        XCTAssertEqual(rb.available, 0)
        XCTAssertEqual(rb.shortfall, 2)
        XCTAssertEqual(report.onBye.map(\.id).sorted(), ["rb1", "rb2"])

        // Nothing else moved.
        XCTAssertEqual(report.byPosition[.wr]?.shortfall, 0)
        XCTAssertEqual(report.byPosition[.qb]?.shortfall, 0)
    }

    /// "RB: 1 available for 2 slots" is the thing the user acts on; a
    /// feasible/infeasible boolean isn't (§5.5).
    func testShortfallIsReportedPerPositionNotAsABoolean() {
        var roster = fullRoster()
        roster.removeAll { $0.id == "rb2" }
        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: [])

        XCTAssertEqual(report.byPosition[.rb]?.required, 2)
        XCTAssertEqual(report.byPosition[.rb]?.available, 1)
        XCTAssertEqual(report.byPosition[.rb]?.shortfall, 1)
        XCTAssertEqual(report.totalShortfall, 1)
    }

    /// A position with no rostered players at all reports its full shortfall
    /// rather than disappearing from the report.
    func testAPositionWithNoPlayersReportsItsFullShortfall() {
        var roster = fullRoster()
        roster.removeAll { $0.position == .wr }
        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: [])

        XCTAssertEqual(report.byPosition[.wr]?.required, 2)
        XCTAssertEqual(report.byPosition[.wr]?.available, 0)
        XCTAssertEqual(report.byPosition[.wr]?.shortfall, 2)
        // The FLEX slot the third receiver was covering is now empty too.
        XCTAssertEqual(report.flexShortfall, 1)
        XCTAssertEqual(report.totalShortfall, 3)
    }

    /// **The deviation from the web app.** `crunchForWeek` in the React codebase
    /// pools every flex slot against the union of their eligibility sets, so in
    /// this league a spare receiver reads as covering a missing linebacker and
    /// the week looks fillable when it isn't. Each flex slot is matched only
    /// against positions it actually accepts.
    func testAnOffensiveSurplusCannotCoverAnIDPFlexSlot() {
        var roster = fullRoster()
        roster.removeAll { $0.id == "lb1" }
        roster.append(entry("wr4", .wr, "SEA"))
        roster.append(entry("wr5", .wr, "TB"))

        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: [])

        XCTAssertEqual(report.flexRequired, 3)
        XCTAssertEqual(report.flexFilled, 2, "two receivers cannot fill an IDP slot")
        XCTAssertEqual(report.flexShortfall, 1)
        XCTAssertEqual(report.totalShortfall, 1)

        let idp = report.flexGroups.first { $0.eligible == [.lb, .dl, .db] }
        XCTAssertEqual(idp?.required, 2)
        XCTAssertEqual(idp?.filled, 1)
        XCTAssertEqual(idp?.shortfall, 1)

        let offensive = report.flexGroups.first { $0.eligible == [.rb, .wr, .te] }
        XCTAssertEqual(offensive?.shortfall, 0)
    }

    /// Overlapping eligibility sets still fill optimally: a league running both
    /// `WRRB_FLEX` and `WRTE_FLEX` must not strand a tight end in the wrong one.
    func testOverlappingFlexEligibilityFillsOptimally() {
        let overlapping = RosterSlots.parse(["WRRB_FLEX", "WRTE_FLEX"])
        let roster = [
            entry("wr1", .wr, "PHI"),
            entry("rb1", .rb, "DAL"),
        ]
        let report = ByeCrunch.forWeek(roster: roster, template: overlapping, byeTeams: [])

        // Naively seating the receiver in WRTE_FLEX would strand the back.
        XCTAssertEqual(report.flexFilled, 2)
        XCTAssertEqual(report.totalShortfall, 0)
    }

    /// Surplus is what flex draws on — a third receiver beyond the two dedicated
    /// slots, not one of the two already needed there.
    func testFlexDrawsOnSurplusNotOnDedicatedStarters() {
        var roster = fullRoster()
        roster.removeAll { $0.id == "wr3" }
        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: [])

        XCTAssertEqual(report.byPosition[.wr]?.shortfall, 0, "the two dedicated slots are covered")
        let offensive = report.flexGroups.first { $0.eligible == [.rb, .wr, .te] }
        XCTAssertEqual(offensive?.shortfall, 1, "but nothing is left over for FLEX")
    }

    /// Bye membership is checked after normalisation, so a Sleeper-sourced `LAR`
    /// player is correctly caught by an nflverse `LA` bye.
    func testByeMatchingNormalisesTheTeamCode() {
        var roster = fullRoster()
        roster.removeAll { $0.id == "qb1" }
        roster.append(entry("qb1", .qb, "LAR"))

        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: ["LA"])

        XCTAssertEqual(report.onBye.map(\.id), ["qb1"])
        XCTAssertEqual(report.byPosition[.qb]?.shortfall, 1)
    }

    /// Unset slots and unknown players are surfaced, never counted as coverage.
    func testUnsetSlotsAndUnknownPositionsAreNotCoverage() {
        var roster = fullRoster()
        roster.append(RosterEntry(id: "0", position: nil, team: nil))
        roster.append(RosterEntry(id: "mystery", position: nil, team: "PHI"))

        let report = ByeCrunch.forWeek(roster: roster, template: template, byeTeams: [])
        XCTAssertEqual(report.unknownPosition, ["mystery"])
        XCTAssertEqual(report.totalShortfall, 0)
    }

    /// End to end against the real schedule.
    func testOutlookAgainstTheRealSchedule() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())
        // Both backs and all three receivers are Rams, so they share a bye.
        let roster = fullRoster(teams: [.rb: "LAR", .wr: "LAR"])
        let outlook = ByeCrunch.outlook(
            roster: roster, template: template, calendar: calendar, weeks: Array(1...18)
        )

        XCTAssertEqual(outlook.count, 18)

        let ramsBye = try XCTUnwrap(calendar.byTeam["LA"])
        XCTAssertEqual(ramsBye, 8)
        let crunchWeek = try XCTUnwrap(outlook[ramsBye])

        XCTAssertEqual(crunchWeek.onBye.count, 5)
        XCTAssertEqual(crunchWeek.byPosition[.rb]?.shortfall, 2)
        XCTAssertEqual(crunchWeek.byPosition[.wr]?.shortfall, 2)
        // Two RB slots, two WR slots and the offensive FLEX behind them.
        XCTAssertEqual(crunchWeek.totalShortfall, 5)
        XCTAssertEqual(crunchWeek.flexGroups.first { $0.eligible == [.lb, .dl, .db] }?.shortfall, 0)

        // Every other week: short exactly when one of the roster's teams is off,
        // and never otherwise. This roster carries one player per dedicated slot
        // outside RB/WR, so any bye at all bites.
        let rosterTeams = Set(roster.compactMap { NFLTeams.nflverse($0.team) })
        for week in 1...18 {
            let report = try XCTUnwrap(outlook[week])
            let affected = !rosterTeams.isDisjoint(with: calendar.byeTeams(week: week))
            if affected {
                XCTAssertGreaterThan(report.totalShortfall, 0, "week \(week)")
            } else {
                XCTAssertEqual(report.totalShortfall, 0, "week \(week)")
            }
        }
    }
}
