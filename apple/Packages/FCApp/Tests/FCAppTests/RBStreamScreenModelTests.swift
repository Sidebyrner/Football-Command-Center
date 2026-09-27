import XCTest
import FCCore
import FCData
@testable import FCApp

/// RB Stream against the recorded week-2 2026 Sleeper stat lines and the
/// 2026 schedule's week-3 lines, under the real Whack-A-Mole rushing scoring.
@MainActor
final class RBStreamScreenModelTests: XCTestCase {
    private var cacheDirectory: URL!
    private var storeDirectory: URL!

    override func setUp() {
        super.setUp()
        storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("rb-store-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        if let storeDirectory { try? FileManager.default.removeItem(at: storeDirectory) }
        super.tearDown()
    }

    // From stats-2026-w2.json.
    private static let cook = "8138"       // BUF, 21 of the 35 BUF carries, a 35-yd run, 4 of 7 RZ carries
    private static let hampton = "12507"   // LAC, lost a fumble
    private static let henderson = "12529" // NE, a 39-yd run
    private static let taylor = "6813"     // IND, mine, starting
    private static let henry = "3198"      // BAL, mine, starting
    private static let gibbs = "9221"      // DET, the rival's

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","RB","RB","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,"rush_fd":1,
               "rush_td":6,"rush_40p":2,"rush_td_40p":4,"rush_td_50p":8,"rec_30_39":1,"rec_40p":2,
               "bonus_rush_yd_200":5,"rush_2pt":2,"fum":-3,"fum_lost":-5},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["qb1","\(Self.taylor)","\(Self.henry)"],
              "starters":["qb1","\(Self.taylor)","\(Self.henry)"],"settings":{"waiver_budget_used":20}},
             {"roster_id":2,"owner_id":"u2","players":["qb2","\(Self.gibbs)"],"starters":["qb2","\(Self.gibbs)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "\(Self.cook)":{"full_name":"James Cook","position":"RB","team":"BUF","active":true},
             "\(Self.hampton)":{"full_name":"Omarion Hampton","position":"RB","team":"LAC","active":true},
             "\(Self.henderson)":{"full_name":"TreVeyon Henderson","position":"RB","team":"NE","active":true},
             "\(Self.taylor)":{"full_name":"Jonathan Taylor","position":"RB","team":"IND","active":true},
             "\(Self.henry)":{"full_name":"Derrick Henry","position":"RB","team":"BAL","active":true},
             "\(Self.gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> RBStreamScreenModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = RBStreamScreenModel(loader: loader, store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    private func candidate(_ model: RBStreamScreenModel, _ id: String) -> RBCandidate? {
        model.candidates.first { $0.id == id }
    }

    func testScoresInTheLeaguesOwnRushingScoring() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.leagueStartsKind)
        XCTAssertEqual(model.scoring.runBonus30, 0)
        XCTAssertEqual(model.scoring.runBonus40, 2)
        XCTAssertEqual(model.scoring.fumble + model.scoring.fumbleLost, -8)
        XCTAssertEqual(model.unmodelledScoringKeys, ["bonus_rush_yd_200", "rush_2pt"])
    }

    func testCandidatesAreBuiltFromSleeperLines() async throws {
        let model = await model(try await transport())
        let cook = try XCTUnwrap(candidate(model, Self.cook))
        XCTAssertEqual(cook.opponent, "vs LAC")
        XCTAssertEqual(cook.spreadOff, -7, "BUF is a 7-point home favorite")
        XCTAssertEqual(cook.total, 50.5)
        XCTAssertEqual(cook.teamRushAttempts, 35, "every BUF carry recorded")
        XCTAssertEqual(cook.teamPassAttempts, 31, "from the BUF quarterback's line")
        XCTAssertEqual(try XCTUnwrap(cook.carryShareLast1), 21.0 / 35.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(cook.targetShareLast1), 3.0 / 11.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(cook.redZoneShare), 4.0 / 7.0, accuracy: 1e-9)
        XCTAssertEqual(cook.rushFirstDowns, 6)
        XCTAssertEqual(cook.runs30, 1, "his longest run went 35")
        XCTAssertEqual(cook.runs40, 0)
        XCTAssertEqual(cook.role, .bellcow)
        XCTAssertTrue(cook.dataFlags.contains("long runs counted from longest run only"))

        let p = try XCTUnwrap(model.projection(for: Self.cook))
        XCTAssertEqual(p.implied, (50.5 + 7) / 2, accuracy: 1e-9)
        XCTAssertGreaterThan(p.impliedMult, 1, "a 28.75-point implied total lifts TDs")
        XCTAssertEqual(try XCTUnwrap(candidate(model, Self.henderson)).runs30, 1)
        XCTAssertEqual(try XCTUnwrap(candidate(model, Self.henderson)).runs40, 0, "39 yards is not 40+")
    }

    func testDefaultStarterIsTheWeakerOfMyStartingBacks() async throws {
        let model = await model(try await transport())
        let incumbent = try XCTUnwrap(model.report?.incumbent)
        XCTAssertTrue([Self.taylor, Self.henry].contains(incumbent.id))
        let other = try XCTUnwrap(model.projection(for: incumbent.id == Self.taylor ? Self.henry : Self.taylor))
        XCTAssertLessThanOrEqual(incumbent.expPts, other.expPts)
    }

    func testAnyBackCanBeComparedOrBeatenAndSearchForgives() async throws {
        let model = await model(try await transport())
        XCTAssertFalse(model.rows.contains { $0.id == Self.gibbs })
        XCTAssertEqual(model.searchPlayers("jahmyr gibs").first?.id, Self.gibbs)
        XCTAssertEqual(model.searchPlayers("cook bills").first?.id, Self.cook)
        await model.setIncumbent(Self.gibbs)
        XCTAssertEqual(model.report?.incumbent?.id, Self.gibbs)
        model.toggleCompare(Self.cook)
        model.toggleCompare(Self.hampton)
        XCTAssertEqual(model.comparison?.players.map(\.id), [Self.cook, Self.hampton])
    }

    func testALostFumbleCostsEightInRecentGames() async throws {
        let model = await model(try await transport())
        let game = try XCTUnwrap(model.recentGames(Self.hampton).first)
        XCTAssertEqual(game.fumblesLost, 1)
        XCTAssertEqual(game.carries, 23)
        // 94 rush yds, 5 rush + 1 rec first downs, a TD, 21 rec yds, then −3 fumble and −5 lost.
        XCTAssertEqual(game.points, 9.4 + 6 + 6 + 2.1 - 8, accuracy: 0.01)
    }

    func testSnapshotsAreSavedForTheBackStream() async throws {
        let model = await model(try await transport())
        XCTAssertEqual(model.snapshots.count, 1)
        let loaded = await model.loadSnapshot(id: try XCTUnwrap(model.snapshots.first?.id))
        XCTAssertEqual(try XCTUnwrap(loaded).report, model.report)
    }
}

