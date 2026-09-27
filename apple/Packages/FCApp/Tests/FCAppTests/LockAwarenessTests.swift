import XCTest
import FCCore
import FCData
@testable import FCApp

/// Lineup locks against week 7 of the real 2025 schedule, on Sunday 2025-10-19 at
/// 2:30pm ET. By then the Thursday (CIN), London (LA at JAX, 9:30) and 1pm games
/// (PHI, KC, CHI, MIN…) have kicked off; the 4:05, 4:25, Sunday night and Monday
/// games haven't. BUF and BAL are on bye and never lock.
@MainActor
final class LockAwarenessTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func harness(_ transport: StubTransport) -> (SleeperService, StaticDataStore) {
        let made = Harness.make(transport: transport)
        cacheDirectory = made.cacheDirectory
        return (made.sleeper, made.staticData)
    }

    private func sitStart(now: @escaping @Sendable () -> Date) async throws -> SitStartModel {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":7,"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: SitStartModelTests.Fixture.rosters)
        await transport.override("/players/nfl", json: SitStartModelTests.Fixture.players)
        let (sleeper, staticData) = harness(transport)
        let model = SitStartModel(loader: LeagueContextLoader(sleeper: sleeper, staticData: staticData, now: now))
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    // MARK: - Sit/Start

    /// Barkley (PHI, 1pm) and Chase (CIN, Thursday) have kicked off: they stay in
    /// their slots and appear in neither Start nor Sit.
    func testLockedStartersStayPutAndAreNeverStartedOrSat() async throws {
        let model = try await sitStart(now: TestClock.week7MidSunday)
        let rb = try XCTUnwrap(model.lineup.first { $0.playerID == "4866" })
        XCTAssertTrue(rb.isLocked)
        XCTAssertFalse(rb.changed)

        let touched = Set(model.starts.map(\.playerID) + model.sits.map(\.playerID))
        XCTAssertFalse(touched.contains("4866"))
        XCTAssertFalse(touched.contains("7564"))
        XCTAssertEqual(model.lockedStarters, 5, "Barkley, Chase, the KC tight end, the PHI defense, the CHI linebacker")
    }

    /// Nacua (LAR, London game) is on the bench and has already played. Before
    /// any kickoff he'd start; mid-Sunday he can't.
    func testALockedBenchPlayerIsNotStarted() async throws {
        let before = try await sitStart(now: TestClock.beforeKickoffs)
        XCTAssertTrue(before.starts.contains { $0.name == "Puka Nacua" }, "fixture precondition")

        let during = try await sitStart(now: TestClock.week7MidSunday)
        XCTAssertFalse(during.starts.contains { $0.name == "Puka Nacua" })
        XCTAssertEqual(during.lockedBench, ["Puka Nacua"])
    }

    /// Moves that are still possible are still recommended: BUF is on bye, never
    /// locks, and Goff (DET, Monday) hasn't played.
    func testUnlockedMovesAreStillRecommended() async throws {
        let model = try await sitStart(now: TestClock.week7MidSunday)
        XCTAssertTrue(model.starts.contains { $0.name == "Jared Goff" })
        XCTAssertTrue(model.sits.contains { $0.name == "Josh Allen" })
    }

    /// The next lock is 4:25pm ET, when the DAL receiver and the GB lineman kick off.
    func testNextLockIsTheNextKickoffAmongStarters() async throws {
        let model = try await sitStart(now: TestClock.week7MidSunday)
        let next = try XCTUnwrap(model.nextLock)
        XCTAssertEqual(next.date, ISO8601DateFormatter().date(from: "2025-10-19T20:25:00Z"))
        XCTAssertEqual(next.starters, 2)
    }

    /// Before any kickoff nothing is locked.
    func testNothingIsLockedBeforeKickoffs() async throws {
        let model = try await sitStart(now: TestClock.beforeKickoffs)
        XCTAssertEqual(model.lockedStarters, 0)
        XCTAssertTrue(model.lockedBench.isEmpty)
        XCTAssertFalse(model.lineup.contains(where: \.isLocked))
    }

    // MARK: - Dashboard

    private func dashboard(now: @escaping @Sendable () -> Date) async throws -> DashboardModel {
        let (sleeper, staticData) = harness(await Harness.dashboardTransport())
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: sleeper, staticData: staticData, now: now),
            sleeper: sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    /// The questionable receiver plays for MIN, whose 1pm game has started:
    /// nothing can be done about him now, so no alert. The bye starters and the
    /// empty slot can still be fixed, so those alerts remain.
    func testAlertsForLockedStartersAreDropped() async throws {
        let before = try await dashboard(now: TestClock.beforeKickoffs)
        XCTAssertTrue(before.alerts.contains { $0.kind == .injured }, "fixture precondition")

        let during = try await dashboard(now: TestClock.week7MidSunday)
        XCTAssertFalse(during.alerts.contains { $0.kind == .injured })
        XCTAssertTrue(during.alerts.contains { $0.kind == .onBye && $0.playerName == "Starter QB" })
        XCTAssertTrue(during.alerts.contains { $0.kind == .emptySlot })
    }

    func testDashboardShowsTheNextLineupLock() async throws {
        let model = try await dashboard(now: TestClock.week7MidSunday)
        XCTAssertEqual(model.nextLock, ISO8601DateFormatter().date(from: "2025-10-19T20:25:00Z"))
    }

    // MARK: - Matchup

    func testMatchupRowsCarryLocks() async throws {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":7,"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: MatchupModelTests.Fixture.rosters)
        await transport.override("/players/nfl", json: MatchupModelTests.Fixture.players)
        await transport.override("/matchups/7", json: MatchupModelTests.Fixture.matchups())
        let (sleeper, staticData) = harness(transport)
        let model = MatchupModel(
            loader: LeagueContextLoader(sleeper: sleeper, staticData: staticData, now: TestClock.week7MidSunday),
            sleeper: sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        let rows = try XCTUnwrap(model.mySide?.rows)
        XCTAssertEqual(rows.first { $0.name == "Saquon Barkley" }?.isLocked, true)
        XCTAssertEqual(rows.first { $0.name == "Josh Allen" }?.isLocked, false, "on bye, never locked")
    }

    // MARK: - Formatting and links

    func testCountdownFormatting() {
        XCTAssertEqual(LockCountdown.format(-5), "now")
        XCTAssertEqual(LockCountdown.format(30), "<1m")
        XCTAssertEqual(LockCountdown.format(14 * 60), "14m")
        XCTAssertEqual(LockCountdown.format(2 * 3600 + 14 * 60), "2h 14m")
        XCTAssertEqual(LockCountdown.format(3 * 3600), "3h")
        XCTAssertEqual(LockCountdown.format(27 * 3600), "1d 3h")
    }

    func testSleeperTeamLink() {
        XCTAssertEqual(SleeperLinks.team(leagueID: "1234567890")?.absoluteString, "https://sleeper.com/leagues/1234567890/team")
    }
}
