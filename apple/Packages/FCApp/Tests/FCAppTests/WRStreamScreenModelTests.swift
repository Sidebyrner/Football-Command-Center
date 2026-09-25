import XCTest
import FCCore
import FCData
@testable import FCApp

/// WR Stream against the recorded week-2 2026 Sleeper stat lines (receivers
/// and quarterbacks) and the 2026 schedule's week-3 lines, under the real
/// Whack-A-Mole receiving scoring.
@MainActor
final class WRStreamScreenModelTests: XCTestCase {
    private var cacheDirectory: URL!
    private var storeDirectory: URL!

    override func setUp() {
        super.setUp()
        storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("wr-store-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        if let storeDirectory { try? FileManager.default.removeItem(at: storeDirectory) }
        super.tearDown()
    }

    // From stats-2026-w2.json.
    private static let boston = "13346"   // CLE, 7 tgt, 55-yd TD (40+ catch, 50+ TD)
    private static let tucker = "10213"   // LV, mine, starting
    private static let olave = "8144"     // NO, mine, starting
    private static let smithNjigba = "9488" // SEA, the rival's
    private static let london = "8112"    // ATL, a carry; ATL has no QB line
    private static let white = "7039"     // LV, 2 tgt, 7 of 63 snaps

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","WR","WR","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,"rush_fd":1,
               "rush_td":6,"rec_30_39":1,"rec_40p":2,"rec_td_40p":4,"rec_td_50p":8,"bonus_rec_yd_200":5,
               "rec_2pt":2,"fum":-3,"fum_lost":-5},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["qb1","\(Self.tucker)","\(Self.olave)"],
              "starters":["qb1","\(Self.tucker)","\(Self.olave)"],"settings":{"waiver_budget_used":20}},
             {"roster_id":2,"owner_id":"u2","players":["qb2","\(Self.smithNjigba)"],"starters":["qb2","\(Self.smithNjigba)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "\(Self.boston)":{"full_name":"Denzel Boston","position":"WR","team":"CLE","active":true},
             "\(Self.tucker)":{"full_name":"Tre Tucker","position":"WR","team":"LV","active":true},
             "\(Self.olave)":{"full_name":"Chris Olave","position":"WR","team":"NO","active":true},
             "\(Self.smithNjigba)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "\(Self.london)":{"full_name":"Drake London","position":"WR","team":"ATL","active":true},
             "\(Self.white)":{"full_name":"Cody White","position":"WR","team":"LV","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> WRStreamScreenModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = WRStreamScreenModel(loader: loader, store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    private func candidate(_ model: WRStreamScreenModel, _ id: String) -> WRCandidate? {
        model.candidates.first { $0.id == id }
    }

    func testScoresInTheLeaguesOwnReceivingScoring() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.leagueStartsKind)
        XCTAssertEqual(model.scoring.firstDown, 1)
        XCTAssertEqual(model.scoring.bonus30 + model.scoring.bonus40, 2)
        XCTAssertEqual(model.scoring.touchdownBonus50, 8)
        XCTAssertEqual(model.unmodelledScoringKeys, ["bonus_rec_yd_200", "rec_2pt"])
    }

    func testCandidatesAreBuiltFromSleeperLines() async throws {
        let model = await model(try await transport())
        let boston = try XCTUnwrap(candidate(model, Self.boston))
        XCTAssertEqual(boston.team, "CLE")
        XCTAssertEqual(boston.opponent, "vs CAR")
        XCTAssertEqual(boston.spreadOff, 2.5, "CLE is a 2.5-point home underdog")
        XCTAssertEqual(boston.teamPassAttempts, 30, "from the CLE quarterback's line")
        XCTAssertEqual(boston.teamGames, 1)
        XCTAssertEqual(boston.statTargets, 7)
        XCTAssertEqual(try XCTUnwrap(boston.targetShareLast1), 7.0 / 18.0, accuracy: 1e-9, "7 of the 18 CLE targets recorded")
        XCTAssertEqual(boston.firstDowns, 2)
        XCTAssertEqual(try XCTUnwrap(boston.adot), 45.0 / 7.0, accuracy: 1e-9)
        XCTAssertEqual(boston.catches30, 1)
        XCTAssertEqual(boston.catches40, 1)
        XCTAssertEqual(boston.catches50, 1, "his longest catch went 55")
        XCTAssertTrue(boston.dataFlags.contains("50+ catches counted from longest catch only"))
        XCTAssertEqual(boston.available, true)

        let p = try XCTUnwrap(model.projection(for: Self.boston))
        XCTAssertGreaterThan(p.eTouchdowns50, 0)
        XCTAssertGreaterThan(p.expPts, 0)
    }

    func testRushingUsageMakesAGadgetAndMissingQBLinesAreFlagged() async throws {
        let model = await model(try await transport())
        let london = try XCTUnwrap(candidate(model, Self.london))
        XCTAssertEqual(london.role, .gadget)
        XCTAssertEqual(london.rushAttemptsPerGame, 1)
        XCTAssertTrue(london.dataFlags.contains("team pass attempts estimated from targets"))
    }

    func testDefaultStarterIsTheWeakerOfMyStartingReceivers() async throws {
        let model = await model(try await transport())
        let incumbent = try XCTUnwrap(model.report?.incumbent)
        XCTAssertTrue([Self.tucker, Self.olave].contains(incumbent.id))
        let other = try XCTUnwrap(model.projection(for: incumbent.id == Self.tucker ? Self.olave : Self.tucker))
        XCTAssertLessThanOrEqual(incumbent.expPts, other.expPts)
        XCTAssertNotNil(model.report?.ranked.first?.pBeatIncumbent)
    }

    func testAnyReceiverCanBeComparedOrBeatenAndSearchForgives() async throws {
        let model = await model(try await transport())
        XCTAssertFalse(model.rows.contains { $0.id == Self.smithNjigba }, "the rival's receiver is hidden by default")
        XCTAssertEqual(model.searchPlayers("jaxon smith njigba").first?.id, Self.smithNjigba)
        XCTAssertEqual(model.searchPlayers("bostn browns").first?.id, Self.boston)

        await model.setIncumbent(Self.smithNjigba)
        XCTAssertEqual(model.report?.incumbent?.id, Self.smithNjigba)
        XCTAssertEqual(model.incumbentOwnerLabel, "rival's starter")

        model.toggleCompare(Self.boston)
        model.toggleCompare(Self.tucker)
        let comparison = try XCTUnwrap(model.comparison)
        XCTAssertEqual(comparison.players.map(\.id), [Self.boston, Self.tucker])
        XCTAssertNotNil(comparison.verdict)
    }

    func testRecentGamesAreScoredInTheLeaguesSettings() async throws {
        let model = await model(try await transport())
        let game = try XCTUnwrap(model.recentGames(Self.boston).first)
        XCTAssertEqual(game.week, 2)
        XCTAssertEqual(game.targets, 7)
        XCTAssertEqual(game.longCatches, 1)
        // 95 yds + 2 first downs + a TD, plus 40+ catch (2), 40+ TD (4) and 50+ TD (8).
        XCTAssertEqual(game.points, 9.5 + 2 + 6 + 2 + 4 + 8, accuracy: 0.01)
    }

    func testSnapshotsAreSavedForTheReceiverStream() async throws {
        let model = await model(try await transport())
        XCTAssertEqual(model.snapshots.count, 1)
        let loaded = await model.loadSnapshot(id: try XCTUnwrap(model.snapshots.first?.id))
        let snapshot = try XCTUnwrap(loaded)
        XCTAssertEqual(snapshot.report, model.report)
        XCTAssertTrue(snapshot.candidates.contains { $0.id == Self.boston })
    }
}

