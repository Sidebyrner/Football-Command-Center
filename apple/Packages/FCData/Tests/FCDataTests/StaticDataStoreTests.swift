import XCTest
import FCCore
@testable import FCData

/// Bundled copy, conditional HTTP refresh, and the fallbacks between them (§9).
final class StaticDataStoreTests: XCTestCase {
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

    private func store(
        transport: HTTPTransport = StubTransport(),
        baseURL: URL? = nil
    ) -> StaticDataStore {
        StaticDataStore(
            bundle: .module,
            bundleSubdirectory: "Fixtures",
            cache: cache,
            transport: transport,
            baseURL: baseURL
        )
    }

    /// With no remote configured, the bundled copy is what a first launch gets —
    /// which is what makes the app work offline before it has ever synced.
    func testFallsBackToTheBundledCopy() async throws {
        let schedule = try await store().schedule(season: 2025)

        XCTAssertEqual(schedule.provenance, .bundled)
        XCTAssertFalse(schedule.value.byWeek.isEmpty)
        XCTAssertTrue(schedule.provenance.needsFreshnessLabel)
    }

    /// The most important file in the app decodes through the store into the
    /// same FCCore type the algorithms already consume.
    func testDecodesTheRealWeeklyFile() async throws {
        let weekly = try await store().weeklyFile(season: 2025)

        XCTAssertEqual(weekly.provenance, .bundled)
        XCTAssertGreaterThan(weekly.value.playerCount, 500)
        XCTAssertGreaterThan(weekly.value.rowCount, 5_000)
    }

    func testDecodesTheRealCrosswalk() async throws {
        let crosswalk = try await store().playerCrosswalk()
        XCTAssertGreaterThan(crosswalk.value.players.count, 5_000)
    }

