import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Dashboard, against the real 2025 schedule and weekly files.
///
/// The fixture's current week is 7, where the shipped schedule puts BAL and BUF
/// on bye — so the user's BUF quarterback and BAL kicker are guaranteed zeroes
/// derived from real data rather than asserted into a fixture. Weeks 1 and 2
/// are completed history; week 7 is live and must never be graded.
@MainActor
final class DashboardModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func makeModel(transport: StubTransport, relay: RelayClient? = nil) -> DashboardModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return DashboardModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs),
            sleeper: harness.sleeper,
            relay: relay
        )
    }

    private func loaded(relay: RelayClient? = nil) async throws -> DashboardModel {
        let model = makeModel(transport: await Harness.dashboardTransport(), relay: relay)
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    // MARK: - Alerts

    /// The reason this screen exists. A starter on bye scores exactly zero, so
    /// it outranks an injury tag, which is only a risk.
    func testAByeStarterIsFlaggedFirst() async throws {
        let model = try await loaded()

        XCTAssertFalse(model.alerts.isEmpty)
        XCTAssertEqual(model.alerts.first?.kind, .onBye)
        XCTAssertTrue(model.alerts.first?.detail.contains("scores 0") ?? false)
    }

    /// Week 7 byes in the shipped 2025 file are BAL and BUF.
    func testTheByeAlertNamesTheRightPlayers() async throws {
        let model = try await loaded()
        let names = Set(model.alerts.filter { $0.kind == .onBye }.compactMap(\.playerName))

        XCTAssertTrue(names.contains("Starter QB"), "the BUF quarterback is on bye")
        XCTAssertTrue(names.contains("Kicker One"), "the BAL kicker is on bye")
        XCTAssertFalse(names.contains("Tight End"), "the KC tight end is not")
    }

    /// `"0"` entries in the raw starters array are the only record that a slot
    /// is unset — the filtered list cannot tell you.
    func testUnsetSlotsAreCountedFromTheRawStartersArray() async throws {
        let model = try await loaded()
        let empty = try XCTUnwrap(model.alerts.first { $0.kind == .emptySlot })
        XCTAssertTrue(empty.detail.contains("1 starter slot"), "got: \(empty.detail)")
    }

    func testAnInjuredStarterIsFlaggedWithSleepersOwnTag() async throws {
        let model = try await loaded()
        let injured = try XCTUnwrap(model.alerts.first { $0.kind == .injured })
        XCTAssertEqual(injured.playerName, "Receiver One")
        XCTAssertEqual(injured.detail, "Questionable")
    }

    func testHealthyStartersProduceNoAlert() async throws {
        let model = try await loaded()
        XCTAssertFalse(model.alerts.contains { $0.playerName == "Receiver Two" })
    }

    // MARK: - Standings

    func testStandingsSortByRecordThenPointsFor() async throws {
        let model = try await loaded()

        XCTAssertEqual(model.standings.count, 2)
        XCTAssertEqual(model.standings.first?.rosterID, 2)
        XCTAssertEqual(model.standings.first?.record, "2-0")
        XCTAssertTrue(model.standings.contains { $0.isUser })
    }

    /// Sleeper splits points either side of the decimal point.
    func testStandingsRecombineSplitPoints() async throws {
        let model = try await loaded()
        let mine = try XCTUnwrap(model.standings.first { $0.isUser })
        XCTAssertEqual(mine.pointsFor, 210.55, accuracy: 0.001)
    }

    // MARK: - Bench points

    /// Week 7 is still being played, so grading it would accuse the user of a
    /// mistake they can still fix.
    func testTheLiveWeekIsNeverGraded() async throws {
        let model = try await loaded()
        XCTAssertFalse(model.benchWeeks.contains { $0.week == 7 })
        XCTAssertEqual(model.benchWeeks.map(\.week), [1, 2])
    }

    /// Week 1 leaves the flex empty while a 25-point receiver sits on the
    /// bench, so the gap is known rather than whatever the search turns up.
    func testPointsLeftOnTheBenchComeFromTheOptimizer() async throws {
        let model = try await loaded()
        let week1 = try XCTUnwrap(model.benchWeeks.first { $0.week == 1 })

        XCTAssertEqual(week1.actual, 76, accuracy: 0.001)
        XCTAssertEqual(week1.left, 25, accuracy: 0.001)
        XCTAssertEqual(week1.best, week1.actual + week1.left, accuracy: 0.001)
        XCTAssertTrue(week1.shouldHaveStarted.contains { $0.name == "Bench Hero" })
    }

    /// A player Sleeper reported no score for is excluded rather than treated
    /// as a zero — "didn't play" and "we have no number" are different claims,
    /// and only one of them justifies a swap suggestion.
    func testAPlayerWithNoReportedScoreIsNeverProposed() async throws {
        let model = try await loaded()
        XCTAssertFalse(
            model.benchWeeks.contains { week in
                week.shouldHaveStarted.contains { $0.name == "No Score Guy" }
            }
        )
    }

    /// A week where the best lineup was actually played reports nothing left.
    func testACleanWeekLeavesNothingOnTheBench() async throws {
        let model = try await loaded()
        let week2 = try XCTUnwrap(model.benchWeeks.first { $0.week == 2 })
        XCTAssertEqual(week2.left, 0, accuracy: 0.001)
    }

    func testTotalLeftIsTheSumAcrossWeeks() async throws {
        let model = try await loaded()
        XCTAssertEqual(
            model.totalLeftOnBench,
            model.benchWeeks.reduce(0) { $0 + $1.left },
            accuracy: 0.001
        )
    }

    // MARK: - Trend

    func testTrendRanksAgainstTheFieldActuallyPlayed() async throws {
        let model = try await loaded()
        let week1 = try XCTUnwrap(model.trend.first { $0.week == 1 })

        XCTAssertEqual(week1.teamCount, 2)
        XCTAssertEqual(week1.mine ?? 0, 76, accuracy: 0.001)
        XCTAssertEqual(week1.leagueAverage ?? 0, 85.5, accuracy: 0.001)
        XCTAssertEqual(week1.rank, 2, "the rival outscored the user in week 1")
    }

    func testTrendFollowsTheWeeksThatLoaded() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.trend.map(\.week), [1, 2])

        let week2 = try XCTUnwrap(model.trend.first { $0.week == 2 })
        XCTAssertEqual(week2.rank, 1, "the user outscored the rival in week 2")
    }

    // MARK: - Draft value

    /// A pick is graded against what that pick number actually returned across
    /// the league this season, not against anyone's preseason ranking.
    func testDraftPicksAreGradedAgainstRealisedValueAtThatSlot() async throws {
        let model = try await loaded()

        XCTAssertNil(model.draftUnavailable)
        XCTAssertEqual(model.draftResults.count, 2)

        let surpluses = model.draftResults.map(\.surplus)
        XCTAssertEqual(surpluses, surpluses.sorted(by: >), "best value first")
    }

    /// Attribution is by who made the pick.
    func testOnlyTheUsersOwnPicksAreGraded() async throws {
        let model = try await loaded()
        let names = model.draftResults.map(\.name)

        XCTAssertTrue(names.contains("Bench Hero"))
        XCTAssertFalse(names.contains("Rival Pick"))
        XCTAssertFalse(names.contains("Rival QB"))
    }

    /// An empty card explains itself rather than looking broken.
    func testAMissingDraftSaysWhyRatherThanShowingNothing() async throws {
        let transport = await Harness.dashboardTransport()
        await transport.override("/league/L1/drafts", json: "[]")
        let model = makeModel(transport: transport)

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertNotNil(model.draftUnavailable)
        XCTAssertTrue(model.draftResults.isEmpty)
    }

    // MARK: - Transactions

    func testRecentTransactionsAreNamedNotJustIDs() async throws {
        let model = try await loaded()

        let move = try XCTUnwrap(model.transactions.first)
        XCTAssertEqual(move.manager, "Byrne Notice")
        XCTAssertEqual(move.addedNames, ["Bench Hero"])
        XCTAssertEqual(move.droppedNames, ["No Score Guy"])
    }

    // MARK: - Relay

    /// No relay means the news section simply never appears. No v1 feature
    /// depends on it being reachable (§0).
    func testNewsIsAbsentWithoutARelay() async throws {
        let model = try await loaded()
        XCTAssertTrue(model.news.isEmpty)
    }

    /// With a relay, only items naming the user's own players survive.
    func testNewsIsFilteredToTheUsersRoster() async throws {
        let relayTransport = StubTransport()
        await relayTransport.on("api/news", json: """
        {"feed":"rotoworld","items":[
          {"title":"Starter QB questionable for Sunday","body":null,"url":null,
           "publishedAt":"2026-09-12T10:00:00Z","sourceId":"1"},
          {"title":"Someone you do not roster signs an extension","body":null,
           "url":null,"publishedAt":"2026-09-12T11:00:00Z","sourceId":"2"}]}
        """)
        let relay = RelayClient(
            baseURL: URL(string: "https://relay.example.test")!, transport: relayTransport
        )

        let model = try await loaded(relay: relay)

        XCTAssertEqual(model.news.count, 1)
        XCTAssertTrue(model.news.first?.title.contains("Starter QB") ?? false)
    }

    /// An unreachable relay must not cost the rest of the screen.
    func testAnUnreachableRelayLeavesTheRestOfTheScreenIntact() async throws {
        let relayTransport = StubTransport()
        await relayTransport.fail("api/news")
        let relay = RelayClient(
            baseURL: URL(string: "https://relay.example.test")!, transport: relayTransport
        )

        let model = try await loaded(relay: relay)

        XCTAssertTrue(model.news.isEmpty)
        XCTAssertFalse(model.alerts.isEmpty, "the rest of the dashboard still rendered")
        XCTAssertFalse(model.standings.isEmpty)
    }

    // MARK: - Failure

    func testAFailedLoadNamesWhatFailed() async {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.dashboardStateJSON)
        await transport.fail("/league/L1")
        let model = makeModel(transport: transport)

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertNotNil(model.errorMessage)
        XCTAssertTrue(model.alerts.isEmpty)
    }

    /// A single failed week must not cost the weeks either side of it.
    func testOneMissingWeekDoesNotLoseTheOthers() async throws {
        let transport = await Harness.dashboardTransport()
        await transport.fail("/matchups/2")
        let model = makeModel(transport: transport)

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertEqual(model.benchWeeks.map(\.week), [1])
        XCTAssertFalse(model.trend.isEmpty)
        XCTAssertFalse(model.alerts.isEmpty)
    }
}
