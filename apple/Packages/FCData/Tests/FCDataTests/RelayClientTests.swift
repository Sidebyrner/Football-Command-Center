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