final class WRRoleInferenceTests: XCTestCase {
    func testUsageMapsToRoles() {
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.10, adot: 8, rushPerGame: 1.5), .gadget)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.15, adot: 3, rushPerGame: 0), .gadget)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.12, adot: 16, rushPerGame: 0), .deep)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.28, adot: 16, rushPerGame: 0), .alpha)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.18, adot: 7, rushPerGame: 0), .slot)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: 0.18, adot: 11, rushPerGame: 0), .boundary)
        XCTAssertEqual(WRCandidateBuilder.inferRole(targetShare: nil, adot: nil, rushPerGame: 0), .boundary)
    }
}

final class WRContextTests: XCTestCase {
    func testImportAcceptsEitherSpreadKeyAndNestedDvP() throws {
        let file = """
            {"teams":{"CLE":{"spreadOff":2.5,"total":42.5,"dvpPct":{"WR":-15},"dvpGames":2,"coverageAdj":0.9},
                      "LAR":{"spreadDef":-2.5,"dvpPct":12}},
             "players":{"_comment":"x","13346":{"role":"DEEP","rzShare":0.3}}}
            """
        let overrides = try WRContextImport.parse(Data(file.utf8))
        XCTAssertEqual(overrides.teams["CLE"]?.dvpPct, -15)
        XCTAssertEqual(overrides.teams["CLE"]?.coverageAdj, 0.9)
        XCTAssertEqual(overrides.teams["LA"]?.spreadOff, -2.5, "LAR lands on LA")
        XCTAssertEqual(overrides.teams["LA"]?.dvpPct, 12)
        XCTAssertEqual(overrides.players["13346"]?.role, .deep)
        XCTAssertEqual(overrides.players["13346"]?.redZoneShare, 0.3)
    }

    func testMatchupUsesPointsAllowedToReceiversOverTheSampleFloor() throws {
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Data("""
            {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}
            """.utf8))
        let facing = [
            DefenseFacing(week: 1, position: .wr, defense: "DEN", points: 45),
            DefenseFacing(week: 1, position: .wr, defense: "LAR", points: 15),
        ]
        let table = DefenseVsPosition.compute(facing: facing, positions: [.wr], minimumGames: 1)
        let teams = WRContextAutofill.build(schedule: schedule, week: 3, defense: table)
        // The Rams' receivers face DEN, which allowed 45 against a 30 average.
        XCTAssertEqual(try XCTUnwrap(teams["LA"]?.dvpPct), 50, accuracy: 1e-9)
        XCTAssertEqual(teams["LA"]?.dvpSource, .sleeperDvP)
        XCTAssertEqual(teams["LA"]?.spreadOff, 2.5, "away underdog by 2.5")
        XCTAssertEqual(teams["DEN"]?.coverageAdj, 1)
    }
}
