import Foundation
import XCTest
import FCCore
import FCData
@testable import FCApp

/// Answers Sleeper requests from a script. Nothing here touches the network —
/// same reasoning as FCData's suite.
actor StubTransport: HTTPTransport {
    private var routes: [(match: String, json: String, status: Int)] = []
    private(set) var requestCount = 0
    private var failures: Set<String> = []

    func on(_ pathContains: String, json: String, status: Int = 200) {
        routes.append((pathContains, json, status))
    }

    /// Replaces an already-scripted route. The first match wins, so a plain
    /// `on` cannot override an earlier one — this puts the new answer in front.
    func override(_ pathContains: String, json: String, status: Int = 200) {
        routes.removeAll { $0.match == pathContains }
        routes.insert((pathContains, json, status), at: 0)
    }

    func fail(_ pathContains: String) {
        failures.insert(pathContains)
    }

    private var paths: [String] = []

    /// Every path requested, in order — for asserting *what* was re-read.
    func requestedPaths() -> [String] { paths }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requestCount += 1
        paths.append(request.url?.path ?? "")
        let path = request.url?.absoluteString ?? ""
        for failure in failures where path.contains(failure) {
            throw StubError.offline
        }
        for route in routes where path.contains(route.match) {
            return HTTPResponse(status: route.status, body: Data(route.json.utf8))
        }
        throw StubError.unscripted(path)
    }

    enum StubError: Error { case unscripted(String), offline }
}

/// A league shaped like the user's real one: 12 teams, and a starting lineup
/// that includes the DEF and IDP slots the weekly file has no data for — which
/// is the case the coverage warning exists for (§3.2).
enum TestLeague {
    static let rosterPositions = """
    ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","IDP_FLEX","IDP_FLEX",
     "BN","BN","BN","BN","BN","IR"]
    """

    static let scoringSettings = """
    {"pass_yd":0.05,"pass_td":6,"pass_int":-5,"rec":0,"rec_yd":0.1,"rec_td":6,
     "rush_yd":0.1,"rush_td":6,"fum_lost":-3}
    """

    static func leagueJSON(id: String = "L1") -> String {
        """
        {"league_id":"\(id)","name":"Byrne Notice","season":"2025",
         "total_rosters":12,
         "roster_positions":\(rosterPositions),
         "scoring_settings":\(scoringSettings)}
        """
    }

    /// Two rosters, each filling all 11 starting slots exactly.
    ///
    /// The user's two backs are LAR and SEA — both on bye in week 8 in the real
    /// 2025 schedule — so their week-8 shortfall is derived from the shipped
    /// file rather than asserted into existence. No rival player is on bye that
    /// week, which makes rival rosters the trade partners §7.4 is about.
    static func rostersJSON() -> String {
        """
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        """
    }

    static func usersJSON() -> String {
        """
        [{"user_id":"u1","display_name":"connor","metadata":{"team_name":"Byrne Notice"}},
         {"user_id":"u2","display_name":"rival"}]
        """
    }

    /// The player pool the rosters refer to. Teams are Sleeper spellings,
    /// including `LAR`, so the loader's normalisation to `LA` is exercised.
    static func playersJSON() -> String {
        """
        {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true}}
        """
    }

    static let nflStateJSON = #"{"week":1,"season":"2025","season_type":"regular"}"#

    // MARK: - Dashboard fixture

    /// Week 7, where the real 2025 schedule has BAL and BUF on bye — so the
    /// user's BUF quarterback and BAL kicker are both guaranteed zeroes.
    static let dashboardStateJSON = #"{"week":7,"season":"2025","season_type":"regular"}"#

    /// Same league, but with one starting slot left unset and a record on each
    /// roster. Kept separate from `rostersJSON` so the planning fixtures stay
    /// untouched.
    static func dashboardRostersJSON() -> String {
        """
        [{"roster_id":1,"owner_id":"u1",
          "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","wr_flex","k1","PHI","lb1","dl1",
                     "bench_hero","no_score_guy"],
          "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"],
          "settings":{"wins":1,"losses":1,"ties":0,"fpts":210,"fpts_decimal":55,
                      "fpts_against":205,"fpts_against_decimal":0}},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2",
                     "rival_pick"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "settings":{"wins":2,"losses":0,"ties":0,"fpts":220,"fpts_decimal":0,
                      "fpts_against":190,"fpts_against_decimal":0}}]
        """
    }

    /// The pool plus the three players the dashboard fixtures need.
    static func dashboardPlayersJSON() -> String {
        """
        {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
         "rb_la":{"full_name":"Rams Back","position":"RB","team":"LAR","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN",
                "injury_status":"Questionable","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "wr_flex":{"full_name":"Flex Receiver","position":"WR","team":"NE","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true},
         "bench_hero":{"full_name":"Bench Hero","position":"WR","team":"DEN","active":true},
         "no_score_guy":{"full_name":"No Score Guy","position":"WR","team":"CLE","active":true},
         "rival_pick":{"full_name":"Rival Pick","position":"RB","team":"ATL","active":true}}
        """
    }

    /// Week 1: the flex slot is empty while a 25-point receiver sits on the
    /// bench, so the gap is a known quantity rather than whatever the optimizer
    /// happens to turn up. `no_score_guy` is absent from `players_points` on
    /// purpose — Sleeper reporting no number is not the same as a zero.
    static let week1MatchupsJSON = """
    [{"roster_id":1,"matchup_id":1,"points":76.0,
      "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","0","k1","PHI","lb1","dl1"],
      "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","k1","PHI","lb1","dl1",
                 "bench_hero","no_score_guy"],
      "players_points":{"qb1":18.0,"rb_la":8.0,"rb_sea":6.0,"wr1":10.0,"wr2":9.0,
                        "te1":5.0,"k1":7.0,"PHI":6.0,"lb1":4.0,"dl1":3.0,"bench_hero":25.0}},
     {"roster_id":2,"matchup_id":1,"points":95.0,
      "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players_points":{"qb2":22.0,"rb_buf":14.0,"rb_kc":12.0,"wr3":11.0,"wr4":10.0,
                        "te2":8.0,"wr_flex2":7.0,"k2":5.0,"DAL":3.0,"lb2":2.0,"dl2":1.0}}]
    """

