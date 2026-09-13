import XCTest
@testable import FCCore

/// Scoring under the league's own profile, checked against values computed from
/// the shipped 2025 file.
final class ScoringEngineTests: XCTestCase {
    private func rows(_ gsisID: String) throws -> [WeeklyRow] {
        try Fixtures.weekly2025().rows(for: gsisID)
    }

    func testScoresAKnownQuarterbackWeek() throws {
        let week1 = try XCTUnwrap(rows(Fixtures.Player.aaronRodgers).first)
        let score = ScoringEngine.score(week1, profile: .leagueDefault, position: .qb)

        // 244 pass yds at 1/20, 4 pass TD, 14 pass 1st downs, 8 incompletions,
        // 4 sacks, and one yard lost rushing.
        XCTAssertEqual(try XCTUnwrap(score.points), 38.1, accuracy: 0.001)
        XCTAssertEqual(week1.week, 1)
        XCTAssertEqual(week1.team, "PIT")
        XCTAssertEqual(week1.opponent, "NYJ")

        let byRule = Dictionary(
            score.breakdown.map { ($0.rule, $0.points) }, uniquingKeysWith: { first, _ in first }
        )
        XCTAssertEqual(try XCTUnwrap(byRule[.passingYardsPerPoint]), 12.2, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(byRule[.passingTD]), 24, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(byRule[.passingFirstDown]), 14, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(byRule[.incompletion]), -8, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(byRule[.sackTaken]), -4, accuracy: 0.001)
    }

    /// The breakdown is a product feature, not a debugging aid: the UI shows
    /// *why* a number is what it is, largest contribution first.
    func testBreakdownIsOrderedByAbsoluteImpactAndSumsToTheTotal() throws {
        let week1 = try XCTUnwrap(rows(Fixtures.Player.joshAllen).first)
        let score = ScoringEngine.score(week1, profile: .leagueDefault, position: .qb)

        XCTAssertEqual(try XCTUnwrap(score.points), 60.7, accuracy: 0.001)

        let magnitudes = score.breakdown.map { abs($0.points) }
        XCTAssertEqual(magnitudes, magnitudes.sorted(by: >))

        let summed = score.breakdown.reduce(0) { $0 + $1.points }
        XCTAssertEqual(summed, try XCTUnwrap(score.points), accuracy: 0.01)

        // Nothing that contributed zero is listed — an empty row would be noise.
        XCTAssertFalse(score.breakdown.contains { $0.points == 0 })
    }

    /// Sleeper models the 300- and 400-yard bonuses as independent rules, so a
    /// 410-yard game pays both. It is not a tier where 400 replaces 300.
    func testYardageBonusesStack() throws {
        let row = WeeklyRow(
            week: 1, team: "BUF", opponent: "NYJ",
            numbers: [.passYards: 410, .attempts: 30, .completions: 30]
        )
        let score = ScoringEngine.score(row, profile: .leagueDefault, position: .qb)
        let rules = Set(score.breakdown.map(\.rule))

        XCTAssertTrue(rules.contains(.passing300Bonus))
        XCTAssertTrue(rules.contains(.passing400Bonus))
        XCTAssertTrue(rules.contains(.completions25Bonus))
        // 410/20 + 3 + 6 + 3
        XCTAssertEqual(try XCTUnwrap(score.points), 32.5, accuracy: 0.001)
    }

    /// A yards-per-point of zero means "this league does not score yards", not
    /// "divide by zero". An infinity here poisons every downstream average and
    /// chart axis (§4).
    func testZeroYardsPerPointDoesNotProduceInfinity() throws {
        var profile = ScoringProfile.leagueDefault
        profile.receivingYardsPerPoint = 0
        profile.rushingYardsPerPoint = 0
        profile.passingYardsPerPoint = 0

        let row = WeeklyRow(
            week: 3, team: "SF", opponent: "SEA",
            numbers: [.recYards: 120, .rushYards: 50, .passYards: 250, .recTD: 1]
        )
        let score = ScoringEngine.score(row, profile: profile, position: .wr)
        let points = try XCTUnwrap(score.points)

        XCTAssertTrue(points.isFinite)
        // The touchdown and the 100-yard receiving bonus. No yardage at all,
        // and crucially no infinity dragged into the sum.
        XCTAssertEqual(points, 6 + 3, accuracy: 0.001)
        XCTAssertFalse(score.breakdown.contains { $0.rule == .receivingYardsPerPoint })
    }

