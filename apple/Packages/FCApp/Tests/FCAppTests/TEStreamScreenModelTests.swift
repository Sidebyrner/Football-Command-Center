import XCTest
import FCCore
import FCData
@testable import FCApp

/// TE Stream against the recorded week-2 2026 Sleeper stat lines and the 2026
/// schedule's week-3 lines, under the Whack-A-Mole receiving scoring plus a
/// TE premium.
///
/// The stat fixture is a sample of each team's lines, so team target totals
/// (and so target shares) run high; these tests check plumbing, not shares.
@MainActor
final class TEStreamScreenModelTests: XCTestCase {
    private var cacheDirectory: URL!
    private var storeDirectory: URL!

    override func setUp() {
        super.setUp()
        storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("te-store-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        if let storeDirectory { try? FileManager.default.removeItem(at: storeDirectory) }
        super.tearDown()
    }

    // From stats-2026-w2.json.
    private static let kelce = "1466"      // KC, mine, starting: 11 tgt, 6 first downs, a TD, 68 of 80 snaps
    private static let schultz = "5001"    // HOU, free agent: 14 tgt; HOU has no QB line
    private static let kincaid = "10236"   // BUF, the rival's
    private static let adkins = "11433"    // DEN, free agent: 23 of 62 snaps

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","TE","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.04,"rec":0,"rec_yd":0.1,"rec_fd":1,"rec_td":6,"rush_yd":0.1,
               "rec_30_39":1,"rec_40p":2,"rec_td_40p":4,"rec_td_50p":8,"bonus_rec_yd_200":5,
               "bonus_rec_te":0.5,"rec_2pt":2,"fum":-3,"fum_lost":-5},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["qb1","\(Self.kelce)"],
              "starters":["qb1","\(Self.kelce)"],"settings":{"waiver_budget_used":20}},
             {"roster_id":2,"owner_id":"u2","players":["qb2","\(Self.kincaid)"],"starters":["qb2","\(Self.kincaid)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "\(Self.kelce)":{"full_name":"Travis Kelce","position":"TE","team":"KC","active":true},
             "\(Self.schultz)":{"full_name":"Dalton Schultz","position":"TE","team":"HOU","active":true},
             "\(Self.kincaid)":{"full_name":"Dalton Kincaid","position":"TE","team":"BUF","active":true},
             "\(Self.adkins)":{"full_name":"Nate Adkins","position":"TE","team":"DEN","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> TEStreamScreenModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = TEStreamScreenModel(loader: loader, store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    private func candidate(_ model: TEStreamScreenModel, _ id: String) -> TECandidate? {
        model.candidates.first { $0.id == id }
    }

    func testScoresInTheLeaguesOwnScoringWithTEPremium() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.leagueStartsKind)
        XCTAssertEqual(model.scoring.firstDown, 1)
        XCTAssertEqual(model.scoring.premiumReception, 0.5)
        XCTAssertEqual(model.scoring.bonus30 + model.scoring.bonus40, 2)
        XCTAssertEqual(model.unmodelledScoringKeys, ["bonus_rec_yd_200", "rec_2pt"])

        let kelce = try XCTUnwrap(model.projection(for: Self.kelce))
        let premium = try XCTUnwrap(kelce.pointsBreakdown(scoring: model.scoring).first { $0.stat == "TE premium" })
        XCTAssertEqual(premium.points, 0.5 * kelce.eRec, accuracy: 1e-9)
    }

    func testCandidatesAreBuiltFromSleeperLines() async throws {
        let model = await model(try await transport())
        let kelce = try XCTUnwrap(candidate(model, Self.kelce))
        XCTAssertEqual(kelce.team, "KC")
        XCTAssertEqual(kelce.opponent, "@MIA")
        XCTAssertEqual(kelce.spreadOff, -11.5, "KC is an 11.5-point road favourite")
        XCTAssertEqual(kelce.teamPassAttempts, 47, "from the KC quarterback's line")
        XCTAssertEqual(kelce.statTargets, 11)
        XCTAssertEqual(kelce.firstDowns, 6)
        XCTAssertEqual(kelce.touchdowns, 1)
        XCTAssertEqual(try XCTUnwrap(kelce.snapShare), 68.0 / 80.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(kelce.redZoneShare), 1.0 / 3.0, accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(kelce.adot), 35.0 / 11.0, accuracy: 1e-9)
        XCTAssertEqual(kelce.role, .featured)
        XCTAssertEqual(kelce.available, false, "on my roster")
        XCTAssertTrue(kelce.dataFlags.contains("routes estimated from snap share by role"))

        let p = try XCTUnwrap(model.projection(for: Self.kelce))
        XCTAssertEqual(try XCTUnwrap(p.estRouteShare), 68.0 / 80.0 * 0.85, accuracy: 1e-9)
        XCTAssertGreaterThan(p.expPts, 0)

        let schultz = try XCTUnwrap(candidate(model, Self.schultz))
        XCTAssertEqual(schultz.available, true)
        XCTAssertTrue(schultz.dataFlags.contains("team pass attempts estimated from targets"))
    }

    func testOnlyTightEndsAreCandidates() async throws {
        let model = await model(try await transport())
        XCTAssertFalse(model.candidates.isEmpty)
        let ids = Set(model.candidates.map(\.id))
        XCTAssertTrue(ids.isSuperset(of: [Self.kelce, Self.schultz, Self.adkins]))
        XCTAssertFalse(ids.contains("qb1"))
    }

    func testDefaultStarterIsMyStartingTightEnd() async throws {
        let model = await model(try await transport())
        XCTAssertEqual(model.report?.incumbent?.id, Self.kelce)
        XCTAssertFalse(model.rows.contains { $0.id == Self.kincaid }, "the rival's TE is hidden by default")
        let best = try XCTUnwrap(model.report?.ranked.first { $0.id == Self.schultz })
        XCTAssertNotNil(best.pBeatIncumbent)
        XCTAssertNotNil(best.bidBand)
    }

    func testPlayerOverridesReachTheEngine() async throws {
        let model = await model(try await transport())
        await model.setPlayerOverride(TEPlayerOverride(role: .rotational, vacatedTargetBoost: 0.05), playerID: Self.kelce)
        let kelce = try XCTUnwrap(candidate(model, Self.kelce))
        XCTAssertEqual(kelce.role, .rotational)
        XCTAssertEqual(kelce.vacatedTargetBoost, 0.05)
        let p = try XCTUnwrap(model.projection(for: Self.kelce))
        XCTAssertEqual(try XCTUnwrap(p.estRouteShare), 68.0 / 80.0 * 0.55, accuracy: 1e-9, "an inline role blocks more")
        XCTAssertEqual(p.vacatedTargetBoost, 0.05)
    }

    func testCompareGivesAVerdict() async throws {
        let model = await model(try await transport())
        model.toggleCompare(Self.schultz)
        model.toggleCompare(Self.kelce)
        let comparison = try XCTUnwrap(model.comparison)
        XCTAssertEqual(comparison.players.map(\.id), [Self.schultz, Self.kelce])
        XCTAssertNotNil(comparison.verdict)
    }

    func testRecentGamesCarryRedZoneAndSnaps() async throws {
        let model = await model(try await transport())
        let game = try XCTUnwrap(model.recentGames(Self.kelce).first)
        XCTAssertEqual(game.week, 2)
        XCTAssertEqual(game.targets, 11)
        XCTAssertEqual(game.redZoneTargets, 1)
        XCTAssertEqual(try XCTUnwrap(game.snapShare), 68.0 / 80.0, accuracy: 1e-9)
    }
}