final class RBRoleAndContextTests: XCTestCase {
    func testUsageMapsToRoles() {
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: 0.65, targetShare: 0.1, redZoneShare: 0.7), .bellcow)
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: 0.50, targetShare: 0.05, redZoneShare: nil), .lead)
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: 0.20, targetShare: 0.12, redZoneShare: nil), .passDown)
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: 0.25, targetShare: 0.03, redZoneShare: 0.5), .goalLine)
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: 0.38, targetShare: 0.06, redZoneShare: 0.3), .committee)
        XCTAssertEqual(RBCandidateBuilder.inferRole(carryShare: nil, targetShare: nil, redZoneShare: nil), .committee)
    }

    /// The zip's shared week-context file nests DvP per position and names the
    /// line adjustment `rbLineAdj`.
    func testImportReadsTheSharedContextFile() throws {
        let file = """
            {"_comment":"x","season":2026,"week":3,"teams":{
              "GB":{"opp":"vs ATL (TNF)","home":true,"spreadDef":-6.5,"total":45.5,
                    "dvpPct":{"LB":89.7,"WR":-9.8,"RB":-36.7},"dvpGames":2,"oppSackEnv":1.0,"wrCoverageAdj":1.1,"rbLineAdj":0.9},
              "LAR":{"spreadOff":-2.5,"total":46.5}},
             "players":{}}
            """
        let rb = try RBContextImport.parse(Data(file.utf8))
        XCTAssertEqual(rb.teams["GB"]?.spreadOff, -6.5)
        XCTAssertEqual(rb.teams["GB"]?.dvpPct, -36.7)
        XCTAssertEqual(rb.teams["GB"]?.lineAdj, 0.9)
        XCTAssertEqual(rb.teams["LA"]?.total, 46.5, "LAR lands on LA")
        // The same file feeds WR Stream.
        let wr = try WRContextImport.parse(Data(file.utf8))
        XCTAssertEqual(wr.teams["GB"]?.dvpPct, -9.8)
        XCTAssertEqual(wr.teams["GB"]?.coverageAdj, 1.1)
    }

    func testMatchupUsesPointsAllowedToBacks() throws {
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Data("""
            {"byWeek":{"3":[{"home":"BUF","away":"LAC","spreadLine":7,"totalLine":50.5}]}}
            """.utf8))
        let facing = [
            DefenseFacing(week: 1, position: .rb, defense: "LAC", points: 30),
            DefenseFacing(week: 1, position: .rb, defense: "BUF", points: 10),
        ]
        let table = DefenseVsPosition.compute(facing: facing, positions: [.rb], minimumGames: 1)
        let teams = RBContextAutofill.build(schedule: schedule, week: 3, defense: table)
        XCTAssertEqual(try XCTUnwrap(teams["BUF"]?.dvpPct), 50, accuracy: 1e-9)
        XCTAssertEqual(teams["BUF"]?.spreadOff, -7)
        XCTAssertEqual(try XCTUnwrap(teams["BUF"]).implied, 28.75, accuracy: 1e-9)
        XCTAssertEqual(teams["LAC"]?.spreadOff, 7)
    }
}
