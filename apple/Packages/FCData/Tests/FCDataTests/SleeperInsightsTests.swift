import XCTest
import FCCore
@testable import FCData

/// The undocumented projection, stats and news routes: decoded from real
/// recorded payloads, cached with their own keys and lifetimes, and reached
/// through the insights base URL rather than `/v1`.
final class SleeperInsightsTests: XCTestCase {
    private var directory: URL!
    private var cache: DiskCache!

    override func setUp() {
        super.setUp()
        (cache, directory) = makeTemporaryCache()
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func client(_ transport: StubTransport) -> SleeperClient {
        SleeperClient(
            baseURL: URL(string: "https://api.example.test/v1")!,
            insightsBaseURL: URL(string: "https://api.example.test")!,
            transport: transport,
            retries: 0
        )
    }

    func testDecodesRealProjectionsForEveryPosition() async throws {
        let transport = StubTransport()
        await transport.on("/projections/nfl/2026/3", data: try Fixtures.data("projections-2026-w3"))

        let projections = try await client(transport).projections(season: 2026, week: 3)
        XCTAssertGreaterThan(projections.count, 100)

        let positions = Set(projections.compactMap(\.position))
        for position in Position.allCases {
            XCTAssertTrue(positions.contains(position), "no \(position.rawValue) projection decoded")
        }

        let gibbs = try XCTUnwrap(projections.first { $0.player?.name == "Jahmyr Gibbs" })
        XCTAssertEqual(gibbs.week, 3)
        XCTAssertEqual(gibbs.opponent, "NYJ")
        XCTAssertEqual(gibbs.sourceLabel, "Rotowire via Sleeper")
        XCTAssertGreaterThan(gibbs.stats["rush_att"] ?? 0, 10)

        // The request went to the insights host, with every position asked for.
        let path = await transport.requests.first?.url?.absoluteString ?? ""
        XCTAssertTrue(path.hasPrefix("https://api.example.test/projections/"))
        XCTAssertTrue(path.contains("position%5B%5D=DEF"))
        XCTAssertTrue(path.contains("position%5B%5D=LB"))
    }

    func testDecodesRealWeekStatsIncludingDefenseAndSnaps() async throws {
        let transport = StubTransport()
        await transport.on("/stats/nfl/2026/2", data: try Fixtures.data("stats-2026-w2"))

        let stats = try await client(transport).weekStats(season: 2026, week: 2)
        let jsn = try XCTUnwrap(stats.first { $0.player?.name == "Jaxon Smith-Njigba" })
        XCTAssertTrue(jsn.played)
        XCTAssertEqual(jsn.targets, 11)
        XCTAssertEqual(jsn.redZoneTargets, 3)
        let share = try XCTUnwrap(jsn.offensiveSnapShare)
        XCTAssertEqual(share, 47.0 / 70.0, accuracy: 0.001)

        // Team defenses carry points allowed per position — defense-vs-position
        // for free, including the positions the nflverse file lacks.
        let defenses = stats.filter { $0.position == .def }
        XCTAssertFalse(defenses.isEmpty)
        XCTAssertNotNil(defenses.first?.stats["fan_pts_allow_rb"])

        let idp = stats.filter { $0.position == .lb }
        XCTAssertFalse(idp.isEmpty)
        XCTAssertNotNil(idp.first { $0.stats["idp_tkl"] != nil })
    }

    func testDecodesPlayerNews() async throws {
        let transport = StubTransport()
        await transport.on("/players/nfl/4046/news", data: try Fixtures.data("news-4046"))

        let news = try await client(transport).playerNews(playerID: "4046", limit: 3)
        XCTAssertEqual(news.count, 3)
        let first = try XCTUnwrap(news.first)
        XCTAssertEqual(first.sourceLabel, "FantasyPros via Sleeper")
        XCTAssertNotNil(first.title)
        XCTAssertNotNil(first.publishedAt)
        XCTAssertNotNil(first.metadata?.analysis)
    }

    /// A projection whose `stats` carry nulls (Sleeper does this for absent
    /// categories) decodes with those keys dropped, not as a failure.
    func testNullStatsAreDroppedRatherThanFailingTheLine() throws {
        let json = #"[{"player_id":"1","week":3,"stats":{"rush_yd":42.5,"rec_td":null},"player":{"position":"RB"},"company":"rotowire"}]"#
        let lines = try JSONDecoder().decode([SleeperProjection].self, from: Data(json.utf8))
        XCTAssertEqual(lines.first?.stats, ["rush_yd": 42.5])
        XCTAssertEqual(lines.first?.position, .rb)
    }

    /// Service layer: projections are cached under their own week key, served
    /// from cache inside the lifetime, and re-fetched when the caller asks for a
    /// younger copy than the one on disk.
    func testProjectionsAreCachedPerWeekAndHonourMaxAge() async throws {
        let transport = StubTransport()
        await transport.on("/projections/nfl/2026/3", data: try Fixtures.data("projections-2026-w3"))
        let service = SleeperService(client: client(transport), cache: cache)

        let first = try await service.projections(season: 2026, week: 3)
        XCTAssertEqual(first.provenance, .live)
        let second = try await service.projections(season: 2026, week: 3)
        guard case .cached = second.provenance else { return XCTFail("expected a cache hit, got \(second.provenance)") }
        var count = await transport.requestCount
        XCTAssertEqual(count, 1)

        // Asking for a copy younger than the one on disk goes back to the network.
        _ = try await service.projections(season: 2026, week: 3, maxAge: 0)
        count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    /// A failed fetch serves the stale copy, labelled — the same rule as every
    /// other Sleeper read (§8.1).
    func testStaleProjectionsAreServedLabelledWhenTheRouteFails() async throws {
        let transport = StubTransport()
        await transport.on("/projections/nfl/2026/3", respond: [
            .success(HTTPResponse(status: 200, body: try Fixtures.data("projections-2026-w3"))),
            .success(HTTPResponse(status: 500, body: Data())),
        ])
        let service = SleeperService(client: client(transport), cache: cache)
        _ = try await service.projections(season: 2026, week: 3)
        let again = try await service.projections(season: 2026, week: 3, force: true)
        guard case .staleCache = again.provenance else { return XCTFail("expected stale cache, got \(again.provenance)") }
    }

    func testCompletedWeekStatsUseTheLongLifetime() async throws {
        let transport = StubTransport()
        await transport.on("/stats/nfl/2026/2", data: try Fixtures.data("stats-2026-w2"))
        let service = SleeperService(client: client(transport), cache: cache)
        _ = try await service.weekStats(season: 2026, week: 2, isCompleted: true)
        let hit = await cache.load([SleeperWeekStat].self, key: "sleeper-weekstats-2026-2-v1")
        XCTAssertNotNil(hit)
    }

    /// The player index now carries the injury detail and depth order the
    /// Injury Center reads, and an index cached before those fields existed
    /// still decodes.
    func testPlayerIndexCarriesInjuryDetailAndDecodesOlderCaches() throws {
        let payload = #"{"1":{"full_name":"Rico Dowdle","position":"RB","team":"PIT","active":true,"injury_status":"Questionable","injury_body_part":"Toe","depth_chart_order":2,"news_updated":1790000000000}}"#
        let index = try PlayerIndex.build(fromSleeperPayload: Data(payload.utf8))
        let dowdle = try XCTUnwrap(index["1"])
        XCTAssertEqual(dowdle.injuryBodyPart, "Toe")
        XCTAssertEqual(dowdle.depthChartOrder, 2)
        XCTAssertNotNil(dowdle.newsUpdated)

        let old = #"{"players":{"1":{"id":"1","name":"Rico Dowdle","positionCode":"RB","team":"PIT","injuryStatus":null,"active":true}},"builtAt":0}"#
        let decoded = try JSONDecoder().decode(PlayerIndex.self, from: Data(old.utf8))
        XCTAssertNil(decoded["1"]?.injuryBodyPart)
    }
}
