import XCTest
import FCCore
import FCData
@testable import FCApp

/// Pull-to-refresh must actually re-read what changes during a week, and an
/// ordinary repeat load must not.
@MainActor
final class RefreshTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func make() async -> (DashboardModel, StubTransport) {
        let transport = await Harness.dashboardTransport()
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let model = DashboardModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData),
            sleeper: harness.sleeper
        )
        return (model, transport)
    }

    func testARepeatLoadIsServedFromCache() async {
        let (model, transport) = await make()
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let afterFirst = await transport.requestCount

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let afterSecond = await transport.requestCount

        // Only the uncached-by-design reads may repeat; the league context and
        // its rosters must not be refetched.
        XCTAssertLessThan(afterSecond - afterFirst, afterFirst / 2)
    }

    /// The whole point of the gesture: rosters, league and week are re-read even
    /// though fresh cached copies exist.
    func testRefreshRereadsRostersAndTheCurrentWeek() async {
        let (model, transport) = await make()
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        let beforeRefresh = await transport.requestCount

        await model.refresh()
        let afterRefresh = await transport.requestCount

        let rosterReads = await transport.requestedPaths().filter { $0.hasSuffix("/rosters") }.count
        let stateReads = await transport.requestedPaths().filter { $0.hasSuffix("/state/nfl") }.count
        XCTAssertGreaterThan(afterRefresh, beforeRefresh)
        XCTAssertEqual(rosterReads, 2, "once on load, once on refresh — not on the cached repeat")
        XCTAssertGreaterThanOrEqual(stateReads, 2)
    }

    /// The player index is 5 MB and Sleeper asks for it once a day; a refresh
    /// must not re-download it.
    func testRefreshDoesNotRefetchThePlayerIndex() async {
        let (model, transport) = await make()
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        await model.refresh()

        let playerReads = await transport.requestedPaths().filter { $0.hasSuffix("/players/nfl") }.count
        XCTAssertEqual(playerReads, 1)
    }

    func testASuccessfulRefreshIsCounted() async {
        let (model, _) = await make()
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        XCTAssertEqual(model.refreshCount, 0, "first load is not a refresh")

        await model.refresh()
        XCTAssertEqual(model.refreshCount, 1)
    }

    /// A refresh that can't reach Sleeper keeps the screen useful by falling back
    /// to the cached copy — labelled offline — and is not confirmed with a success
    /// haptic, because nothing was actually refreshed.
    func testARefreshThatCannotReachSleeperFallsBackAndIsNotCounted() async {
        let (model, transport) = await make()
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        XCTAssertNotNil(model.context)

        await transport.fail("/league/L1")
        await transport.fail("/state/nfl")
        await model.refresh()

        let context = model.context
        XCTAssertNotNil(context, "the previous content stays")
        guard case .staleCache = context?.provenance else {
            return XCTFail("expected the offline fallback, got \(String(describing: context?.provenance))")
        }
        XCTAssertEqual(model.refreshCount, 0)
    }

    func testRefreshBeforeAnyLoadDoesNothing() async {
        let (model, transport) = await make()
        await model.refresh()
        let count = await transport.requestCount
        XCTAssertEqual(count, 0)
    }
}