    /// Team defense is not in the nflverse player stats file. Returning nil
    /// keeps a blank cell honest — zero would be a claim the data cannot make
    /// (§3.2).
    func testTeamDefenseIsUnsupportedNotZero() {
        let row = WeeklyRow(week: 1, team: "PHI", opponent: "DAL", numbers: [:])
        let score = ScoringEngine.score(row, profile: .leagueDefault, position: .def)

        XCTAssertNil(score.points)
        XCTAssertEqual(score.reason, "Team defense is not in the nflverse player stats file")
        XCTAssertTrue(score.unsupported.contains(.idpTackle))
        XCTAssertTrue(score.unsupported.contains(.defPointsAllowed0))
    }

    /// Telling a quarterback his league has sixteen missing rules — fifteen of
    /// them ones he can never trigger — overstates the gap and trains the reader
    /// to ignore the warning.
    func testUnsupportedRulesAreScopedToWhatCouldActuallyFire() throws {
        let week1 = try XCTUnwrap(rows(Fixtures.Player.joshAllen).first)

        let qb = ScoringEngine.score(week1, profile: .leagueDefault, position: .qb)
        XCTAssertEqual(qb.unsupported, [.pickSix])

        let rb = ScoringEngine.score(week1, profile: .leagueDefault, position: .rb)
        XCTAssertEqual(rb.unsupported, [])
    }

    /// A rule is only a real gap when the league actually pays for it.
    func testUnsupportedRulesAreFilteredToRulesTheLeaguePaysFor() throws {
        let week1 = try XCTUnwrap(rows(Fixtures.Player.joshAllen).first)
        var profile = ScoringProfile.leagueDefault
        profile.pickSix = 0

        let score = ScoringEngine.score(week1, profile: profile, position: .qb)
        XCTAssertEqual(score.unsupported, [])
    }

    func testSeasonTotalsForKnownPlayers() throws {
        let allen = ScoringEngine.score(
            weeks: try rows(Fixtures.Player.joshAllen), profile: .leagueDefault, position: .qb
        )
        XCTAssertEqual(allen.games, 16)
        XCTAssertEqual(allen.total, 478.3, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(allen.pointsPerGame), 29.89, accuracy: 0.001)

        let bijan = ScoringEngine.score(
            weeks: try rows(Fixtures.Player.bijanRobinson), profile: .leagueDefault, position: .rb
        )
        XCTAssertEqual(bijan.games, 17)
        XCTAssertEqual(bijan.total, 409.8, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(bijan.pointsPerGame), 24.11, accuracy: 0.001)

        // Ascending, always — the UI renders them in order.
        XCTAssertEqual(allen.weeks.map(\.week), allen.weeks.map(\.week).sorted())
    }

    func testEmptySeasonReportsNoPaceRatherThanZero() {
        let season = ScoringEngine.score(weeks: [], profile: .leagueDefault, position: .wr)
        XCTAssertEqual(season.games, 0)
        XCTAssertNil(season.pointsPerGame)
    }

    /// Non-PPR is the whole point of this league's shape: receptions score
    /// nothing, first downs do.
    func testLeagueDefaultIsNonPPR() throws {
        XCTAssertEqual(ScoringProfile.leagueDefault.receptionPoints, 0)
        XCTAssertEqual(ScoringProfile.leagueDefault.receivingFirstDown, 1)

        let row = WeeklyRow(
            week: 1, team: "MIN", opponent: "CHI",
            numbers: [.receptions: 10, .recYards: 40, .recFirstDowns: 2]
        )
        let score = ScoringEngine.score(row, profile: .leagueDefault, position: .wr)
        // 40/10 + 2 first downs. Ten catches add nothing.
        XCTAssertEqual(try XCTUnwrap(score.points), 6, accuracy: 0.001)
    }

    /// Fumbles lost arrive in three separate columns and all three count.
    func testFumblesLostCombineAllThreeColumns() throws {
        let row = WeeklyRow(
            week: 4, team: "DET", opponent: "GB",
            numbers: [.rushFumblesLost: 1, .recFumblesLost: 1, .sackFumblesLost: 1]
        )
        let score = ScoringEngine.score(row, profile: .leagueDefault, position: .rb)
        XCTAssertEqual(try XCTUnwrap(score.points), -6, accuracy: 0.001)
    }

    func testMissingRowIsUnscorable() {
        let score = ScoringEngine.score(nil, profile: .leagueDefault, position: .wr)
        XCTAssertNil(score.points)
        XCTAssertEqual(score.reason, "No stat line")
    }

    /// The profile subscript must cover every rule, or a rule could silently
    /// read as zero forever.
    func testEveryScoringRuleIsAddressableOnTheProfile() {
        var profile = ScoringProfile.zeroed(id: "t", name: "t", source: .bundledDefault)
        for (index, rule) in ScoringRule.allCases.enumerated() {
            profile[rule] = Double(index + 1)
        }
        for (index, rule) in ScoringRule.allCases.enumerated() {
            XCTAssertEqual(profile[rule], Double(index + 1), "\(rule) is not wired up")
        }
    }
}
