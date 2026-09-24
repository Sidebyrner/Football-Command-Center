import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Injury Center against real 2026 data: the official week-2 injury
/// report and depth charts shipped by the pipeline, and recorded Sleeper stat
/// lines. Nico Collins (HOU WR, Out, did not practice, hamstring) is the user's
/// starter; Xavier Hutchinson is the free agent behind him on the depth chart;
/// Puka Nacua (Questionable, DNP) starts for the rival.
@MainActor
final class InjuryCenterModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let collins = "7569"
    private static let nacua = "9493"
    private static let hutchinson = "10218"
    private static let smithNjigba = "9488"

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":2,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":8,
             "roster_positions":["QB","RB","WR","WR","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6},
             "settings":{"reserve_slots":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1",
              "players":["qb1","rb1","\(Self.collins)","wr_bench","wr_spare"],
              "starters":["qb1","rb1","\(Self.collins)","wr_bench"]},
             {"roster_id":2,"owner_id":"u2",
              "players":["qb2","rb2","\(Self.nacua)","wr_r2"],
              "starters":["qb2","rb2","\(Self.nacua)","wr_r2"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "rb1":{"full_name":"Starter Back","position":"RB","team":"DET","active":true},
             "\(Self.collins)":{"full_name":"Nico Collins","position":"WR","team":"HOU","active":true,
                                "injury_status":"Out","injury_body_part":"Hamstring"},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"MIN","active":true},
             "wr_spare":{"full_name":"Spare Receiver","position":"WR","team":"DAL","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "\(Self.nacua)":{"full_name":"Puka Nacua","position":"WR","team":"LAR","active":true,
                              "injury_status":"Questionable","injury_body_part":"Hip"},
             "wr_r2":{"full_name":"Rival Receiver","position":"WR","team":"NYJ","active":true},
             "\(Self.hutchinson)":{"full_name":"Xavier Hutchinson","position":"WR","team":"HOU","active":true},
             "\(Self.smithNjigba)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "retired":{"full_name":"Retired Receiver","position":"WR","team":"SEA","active":false}}
            """)
        // Week 1 done, week 2 live: both answered from the recorded week-2 lines.
        try await transport.on("/stats/nfl/2026/1", fixture: "stats-2026-w2")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> InjuryCenterModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = InjuryCenterModel(loader: loader, sleeper: harness.sleeper)
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    func testRosterJoinsSleeperTagWithTheOfficialReport() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)

        let collins = try XCTUnwrap(model.roster.first { $0.id == Self.collins })
        XCTAssertTrue(collins.isStarter)
        XCTAssertEqual(collins.slotToken, "WR")
        XCTAssertEqual(collins.severity, .out)
        XCTAssertEqual(collins.report?.designation, .out)
        XCTAssertEqual(collins.report?.practice, .didNotParticipate)
        XCTAssertEqual(collins.headline, "Out · Hamstring · Did not practice")
        XCTAssertFalse(collins.isLocked)
        XCTAssertNotNil(collins.kickoff, "HOU plays in week 2 of the shipped 2026 schedule")
        // Only players with a signal appear.
        XCTAssertFalse(model.roster.contains { $0.id == "wr_bench" })
    }

    func testWhoBenefitsNamesTheDepthChartBehindTheInjuredPlayer() async throws {
        let model = await model(try await transport())

        let opening = try XCTUnwrap(model.openings.first { $0.id == Self.collins })
        XCTAssertEqual(opening.availability, .mine)
        XCTAssertEqual(opening.severity, .out)
        let hutchinson = try XCTUnwrap(opening.beneficiaries.first { $0.sleeperID == Self.hutchinson })
        XCTAssertEqual(hutchinson.depthBehind, 1)
        XCTAssertEqual(hutchinson.availability, .freeAgent)
        XCTAssertEqual(try XCTUnwrap(hutchinson.lastSnapShare), 0.81, accuracy: 0.001)
        XCTAssertNotNil(hutchinson.lastExpectedPoints)

        // The rival's questionable starter is an opening too, listed after mine.
        let nacua = try XCTUnwrap(model.openings.first { $0.id == Self.nacua })
        XCTAssertEqual(nacua.severity, .questionableNoPractice)
        XCTAssertLessThan(
            try XCTUnwrap(model.openings.firstIndex { $0.id == Self.collins }),
            try XCTUnwrap(model.openings.firstIndex { $0.id == Self.nacua })
        )
    }

    func testRivalInjuriesFlagYourSurplus() async throws {
        let model = await model(try await transport())
        let nacua = try XCTUnwrap(model.rivalInjuries.first { $0.id == Self.nacua })
        XCTAssertEqual(nacua.manager, "rival")
        XCTAssertTrue(nacua.youHaveSurplus, "three receivers for two WR slots is a spare")
        XCTAssertTrue(nacua.headline.hasPrefix("Questionable"))
    }

    /// The Replacement Finder on the season basis: a free agent with a real
    /// stat line ranks, the injured player himself never appears, and the
    /// lineup gain is computed against the lineup without him.
    func testReplacementCandidatesAreRankedAndExcludeTheInjuredPlayer() async throws {
        let model = await model(try await transport())
        model.basis = .sleeperPointsPerGame
        let collins = try XCTUnwrap(model.roster.first { $0.id == Self.collins })

        let candidates = model.candidates(for: collins)
        XCTAssertFalse(candidates.isEmpty)
        XCTAssertFalse(candidates.contains { $0.id == Self.collins })
        XCTAssertFalse(candidates.contains { $0.id == "retired" })
        XCTAssertTrue(candidates.allSatisfy { $0.position == .wr })
        XCTAssertEqual(candidates.map { $0.value ?? 0 }, candidates.map { $0.value ?? 0 }.sorted(by: >))

        let jsn = try XCTUnwrap(candidates.first { $0.id == Self.smithNjigba })
        XCTAssertEqual(jsn.availability, .freeAgent)
        XCTAssertEqual(try XCTUnwrap(jsn.value), 33.5, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(jsn.lineupGain), 33.5, accuracy: 0.1,
                       "nobody else on the roster has a valued line, so he is the whole gain")
    }

    /// No projections were scripted, so the projected basis values nobody —
    /// and says so with an empty list rather than a list of zeroes.
    func testAnUnavailableBasisYieldsNoCandidatesRatherThanZeroes() async throws {
        let model = await model(try await transport())
        model.basis = .projected
        let collins = try XCTUnwrap(model.roster.first { $0.id == Self.collins })
        XCTAssertTrue(model.candidates(for: collins).isEmpty)
        XCTAssertTrue(model.sourceNotes.contains { $0.contains("Unavailable") && $0.contains("projections") })
    }

    /// My Team's alert now carries the report detail, not just the tag.
    func testDashboardAlertCarriesPracticeDetail() async throws {
        let transport = try await transport()
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let dashboard = DashboardModel(loader: loader, sleeper: harness.sleeper, relay: nil)
        await dashboard.load(leagueID: "L1", userRosterID: 1)
        let alert = try XCTUnwrap(dashboard.alerts.first { $0.playerID == Self.collins })
        XCTAssertEqual(alert.detail, "Out · Hamstring · Did not practice")
    }
}
