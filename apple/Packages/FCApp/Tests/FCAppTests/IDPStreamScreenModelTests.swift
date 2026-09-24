import XCTest
import FCCore
import FCData
@testable import FCApp

/// IDP Stream against the recorded week-2 2026 Sleeper stat lines and the
/// 2026 schedule's week-3 lines, in a league with two IDP_FLEX slots and the
/// real Whack-A-Mole IDP scoring.
@MainActor
final class IDPStreamScreenModelTests: XCTestCase {
    private var cacheDirectory: URL!
    private var storeDirectory: URL!

    override func setUp() {
        super.setUp()
        storeDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("idp-store-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        if let storeDirectory { try? FileManager.default.removeItem(at: storeDirectory) }
        super.tearDown()
    }

    // From stats-2026-w2.json.
    private static let bolton = "7648"   // KC LB, 65/65 snaps, 6 solo 7 ast
    private static let carter = "12574"  // NYG DE, 55/62, a sack and a QB hit
    private static let curl = "7136"     // LAR SS, on the rival's roster
    private static let nubin = "11674"   // NYG DB with no listed alignment
    private static let newsome = "7630"  // NYG CB
    private static let edmunds = "4968"  // NYG LB, mine, starting
    private static let downs = "13376"   // DAL FS, mine, starting
    private static let landman = "8659"  // LAR LB, 49/58
    private static let johnson = "11021" // LAR DT, 10/58 — under the snap floor

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","IDP_FLEX","IDP_FLEX","BN","BN","BN"],
             "scoring_settings":{"pass_yd":0.04,"idp_tkl":0,"idp_tkl_solo":2,"idp_tkl_ast":1,"idp_sack":5,
               "idp_tkl_loss":2,"idp_int":5,"idp_ff":3,"idp_fum_rec":5,"idp_def_td":10,"idp_qb_hit":0.5,"idp_pass_def":0},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["qb1","\(Self.edmunds)","\(Self.downs)"],
              "starters":["qb1","\(Self.edmunds)","\(Self.downs)"],"settings":{"waiver_budget_used":20}},
             {"roster_id":2,"owner_id":"u2","players":["qb2","\(Self.curl)"],"starters":["qb2","\(Self.curl)"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "\(Self.bolton)":{"full_name":"Nick Bolton","position":"LB","team":"KC","active":true},
             "\(Self.carter)":{"full_name":"Abdul Carter","position":"DE","team":"NYG","active":true},
             "\(Self.curl)":{"full_name":"Kam Curl","position":"DB","depth_chart_position":"SS","team":"LAR","active":true},
             "\(Self.nubin)":{"full_name":"Tyler Nubin","position":"DB","team":"NYG","active":true},
             "\(Self.newsome)":{"full_name":"Greg Newsome","position":"CB","team":"NYG","active":true},
             "\(Self.edmunds)":{"full_name":"Tremaine Edmunds","position":"LB","team":"NYG","active":true},
             "\(Self.downs)":{"full_name":"Caleb Downs","position":"DB","depth_chart_position":"FS","team":"DAL","active":true},
             "\(Self.landman)":{"full_name":"Nate Landman","position":"LB","team":"LAR","active":true,"injury_status":"Questionable"},
             "\(Self.johnson)":{"full_name":"Desjuan Johnson","position":"DT","team":"LAR","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> IDPStreamScreenModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = IDPStreamScreenModel(loader: loader, store: IDPStreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    private func row(_ model: IDPStreamScreenModel, _ id: String) -> IDPProjection? {
        (model.report?.ranked ?? []).first { $0.id == id } ?? (model.report?.incumbent?.id == id ? model.report?.incumbent : nil)
    }

    func testScoresInTheLeaguesOwnIDPScoring() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.leagueHasIDP)
        XCTAssertEqual(model.scoring.solo, 2)
        XCTAssertEqual(model.scoring.ast, 1)
        XCTAssertEqual(model.scoring.qbHit, 0.5)
        XCTAssertEqual(model.unmodelledScoringKeys, ["idp_def_td", "idp_fum_rec"])
    }

