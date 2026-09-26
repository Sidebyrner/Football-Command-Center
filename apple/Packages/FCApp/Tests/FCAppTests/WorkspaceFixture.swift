import XCTest
import FCCore
import FCData
@testable import FCApp

/// The whole app's services on a two-team 2026 superflex league at week 3,
/// with week-2 Sleeper lines — enough for every workspace panel to have rows.
@MainActor
enum WorkspaceFixture {
    static let mahomes = "4046", ward = "12522", cook = "8138", bolton = "7648", kyren = "8150"
    static let goff = "3163", stafford = "421", gibbs = "9221", edmunds = "4968"
    static let prescott = "3294", hampton = "12507", purdy = "8183", henderson = "12529", jsn = "9488"
    /// A free agent with no Sleeper line and no projection — the Waiver Board hides him, Discovery doesn't.
    static let unknown = "99001"

    /// Week 3 as Sleeper's scores route sends it: DET at LAR live in the third
    /// (Sleeper spells the Rams `LAR`), BUF final, KC not yet kicked off.
    static let scoresWeek3 = """
        [{"game_id":"g1","week":3,"status":"in_progress","start_time":1790528400000,
          "metadata":{"home_team":"LAR","away_team":"DET","home_score":17,"away_score":20,"quarter":"3","quarter_num":3,
                      "time_remaining":"7:42","possession":"DET","down_and_distance":"3rd & 4","red_zone":"true",
                      "yard_line":12,"is_in_progress":true,"is_over":false,"spread":{"LAR":2.5,"DET":-2.5}}},
         {"game_id":"g2","week":3,"status":"complete","start_time":1790442000000,
          "metadata":{"home_team":"BUF","away_team":"MIA","home_score":27,"away_score":10,"quarter":"F","quarter_num":4,
                      "is_in_progress":false,"is_over":true}},
         {"game_id":"g3","week":3,"status":"pre_game","start_time":1790640900000,
          "metadata":{"home_team":"KC","away_team":"NYG","home_score":null,"away_score":null,"quarter":"","quarter_num":"",
                      "is_in_progress":false,"is_over":false,"moneyline":{"KC":71.0,"NYG":33.0,"updated_at":1}}},
         {"game_id":"g4","week":3,"status":"pre_game","start_time":1790640900000,
          "metadata":{"home_team":"GB","away_team":"CHI","quarter":"","is_in_progress":false,"is_over":false}}]
        """

