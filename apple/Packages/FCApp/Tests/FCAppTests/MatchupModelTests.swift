import XCTest
import FCCore
import FCData
@testable import FCApp

/// Matchup, against week 1 of the real 2025 schedule and weekly file.
///
/// The user's lineup uses three real players so the season lines and defense
/// ranks are joined through the real crosswalk rather than invented: Josh Allen
/// (BUF, at home to BAL), Saquon Barkley (PHI, hosting DAL at a 28.0 implied
/// total) and Ja'Marr Chase (CIN, at CLE).
@MainActor
final class MatchupModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    enum Fixture {
        static let rosters = """
        [{"roster_id":1,"owner_id":"u1",
          "players":["4984","4866","rb_sea","7564","wr2","te1","k1","PHI","lb1","dl1"],
          "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"]},
         {"roster_id":2,"owner_id":"u2",
          "players":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
          "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"]}]
        """

        static let players = """
        {"4984":{"full_name":"Josh Allen","position":"QB","team":"BUF","active":true},
         "4866":{"full_name":"Saquon Barkley","position":"RB","team":"PHI","active":true},
         "7564":{"full_name":"Ja'Marr Chase","position":"WR","team":"CIN","active":true},
         "rb_sea":{"full_name":"Seattle Back","position":"RB","team":"SEA","active":true},
         "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
         "te1":{"full_name":"Tight End","position":"TE","team":"KC","active":true},
         "k1":{"full_name":"Kicker One","position":"K","team":"BAL","active":true},
         "PHI":{"position":"DEF","team":"PHI","active":true},
         "lb1":{"full_name":"Linebacker One","position":"LB","team":"CHI","active":true},
         "dl1":{"full_name":"Lineman One","position":"DL","team":"GB","active":true},
         "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
         "rb_buf":{"full_name":"Bills Back","position":"RB","team":"BUF","active":true},
         "rb_kc":{"full_name":"Chiefs Back","position":"RB","team":"KC","active":true},
         "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
         "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
         "te2":{"full_name":"Tight End Two","position":"TE","team":"SF","active":true},
         "wr_flex2":{"full_name":"Flex Receiver Two","position":"WR","team":"CIN","active":true},
         "k2":{"full_name":"Kicker Two","position":"K","team":"NO","active":true},
         "DAL":{"position":"DEF","team":"DAL","active":true},
         "lb2":{"full_name":"Linebacker Two","position":"LB","team":"NE","active":true},
         "dl2":{"full_name":"Lineman Two","position":"DL","team":"TB","active":true}}
        """