    func testFreeAgentDefendersAreProjectedWithScheduleLines() async throws {
        let model = await model(try await transport())
        let bolton = try XCTUnwrap(row(model, Self.bolton))
        XCTAssertEqual(bolton.available, true)
        XCTAssertEqual(bolton.position, .lb)
        XCTAssertEqual(bolton.opponent, "@MIA")
        XCTAssertEqual(bolton.snapShare, 1, accuracy: 0.01)
        XCTAssertGreaterThan(bolton.expPts, 0)
        XCTAssertNotNil(bolton.pBeatIncumbent)
        XCTAssertEqual(model.bidLabel(bolton).map { $0.hasPrefix("$") }, true, "FAAB league shows dollars")

        // KC is an 11.5-point road favorite: negative from the defense's side.
        let kc = try XCTUnwrap(model.teams["KC"])
        XCTAssertEqual(kc.spreadDef, -11.5)
        XCTAssertEqual(kc.total, 46.5)
        XCTAssertEqual(kc.linesSource, .schedule)
        XCTAssertEqual(try XCTUnwrap(model.teams["MIA"]).spreadDef, 11.5)
    }

    func testDefendersListedByFootballPositionAreInThePool() async throws {
        let model = await model(try await transport())
        // Sleeper lists him as DE, not DL — he used to have no position at all.
        let carter = try XCTUnwrap(row(model, Self.carter))
        XCTAssertEqual(carter.position, .edge)
        XCTAssertEqual(carter.platform, .dl)
        XCTAssertGreaterThan(carter.eQbHit, 0)
        XCTAssertEqual(try XCTUnwrap(row(model, Self.newsome)).position, .cb)
        let nubin = try XCTUnwrap(row(model, Self.nubin))
        XCTAssertEqual(nubin.position, .safetyBox)
        XCTAssertTrue(nubin.flags.contains { $0.contains("alignment not listed") })
    }

    func testRosteredDefendersAreHiddenUntilAskedAndRamsJoinAcrossDialects() async throws {
        let model = await model(try await transport())
        XCTAssertFalse(model.rows.contains { $0.id == Self.curl })
        model.onlyAvailable = false
        let curl = try XCTUnwrap(model.rows.first { $0.id == Self.curl })
        XCTAssertEqual(curl.available, false)
        XCTAssertEqual(curl.team, "LA", "LAR is normalised so the Rams find their game")
        XCTAssertEqual(curl.opponent, "@DEN")
        XCTAssertEqual(curl.position, .safetyBox)
        XCTAssertEqual(try XCTUnwrap(row(model, Self.landman)).practice, .Q)

        // One week of lines is under the defense table's sample floor, so no
        // matchup claim is made yet.
        let den = try XCTUnwrap(model.teams["DEN"])
        XCTAssertEqual(den.dvpSource, .standard)
        XCTAssertTrue(den.dvpPct.isEmpty)
        XCTAssertTrue(model.sourceNotes.contains { $0.contains("4 games") })
    }

    func testDefaultStarterIsTheWeakerOfMyIDPStarters() async throws {
        let model = await model(try await transport())
        let incumbent = try XCTUnwrap(model.report?.incumbent)
        XCTAssertTrue([Self.edmunds, Self.downs].contains(incumbent.id))
        XCTAssertTrue(model.incumbentIsDefault)
        let other = try XCTUnwrap(row(model, incumbent.id == Self.edmunds ? Self.downs : Self.edmunds))
        XCTAssertLessThanOrEqual(incumbent.expPts, other.expPts)
        XCTAssertFalse(model.report?.ranked.contains { $0.id == incumbent.id } ?? true)

        await model.setIncumbent(other.id)
        XCTAssertEqual(model.report?.incumbent?.id, other.id)
        XCTAssertFalse(model.incumbentIsDefault)
    }

    func testAnyDefenderCanBeTheStarterToBeat() async throws {
        let model = await model(try await transport())
        await model.setIncumbent(Self.curl)
        XCTAssertEqual(model.report?.incumbent?.id, Self.curl)
        XCTAssertEqual(model.incumbentOwnerLabel, "rival's starter")
        XCTAssertFalse(model.report?.ranked.contains { $0.id == Self.curl } ?? true)
        XCTAssertNotNil(model.report?.ranked.first?.pBeatIncumbent)

        // Someone below the snap floor is projected once chosen.
        XCTAssertNil(model.projection(for: Self.johnson), "rotational players are not streamed")
        await model.setIncumbent(Self.johnson)
        XCTAssertEqual(model.report?.incumbent?.id, Self.johnson)
        XCTAssertEqual(model.report?.incumbent?.position, .idl)
    }

