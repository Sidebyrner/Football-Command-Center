import XCTest
@testable import FCCore

/// Byes derived from the schedule by absence, checked against the shipped
/// schedule file.
final class ByeWeeksTests: XCTestCase {
    func testFindsAllThirtyTwoTeams() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())
        XCTAssertEqual(calendar.teams.count, 32)
        XCTAssertEqual(calendar.teams, calendar.teams.sorted())

        // The schedule speaks the nflverse dialect.
        XCTAssertTrue(calendar.teams.contains("LA"))
        XCTAssertFalse(calendar.teams.contains("LAR"))
    }

    func testAKnownWeeksByesReproduceExactly() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())

        XCTAssertEqual(calendar.byWeek[5], ["ATL", "CHI", "GB", "PIT"])
        XCTAssertEqual(calendar.byWeek[6], ["HOU", "MIN"])
        XCTAssertEqual(calendar.byWeek[8], ["ARI", "DET", "JAX", "LA", "LV", "SEA"])
        XCTAssertEqual(calendar.byWeek[10], ["CIN", "DAL", "KC", "TEN"])
    }

    /// Every team gets exactly one bye, and no week outside the bye window
    /// invents one.
    func testEveryTeamHasExactlyOneBye() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())

        XCTAssertEqual(calendar.byTeam.count, 32)
        XCTAssertEqual(Set(calendar.byWeek.keys), [5, 6, 7, 8, 9, 10, 11, 12, 14])

        let allByeSlots = calendar.byWeek.values.reduce(0) { $0 + $1.count }
        XCTAssertEqual(allByeSlots, 32, "a team appearing twice means a week was double-counted")
    }

    /// A week with no games means the file does not cover it — **not** that all
    /// thirty-two teams are on bye. Inventing 32 byes out of missing data is the
    /// obvious bug here (§5.4).
    func testAWeekWithNoGamesYieldsNoByes() throws {
        let real = try Fixtures.schedule2025()
        var padded = real.byWeek
        padded["19"] = []
        padded["20"] = []

        let json = try JSONEncoder().encode(PaddedSchedule(byWeek: padded))
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: json)
        let calendar = ByeCalendar(schedule: schedule)

        XCTAssertNil(calendar.byWeek[19])
        XCTAssertNil(calendar.byWeek[20])
        XCTAssertEqual(calendar.teams.count, 32)
        XCTAssertEqual(calendar.byTeam.count, 32)
    }

    /// The LAR regression, end to end: a Sleeper-sourced Rams player must read
    /// as on bye in the week the nflverse schedule says `LA` is off.
    func testARamsPlayerIsOnByeAfterNormalisation() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())
        let ramsBye = try XCTUnwrap(calendar.byTeam["LA"])
        XCTAssertEqual(ramsBye, 8)

        let sleeperTeam = "LAR"
        XCTAssertFalse(
            calendar.isOnBye(team: sleeperTeam, week: ramsBye),
            "the raw Sleeper code must not match — that is exactly the join bug"
        )
        XCTAssertTrue(calendar.isOnBye(team: NFLTeams.nflverse(sleeperTeam), week: ramsBye))
    }

    func testByeTeamsLookupIsEmptyForAWeekWithNoByes() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2025())
        XCTAssertTrue(calendar.byeTeams(week: 1).isEmpty)
        XCTAssertEqual(calendar.byeTeams(week: 8).count, 6)
    }

    /// The 2026 file is a different season with a different bye pattern; the
    /// derivation must not be tuned to one file.
    func testDerivationWorksOnASecondSeason() throws {
        let calendar = ByeCalendar(schedule: try Fixtures.schedule2026())
        XCTAssertEqual(calendar.teams.count, 32)
        XCTAssertEqual(calendar.byTeam.count, 32)
        XCTAssertEqual(calendar.byWeek.values.reduce(0) { $0 + $1.count }, 32)
    }

    /// `byTeam` records a team's *first* bye, which requires walking weeks in
    /// ascending order rather than in whatever order the JSON object yields.
    func testByTeamRecordsTheEarliestWeek() throws {
        let schedule = try JSONDecoder().decode(
            ScheduleFile.self,
            from: Data(
                """
                {"byWeek":{
                  "2":[{"home":"PHI","away":"DAL"}],
                  "1":[{"home":"PHI","away":"DAL"},{"home":"KC","away":"BUF"}],
                  "3":[{"home":"KC","away":"BUF"}]
                }}
                """.utf8
            )
        )
        let calendar = ByeCalendar(schedule: schedule)
        XCTAssertEqual(calendar.teams, ["BUF", "DAL", "KC", "PHI"])
        XCTAssertEqual(calendar.byTeam["KC"], 2)
        XCTAssertEqual(calendar.byTeam["BUF"], 2)
        XCTAssertEqual(calendar.byTeam["PHI"], 3)
    }
}

/// Minimal encodable mirror so a test can add a week to a real schedule.
private struct PaddedSchedule: Encodable {
    let byWeek: [String: [ScheduledGame]]
}
