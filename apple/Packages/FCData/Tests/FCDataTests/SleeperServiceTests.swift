import XCTest
import FCCore
@testable import FCData

/// The cache-through ordering: fresh cache, then network, then **stale** cache
/// rather than an error. That last step is what makes the app usable with no
/// signal, and the provenance is what stops it lying about freshness (§8.1, §6).
final class SleeperServiceTests: XCTestCase {
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

    private func service(_ transport: StubTransport) -> SleeperService {
        SleeperService(
            client: SleeperClient(
                baseURL: URL(string: "https://api.example.test/v1")!,
                transport: transport,
                retries: 0
            ),
            cache: cache
        )
    }

    func testFirstReadIsLiveAndTheSecondIsCached() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1", json: #"{"league_id":"L1","name":"Test"}"#)
        let service = service(transport)

        let first = try await service.league(id: "L1")
        XCTAssertEqual(first.provenance, .live)
        XCTAssertFalse(first.provenance.needsFreshnessLabel)

        let second = try await service.league(id: "L1")
        guard case .cached = second.provenance else {
            return XCTFail("expected the second read to be cached, got \(second.provenance)")
        }
        XCTAssertTrue(second.provenance.needsFreshnessLabel)

        let count = await transport.requestCount
        XCTAssertEqual(count, 1, "the second read must not hit the network")
    }

    func testForceBypassesAFreshCacheEntry() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1", json: #"{"league_id":"L1","name":"Test"}"#)
        let service = service(transport)

        _ = try await service.league(id: "L1")
        let forced = try await service.league(id: "L1", force: true)

        XCTAssertEqual(forced.provenance, .live)
        let count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    /// The offline case. An expired entry beats an error, but it must arrive
    /// labelled — presenting it as current is the thing §6 forbids.
    func testAFailedFetchFallsBackToStaleCacheWithProvenance() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1", respond: [
            .success(HTTPResponse(status: 200, body: Data(#"{"league_id":"L1","name":"Test"}"#.utf8))),
            .failure(StubTransport.StubError.offline),
        ])
        let service = service(transport)

        _ = try await service.league(id: "L1")

        // Age the entry past its TTL by rewriting it with a backdated stamp.
        let stored = await cache.load(SleeperLeague.self, key: "sleeper-league-L1", allowingStale: true)
        let league = try XCTUnwrap(stored?.value)
        try await cache.store(
            league,
            key: "sleeper-league-L1",
            ttl: CacheTTL.roster,
            now: Date().addingTimeInterval(-CacheTTL.roster - 60)
        )

        let offline = try await service.league(id: "L1")

        guard case .staleCache(let age, _) = offline.provenance else {
            return XCTFail("expected staleCache, got \(offline.provenance)")
        }
        XCTAssertGreaterThan(age, CacheTTL.roster)
        XCTAssertEqual(offline.value.leagueID, "L1")
        XCTAssertTrue(offline.provenance.needsFreshnessLabel)
    }

    /// With nothing cached, a failure is a failure — inventing data would be
    /// worse than saying so.
    func testAFailedFetchWithNoCacheThrows() async {
        let transport = StubTransport()
        await transport.on("/league/L1", failWith: StubTransport.StubError.offline)
        let service = service(transport)

        do {
            _ = try await service.league(id: "L1")
            XCTFail("expected a throw with nothing cached")
        } catch {
            // expected
        }
    }

    /// Scoring is read from the league live, so a mid-season settings change is
    /// picked up without a new build (§1).
    func testScoringTranslationComesFromTheLeaguesOwnSettings() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1", json: """
        {"league_id":"L1","name":"Byrne Notice",
         "scoring_settings":{"rec":0.5,"pass_td":6.0,"rush_yd":0.1}}
        """)

        let translation = try await service(transport).scoringTranslation(leagueID: "L1")
        XCTAssertEqual(translation.value.profile.receptionPoints, 0.5)
        XCTAssertEqual(translation.value.profile.rushingTD, 0)
        XCTAssertEqual(translation.value.profile.rushingYardsPerPoint, 10, accuracy: 0.001)
        XCTAssertEqual(translation.value.profile.source, .sleeper)
    }

    /// Derived values keep the provenance of what they came from — translating
    /// cached settings does not make them live.
    func testDerivedValuesInheritProvenance() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1", json: """
        {"league_id":"L1","roster_positions":["QB","RB","WR","FLEX","BN"]}
        """)
        let service = service(transport)

        _ = try await service.league(id: "L1")
        let template = try await service.slotTemplate(leagueID: "L1")

        guard case .cached = template.provenance else {
            return XCTFail("expected cached provenance to carry through map")
        }
        XCTAssertEqual(template.value.totalStarterSlots, 4)
        XCTAssertEqual(template.value.benchCount, 1)
    }

    /// A completed week's scores never change, so history must not re-fetch on
    /// the 5-minute roster TTL.
    func testCompletedWeeksReuseTheEntryWrittenByALiveRead() async throws {
        let transport = StubTransport()
        await transport.on("/matchups/3", json: #"[{"roster_id":1,"points":102.5}]"#)
        let service = service(transport)

        _ = try await service.matchups(leagueID: "L1", week: 3)
        let historical = try await service.completedMatchups(leagueID: "L1", week: 3)

        guard case .cached = historical.provenance else {
            return XCTFail("expected the historical read to reuse the live entry")
        }
        let count = await transport.requestCount
        XCTAssertEqual(count, 1)
    }

    /// Setup-time lookups are deliberately uncached: a user retyping after a
    /// typo expects a fresh answer, not their own mistake played back.
    func testUsernameLookupIsNotCached() async throws {
        let transport = StubTransport()
        await transport.on("/user/", json: #"{"user_id":"u1","username":"connor"}"#)
        let service = service(transport)

        _ = try await service.user(username: "connor")
        _ = try await service.user(username: "connor")

        let count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    func testPlayerIndexIsCachedOnTheDailyTTL() async throws {
        let transport = StubTransport()
        await transport.on("/players/nfl", json: """
        {"4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true}}
        """)
        let service = service(transport)

        let first = try await service.playerIndex()
        XCTAssertEqual(first.provenance, .live)
        XCTAssertEqual(first.value.count, 1)

        let second = try await service.playerIndex()
        guard case .cached = second.provenance else {
            return XCTFail("the 5 MB payload must not be re-fetched")
        }
        let count = await transport.requestCount
        XCTAssertEqual(count, 1)
    }
}

/// Game-day freshness for the player index, where injury tags live.
final class PlayerIndexMaxAgeTests: XCTestCase {
    private var directory: URL!

    override func tearDown() {
        if let directory { try? FileManager.default.removeItem(at: directory) }
        super.tearDown()
    }

    private let payload = #"{"4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true,"injury_status":"Questionable"}}"#

    private func service() async -> (SleeperService, StubTransport, DiskCache) {
        let transport = StubTransport()
        await transport.on("/players/nfl", json: payload)
        let made = makeTemporaryCache()
        directory = made.directory
        let service = SleeperService(
            client: SleeperClient(baseURL: URL(string: "https://api.example.test/v1")!, transport: transport, retries: 0),
            cache: made.cache
        )
        return (service, transport, made.cache)
    }

    /// Backdates the cached index so its age can be controlled.
    private func age(_ cache: DiskCache, by seconds: TimeInterval) async throws {
        let loaded = await cache.load(PlayerIndex.self, key: "sleeper-players-v1", allowingStale: true)
        let hit = try XCTUnwrap(loaded)
        try await cache.store(hit.value, key: "sleeper-players-v1", ttl: CacheTTL.players, now: Date().addingTimeInterval(-seconds))
    }

    func testAYoungCopyIsReusedOnAGameDay() async throws {
        let (service, transport, cache) = await service()
        _ = try await service.playerIndex()
        try await age(cache, by: 60 * 60)

        _ = try await service.playerIndex(maxAge: 3 * 60 * 60)
        let count = await transport.requestCount
        XCTAssertEqual(count, 1, "an hour-old copy is fine inside a three-hour window")
    }

    func testAnOlderCopyIsRefetchedOnAGameDay() async throws {
        let (service, transport, cache) = await service()
        _ = try await service.playerIndex()
        try await age(cache, by: 4 * 60 * 60)

        let fetched = try await service.playerIndex(maxAge: 3 * 60 * 60)
        XCTAssertEqual(fetched.provenance, .live)
        let count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    /// Outside a game day the same four-hour-old copy is well within Sleeper's
    /// once-a-day request and is kept.
    func testTheSameCopyIsKeptOnAnOrdinaryDay() async throws {
        let (service, transport, cache) = await service()
        _ = try await service.playerIndex()
        try await age(cache, by: 4 * 60 * 60)

        _ = try await service.playerIndex()
        let count = await transport.requestCount
        XCTAssertEqual(count, 1)
    }

    /// If the early re-download fails, the older copy is still served, labelled.
    func testAFailedGameDayRefetchFallsBackToTheCachedCopy() async throws {
        let (service, _, cache) = await service()
        _ = try await service.playerIndex()
        try await age(cache, by: 4 * 60 * 60)

        // Same cache, but the network is now down.
        let failing = StubTransport()
        await failing.on("/players/nfl", failWith: StubTransport.StubError.offline)
        let offline = SleeperService(
            client: SleeperClient(baseURL: URL(string: "https://api.example.test/v1")!, transport: failing, retries: 0),
            cache: cache
        )
        let fetched = try await offline.playerIndex(maxAge: 3 * 60 * 60)
        XCTAssertEqual(fetched.value.count, 1)
        XCTAssertNotEqual(fetched.provenance, .live)
    }
}