    func testSearchFindsDefendersAcrossRosters() async throws {
        let model = await model(try await transport())
        let results = model.searchDefenders("johnson")
        XCTAssertEqual(results.map(\.id), [Self.johnson])
        XCTAssertNil(results.first?.projected)
        XCTAssertFalse(model.searchDefenders("starter").contains { $0.id == "qb1" }, "only defenders")
        let browse = model.searchDefenders("")
        XCTAssertFalse(browse.isEmpty)
        XCTAssertEqual(browse.compactMap(\.projected), browse.compactMap(\.projected).sorted(by: >))
    }

    func testSearchForgivesTyposWordOrderAndMatchesTeams() async throws {
        let model = await model(try await transport())
        XCTAssertEqual(model.searchDefenders("Desjaun Jonson").first?.id, Self.johnson, "a typo in each word")
        XCTAssertEqual(model.searchDefenders("bolten").first?.id, Self.bolton)
        XCTAssertEqual(model.searchDefenders("curl rams").map(\.id), [Self.curl], "team name counts, any order")
        XCTAssertEqual(model.searchDefenders("curl la").map(\.id), [Self.curl], "team code counts")
        XCTAssertTrue(model.searchDefenders("curl chiefs").isEmpty)
        // Every Giants defender, strongest projection first.
        let giants = model.searchDefenders("giants")
        XCTAssertTrue(giants.contains { $0.id == Self.carter })
        XCTAssertFalse(giants.contains { $0.id == Self.bolton })
    }

    func testRecentGamesAreScoredInTheLeaguesSettings() async throws {
        let model = await model(try await transport())
        let games = model.recentGames(Self.bolton)
        let week2 = try XCTUnwrap(games.first)
        XCTAssertEqual(games.count, 1, "only week 2 is recorded")
        XCTAssertEqual(week2.week, 2)
        XCTAssertEqual(week2.opponent, "IND")
        XCTAssertEqual(try XCTUnwrap(week2.snapShare), 1, accuracy: 0.001)
        XCTAssertEqual(week2.tackles, 13)
        // 6 solo × 2 + 7 assists × 1, plus whatever else he did that the league pays for.
        XCTAssertGreaterThanOrEqual(week2.points, 19)
        XCTAssertTrue(model.recentGames("nobody").isEmpty)
    }

    func testCompareKeepsOrderCapsAtFourAndProjectsAnyone() async throws {
        let model = await model(try await transport())
        model.toggleCompare(Self.bolton)
        model.toggleCompare(Self.johnson)   // under the snap floor: projected on add
        model.toggleCompare(Self.curl)
        XCTAssertEqual(model.compareIDs, [Self.bolton, Self.johnson, Self.curl])
        let comparison = try XCTUnwrap(model.comparison)
        XCTAssertEqual(comparison.players.map(\.id), [Self.bolton, Self.johnson, Self.curl])
        XCTAssertNil(comparison.headToHead[0][0])
        XCTAssertEqual((comparison.headToHead[0][1] ?? 0) + (comparison.headToHead[1][0] ?? 0), 1, accuracy: 1e-9)

        model.toggleCompare(Self.carter)
        model.toggleCompare(Self.nubin)
        XCTAssertEqual(model.compareIDs.count, IDPStreamScreenModel.compareLimit)
        XCTAssertFalse(model.compareIDs.contains(Self.nubin))
        XCTAssertFalse(model.canAddToCompare)

        model.toggleCompare(Self.johnson)
        XCTAssertEqual(model.compareIDs, [Self.bolton, Self.curl, Self.carter])
        XCTAssertNil(model.projection(for: Self.johnson), "forced inclusion ends with the comparison")
        model.clearCompare()
        XCTAssertNil(model.comparison)
    }

    func testTeamEditsApplyAndPersist() async throws {
        let transport = try await transport()
        let model = await model(transport)
        let before = try XCTUnwrap(row(model, Self.bolton)).expPts
        await model.setTeamOverride(IDPTeamOverride(spreadDef: 7), team: "KC")
        XCTAssertEqual(model.teams["KC"]?.spreadDef, 7)
        XCTAssertEqual(model.teams["KC"]?.linesSource, .manual)
        XCTAssertGreaterThan(try XCTUnwrap(row(model, Self.bolton)).expPts, before, "an underdog defends more plays")

        let reloaded = await self.model(transport)
        XCTAssertEqual(reloaded.teams["KC"]?.spreadDef, 7)
        XCTAssertEqual(reloaded.autoTeams["KC"]?.spreadDef, -11.5)

        await reloaded.setTeamOverride(nil, team: "KC")
        XCTAssertEqual(reloaded.teams["KC"]?.spreadDef, -11.5)
    }

