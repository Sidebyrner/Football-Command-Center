import XCTest
@testable import FCCore

/// Defense-vs-position against the real 2025 weekly file, scored under the
/// league's own profile rather than nflverse's PPR.
final class DefenseVsPositionTests: XCTestCase {
    private static var cached: DefenseVsPositionTable?

    private func table() throws -> DefenseVsPositionTable {
        if let cached = Self.cached { return cached }
        let table = DefenseVsPosition.compute(
            file: try Fixtures.weekly2025(), profile: .leagueDefault
        )
        Self.cached = table
        return table
    }

    func testEveryNFLDefenseIsPresent() throws {
        XCTAssertEqual(try table().defenseCount, 32)
    }

    /// Rank 1 is the softest defense — the most points allowed.
    func testRankOneAllowsTheMost() throws {
        let table = try table()
        for position in [Position.qb, .rb, .wr, .te] {
            let ranked = try XCTUnwrap(table.ranked[position])
            let rates = ranked.compactMap { table.byDefense[$0]?[position]?.perGame }
            XCTAssertEqual(rates, rates.sorted(by: >), "\(position) must be softest first")
            XCTAssertEqual(table.byDefense[ranked[0]]?[position]?.rank, 1)
        }
    }

    /// The denominator is games played, not player-weeks. Several receivers
    /// face a defense each week, so player-weeks must exceed games — if the
    /// denominator were player-weeks this would be a per-player average instead.
    func testTheDenominatorIsGamesNotPlayerWeeks() throws {
        let table = try table()
        let cell = try XCTUnwrap(table.byDefense["PHI"]?[.wr])
        let perGame = try XCTUnwrap(cell.perGame)

        XCTAssertGreaterThan(cell.playerWeeks, cell.games)
        XCTAssertEqual(perGame * Double(cell.games), cell.totalPoints, accuracy: 0.0001)
    }

    /// Byes are handled without a schedule: a full 17-game season, not 18 weeks.
    func testGamesCountExcludesByes() throws {
        let table = try table()
        let games = table.byDefense.values.compactMap { $0[.wr]?.games }
        XCTAssertTrue(games.allSatisfy { $0 <= 17 }, "no defense plays more than 17 regular-season games")
    }

    func testLeagueAverageIsTheMeanOfRankedDefenses() throws {
        let table = try table()
        let ranked = try XCTUnwrap(table.ranked[.rb])
        let mean = ranked.compactMap { table.byDefense[$0]?[.rb]?.perGame }.reduce(0, +) / Double(ranked.count)

        XCTAssertEqual(try XCTUnwrap(table.leagueAverage[.rb]), mean, accuracy: 0.0001)
        let deltas = ranked.compactMap { table.byDefense[$0]?[.rb]?.vsLeagueAverage }
        XCTAssertEqual(deltas.reduce(0, +), 0, accuracy: 0.0001, "deviations from a mean sum to zero")
    }

    /// Under the sample-size floor a defense is left unranked — not given a
    /// rank the data can't support, and not given an average either.
    func testDefensesUnderTheFloorAreUnrankedNotAverage() throws {
        let table = DefenseVsPosition.compute(
            file: try Fixtures.weekly2025(), profile: .leagueDefault, minimumGames: 99
        )
        XCTAssertTrue(table.byDefense.values.allSatisfy { $0.values.allSatisfy { $0.rank == nil } })
        XCTAssertTrue(table.byDefense.values.allSatisfy { $0.values.allSatisfy { $0.vsLeagueAverage == nil } })
        XCTAssertTrue(table.leagueAverage.isEmpty)
        // The raw rate is still there — it is the ranking that is withheld.
        XCTAssertNotNil(table.byDefense["PHI"]?[.wr]?.perGame)
    }

    func testAWeekRangeRestrictsTheWindow() throws {
        let table = DefenseVsPosition.compute(
            file: try Fixtures.weekly2025(), profile: .leagueDefault, weekRange: 1...4, minimumGames: 1
        )
        XCTAssertEqual(table.weeks, [1, 2, 3, 4])
        XCTAssertTrue(table.byDefense.values.allSatisfy { ($0[.wr]?.games ?? 0) <= 4 })
    }

    /// The weekly file has no DEF or IDP production, so there is nothing to
    /// compute for them — and they must be absent, never zero (§3.2).
    func testNoCellsForPositionsWithoutProductionData() throws {
        let table = try table()
        XCTAssertTrue(table.byDefense.values.allSatisfy { $0[.def] == nil && $0[.lb] == nil })
    }

    /// Sleeper spells the Rams `LAR`; the weekly file spells them `LA` (§5.6).
    func testLookupNormalisesTheTeamCode() throws {
        let table = try table()
        XCTAssertNotNil(table.cell(defense: "LAR", position: .wr))
        XCTAssertEqual(table.cell(defense: "LAR", position: .wr), table.cell(defense: "LA", position: .wr))
    }

    /// The numbers are in the league's own points, not nflverse PPR: a PPR
    /// profile must make receivers look richer against the same defense.
    func testScoresUnderTheGivenProfile() throws {
        let file = try Fixtures.weekly2025()
        let standard = DefenseVsPosition.compute(file: file, profile: .leagueDefault)
        let ppr = DefenseVsPosition.compute(file: file, profile: .pprReference)

        let standardWR = try XCTUnwrap(standard.byDefense["PHI"]?[.wr]?.perGame)
        let pprWR = try XCTUnwrap(ppr.byDefense["PHI"]?[.wr]?.perGame)
        XCTAssertNotEqual(standardWR, pprWR, accuracy: 0.01)
    }
}

