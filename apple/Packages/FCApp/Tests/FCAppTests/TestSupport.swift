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

    func fail(_ pathContains: String) {
        failures.insert(pathContains)
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        requestCount += 1
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
