import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Dashboard's "this week" card and waiver targets, against week 7 of the
/// real 2025 schedule — where BUF and BAL are off, so the user (whose only QB is
/// on BUF and only kicker on BAL) genuinely can't fill QB or K this week.
@MainActor
final class DashboardFunctionalTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static func players() -> String {
        var base = TestLeague.dashboardPlayersJSON().trimmingCharacters(in: .whitespacesAndNewlines)
        base.removeLast()
        return base + """
        ,"fa_qb":{"full_name":"Free QB","position":"QB","team":"NYG","active":true},
         "fa_qb_bye":{"full_name":"Bills Backup","position":"QB","team":"BUF","active":true},
         "fa_wr":{"full_name":"Free Receiver","position":"WR","team":"NYG","active":true},
         "retired":{"full_name":"Retired QB","position":"QB","team":"NYG","active":false}}
        """
    }

    /// Popularity order: the rostered player and the retired one must drop out,
    /// and the one who fills a hole this week must come first.
    private static let trending = """
    [{"player_id":"fa_wr","count":9000},{"player_id":"rb_buf","count":8500},
     {"player_id":"fa_qb_bye","count":8000},{"player_id":"retired","count":7500},
     {"player_id":"fa_qb","count":7000}]
    """

    private func loaded(matchups: String? = nil, trending: String? = trending) async throws -> DashboardModel {
        let transport = await Harness.dashboardTransport()
        await transport.override("/players/nfl", json: Self.players())
        if let trending { await transport.override("/trending/add", json: trending) }
        if let matchups { await transport.override("/matchups/7", json: matchups) }
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData),
            sleeper: harness.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    // MARK: - This week

    func testThisWeekShowsBothScoresAndWhoLeads() async throws {
        let model = try await loaded(matchups: """
        [{"roster_id":1,"matchup_id":1,"points":50.5,"starters":["qb1","PHI"]},
         {"roster_id":2,"matchup_id":1,"points":40.0,"starters":["qb2","DAL"]}]
        """)
        let week = try XCTUnwrap(model.thisWeek)

        XCTAssertEqual(week.week, 7)
        XCTAssertEqual(week.myManager, "Byrne Notice")
        XCTAssertEqual(week.opponentManager, "rival")
        XCTAssertEqual(week.status, "Leading rival by 10.5")
    }

    func testANoOpponentWeekSaysSo() async throws {
        let model = try await loaded(matchups: """
        [{"roster_id":1,"matchup_id":null,"points":0,"starters":["qb1"]}]
        """)
        let week = try XCTUnwrap(model.thisWeek)
        XCTAssertNil(week.opponentManager)
        XCTAssertEqual(week.status, "No opponent this week")
    }

    /// Before kickoff both sides are on zero, which is "not started", not a tie.
    func testZeroZeroIsNotStartedRatherThanTied() async throws {
        let model = try await loaded(matchups: """
        [{"roster_id":1,"matchup_id":1,"points":0,"starters":[]},
         {"roster_id":2,"matchup_id":1,"points":0,"starters":[]}]
        """)
        XCTAssertEqual(model.thisWeek?.status, "vs rival — not started")
    }

    /// No matchups from Sleeper yet: no card, and nothing else breaks.
    func testNoMatchupsMeansNoCardButTheRestLoads() async throws {
        let model = try await loaded()
        XCTAssertNil(model.thisWeek)
        XCTAssertFalse(model.alerts.isEmpty)
    }

    // MARK: - Waiver targets

    func testRosteredAndInactivePlayersAreNeverTargets() async throws {
        let model = try await loaded()
        let names = model.waiverTargets.map(\.name)
        XCTAssertFalse(names.contains("Bills Back"), "rostered")
        XCTAssertFalse(names.contains("Retired QB"), "inactive")
    }

    /// The user can't field a QB in week 7. A free QB who plays fills that hole
    /// and is listed first despite being the least popular; a free QB whose own
    /// team is off does not fill it.
    func testAPlayerWhoFillsAHoleThisWeekIsFlaggedAndFirst() async throws {
        let model = try await loaded()
        let first = try XCTUnwrap(model.waiverTargets.first)
        XCTAssertEqual(first.name, "Free QB")
        XCTAssertTrue(first.fillsNeedThisWeek)

        let backup = try XCTUnwrap(model.waiverTargets.first { $0.name == "Bills Backup" })
        XCTAssertFalse(backup.fillsNeedThisWeek, "BUF is on bye in week 7")

        let receiver = try XCTUnwrap(model.waiverTargets.first { $0.name == "Free Receiver" })
        XCTAssertFalse(receiver.fillsNeedThisWeek, "WR is not short this week")
    }

    func testTrendingThatFailsToLoadIsReportedNotHidden() async throws {
        let transport = await Harness.dashboardTransport()
        await transport.fail("/trending/add")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData),
            sleeper: harness.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertTrue(model.waiverTargetsUnavailable)
        XCTAssertTrue(model.waiverTargets.isEmpty)
        XCTAssertFalse(model.standings.isEmpty, "the rest of the dashboard still loads")
    }
}
