import XCTest
import FCCore
import FCData
@testable import FCApp

/// Dashboard, Matchup and Planning share one loader. Before this, a launch
/// assembled the league context — decode the weekly file, score the whole
/// season — once per screen, back to back.
@MainActor
final class ContextSharingTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func setUp(reuseFor: TimeInterval = 60) async -> (LeagueContextLoader, StubTransport) {
        let transport = await Harness.standardTransport()
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return (
            LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs, reuseFor: reuseFor),
            transport
        )
    }

    func testASecondScreenReusesTheFirstScreensContext() async throws {
        let (loader, transport) = await setUp()

        let first = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let afterFirst = await transport.requestCount
        let second = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let afterSecond = await transport.requestCount

        XCTAssertEqual(afterFirst, afterSecond, "the second load must not touch the data layer at all")
        XCTAssertEqual(first.seasonProfiles.count, second.seasonProfiles.count)
    }

    /// Two screens asking at the same instant — which is what launch does —
    /// share one in-flight load rather than racing two.
    func testSimultaneousLoadsShareOneInFlightAssembly() async throws {
        let (loader, transport) = await setUp()

        async let a = loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        async let b = loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        _ = try await (a, b)
        let concurrent = await transport.requestCount

        let (solo, soloTransport) = await setUp()
        _ = try await solo.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let single = await soloTransport.requestCount

        XCTAssertEqual(concurrent, single)
    }

    /// Switching team in Settings is a different key, so it is never served the
    /// previous team's context.
    func testADifferentRosterIsADifferentContext() async throws {
        let (loader, _) = await setUp()

        let mine = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let theirs = try await loader.load(leagueID: "L1", userRosterID: 2, season: 2025)

        XCTAssertEqual(mine.userRosterID, 1)
        XCTAssertEqual(theirs.userRosterID, 2)
    }

    // MARK: - The memo itself

    /// Counts real assemblies, which the request counts above can only infer.
    private actor Counter {
        var value = 0
        func increment() { value += 1 }
    }

    private func sampleContext() async throws -> LeagueContext {
        let (loader, _) = await setUp()
        return try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
    }

    func testForceRebuildsEvenWhenAFreshEntryExists() async throws {
        let context = try await sampleContext()
        let memo = ContextMemo(maxAge: 3_600)
        let counter = Counter()
        let key = ContextMemo.Key(leagueID: "L1", rosterID: 1, season: 2025)
        let make: @Sendable () async throws -> LeagueContext = {
            await counter.increment()
            return context
        }

        _ = try await memo.value(for: key, force: false, make: make)
        _ = try await memo.value(for: key, force: false, make: make)
        let reused = await counter.value
        _ = try await memo.value(for: key, force: true, make: make)
        let forced = await counter.value

        XCTAssertEqual(reused, 1, "a fresh entry is reused")
        XCTAssertEqual(forced, 2, "force rebuilds regardless")
    }

    func testAnEntryOlderThanMaxAgeIsRebuilt() async throws {
        let context = try await sampleContext()
        let memo = ContextMemo(maxAge: 0)
        let counter = Counter()
        let key = ContextMemo.Key(leagueID: "L1", rosterID: 1, season: 2025)
        let make: @Sendable () async throws -> LeagueContext = {
            await counter.increment()
            return context
        }

        _ = try await memo.value(for: key, force: false, make: make)
        _ = try await memo.value(for: key, force: false, make: make)

        let count = await counter.value
        XCTAssertEqual(count, 2)
    }

    /// A failure is not remembered: the next screen tries again rather than
    /// inheriting the error.
    func testAFailureIsNotMemoised() async throws {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.fail("/league/L1")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)

        do {
            _ = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
            XCTFail("expected the first load to fail")
        } catch {}
        let afterFirst = await transport.requestCount

        do {
            _ = try await loader.load(leagueID: "L1", userRosterID: 1, season: 2025)
        } catch {}
        let afterSecond = await transport.requestCount

        XCTAssertGreaterThan(afterSecond, afterFirst, "the second attempt must actually try again")
    }
}
