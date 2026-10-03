import XCTest
import FCCore
import FCData
@testable import FCApp

/// A roster-vs-waiver comparison makes the same call whichever provider the
/// league comes from: the verdict only sees `Availability`, and both Sleeper
/// and ESPN leagues fill it from the translated rosters.
@MainActor
final class CompareVerdictProviderTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private let league = CompareVerdict.League(waivers: .faab(budget: 100), faabRemaining: 80, currentWeek: 3)

    private func sleeperContext() async throws -> LeagueContext {
        let transport = await Harness.standardTransport()
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        return try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
    }

    private func espnContext() async throws -> LeagueContext {
        let transport = await Harness.standardTransport()
        try await transport.on("/leagues/987654", fixture: "espn-league")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let staticData = harness.staticData
        let espn = ESPNLeagueService(
            client: ESPNClient(credentials: nil, transport: transport, retries: 0),
            cache: DiskCache(directory: harness.cacheDirectory.appendingPathComponent("espn")),
            season: { 2026 },
            playerIndex: { nil },
            crosswalk: { try? await staticData.playerCrosswalk().value }
        )
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, leagueSource: espn,
                                         provider: { .espn }, now: TestClock.beforeKickoffs)
        return try await loader.load(leagueID: "987654", userRosterID: 1, season: 2026)
    }

    private func assertKeepsAndSwaps(_ context: LeagueContext, file: StaticString = #filePath, line: UInt = #line) throws {
        let mineID = try XCTUnwrap(context.teams.first(where: \.isUser)?.roster.first { !$0.id.hasPrefix("espn:") }?.id,
                                   "the user's roster has a mapped player", file: file, line: line)
        XCTAssertEqual(context.availability(ofSleeperID: mineID), .mine, file: file, line: line)
        let freeAgentID = "not-on-any-roster"
        XCTAssertEqual(context.availability(ofSleeperID: freeAgentID), .freeAgent, file: file, line: line)

        func input(_ id: String, ros: Double) -> CompareVerdict.Input {
            CompareVerdict.Input(id: id, name: id, availability: context.availability(ofSleeperID: id),
                                 restOfSeason: ros, projectedThisWeek: ros, expectedPointsLast4: ros)
        }
        let keep = CompareVerdict.compute([input(mineID, ros: 14), input(freeAgentID, ros: 9)], league: league)
        guard case .keep = keep.priority else { return XCTFail("\(keep.priority)", file: file, line: line) }
        XCTAssertEqual(keep.pickID, mineID, file: file, line: line)

        let swap = CompareVerdict.compute([input(mineID, ros: 6), input(freeAgentID, ros: 12)], league: league)
        guard case .spend = swap.priority else { return XCTFail("\(swap.priority)", file: file, line: line) }
        XCTAssertEqual(swap.headline, "Add \(freeAgentID), drop \(mineID)", file: file, line: line)
    }

    func testSleeperLeague() async throws {
        try assertKeepsAndSwaps(try await sleeperContext())
    }

    func testESPNLeague() async throws {
        try assertKeepsAndSwaps(try await espnContext())
    }
}