    static func services() async throws -> (AppServices, URL) {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","SUPER_FLEX","RB","WR","LB","BN","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.04,"pass_td":4,"pass_int":-2,"rush_yd":0.1,"rush_td":6,"rush_fd":1,
               "rec":0,"rec_yd":0.1,"rec_td":6,"rec_fd":1,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5},
             "settings":{"waiver_type":2,"waiver_budget":100,"reserve_slots":1,"trade_deadline":11}}
            """)
        func list(_ ids: [String]) -> String { ids.map { "\"\($0)\"" }.joined(separator: ",") }
        let mine = [mahomes, ward, cook, jsn, bolton, kyren]
        let theirs = [goff, stafford, gibbs, edmunds, prescott, hampton, purdy]
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":[\(list(mine))],
              "starters":[\(list([mahomes, ward, cook, jsn, bolton]))],"reserve":["\(kyren)"]},
             {"roster_id":2,"owner_id":"u2","players":[\(list(theirs))],
              "starters":[\(list([goff, stafford, gibbs, "0", edmunds]))],"reserve":["\(purdy)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"\(mahomes)":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true},
             "\(ward)":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true},
             "\(cook)":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
             "\(jsn)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true,"injury_status":"Questionable","injury_body_part":"Ankle"},
             "\(bolton)":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
             "\(kyren)":{"full_name":"Kyren Williams","position":"RB","team":"LAR","active":true,"injury_status":"IR"},
             "\(goff)":{"full_name":"Jared Goff","position":"QB","team":"DET","active":true},
             "\(stafford)":{"full_name":"Matthew Stafford","position":"QB","team":"LAR","active":true},
             "\(gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "\(edmunds)":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
             "\(prescott)":{"full_name":"Dak Prescott","position":"QB","team":"DAL","active":true},
             "\(hampton)":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
             "\(henderson)":{"full_name":"TreVeyon Henderson","position":"RB","team":"NE","active":true},
             "\(purdy)":{"full_name":"Brock Purdy","position":"QB","team":"SF","active":true},
             "\(unknown)":{"full_name":"Deep Sleeper","position":"RB","team":"NE","active":true,"age":22,"years_exp":0,
                            "college":"Nowhere State","height":"70","weight":"201"}}
            """)
        try await transport.on("/stats/nfl/2026/1", fixture: "stats-2026-w2")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        try await transport.on("/projections/nfl/2026/3", fixture: "projections-2026-w3")
        await transport.override("/scores/nfl/regular/2026/3", json: scoresWeek3)
        // Starters in roster_positions order: QB, SUPER_FLEX, RB, WR, LB.
        await transport.override("/league/L1/matchups/3", json: """
            [{"roster_id":1,"matchup_id":1,"points":24.6,"starters":["\(mahomes)","\(kyren)","\(cook)","\(jsn)","\(bolton)"],
              "players_points":{"\(cook)":24.6}},
             {"roster_id":2,"matchup_id":1,"points":31.2,"starters":["\(goff)","\(stafford)","\(gibbs)","\(hampton)","\(edmunds)"],
              "players_points":{"\(goff)":14.2,"\(stafford)":9.0,"\(gibbs)":8.0}}]
            """)
        let harness = Harness.make(transport: transport)
        let settings = InMemorySettingsStore(AppSettings(sleeperUsername: "me", userID: "u1", leagueID: "L1", rosterID: 1))
        let services = AppServices(
            sleeper: harness.sleeper, staticData: harness.staticData, settingsStore: settings,
            workspacePersistence: InMemoryWorkspacePersistence(), now: TestClock.beforeKickoffs
        )
        await services.loadIfConfigured()
        return (services, harness.cacheDirectory)
    }
}

@MainActor
final class AppServicesTests: XCTestCase {
    private var cacheDirectory: URL?

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    func testEveryScreenLoadsFromOneSharedContext() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        XCTAssertNil(services.sitStart.errorMessage)
        XCTAssertNotNil(services.dashboard.context)
        XCTAssertNotNil(services.sitStart.context)
        XCTAssertNotNil(services.injuries.context)
        XCTAssertNotNil(services.trades.desk)
        XCTAssertEqual(services.dashboard.context?.league.leagueID, services.waivers.context?.league.leagueID)
    }

    func testPlayerCardsAreReusedUntilTheLeagueReloads() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        let context = try XCTUnwrap(services.dashboard.context)
        let first = services.playerCard(WorkspaceFixture.cook, context: context)
        XCTAssertTrue(services.playerCard(WorkspaceFixture.cook, context: context) === first)
        XCTAssertFalse(services.playerCard(WorkspaceFixture.gibbs, context: context) === first)
        await services.loadIfConfigured(force: true)
        XCTAssertFalse(services.playerCard(WorkspaceFixture.cook, context: context) === first, "a reload starts fresh")
    }

    func testThePlayerCardCacheEvictsTheLeastRecent() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        let context = try XCTUnwrap(services.dashboard.context)
        let cache = PlayerCardCache(capacity: 2)
        func make(_ id: String) -> PlayerCardModel {
            cache.model(for: id) { PlayerCardModel(playerID: id, context: context, sleeper: nil) }
        }
        let a = make("a")
        _ = make("b")
        XCTAssertTrue(make("a") === a, "touching a makes b the oldest")
        _ = make("c")
        XCTAssertEqual(cache.count, 2)
        XCTAssertTrue(make("a") === a)
    }
}
