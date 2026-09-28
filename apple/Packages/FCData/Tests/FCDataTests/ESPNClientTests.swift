import XCTest
@testable import FCData

/// The one place ESPN cookies are ever sent. These tests pin down where they
/// go, where they don't, and that a rejected cookie is reported as such and
/// never echoed back.
final class ESPNClientTests: XCTestCase {
    private let credentials = ESPNCredentials(espnS2: "s2-secret-value", swid: "{ABCD-1234}")

    private func client(_ transport: StubTransport, signedIn: Bool = true) -> ESPNClient {
        ESPNClient(
            credentials: signedIn ? credentials : nil,
            baseURL: URL(string: "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl")!,
            transport: transport,
            retries: 1
        )
    }

    func testSendsBothCookiesToTheFantasyHost() async throws {
        let transport = StubTransport()
        await transport.on("/leagues/987654", json: #"{"id":987654}"#)

        _ = try await client(transport).league(id: "987654", season: 2026)

        let cookie = await transport.header("Cookie", onRequestAt: 0)
        XCTAssertEqual(cookie, "espn_s2=s2-secret-value; SWID={ABCD-1234}")
        let url = await transport.requests.first?.url
        XCTAssertEqual(url?.host, "lm-api-reads.fantasy.espn.com")
        XCTAssertEqual(url?.path, "/apis/v3/games/ffl/seasons/2026/segments/0/leagues/987654")
    }

    func testSendsNoCookieWhenSignedOut() async throws {
        let transport = StubTransport()
        await transport.on("/leagues/1", json: #"{"id":1}"#)

        _ = try await client(transport, signedIn: false).league(id: "1", season: 2026)

        let cookie = await transport.header("Cookie", onRequestAt: 0)
        XCTAssertNil(cookie)
    }

    func testARejectedCookieIsUnauthorisedNotRetriedAndNotEchoed() async {
        let transport = StubTransport()
        await transport.on("/leagues/987654", json: #"{"messages":["You are not authorized to view this League."]}"#, status: 401)

        do {
            _ = try await client(transport).league(id: "987654", season: 2026)
            XCTFail("expected an error")
        } catch let error as DataLayerError {
            guard case .unauthorized(let path) = error else { return XCTFail("\(error)") }
            XCTAssertTrue(path.hasSuffix("/leagues/987654"))
            let text = String(describing: error)
            XCTAssertFalse(text.contains("s2-secret-value"))
            XCTAssertFalse(text.contains("ABCD-1234"))
        } catch {
            XCTFail("\(error)")
        }
        let count = await transport.requestCount
        XCTAssertEqual(count, 1)
    }

    func testAServerErrorIsRetriedOnce() async throws {
        let transport = StubTransport()
        await transport.on("/leagues/5", respond: [
            .success(HTTPResponse(status: 502, body: Data())),
            .success(HTTPResponse(status: 200, body: Data(#"{"id":5,"seasonId":2026}"#.utf8))),
        ])

        let league = try await client(transport).league(id: "5", season: 2026)
        XCTAssertEqual(league.seasonId, 2026)
        let count = await transport.requestCount
        XCTAssertEqual(count, 2)
    }

    func testCredentialsNeverPrintTheSecret() {
        let text = "\(credentials)"
        XCTAssertFalse(text.contains("s2-secret-value"))
        XCTAssertTrue(text.contains("…1234"))
        XCTAssertEqual(credentials.swidSuffix, "1234")
    }

    func testCredentialsRoundTripThroughASecretStore() {
        let store = InMemorySecretStore()
        XCTAssertNil(ESPNCredentials.load(from: store))
        credentials.save(to: store)
        XCTAssertEqual(ESPNCredentials.load(from: store), credentials)
        ESPNCredentials.clear(from: store)
        XCTAssertNil(ESPNCredentials.load(from: store))
    }
}
