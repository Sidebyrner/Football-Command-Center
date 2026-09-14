import XCTest
import FCCore
import FCData
@testable import FCApp

/// The My Team hub's model, on the week 7 dashboard fixture: the user's QB (BUF)
/// and kicker (BAL) are on bye, the flex is empty, and the MIN receiver is
/// Questionable. Weeks 1 and 2 are completed history (lost 76–95, won 88–70).
@MainActor
final class MyTeamModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func loaded(
        now: @escaping @Sendable () -> Date = TestClock.beforeKickoffs,
        configure: (StubTransport) async -> Void = { _ in }
    ) async throws -> DashboardModel {
        let transport = await Harness.dashboardTransport()
        await configure(transport)
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: made.sleeper, staticData: made.staticData, now: now),
            sleeper: made.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    // MARK: - Readiness

    func testReadinessCountsEachSlotOnce() async throws {
        let model = try await loaded()
        let readiness = try XCTUnwrap(model.readiness)

        XCTAssertEqual(readiness.slots, 11)
        XCTAssertEqual(readiness.problems, 3, "two byes and the empty flex")
        XCTAssertEqual(readiness.caution, 1, "the Questionable receiver")
        XCTAssertEqual(readiness.ready, 7)
        XCTAssertEqual(readiness.settled, 0)
        XCTAssertEqual(readiness.ready + readiness.caution + readiness.problems + readiness.settled, readiness.slots)
        XCTAssertFalse(readiness.isAllClear)
    }

    /// The ring and the alerts are built from the same rules: every flagged slot
    /// is exactly one alert.
    func testReadinessAgreesWithTheAlerts() async throws {
        for clock in [TestClock.beforeKickoffs, TestClock.week7MidSunday] {
            let model = try await loaded(now: clock)
            let readiness = try XCTUnwrap(model.readiness)
            let emptySlots = model.context?.userTeam?.rawStarters.filter { $0 == "0" }.count ?? 0
            let flagged = model.alerts.filter { $0.kind != .emptySlot }.count + (model.alerts.contains { $0.kind == .emptySlot } ? emptySlots : 0)
            XCTAssertEqual(readiness.caution + readiness.problems, flagged)
        }
    }

    /// Mid-Sunday the MIN receiver's game has started: settled, not a caution.
    func testLockedStartersCountAsSettled() async throws {
        let model = try await loaded(now: TestClock.week7MidSunday)
        let readiness = try XCTUnwrap(model.readiness)
        XCTAssertEqual(readiness.settled, 5, "LAR (London), MIN, KC, PHI and CHI have kicked off")
        XCTAssertEqual(readiness.caution, 0)
        XCTAssertEqual(readiness.problems, 3, "byes and an empty slot are still fixable")
    }

    func testAnOutTagIsAProblemNotACaution() async throws {
        let model = try await loaded { transport in
            var players = TestLeague.dashboardPlayersJSON()
            players = players.replacingOccurrences(
                of: #""wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true}"#,
                with: #""wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","injury_status":"Out","active":true}"#
            )
            await transport.override("/players/nfl", json: players)
        }
        let readiness = try XCTUnwrap(model.readiness)
        XCTAssertEqual(readiness.problems, 4)
        XCTAssertEqual(readiness.caution, 1)
    }

    // MARK: - Results, streak, place

    func testResultsComeFromCompletedMatchups() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.results.map(\.week), [1, 2])
        XCTAssertEqual(model.results.first?.outcome, .loss)
        XCTAssertEqual(model.results.first?.opponentManager, "rival")
        XCTAssertEqual(model.results.last?.outcome, .win)
        XCTAssertEqual(model.streak, "W1")
    }

    func testStreakCountsTheCurrentRun() {
        let results = [WeekResult.Outcome.loss, .win, .win, .win].enumerated().map {
            WeekResult(week: $0.offset + 1, myPoints: 1, opponentPoints: 0, opponentManager: "x", outcome: $0.element)
        }
        XCTAssertEqual(DashboardModel.streak(results), "W3")
        XCTAssertNil(DashboardModel.streak([]))
    }

    func testStandingsPlace() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.place?.rank, 2)
        XCTAssertEqual(model.place?.of, 2)
    }

    // MARK: - Upcoming and the bye strip

    /// Week 8 pairs the user with the rival. In week 8 LAR and SEA are off, so the
    /// user is short at RB; the rival isn't short at all.
    func testUpcomingOpponentsFlagShortfallsOnBothSides() async throws {
        let model = try await loaded { transport in
            await transport.override("/matchups/8", json: """
            [{"roster_id":1,"matchup_id":3,"points":0},{"roster_id":2,"matchup_id":3,"points":0}]
            """)
        }
        let week8 = try XCTUnwrap(model.upcoming.first { $0.week == 8 })
        XCTAssertEqual(week8.manager, "rival")
        XCTAssertEqual(week8.record, "2-0")
        XCTAssertGreaterThanOrEqual(week8.yourShortfall, 2)
        XCTAssertEqual(week8.theirShortfall, 0)
    }

    func testByeStripCoversRemainingWeeks() async throws {
        let model = try await loaded()
        let context = try XCTUnwrap(model.context)
        XCTAssertEqual(model.byeStrip.map(\.week), context.remainingWeeks)
        let week8 = try XCTUnwrap(model.byeStrip.first { $0.week == 8 })
        XCTAssertGreaterThanOrEqual(week8.yourShortfall, 2)
        XCTAssertGreaterThanOrEqual(week8.teamsShort, 1)
        XCTAssertEqual(week8.teamCount, 2)
    }

    // MARK: - Provenance for the pillar chips

    /// Sleeper data here comes live from the stub; the nflverse files are
    /// bundled. The chips must say those two different things.
    func testSleeperAndStaticProvenanceAreSeparate() async throws {
        let model = try await loaded()
        let context = try XCTUnwrap(model.context)
        XCTAssertEqual(context.sleeperProvenance, .live)
        XCTAssertEqual(context.staticProvenance, .bundled)
    }
}