    func testImportsTheReferenceContextFile() async throws {
        let model = await model(try await transport())
        let file = """
            {"_comment":"week 3","teams":{
              "KC":{"opp":"@MIA","home":false,"spreadDef":-10.5,"total":46.5,"dvpPct":{"DL":17.0},"dvpGames":2,"oppSackEnv":1.25},
              "LAR":{"opp":"@DEN","home":false,"spreadDef":-2.5,"total":46.5,"dvpPct":{"LB":-28.2},"dvpGames":2,"oppSackEnv":1.0}},
             "players":{"_comment":"x","\(Self.nubin)":{"pos":"S_FREE"}}}
            """
        let counts = try await model.importContext(Data(file.utf8))
        XCTAssertEqual(counts.teams, 2)
        XCTAssertEqual(counts.players, 1)
        XCTAssertEqual(model.teams["KC"]?.spreadDef, -10.5)
        XCTAssertEqual(model.teams["KC"]?.oppSackEnv, 1.25)
        XCTAssertEqual(model.teams["KC"]?.linesSource, .imported)
        XCTAssertEqual(model.teams["LA"]?.dvpPct[.lb], -28.2, "LAR keys land on LA")
        XCTAssertEqual(try XCTUnwrap(row(model, Self.nubin)).position, .safetyFree)
    }

    func testFirstLoadEachDayIsSnapshottedAndFreezingAddsAnother() async throws {
        let transport = try await transport()
        let model = await model(transport)
        XCTAssertEqual(model.snapshots.count, 1)
        XCTAssertEqual(model.snapshots.first?.pinned, false)

        _ = await self.model(transport)  // same day: no second auto snapshot
        await model.freezeSnapshot()
        XCTAssertEqual(model.snapshots.count, 2)
        let pinned = try XCTUnwrap(model.snapshots.first { $0.pinned })
        XCTAssertEqual(pinned.week, 3)
        let loaded = await model.loadSnapshot(id: pinned.id)
        let snapshot = try XCTUnwrap(loaded)
        XCTAssertEqual(snapshot.report, model.report)
        XCTAssertFalse(snapshot.candidates.isEmpty)
    }
}

final class IDPContextAutofillTests: XCTestCase {
    func testMissingLinesFallBackToNeutralAndAreLabelled() throws {
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Data("""
            {"byWeek":{"3":[{"home":"GB","away":"ATL"}]}}
            """.utf8))
        let teams = IDPContextAutofill.build(schedule: schedule, week: 3, defense: .empty)
        let gb = try XCTUnwrap(teams["GB"])
        XCTAssertEqual(gb.spreadDef, 0)
        XCTAssertEqual(gb.total, 45)
        XCTAssertEqual(gb.linesSource, .standard)
        XCTAssertEqual(gb.dvpSource, .standard)
        XCTAssertEqual(gb.opponentLabel, "vs ATL")
        XCTAssertEqual(teams["ATL"]?.opponentLabel, "@GB")
        XCTAssertNil(teams["KC"], "a team with no game is on bye")
    }

    /// The IDP half of the table is keyed by the offense a defender faced, so
    /// a defense facing the Rams reads the cell built from lines saying LAR.
    func testMatchupReadsPointsTheOpposingOffenseAllows() throws {
        let schedule = try JSONDecoder().decode(ScheduleFile.self, from: Data("""
            {"byWeek":{"3":[{"home":"DEN","away":"LA","spreadLine":2.5,"totalLine":45.5}]}}
            """.utf8))
        let facing = [
            DefenseFacing(week: 1, position: .lb, defense: "LAR", points: 30),
            DefenseFacing(week: 1, position: .lb, defense: "DEN", points: 10),
        ]
        let table = DefenseVsPosition.compute(facing: facing, positions: [.lb, .dl, .db], minimumGames: 1)
        let teams = IDPContextAutofill.build(schedule: schedule, week: 3, defense: table)
        let den = try XCTUnwrap(teams["DEN"])
        XCTAssertEqual(den.opponent, "LA")
        XCTAssertEqual(den.dvpSource, .sleeperDvP)
        // LAR allowed 30 against a league average of 20: +50%.
        XCTAssertEqual(try XCTUnwrap(den.dvpPct[.lb]), 50, accuracy: 1e-9)
        XCTAssertEqual(den.dvpGames, 1)
        XCTAssertEqual(try XCTUnwrap(teams["LA"]?.dvpPct[.lb]), -50, accuracy: 1e-9)
        XCTAssertEqual(den.spreadDef, -2.5, "home favored by 2.5")
    }
}