final class TEContextTests: XCTestCase {
    func testImportReadsTEKeys() throws {
        let file = """
            {"teams":{"MIA":{"spreadOff":11.5,"dvpPct":{"TE":20},"dvpGames":2,"seamCoverageAdj":1.15},
                      "LAR":{"spreadDef":-2.5,"teCoverageAdj":0.9}},
             "players":{"_comment":"x","1466":{"role":"SEAM","vacatedTargetBoost":0.04}}}
            """
        let overrides = try TEContextImport.parse(Data(file.utf8))
        XCTAssertEqual(overrides.teams["MIA"]?.dvpPct, 20)
        XCTAssertEqual(overrides.teams["MIA"]?.seamCoverageAdj, 1.15)
        XCTAssertEqual(overrides.teams["LA"]?.seamCoverageAdj, 0.9)
        XCTAssertEqual(overrides.players["1466"]?.role, .seam)
        XCTAssertEqual(overrides.players["1466"]?.vacatedTargetBoost, 0.04)
    }

    func testMatchupUsesPointsAllowedToTightEnds() throws {
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Data("""
            {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}
            """.utf8))
        let facing = [
            DefenseFacing(week: 1, position: .te, defense: "DEN", points: 15),
            DefenseFacing(week: 1, position: .te, defense: "LAR", points: 5),
            DefenseFacing(week: 1, position: .wr, defense: "DEN", points: 5),
            DefenseFacing(week: 1, position: .wr, defense: "LAR", points: 45),
        ]
        let table = DefenseVsPosition.compute(facing: facing, positions: [.wr, .te], minimumGames: 1)
        let teams = TEContextAutofill.build(schedule: schedule, week: 3, defense: table)
        // The Rams' tight ends face DEN, which allowed 15 against a 10 TE average.
        XCTAssertEqual(try XCTUnwrap(teams["LA"]?.dvpPct), 50, accuracy: 1e-9)
        XCTAssertEqual(teams["DEN"]?.seamCoverageAdj, 1)
    }
}