final class GameLinesTests: XCTestCase {
    /// PHI hosted DAL in week 1 of 2025, PHI favored by 8.5, total 47.5.
    func testHomeFavoriteImpliedTotals() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 1)

        let phi = try XCTUnwrap(lines["PHI"])
        let dal = try XCTUnwrap(lines["DAL"])

        XCTAssertEqual(try XCTUnwrap(phi.impliedTotal), 28.0, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(dal.impliedTotal), 19.5, accuracy: 0.001)
        XCTAssertEqual(phi.opponent, "DAL")
        XCTAssertTrue(phi.isHome)
    }

    /// The file's positive-means-home-favored convention is flipped to the Odds
    /// API's negative-means-favored, once, here.
    func testSpreadUsesOddsSignConvention() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 1)
        XCTAssertEqual(lines["PHI"]?.spread, -8.5)
        XCTAssertEqual(lines["DAL"]?.spread, 8.5)
    }

    /// LAC hosted KC with a spreadLine of −3: the *away* team was favored.
    func testAwayFavoriteImpliedTotals() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 1)
        let kc = try XCTUnwrap(lines["KC"]?.impliedTotal)
        let lac = try XCTUnwrap(lines["LAC"]?.impliedTotal)

        XCTAssertEqual(kc, 25.25, accuracy: 0.001)
        XCTAssertEqual(lac, 22.25, accuracy: 0.001)
        XCTAssertEqual(lines["KC"]?.spread, -3)
    }

    func testBothSidesSumToTheTotal() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 1)
        for line in lines.values {
            guard let implied = line.impliedTotal,
                  let other = lines[line.opponent]?.impliedTotal,
                  let total = line.total else { continue }
            XCTAssertEqual(implied + other, total, accuracy: 0.001)
        }
        XCTAssertEqual(lines.count, 32, "16 games in week 1, both sides of each")
    }

    /// Week 8 of 2025 had ARI, DET, JAX, LA, LV and SEA on bye.
    func testTeamsOnByeHaveNoLine() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 8)
        for team in ["ARI", "DET", "JAX", "LA", "LV", "SEA"] {
            XCTAssertNil(lines[team], "\(team) was on bye")
        }
        XCTAssertEqual(lines.count, 26)
    }

    /// Two starters from one NFL team must not double-count that team's
    /// number, and a team with no line is named rather than counted as zero.
    func testLineupEnvironmentCountsEachTeamOnceAndNamesMissingTeams() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 8)
        let environment = GameLines.lineupEnvironment(
            teams: ["PHI", "PHI", "SEA", nil], lines: lines
        )

        XCTAssertEqual(environment.teamCount, 2)
        XCTAssertEqual(environment.missing, ["SEA"])
        XCTAssertEqual(environment.total, lines["PHI"]?.impliedTotal)
    }

    func testLineupEnvironmentNormalisesSleeperTeamCodes() throws {
        let lines = GameLines.week(try Fixtures.schedule2025(), week: 8)
        let environment = GameLines.lineupEnvironment(teams: ["LAR"], lines: lines)
        XCTAssertEqual(environment.missing, ["LA"], "LAR is LA, and LA was on bye in week 8")
    }

    /// Every 2026 week 1 line sits on that week's real matchup, both sides of it
    /// — pairings checked against ESPN's week 1 scoreboard on 2026-09-13.
    func testWeekOne2026LinesSitOnTheScheduledMatchups() throws {
        let lines = GameLines.week(try Fixtures.schedule2026(), week: 1)
        let matchups = [
            ("NE", "SEA"), ("SF", "LA"), ("CHI", "CAR"), ("TB", "CIN"), ("NO", "DET"),
            ("BUF", "HOU"), ("BAL", "IND"), ("CLE", "JAX"), ("ATL", "PIT"), ("NYJ", "TEN"),
            ("ARI", "LAC"), ("MIA", "LV"), ("GB", "MIN"), ("WAS", "PHI"), ("DAL", "NYG"),
            ("DEN", "KC"),
        ]
        XCTAssertEqual(lines.count, 32)
        for (away, home) in matchups {
            let a = try XCTUnwrap(lines[away], away)
            let h = try XCTUnwrap(lines[home], home)
            XCTAssertEqual(a.opponent, home)
            XCTAssertEqual(h.opponent, away)
            XCTAssertTrue(h.isHome)
            XCTAssertEqual(a.total, h.total, "\(away)@\(home) share one total")
            XCTAssertEqual(a.spread.map { -$0 }, h.spread, "\(away)@\(home) spreads mirror")
        }

        // The closing line: PIT −6.5, total 40.5 (the Sept 9 file still had −3.5).
        XCTAssertEqual(lines["PIT"]?.spread, -6.5)
        XCTAssertEqual(lines["PIT"]?.total, 40.5)
        XCTAssertEqual(try XCTUnwrap(lines["PIT"]?.impliedTotal), 23.5, accuracy: 0.001)
    }

    func testNoLinesAtAllIsNilNotZero() throws {
        let environment = GameLines.lineupEnvironment(teams: ["SEA"], lines: [:])
        XCTAssertNil(environment.total)
    }
}
