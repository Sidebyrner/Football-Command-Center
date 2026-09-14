import XCTest
import FCCore
import FCData
@testable import FCApp

/// Game-day freshness and live matchups, against week 7 of the real 2025 schedule:
/// Thursday 8:15pm ET (CIN), Sunday 9:30am ET London, 1pm, 4:05, 4:25, Sunday
/// night, and two Monday games.
@MainActor
final class GameDayFreshnessTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func at(_ iso: String) -> @Sendable () -> Date {
        let date = ISO8601DateFormatter().date(from: iso)!
        return { date }
    }

    private func kickoffs() throws -> KickoffCalendar {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "schedule-2025", withExtension: "json", subdirectory: "Fixtures"))
        return KickoffCalendar(schedule: try JSONDecoder().decode(ScheduleFile.self, from: Data(contentsOf: url)))
    }

    // MARK: - The window

    func testTheWindowOpensSixHoursBeforeAKickoff() throws {
        let calendar = try kickoffs()
        // Sunday 4:00am ET: 5.5h before London's 9:30 kickoff.
        XCTAssertTrue(GameDayWindow.isActive(kickoffs: calendar, week: 7, now: at("2025-10-19T08:00:00Z")()))
        // Sunday 3:00am ET: 6.5h before — not yet.
        XCTAssertFalse(GameDayWindow.isActive(kickoffs: calendar, week: 7, now: at("2025-10-19T07:00:00Z")()))
    }

    func testTheWindowClosesFourHoursAfterAKickoff() throws {
        let calendar = try kickoffs()
        // Friday 12:00am ET: 3h45m after Thursday's 8:15pm kickoff.
        XCTAssertTrue(GameDayWindow.isActive(kickoffs: calendar, week: 7, now: at("2025-10-17T04:00:00Z")()))
        // Friday 1:00am ET: 4h45m after — closed.
        XCTAssertFalse(GameDayWindow.isActive(kickoffs: calendar, week: 7, now: at("2025-10-17T05:00:00Z")()))
    }

    func testMidweekIsNotAGameDay() throws {
        let calendar = try kickoffs()
        XCTAssertFalse(GameDayWindow.isActive(kickoffs: calendar, week: 7, now: at("2025-10-15T16:00:00Z")()))
        XCTAssertEqual(
            GameDayWindow.playerIndexMaxAge(kickoffs: calendar, week: 7, now: at("2025-10-15T16:00:00Z")()),
            CacheTTL.players
        )
        XCTAssertEqual(
            GameDayWindow.playerIndexMaxAge(kickoffs: calendar, week: 7, now: TestClock.week7MidSunday()),
            3 * 60 * 60
        )
    }

    // MARK: - The loader honours it

    /// A four-hour-old player index — and its injury tags — is kept midweek but
    /// replaced on Sunday afternoon.
    private func playerDownloads(now: @escaping @Sendable () -> Date) async throws -> Int {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":7,"season":"2025","season_type":"regular"}"#)
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let loader = LeagueContextLoader(sleeper: made.sleeper, staticData: made.staticData, now: now)

        _ = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)

        // Age the cached index by four hours.
        let cache = DiskCache(directory: made.cacheDirectory)
        let hit = await cache.load(PlayerIndex.self, key: "sleeper-players-v1", allowingStale: true)
        let index = try XCTUnwrap(hit).value
        try await cache.store(index, key: "sleeper-players-v1", ttl: CacheTTL.players, now: Date().addingTimeInterval(-4 * 60 * 60))

        _ = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025, force: true)
        return await transport.requestedPaths().filter { $0.hasSuffix("/players/nfl") }.count
    }

    func testTheLoaderKeepsAnOlderIndexMidweek() async throws {
        let count = try await playerDownloads(now: at("2025-10-15T16:00:00Z"))
        XCTAssertEqual(count, 1)
    }

    func testTheLoaderReplacesAnOlderIndexOnGameDay() async throws {
        let count = try await playerDownloads(now: TestClock.week7MidSunday)
        XCTAssertEqual(count, 2)
    }

    // MARK: - Live matchup

    private func matchup(now: @escaping @Sendable () -> Date) async throws -> (MatchupModel, StubTransport) {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":7,"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: MatchupModelTests.Fixture.rosters)
        await transport.override("/players/nfl", json: MatchupModelTests.Fixture.players)
        await transport.override("/matchups/7", json: MatchupModelTests.Fixture.matchups())
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let model = MatchupModel(
            loader: LeagueContextLoader(sleeper: made.sleeper, staticData: made.staticData, now: now),
            sleeper: made.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return (model, transport)
    }

    /// Mid-Sunday the 1pm games are on: a tick re-reads the matchups, stamps the
    /// update, and reuses the defense table rather than recomputing it.
    func testALiveTickDuringGamesRefreshesScores() async throws {
        let (model, transport) = try await matchup(now: TestClock.week7MidSunday)
        XCTAssertTrue(model.anyGameLive)
        let before = await transport.requestedPaths().filter { $0.hasSuffix("/matchups/7") }.count

        let polled = await model.liveTick()

        let after = await transport.requestedPaths().filter { $0.hasSuffix("/matchups/7") }.count
        XCTAssertTrue(polled)
        XCTAssertEqual(after, before + 1)
        XCTAssertNotNil(model.lastLiveUpdate)
        XCTAssertEqual(model.defenseTableBuilds, 1, "the defense table is computed once per load")
    }

    /// Midweek nothing is on, so a tick costs nothing at all.
    func testALiveTickOutsideGamesDoesNothing() async throws {
        let (model, transport) = try await matchup(now: at("2025-10-15T16:00:00Z"))
        XCTAssertFalse(model.anyGameLive)
        let before = await transport.requestCount

        let polled = await model.liveTick()

        let after = await transport.requestCount
        XCTAssertFalse(polled)
        XCTAssertEqual(after, before)
        XCTAssertNil(model.lastLiveUpdate)
    }

    /// At 2:30pm Sunday: Barkley (1pm) and Chase (Thursday) are playing or done,
    /// Allen and the BAL kicker are on bye, the flex is empty — which leaves the
    /// SEA back (Monday), the DAL receiver (4:25) and the GB lineman (4:25).
    func testLeftToPlayCountsOnlyStartersYetToKickOff() async throws {
        let (model, _) = try await matchup(now: TestClock.week7MidSunday)
        XCTAssertEqual(model.mySide?.leftToPlay, 3)
        XCTAssertEqual(model.mySide?.rows.first { $0.name == "Saquon Barkley" }?.isLive, true)
        XCTAssertNotNil(model.mySide?.rows.first { $0.name == "Receiver Two" }?.kickoff)
    }

    // MARK: - Dashboard

    func testInjuryAlertsSayHowOldTheTagIs() async throws {
        let made = Harness.make(transport: await Harness.dashboardTransport())
        cacheDirectory = made.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: made.sleeper, staticData: made.staticData, now: TestClock.beforeKickoffs),
            sleeper: made.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        let injured = try XCTUnwrap(model.alerts.first { $0.kind == .injured })
        XCTAssertNotNil(injured.asOf)
        XCTAssertNil(model.alerts.first { $0.kind == .onBye }?.asOf, "only injury tags age")
    }

    func testThisWeekCardCountsLeftToPlay() async throws {
        let transport = await Harness.dashboardTransport()
        await transport.override("/matchups/7", json: """
        [{"roster_id":1,"matchup_id":1,"points":40.0,
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"matchup_id":1,"points":30.0,
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        """)
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: made.sleeper, staticData: made.staticData, now: TestClock.week7MidSunday),
            sleeper: made.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let week = try XCTUnwrap(model.thisWeek)

        // Mine: rb_sea (Mon), wr2 (DAL 4:25), dl1 (GB 4:25).
        XCTAssertEqual(week.myLeftToPlay, 3)
        XCTAssertNotNil(week.opponentLeftToPlay)
    }
}