    func testARefreshIsStoredAndReportedLive() async throws {
        let transport = StubTransport()
        await transport.on("schedule-2025.json", json: #"{"byWeek":{"1":[]}}"#, headers: ["ETag": "v1"])

        let store = store(transport: transport, baseURL: URL(string: "https://data.example.test")!)
        let first = try await store.schedule(season: 2025)

        XCTAssertEqual(first.provenance, .live)
        XCTAssertEqual(first.value.byWeek.count, 1)

        // Second read is served from cache without touching the network.
        let second = try await store.schedule(season: 2025)
        guard case .cached = second.provenance else {
            return XCTFail("expected cached, got \(second.provenance)")
        }
        let count = await transport.requestCount
        XCTAssertEqual(count, 1)
    }

    /// The ETag is what makes a weekly refresh nearly free — without it the app
    /// re-downloads 1.8 MB to learn nothing changed.
    func testSendsIfNoneMatchOnceAnETagIsKnown() async throws {
        let transport = StubTransport()
        await transport.on("schedule-2025.json", respond: [
            .success(HTTPResponse(
                status: 200, body: Data(#"{"byWeek":{"1":[]}}"#.utf8), headers: ["ETag": "v1"]
            )),
            .success(HTTPResponse(status: 304, body: Data())),
        ])

        let store = store(transport: transport, baseURL: URL(string: "https://data.example.test")!)
        _ = try await store.schedule(season: 2025)
        let refreshed = try await store.schedule(season: 2025, force: true)

        let sent = await transport.header("If-None-Match", onRequestAt: 1)
        XCTAssertEqual(sent, "v1")

        // A 304 means what we hold is current, so it is served rather than refetched.
        guard case .cached = refreshed.provenance else {
            return XCTFail("expected a 304 to serve the cached copy, got \(refreshed.provenance)")
        }
        XCTAssertEqual(refreshed.value.byWeek.count, 1)
    }

    /// A refresh failure with something cached serves the cached bytes, labelled.
    func testARefreshFailureFallsBackToStaleCache() async throws {
        let transport = StubTransport()
        await transport.on("schedule-2025.json", respond: [
            .success(HTTPResponse(
                status: 200, body: Data(#"{"byWeek":{"1":[]}}"#.utf8), headers: ["ETag": "v1"]
            )),
            .failure(StubTransport.StubError.offline),
        ])

        let store = store(transport: transport, baseURL: URL(string: "https://data.example.test")!)
        _ = try await store.schedule(season: 2025)
        let offline = try await store.schedule(season: 2025, force: true)

        guard case .staleCache = offline.provenance else {
            return XCTFail("expected staleCache, got \(offline.provenance)")
        }
        XCTAssertEqual(offline.value.byWeek.count, 1)
    }

    /// A refresh failure with nothing cached still has the bundled copy — being
    /// unable to reach the server is not a reason to have no data at all.
    func testARefreshFailureWithNoCacheFallsBackToTheBundle() async throws {
        let transport = StubTransport()
        await transport.on("schedule-2025.json", failWith: StubTransport.StubError.offline)

        let store = store(transport: transport, baseURL: URL(string: "https://data.example.test")!)
        let schedule = try await store.schedule(season: 2025)

        XCTAssertEqual(schedule.provenance, .bundled)
        XCTAssertFalse(schedule.value.byWeek.isEmpty)
    }

    /// Nothing bundled, nothing cached, no network: the error names the file
    /// rather than saying "couldn't load" (§6).
    func testAMissingResourceNamesItself() async {
        let store = store()
        do {
            _ = try await store.weeklyFile(season: 1999)
            XCTFail("expected a failure for a season we do not ship")
        } catch {
            guard case DataLayerError.noFallbackAvailable(let resource) = error else {
                return XCTFail("expected noFallbackAvailable, got \(error)")
            }
            XCTAssertEqual(resource, "weekly-1999")
        }
    }

    /// The schedule carries **recorded** closing lines. They are free and need
    /// no key, and the UI must label them as recorded so they are never
    /// mistaken for live odds (§3.2).
    func testTheBundledScheduleCarriesRecordedLines() async throws {
        let schedule = try await store().schedule(season: 2025)
        let games = schedule.value.byWeek.values.flatMap { $0 }
        let withLines = games.filter { $0.spreadLine != nil && $0.totalLine != nil }
        XCTAssertGreaterThan(withLines.count, 0)
    }

    /// A newer schema than we know must be ignored, never crashed on (§9).
    func testUnknownFieldsInARefreshedFileAreTolerated() async throws {
        let transport = StubTransport()
        await transport.on("schedule-2025.json", json: """
        {"byWeek":{"1":[{"home":"SEA","away":"NE","kickoff":"2025-09-07",
         "brand_new_field":{"nested":true}}]},"somethingElse":42}
        """)

        let store = store(transport: transport, baseURL: URL(string: "https://data.example.test")!)
        let schedule = try await store.schedule(season: 2025)

        XCTAssertEqual(schedule.provenance, .live)
        XCTAssertEqual(schedule.value.byWeek["1"]?.first?.home, "SEA")
    }
}

/// Per-file cache lifetimes.
final class StaticResourceTTLTests: XCTestCase {
    func testInSeasonFilesAreRecheckedTwiceADay() {
        XCTAssertEqual(StaticResource.weeklyIndex.ttl, 12 * 60 * 60)
        XCTAssertEqual(StaticResource.weekly(season: 2026).ttl, 12 * 60 * 60)
        XCTAssertEqual(StaticResource.schedule(season: 2026).ttl, 12 * 60 * 60)
    }

    func testSlowMovingFilesKeepAWeek() {
        XCTAssertEqual(StaticResource.playerIDs.ttl, CacheTTL.staticData)
        XCTAssertEqual(StaticResource.adp.ttl, CacheTTL.staticData)
    }

    /// The resource's own TTL governs the cache: an expired entry is re-checked
    /// with If-None-Match rather than served.
    func testAnExpiredResourceIsRecheckedWithItsETag() async throws {
        let transport = StubTransport()
        await transport.on("tiny.json", respond: [
            .success(HTTPResponse(status: 200, body: Data(#"{"byWeek":{}}"#.utf8), headers: ["ETag": "v1"])),
            .success(HTTPResponse(status: 304, body: Data())),
        ])
        let (cache, directory) = makeTemporaryCache()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = StaticDataStore(
            bundle: .module, cache: cache, transport: transport,
            baseURL: URL(string: "https://data.example.test")!
        )
        let resource = StaticResource(bundledName: "none", remotePath: "tiny.json", identifier: "tiny", ttl: 0)

        _ = try await store.load(ScheduleFile.self, resource: resource)
        _ = try await store.load(ScheduleFile.self, resource: resource)

        let count = await transport.requestCount
        XCTAssertEqual(count, 2, "a zero TTL means the second read asks the server again")
        let etag = await transport.header("If-None-Match", onRequestAt: 1)
        XCTAssertEqual(etag, "v1")
    }
}
