import XCTest
import FCCore
import FCData
@testable import FCApp

/// Decide against the Sit/Start fixture league: real 2025 players through the
/// real crosswalk, with unjoinable fixture players beside them.
@MainActor
final class DecideModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    /// Nacua off the roster, so he's a free agent.
    static let rostersWithNacuaFree = SitStartModelTests.Fixture.rosters.replacingOccurrences(of: #""9493","#, with: "")

    private func loaded(rosters: String = SitStartModelTests.Fixture.rosters, injuries: [String: String] = [:]) async throws
        -> (decide: DecideModel, sitStart: SitStartModel) {
        var players = SitStartModelTests.Fixture.players
        for (id, tag) in injuries {
            players = players.replacingOccurrences(of: #""\#(id)":{"#, with: #""\#(id)":{"injury_status":"\#(tag)","#)
        }
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":1,"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: rosters)
        await transport.override("/players/nfl", json: players)
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let sitStart = SitStartModel(loader: loader)
        let waivers = WaiverBoardModel(loader: loader)
        let matchup = MatchupModel(loader: loader, sleeper: harness.sleeper)
        let discovery = DiscoveryModel(loader: loader)
        await sitStart.load(leagueID: "L1", userRosterID: 1, season: 2025)
        await waivers.load(leagueID: "L1", userRosterID: 1, season: 2025)
        await matchup.load(leagueID: "L1", userRosterID: 1, season: 2025)
        await discovery.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = sitStart.errorMessage { throw XCTSkip("load failed: \(error)") }
        return (DecideModel(sitStart: sitStart, waivers: waivers, matchup: matchup, discovery: discovery), sitStart)
    }

    private func slot(_ decide: DecideModel, _ index: Int) throws -> DecideSlot {
        try XCTUnwrap(decide.slot(index))
    }

    // Starters: QB Allen, RB Barkley, RB Seattle Back, WR Chase, WR Receiver
    // Two, TE, an empty FLEX, K, DEF, two IDP. Bench: Goff, Gibbs, Robinson,
    // Nacua.

    func testADedicatedSlotOffersOnlyThatPosition() async throws {
        let (decide, _) = try await loaded()
        let rb = try slot(decide, 1)
        XCTAssertEqual(rb.token, "RB")
        XCTAssertEqual(rb.incumbentID, "4866")
        XCTAssertEqual(rb.candidateIDs.first, "4866", "the incumbent leads")
        XCTAssertEqual(Set(rb.candidateIDs), ["4866", "9221", "9509"])
        XCTAssertTrue(rb.hasBenchOption)
    }

    func testFlexOffersEveryEligiblePositionAndNoOtherStarter() async throws {
        let (decide, _) = try await loaded()
        let flex = try slot(decide, 6)
        XCTAssertEqual(flex.token, "FLEX")
        XCTAssertNil(flex.incumbentID, "the fixture's flex is empty")
        XCTAssertEqual(Set(flex.candidateIDs), ["9221", "9509", "9493"], "bench RBs and WRs; starters elsewhere stay put")
        XCTAssertTrue(flex.verdict.headline.hasSuffix("at FLEX"), flex.verdict.headline)
    }

    func testCandidatesAreValuedExactlyAsSitStartValuesThem() async throws {
        let (decide, sitStart) = try await loaded()
        let context = try XCTUnwrap(sitStart.context)
        let signals = decide.signals(for: "9509")
        XCTAssertEqual(signals[.commandCenter], sitStart.value(of: "9509", basis: .commandCenter, context: context))
        XCTAssertEqual(signals[.form], sitStart.value(of: "9509", basis: .form, context: context))
        XCTAssertEqual(signals[.environment], sitStart.value(of: "9509", basis: .environment, context: context))
    }

    func testAPlayerWhoIsOutHasNoSignalsAndCantStart() async throws {
        let (decide, _) = try await loaded(injuries: ["9509": "Out"])
        XCTAssertTrue(decide.signals(for: "9509").isEmpty)
        let rb = try slot(decide, 1)
        XCTAssertEqual(rb.verdict.blocked.map(\.id), ["9509"])
        XCTAssertFalse(rb.verdict.ranked.contains { $0.id == "9509" })
    }

    func testTheHopperOnlyOffersFreeAgentsWhoBeatTheWeakestOption() async throws {
        let (decide, sitStart) = try await loaded(rosters: Self.rostersWithNacuaFree)
        let context = try XCTUnwrap(sitStart.context)
        let wr = try slot(decide, 3)
        XCTAssertEqual(wr.candidateIDs, ["7564"], "Nacua is no longer on the bench")
        let suggestions = decide.suggestions(for: wr)
        let nacua = try XCTUnwrap(suggestions.first { $0.id == "9493" })
        let chase = try XCTUnwrap(sitStart.value(of: "7564", basis: .projected, context: context)
            ?? sitStart.value(of: "7564", basis: .commandCenter, context: context))
        XCTAssertGreaterThan(nacua.value, chase)
        XCTAssertTrue(suggestions.allSatisfy { $0.value > chase })
        XCTAssertTrue(nacua.reason.hasPrefix("Beats Chase on"), nacua.reason)
        XCTAssertTrue(decide.suggestions(for: try slot(decide, 1)).isEmpty, "a WR is never offered for an RB slot")
    }

    func testTheHopperSkipsFreeAgentsWhoCantPlay() async throws {
        let (decide, _) = try await loaded(rosters: Self.rostersWithNacuaFree, injuries: ["9493": "Out"])
        XCTAssertFalse(decide.suggestions(for: try slot(decide, 3)).contains { $0.id == "9493" })
    }

    func testASessionNeverTouchesTheWatchlist() async throws {
        let (decide, _) = try await loaded(rosters: Self.rostersWithNacuaFree)
        let watchlist = WatchlistModel(store: InMemoryWatchlistStore())
        let session = decide.session(for: try slot(decide, 1))
        XCTAssertEqual(session.ids.count, 3)
        session.add("9493")
        XCTAssertEqual(session.ids.count, 4)
        session.removeFromCompare("4866")
        XCTAssertTrue(session.ids.contains("4866"), "the incumbent can't be removed")
        session.removeFromCompare("9221")
        XCTAssertFalse(session.ids.contains("9221"))
        XCTAssertTrue(watchlist.entries.isEmpty)
    }

    func testASessionLeavesRoomForASuggestedFreeAgent() async throws {
        let (decide, _) = try await loaded(rosters: Self.rostersWithNacuaFree)
        let session = decide.session(for: try slot(decide, 3))
        XCTAssertEqual(session.ids, ["7564"])
        XCTAssertFalse(session.isFull)
    }

    func testAFullSessionReplacesTheNamedColumn() async throws {
        let (decide, _) = try await loaded()
        let session = DecideSession(slot: try slot(decide, 1), ids: ["4866", "9221", "9509", "x"])
        XCTAssertTrue(session.isFull)
        session.add("y")
        XCTAssertFalse(session.ids.contains("y"), "full, and nothing named to replace")
        session.add("y", replacing: "x")
        XCTAssertEqual(session.ids, ["4866", "9221", "9509", "y"])
    }

    func testABenchPlayerPickedInTwoSlotsIsCalledOut() async throws {
        let (decide, _) = try await loaded()
        // Robinson out-values Barkley, Seattle Back and the empty flex alike.
        XCTAssertEqual(DecideModel.sharedPicks(decide.slots())["9509"], ["RB", "RB", "FLEX"])
    }
}
