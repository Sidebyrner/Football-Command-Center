import XCTest
import FCCore
import FCData
@testable import FCApp

/// QB, D/ST and K streams against the recorded week-2 2026 Sleeper lines
/// (served for weeks 1 and 2) and the 2026 schedule at week 3, under the real
/// Whack-A-Mole scoring.
@MainActor
final class QBDSTKStreamScreenTests: XCTestCase {
    private var cacheDirectory: URL?
    private var storeDirectory: URL!

    static let mahomes = "4046", ward = "12522"
    static let butker = "4227", aubrey = "11533", mcpherson = "7839"

    override func setUp() {
        super.setUp()
        storeDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("qdk-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        try? FileManager.default.removeItem(at: storeDirectory)
        super.tearDown()
    }

    private func loader() async throws -> LeagueContextLoader {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        let scoring = try String(data: Data(contentsOf: Bundle.module.url(forResource: "scoring-whack-a-mole", withExtension: "json",
                                                                          subdirectory: "Fixtures")!), encoding: .utf8)!
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","SUPER_FLEX","K","DEF","BN","BN"],
             "scoring_settings":\(scoring),
             "settings":{"waiver_type":2,"waiver_budget":100}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["\(Self.mahomes)","\(Self.ward)","\(Self.butker)","KC"],
              "starters":["\(Self.mahomes)","\(Self.ward)","\(Self.butker)","KC"]},
             {"roster_id":2,"owner_id":"u2","players":["\(Self.aubrey)","NE"],"starters":["0","0","\(Self.aubrey)","NE"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"\(Self.mahomes)":{"full_name":"Patrick Mahomes","position":"QB","team":"KC","active":true,"depth_chart_order":1},
             "\(Self.ward)":{"full_name":"Cam Ward","position":"QB","team":"TEN","active":true,"depth_chart_order":1},
             "\(Self.butker)":{"full_name":"Harrison Butker","position":"K","team":"KC","active":true},
             "\(Self.aubrey)":{"full_name":"Brandon Aubrey","position":"K","team":"DAL","active":true},
             "\(Self.mcpherson)":{"full_name":"Evan McPherson","position":"K","team":"CIN","active":true},
             "KC":{"position":"DEF","team":"KC","active":true},
             "NE":{"position":"DEF","team":"NE","active":true},
             "CAR":{"position":"DEF","team":"CAR","active":true},
             "MIN":{"position":"DEF","team":"MIN","active":true}}
            """)
        try await transport.on("/stats/nfl/2026/1", fixture: "stats-2026-w2")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
    }

    // MARK: QB

    func testQBStreamProjectsUnderTheLeaguesPassingScoring() async throws {
        let model = QBStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.scoring.incompletion, -1)
        XCTAssertEqual(model.scoring.interception + model.scoring.pickSixExtra, -15)
        let mahomes = try XCTUnwrap(model.projection(for: Self.mahomes))
        XCTAssertGreaterThan(mahomes.expAtt, 20)
        XCTAssertGreaterThan(mahomes.ros.games, 10, "the rest of 2026 from the schedule")
        let kc = SleeperTeamTotals.schedule(try XCTUnwrap(model.context).schedule, team: "KC")
        XCTAssertEqual(mahomes.ros.byeWeek, (4...18).first { !kc.keys.contains($0) }, "KC's bye from the schedule")
        XCTAssertTrue(QBStreamKind.usesHorizon)
        XCTAssertFalse(RBStreamKind.usesHorizon)
    }

    func testTheHorizonMovesTheRanking() async throws {
        let model = QBStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        model.horizon = .week
        let week = try XCTUnwrap(model.projection(for: Self.mahomes))
        XCTAssertEqual(week.utility, week.expPts - 0.2 * week.sdIfPlays, accuracy: 1e-9)
        model.horizon = .ros
        let ros = try XCTUnwrap(model.projection(for: Self.mahomes))
        XCTAssertEqual(ros.expPts, week.expPts, accuracy: 1e-9, "this week's projection doesn't move")
        XCTAssertNotEqual(ros.utility, week.utility, "the ranking value does")
    }

    func testTheOpposingPassDefenseComesFromQuarterbacksItFaced() async throws {
        let model = QBStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        let withRates = model.teams.values.filter { $0.oppCompAllowed != nil }
        XCTAssertFalse(withRates.isEmpty)
        for team in withRates {
            XCTAssertTrue((0...1).contains(team.oppCompAllowed!))
            XCTAssertTrue((0...1).contains(team.oppSackRate ?? 0))
        }
    }

    // MARK: D/ST

    func testDefensesProjectFromTheirOwnLinesAndTheLeaguesTiers() async throws {
        let model = DSTStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.scoring.pointsAllowed.first?.points, 15)
        XCTAssertEqual(model.scoring.interception, 8)
        let ne = try XCTUnwrap(model.candidates.first { $0.id == "NE" })
        XCTAssertEqual(ne.sacks, 8, "4 sacks in each of the two served weeks")
        XCTAssertEqual(ne.games, 2)
        XCTAssertEqual(ne.paTotal, 6)
        XCTAssertEqual(model.incumbentID, "KC", "my starting defense is the one to beat")
        let projection = try XCTUnwrap(model.projection(for: "NE"))
        XCTAssertFalse(projection.flags.contains("scoring = Sleeper defaults (placeholder)"))
        XCTAssertTrue(model.unmodelledScoringKeys.contains("def_3_and_out"), "named on screen, not dropped")
    }

    // MARK: K

    func testKickersBucketTheirKicksAndReadTheStadium() async throws {
        let model = KStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.scoring.make(.fifty), 18, "fgm (6) plus the 50–59 value (12)")
        let mcpherson = try XCTUnwrap(model.candidates.first { $0.id == Self.mcpherson })
        XCTAssertEqual(mcpherson.fga[.fifty], 4, "two 50-yarders in each served week")
        XCTAssertEqual(mcpherson.fgm[.fifty], 4)
        let butker = try XCTUnwrap(model.candidates.first { $0.id == Self.butker })
        XCTAssertEqual(butker.fga.values.reduce(0, +), 10)
        let misses = KBucket.allCases.reduce(0.0) { $0 + (butker.fga[$1] ?? 0) - (butker.fgm[$1] ?? 0) }
        XCTAssertEqual(misses, 2, "one miss in each served week")
        for team in model.teams.values {
            let site = team.home == true ? team.team : team.opponent
            XCTAssertEqual(team.venue == .dome, KStreamEngine.domeHome.contains(site), team.team)
            XCTAssertEqual(team.altitude, site == "DEN")
        }
        XCTAssertGreaterThan(try XCTUnwrap(model.projection(for: Self.mcpherson)).expPts, 0)
    }

    func testWeatherEditsMoveTheKickingProjection() async throws {
        let model = KStreamScreenModel(loader: try await loader(), store: StreamStore(directory: storeDirectory))
        await model.load(leagueID: "L1", userRosterID: 1)
        let before = try XCTUnwrap(model.projection(for: Self.mcpherson))
        guard let team = model.teams["CIN"], team.venue != .dome else { throw XCTSkip("CIN indoors this week") }
        await model.setTeamOverride(KTeamOverride(windMph: 25, precipPct: 80), team: "CIN")
        let after = try XCTUnwrap(model.projection(for: Self.mcpherson))
        XCTAssertLessThan(after.e50pAtt, before.e50pAtt, "wind moves long attempts shorter")
        XCTAssertLessThan(after.expPts, before.expPts)
        XCTAssertEqual(model.teams["CIN"]?.weatherSource, .manual)
    }
}