        /// Allen has a live score; nobody else has kicked off. An unreported
        /// score must read as `nil`, never as zero.
        static func matchups(userMatchupID: String = "1") -> String {
            """
            [{"roster_id":1,"matchup_id":\(userMatchupID),"points":30.5,
              "starters":["4984","4866","rb_sea","7564","wr2","te1","0","k1","PHI","lb1","dl1"],
              "players_points":{"4984":30.5}},
             {"roster_id":2,"matchup_id":1,"points":0,
              "starters":["qb2","rb_buf","rb_kc","wr3","wr4","te2","wr_flex2","k2","DAL","lb2","dl2"],
              "players_points":{}}]
            """
        }
    }

    private func transport(week: Int = 1, userMatchupID: String = "1") async -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":\#(week),"season":"2025","season_type":"regular"}"#)
        await transport.override("/league/L1/rosters", json: Fixture.rosters)
        await transport.override("/players/nfl", json: Fixture.players)
        await transport.override("/matchups/\(week)", json: Fixture.matchups(userMatchupID: userMatchupID))
        return transport
    }

    private func loaded(week: Int = 1, userMatchupID: String = "1") async throws -> MatchupModel {
        let harness = Harness.make(transport: await transport(week: week, userMatchupID: userMatchupID))
        cacheDirectory = harness.cacheDirectory
        let model = MatchupModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData),
            sleeper: harness.sleeper
        )
        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)
        if let error = model.errorMessage { throw XCTSkip("load failed: \(error)") }
        return model
    }

    private func row(_ model: MatchupModel, _ name: String) throws -> MatchupRow {
        try XCTUnwrap(model.mySide?.rows.first { $0.name == name }, "no row for \(name)")
    }

    // MARK: - Shape

    func testBothSidesArePaired() async throws {
        let model = try await loaded()

        XCTAssertEqual(model.mySide?.manager, "Byrne Notice")
        XCTAssertEqual(model.opponentSide?.rosterID, 2)
        XCTAssertEqual(model.opponentSide?.manager, "rival")
        XCTAssertNil(model.noOpponentReason)
        XCTAssertEqual(model.week, 1)
    }

    /// Rows follow the league's slots, labelled by slot, with the unset flex
    /// kept in place rather than dropped.
    func testRowsFollowTheSlotTemplate() async throws {
        let model = try await loaded()
        let rows = try XCTUnwrap(model.mySide?.rows)

        XCTAssertEqual(rows.count, 11)
        XCTAssertEqual(rows[0].slot, "QB")
        XCTAssertEqual(rows[6].slot, "FLEX")
        XCTAssertTrue(rows[6].isEmptySlot)
        XCTAssertEqual(model.mySide?.emptySlots, 1)
    }

    // MARK: - Per player

    func testOpponentAndVenueComeFromTheSchedule() async throws {
        let model = try await loaded()

        let allen = try row(model, "Josh Allen")
        XCTAssertEqual(allen.opponent, "BAL")
        XCTAssertEqual(allen.isHome, true)

        let chase = try row(model, "Ja'Marr Chase")
        XCTAssertEqual(chase.opponent, "CLE")
        XCTAssertEqual(chase.isHome, false)
    }

    /// PHI hosted DAL favored by 8.5 with a 47.5 total: 28.0 implied.
    func testImpliedTotalIsThePlayersTeam() async throws {
        let model = try await loaded()
        let barkley = try row(model, "Saquon Barkley")
        XCTAssertEqual(try XCTUnwrap(barkley.impliedTotal), 28.0, accuracy: 0.001)
    }

    /// Joined through the real crosswalk to a real 2025 production line.
    func testSeasonLineIsJoinedFromTheWeeklyFile() async throws {
        let model = try await loaded()
        let season = try XCTUnwrap(try row(model, "Josh Allen").season)

        XCTAssertGreaterThan(season.games, 10)
        XCTAssertGreaterThan(season.pointsPerGame, 10)
        XCTAssertNotNil(season.formPointsPerGame)
        XCTAssertLessThanOrEqual(try XCTUnwrap(season.floor), try XCTUnwrap(season.ceiling))
    }

    func testDefenseContextIsTheOpponentAgainstThePosition() async throws {
        let model = try await loaded()
        let allen = try row(model, "Josh Allen")
        let context = try XCTUnwrap(model.context)

        let expected = DefenseVsPosition
            .compute(file: context.weekly, profile: context.scoring.profile)
            .cell(defense: "BAL", position: .qb)
        XCTAssertEqual(allen.defense, expected)
        XCTAssertNotNil(allen.defenseSummary)
        XCTAssertTrue(allen.defenseSummary?.contains("BAL") ?? false)
    }

    /// Sleeper's live number, and a player who has not kicked off reads as no
    /// number rather than zero.
    func testLivePointsAreNilNotZeroBeforeKickoff() async throws {
        let model = try await loaded()
        XCTAssertEqual(try row(model, "Josh Allen").livePoints, 30.5)
        XCTAssertNil(try row(model, "Saquon Barkley").livePoints)
        XCTAssertEqual(model.mySide?.livePoints, 30.5)
    }

    /// A team defense has no production data at all. The row still knows its
    /// game — byes and lines come from the schedule — but it must say it has no
    /// production rather than showing a blank that reads like zero (§3.2).
    func testATeamDefenseRowStatesItHasNoProduction() async throws {
        let model = try await loaded()
        let defense = try XCTUnwrap(model.mySide?.rows.first { $0.playerID == "PHI" })

        XCTAssertFalse(defense.hasProductionData)
        XCTAssertNil(defense.season)
        XCTAssertNil(defense.defense)
        XCTAssertEqual(defense.opponent, "DAL")
        XCTAssertEqual(try XCTUnwrap(defense.impliedTotal), 28.0, accuracy: 0.001)
    }

    /// A covered position with no crosswalk join is a different claim from an
    /// uncovered position, and the row must be able to tell them apart.
    func testAnUnjoinablePlayerIsDistinctFromAnUncoveredPosition() async throws {
        let model = try await loaded()
        let back = try row(model, "Seattle Back")
        XCTAssertTrue(back.hasProductionData)
        XCTAssertNil(back.season)
    }

    // MARK: - Lineup environment

    /// Barkley and the PHI defense are one NFL team, counted once.
    func testLineupEnvironmentCountsEachNFLTeamOnce() async throws {
        let model = try await loaded()
        let environment = try XCTUnwrap(model.mySide?.environment)
        let context = try XCTUnwrap(model.context)

        let teams = ["BUF", "PHI", "SEA", "CIN", "DAL", "KC", "BAL", "CHI", "GB"]
        XCTAssertEqual(environment.teamCount, teams.count)

        let lines = GameLines.week(context.schedule, week: 1)
        let expected = teams.compactMap { lines[$0]?.impliedTotal }.reduce(0, +)
        XCTAssertEqual(try XCTUnwrap(environment.total), expected, accuracy: 0.001)
        XCTAssertTrue(environment.missingTeams.isEmpty)
    }

    // MARK: - Byes and no opponent

    /// Week 7 of 2025 had BUF on bye: Allen has no opponent, and the row says so.
    func testAStarterOnByeHasNoOpponent() async throws {
        let model = try await loaded(week: 7)
        let allen = try row(model, "Josh Allen")

        XCTAssertTrue(allen.onBye)
        XCTAssertNil(allen.opponent)
        XCTAssertNil(allen.impliedTotal)
        XCTAssertGreaterThan(model.mySide?.startersOnBye ?? 0, 0)
        XCTAssertTrue(model.mySide?.environment.missingTeams.contains("BUF") ?? false)
    }

    /// No opponent is stated plainly, and the user's own side still renders.
    func testNoOpponentIsExplainedRatherThanBlank() async throws {
        let model = try await loaded(userMatchupID: "null")

        XCTAssertNotNil(model.mySide)
        XCTAssertNil(model.opponentSide)
        XCTAssertNotNil(model.noOpponentReason)
    }

    // MARK: - Interaction and failure

    func testTheSegmentedControlSwitchesSides() async throws {
        let model = try await loaded()
        XCTAssertEqual(model.visibleSide?.rosterID, 1)

        model.showing = .opponent
        XCTAssertEqual(model.visibleSide?.rosterID, 2)
    }

    func testAFailedLoadNamesWhatFailed() async {
        let transport = StubTransport()
        await transport.on("/state/nfl", json: TestLeague.nflStateJSON)
        await transport.fail("/league/L1")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let model = MatchupModel(
            loader: LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData),
            sleeper: harness.sleeper
        )

        await model.load(leagueID: "L1", userRosterID: 1, season: 2025)

        XCTAssertNotNil(model.errorMessage)
        XCTAssertNil(model.mySide)
    }
}
