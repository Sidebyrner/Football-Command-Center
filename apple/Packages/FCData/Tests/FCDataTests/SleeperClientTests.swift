import XCTest
@testable import FCData

/// The client's retry and error behaviour. No network: the interesting cases
/// are a 500 that then succeeds and a 404 that must not be retried, neither of
/// which a live server produces on request.
final class SleeperClientTests: XCTestCase {
    private func client(_ transport: StubTransport, retries: Int = 1) -> SleeperClient {
        SleeperClient(
            baseURL: URL(string: "https://api.example.test/v1")!,
            transport: transport,
            retries: retries
        )
    }

    func testDecodesNFLState() async throws {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)

        let state = try await client(transport).nflState()
        XCTAssertEqual(state.week, 3)
        XCTAssertEqual(state.seasonYear, 2026)
    }

    /// One retry, as the web client had — a blip during a lineup decision should
    /// not need the user to tap again.
    func testRetriesOnceOnAServerError() async throws {
        let transport = StubTransport()
        await transport.on("/state/nfl", respond: [
            .success(HTTPResponse(status: 500, body: Data())),
            .success(HTTPResponse(status: 200, body: Data(#"{"week":5}"#.utf8))),
        ])

        let state = try await client(transport).nflState()
        XCTAssertEqual(state.week, 5)
        let count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    /// A 404 on a username the user just typed is an answer, not a blip.
    /// Retrying it only doubles the wait before telling them it's wrong.
    func testDoesNotRetryAClientError() async {
        let transport = StubTransport()
        await transport.on("/user/", respond: [
            .success(HTTPResponse(status: 404, body: Data())),
            .success(HTTPResponse(status: 200, body: Data(#"{"user_id":"u1"}"#.utf8))),
        ])

        do {
            _ = try await client(transport).user(username: "nobody")
            XCTFail("expected a 404 to surface")
        } catch {
            guard case DataLayerError.httpStatus(let code, _) = error else {
                return XCTFail("expected an httpStatus error, got \(error)")
            }
            XCTAssertEqual(code, 404)
        }

        let count = await transport.requestCount
        XCTAssertEqual(count, 1, "a 404 must not be retried")
    }

    func testGivesUpAfterTheRetryBudget() async {
        let transport = StubTransport()
        await transport.on("/state/nfl", respond: [
            .success(HTTPResponse(status: 503, body: Data())),
            .success(HTTPResponse(status: 503, body: Data())),
            .success(HTTPResponse(status: 503, body: Data())),
        ])

        do {
            _ = try await client(transport).nflState()
            XCTFail("expected failure")
        } catch {
            // expected
        }
        let count = await transport.requestCount
        XCTAssertEqual(count, 2, "one attempt plus one retry")
    }

    /// An error must name what failed — "couldn't load" with no subject is the
    /// failure mode the house style exists to prevent (§6).
    func testADecodingFailureNamesThePath() async {
        let transport = StubTransport()
        await transport.on("/league/L1", json: #"{"unexpected":"shape"}"#)

        do {
            _ = try await client(transport).league(id: "L1")
            XCTFail("expected a decode failure")
        } catch {
            guard case DataLayerError.undecodable(let path, _) = error else {
                return XCTFail("expected undecodable, got \(error)")
            }
            XCTAssertTrue(path.contains("L1"))
        }
    }

    func testBuildsLeagueAndMatchupPaths() async throws {
        let transport = StubTransport()
        await transport.on("/league/L1/matchups/7", json: "[]")

        _ = try await client(transport).matchups(leagueID: "L1", week: 7)
        let paths = await transport.requestedPaths()
        XCTAssertEqual(paths, ["/v1/league/L1/matchups/7"])
    }

    /// Usernames are user input and can contain anything.
    func testEscapesUsernamesInThePath() async throws {
        let transport = StubTransport()
        await transport.on("/user/", json: #"{"user_id":"u1"}"#)

        _ = try await client(transport).user(username: "a b/c")
        let requests = await transport.requests
        let url = try XCTUnwrap(requests.first?.url?.absoluteString)
        XCTAssertFalse(url.contains("a b"), "a raw space must not reach the URL")
    }

    /// The client hands back the trimmed index and never the raw 5 MB body —
    /// the simplest way to keep §3.1 true is to give callers no way to hold it.
    func testPlayerIndexIsReturnedAlreadyTrimmed() async throws {
        let transport = StubTransport()
        await transport.on("/players/nfl", json: """
        {"4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true}}
        """)

        let index = try await client(transport).playerIndex()
        XCTAssertEqual(index.count, 2)
        XCTAssertEqual(index["PHI"]?.position, .def)
    }

    func testTrendingParses() async throws {
        let transport = StubTransport()
        await transport.on("/trending/add", json: #"[{"player_id":"4034","count":5000}]"#)

        let trending = try await client(transport).trendingAdds()
        XCTAssertEqual(trending.first?.playerID, "4034")
        XCTAssertEqual(trending.first?.count, 5000)
    }
}
