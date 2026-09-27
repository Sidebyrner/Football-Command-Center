import XCTest
@testable import FCData

/// Sleeper's undocumented scores route: a final, a game before kickoff (nulls
/// and empty strings), and a game in progress (hand-edited from a recorded
/// final, since none was on when the fixture was taken).
final class SleeperScoresTests: XCTestCase {
    private func scores() async throws -> [SleeperGameScore] {
        let transport = StubTransport()
        await transport.on("/scores/nfl/regular/2026/2", data: try Fixtures.data("scores-2026-w2"))
        let client = SleeperClient(baseURL: URL(string: "https://api.example.test/v1")!, transport: transport)
        return try await client.scores(season: 2026, week: 2)
    }

    func testAFinal() async throws {
        let all = try await scores()
        let game = try XCTUnwrap(all.first { $0.home == "ARI" })
        XCTAssertEqual(game.status, .complete)
        XCTAssertEqual(game.away, "SEA")
        XCTAssertEqual(game.awayScore, 31)
        XCTAssertEqual(game.homeScore, 7)
        XCTAssertEqual(game.quarter, "F")
        XCTAssertNil(game.possession, "empty strings read as nothing")
        XCTAssertFalse(game.isRedZone)
        XCTAssertEqual(game.spread["SEA"], -4.5)
        XCTAssertNil(game.spread["updated_at"], "the timestamp isn't a team")
        XCTAssertEqual(try XCTUnwrap(game.winChance["SEA"]), 67.74, accuracy: 1e-9)
        XCTAssertEqual(game.score(of: "SEA"), 31)
        XCTAssertEqual(game.opponent(of: "ARI"), "SEA")
    }

    func testAGameBeforeKickoff() async throws {
        let all = try await scores()
        let game = try XCTUnwrap(all.first { $0.home == "BUF" })
        XCTAssertEqual(game.status, .pregame)
        XCTAssertNil(game.homeScore)
        XCTAssertNil(game.quarterNumber, "Sleeper sends \"\" before kickoff")
        XCTAssertNil(game.quarter)
        XCTAssertNotNil(game.startTime)
        XCTAssertEqual(game.forecastWindMph, 12)
        XCTAssertEqual(game.channel, "FOX")
    }

    func testAGameInProgress() async throws {
        let all = try await scores()
        let game = try XCTUnwrap(all.first { $0.home == "ATL" })
        XCTAssertEqual(game.status, .inProgress)
        XCTAssertEqual(game.quarter, "3")
        XCTAssertEqual(game.quarterNumber, 3)
        XCTAssertEqual(game.timeRemaining, "7:42")
        XCTAssertEqual(game.possession, "ATL")
        XCTAssertEqual(game.downAndDistance, "3rd & 4")
        XCTAssertEqual(game.yardLine, "12", "a numeric yard line reads as text")
        XCTAssertTrue(game.isRedZone)
        XCTAssertEqual(game.homeScore, 17)
    }

    func testCachesAndServesStaleWhenOffline() async throws {
        let transport = StubTransport()
        await transport.on("/scores/nfl/regular/2026/2", respond: [
            .success(HTTPResponse(status: 200, body: try Fixtures.data("scores-2026-w2"), headers: [:])),
            .failure(StubTransport.StubError.offline),
        ])
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let service = SleeperService(
            client: SleeperClient(baseURL: URL(string: "https://api.example.test/v1")!, transport: transport, retries: 0),
            cache: DiskCache(directory: directory)
        )
        let first = try await service.scores(season: 2026, week: 2)
        XCTAssertEqual(first.value.count, 3)
        let second = try await service.scores(season: 2026, week: 2, force: true)
        XCTAssertEqual(second.value.count, 3, "a failed live tick keeps the last scores")
    }
}