    /// Week 2: a clean lineup, so the panel does not read as if every week were
    /// a mistake.
    static let week2MatchupsJSON = """
    [{"roster_id":1,"matchup_id":1,"points":88.0,
      "starters":["qb1","rb_la","rb_sea","wr1","wr2","te1","bench_hero","k1","PHI","lb1","dl1"],
      "players":["qb1","rb_la","rb_sea","wr1","wr2","te1","k1","PHI","lb1","dl1",
                 "bench_hero","no_score_guy"],
      "players_points":{"qb1":20.0,"rb_la":12.0,"rb_sea":9.0,"wr1":11.0,"wr2":8.0,
                        "te1":6.0,"bench_hero":14.0,"k1":4.0,"PHI":2.0,"lb1":1.0,"dl1":1.0}},
     {"roster_id":2,"matchup_id":1,"points":70.0,
      "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
      "players_points":{"qb2":15.0,"rb_buf":10.0,"rb_kc":9.0,"wr3":8.0,"wr4":8.0,
                        "te2":7.0,"wr_flex2":6.0,"k2":4.0,"DAL":2.0,"lb2":1.0,"dl2":0.0}}]
    """

    static let draftsJSON = #"[{"draft_id":"D1","status":"complete","season":"2025"}]"#

    /// Picks 1 and 4 are the user's; 2 and 3 the rival's. Attribution is by who
    /// *made* the pick, not by who holds the player now.
    static let draftPicksJSON = """
    [{"pick_no":1,"player_id":"bench_hero","picked_by":"u1","roster_id":1,"round":1},
     {"pick_no":2,"player_id":"qb2","picked_by":"u2","roster_id":2,"round":1},
     {"pick_no":3,"player_id":"rival_pick","picked_by":"u2","roster_id":2,"round":1},
     {"pick_no":4,"player_id":"wr1","picked_by":"u1","roster_id":1,"round":1}]
    """

    static let transactionsJSON = """
    [{"transaction_id":"t1","type":"waiver","status":"complete","created":1757700000000,
      "roster_ids":[1],"adds":{"bench_hero":1},"drops":{"no_score_guy":1}}]
    """
}


@MainActor
enum Harness {
    /// A service and store wired to the stub, plus the real bundled static files.
    static func make(
        transport: StubTransport
    ) -> (sleeper: SleeperService, staticData: StaticDataStore, cacheDirectory: URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("fcapp-tests-\(UUID().uuidString)", isDirectory: true)
        let cache = DiskCache(directory: directory)
        let sleeper = SleeperService(
            client: SleeperClient(
                baseURL: URL(string: "https://api.example.test/v1")!,
                transport: transport,
                retries: 0
            ),
            cache: cache
        )
        let staticData = StaticDataStore(
            bundle: .module,
            bundleSubdirectory: "Fixtures",
            cache: DiskCache(directory: directory.appendingPathComponent("static")),
            transport: transport,
            baseURL: nil
        )
        return (sleeper, staticData, directory)
    }

    /// The dashboard league: week 7, one unset slot, two completed weeks of
    /// scoring, a finished draft and one waiver claim.
    ///
    /// Weeks 3 to 6 are deliberately unscripted. `SeasonHistory` skips a week
    /// it cannot load rather than failing the whole screen, so leaving them out
    /// keeps the fixture small and exercises that behaviour at the same time.
    static func dashboardTransport() async -> StubTransport {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.dashboardStateJSON)
        await transport.on("/league/L1/rosters", json: TestLeague.dashboardRostersJSON())
        await transport.on("/league/L1/users", json: TestLeague.usersJSON())
        await transport.on("/league/L1/drafts", json: TestLeague.draftsJSON)
        await transport.on("/draft/D1/picks", json: TestLeague.draftPicksJSON)
        await transport.on("/matchups/1", json: TestLeague.week1MatchupsJSON)
        await transport.on("/matchups/2", json: TestLeague.week2MatchupsJSON)
        await transport.on("/transactions/7", json: TestLeague.transactionsJSON)
        await transport.on("/players/nfl", json: TestLeague.dashboardPlayersJSON())
        await transport.on("/league/L1", json: TestLeague.leagueJSON())
        return transport
    }

    /// The standard fully-populated league.
    static func standardTransport() async -> StubTransport {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.on("/league/L1/rosters", json: TestLeague.rostersJSON())
        await transport.on("/league/L1/users", json: TestLeague.usersJSON())
        await transport.on("/players/nfl", json: TestLeague.playersJSON())
        await transport.on("/league/L1", json: TestLeague.leagueJSON())
        return transport
    }
}

/// Fixed clocks for tests that depend on lineup locks.
enum TestClock {
    /// 2025-09-01, before any 2025 game: nothing is locked. The default for
    /// fixtures written before locks existed, so their meaning is unchanged.
    static let beforeKickoffs: @Sendable () -> Date = {
        ISO8601DateFormatter().date(from: "2025-09-01T12:00:00Z")!
    }

    /// Week 7 of 2025, Sunday 2:30pm ET: the Thursday, London and 1pm games have
    /// kicked off; the 4pm and night games haven't.
    static let week7MidSunday: @Sendable () -> Date = {
        ISO8601DateFormatter().date(from: "2025-10-19T18:30:00Z")!
    }
}
