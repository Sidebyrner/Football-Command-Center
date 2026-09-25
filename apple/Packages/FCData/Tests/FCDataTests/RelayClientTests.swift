import XCTest
@testable import FCData

/// The relay is enrichment and every call fails soft. No v1 feature may depend
/// on it being reachable (§0, §3.3), so these tests are mostly about failure
/// producing `nil` rather than an error the caller has to handle.
final class RelayClientTests: XCTestCase {
    private func client(_ transport: StubTransport) -> RelayClient {
        RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
    }

    func testProbeReportsReachability() async {
        let up = StubTransport()
        await up.on("health", json: #"{"ok":true}"#)
        let reachable = await client(up).probe()
        XCTAssertTrue(reachable)

        let down = StubTransport()
        await down.on("health", failWith: StubTransport.StubError.offline)
        let unreachable = await client(down).probe()
        XCTAssertFalse(unreachable)
    }

    func testParsesANewsFeed() async {
        let transport = StubTransport()
        await transport.on("api/news", json: """
        {"feed":"rotoworld","cached":false,"items":[
          {"title":"Allen questionable","body":"Limited in practice",
           "url":"https://example.test/1","publishedAt":"2026-09-12T10:00:00Z",
           "sourceId":"1"}]}
        """)

        let feed = await client(transport).news(feed: "rotoworld")
        XCTAssertEqual(feed?.items.count, 1)
        XCTAssertEqual(feed?.items.first?.title, "Allen questionable")
    }

    /// An unreachable relay means the news section does not render. It does not
    /// mean an error the caller has to catch.
    func testAnUnreachableRelayReturnsNilRatherThanThrowing() async {
        let transport = StubTransport()
        await transport.on("api/news", failWith: StubTransport.StubError.offline)

        let feed = await client(transport).news(feed: "rotoworld")
        XCTAssertNil(feed)
    }

    /// The relay answers 503 when it has no paid odds key. That is routine —
    /// the fallback is the recorded closing lines already in the schedule file.
    func testAMissingOddsKeyReadsAsNoOdds() async {
        struct Odds: Decodable, Sendable { let events: [String] }
        let transport = StubTransport()
        await transport.on("api/odds", json: #"{"error":"no key"}"#, status: 503)

        let odds = await client(transport).odds(Odds.self)
        XCTAssertNil(odds)
    }

    func testAMalformedBodyReadsAsAbsentRatherThanCrashing() async {
        struct Odds: Decodable, Sendable { let events: [String] }
        let transport = StubTransport()
        await transport.on("api/odds", json: "not json")

        let odds = await client(transport).odds(Odds.self)
        XCTAssertNil(odds)
    }

    func testEscapesEventIDsInThePropsPath() async {
        struct Props: Decodable, Sendable { let ok: Bool }
        let transport = StubTransport()
        await transport.on("props", json: #"{"ok":true}"#)

        _ = await client(transport).props(Props.self, eventID: "a b/c")
        let requests = await transport.requests
        let url = requests.first?.url?.absoluteString ?? ""
        XCTAssertFalse(url.contains("a b"))
    }
}

/// League timing settings and the authenticated AI pitch call.
final class TradeSupportTests: XCTestCase {
    func testLeagueSettingsDecodeTheTradeDeadline() throws {
        let league = try JSONDecoder().decode(SleeperLeague.self, from: Data("""
        {"league_id":"L1","settings":{"trade_deadline":11,"waiver_day_of_week":3,"playoff_week_start":15,"unrelated":7}}
        """.utf8))
        XCTAssertEqual(league.settings?.effectiveTradeDeadline, 11)
        XCTAssertEqual(league.settings?.waiverDayOfWeek, 3)
        XCTAssertEqual(league.settings?.playoffWeekStart, 15)
    }

    /// Sleeper uses 0 for a league without a deadline.
    func testAZeroDeadlineMeansNone() throws {
        let league = try JSONDecoder().decode(SleeperLeague.self, from: Data(#"{"league_id":"L1","settings":{"trade_deadline":0}}"#.utf8))
        XCTAssertNil(league.settings?.effectiveTradeDeadline)
    }

    func testPitchPolishSendsTheTokenAndFacts() async throws {
        let transport = StubTransport()
        await transport.on("api/ai/trade-pitch", json: #"{"pitch":"  Polished pitch.  "}"#)
        let client = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)

        let pitch = await client.polishTradePitch(.init(facts: ["You're short at WR in week 9"], draft: "Draft"), token: "s3cret")

        XCTAssertEqual(pitch, "Polished pitch.")
        let auth = await transport.header("Authorization", onRequestAt: 0)
        XCTAssertEqual(auth, "Bearer s3cret")
        let requests = await transport.requests
        let body = try XCTUnwrap(requests.first?.httpBody)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["facts"] as? [String], ["You're short at WR in week 9"])
        XCTAssertEqual(requests.first?.httpMethod, "POST")
    }

    /// An unauthorised or unreachable relay falls back to the template silently.
    func testPitchPolishFailsSoft() async {
        let transport = StubTransport()
        await transport.on("api/ai/trade-pitch", json: #"{"error":"unauthorized"}"#, status: 401)
        let client = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
        let pitch = await client.polishTradePitch(.init(facts: [], draft: "Draft"), token: nil)
        XCTAssertNil(pitch)
    }

    /// Each failure says what to fix: the token, the relay, or the model.
    func testPitchPolishSaysWhyItFailed() async {
        func result(status: Int, json: String = #"{"error":"x"}"#) async -> Result<String, RelayClient.PolishFailure> {
            let transport = StubTransport()
            await transport.on("api/ai/trade-pitch", json: json, status: status)
            let client = RelayClient(baseURL: URL(string: "https://relay.example.test")!, transport: transport)
            return await client.polishTradePitchResult(.init(facts: [], draft: "Draft"), token: "t")
        }
        let unauthorized = await result(status: 401)
        XCTAssertEqual(unauthorized, .failure(.unauthorized))
        let server = await result(status: 503)
        XCTAssertEqual(server, .failure(.server(status: 503)))
        let empty = await result(status: 200, json: #"{"pitch":"   "}"#)
        XCTAssertEqual(empty, .failure(.emptyResponse))
        let ok = await result(status: 200, json: #"{"pitch":"Hi"}"#)
        XCTAssertEqual(ok, .success("Hi"))
    }

    func testInMemorySecretStoreRoundTrips() {
        let store = InMemorySecretStore()
        store.save("abc")
        XCTAssertEqual(store.load(), "abc")
        store.save(nil)
        XCTAssertNil(store.load())
    }
}
