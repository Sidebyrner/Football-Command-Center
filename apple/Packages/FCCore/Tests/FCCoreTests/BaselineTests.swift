import XCTest
@testable import FCCore

final class BaselineTests: XCTestCase {
    private func scan() throws -> [SeasonProfile] {
        SeasonScan.run(file: try Fixtures.weekly2025(), profile: .leagueDefault)
    }

    private func baselines() throws -> [Position: PositionBaseline] {
        Baselines.seasonPace(
            players: try scan(),
            template: Fixtures.leagueTemplate,
            teamCount: Fixtures.leagueTeamCount
        )
    }

    /// The whole point of the season-pace line: exactly *N* players clear it at
    /// a position the league starts *N* of. The web app's weekly-Nth-best
    /// baseline left two of seventy quarterbacks reading as startable (§5.7).
    func testExactlyTheStartedCountClearsTheStartLine() throws {
        let players = try scan()
        let lines = try baselines()
        XCTAssertFalse(lines.isEmpty)

        for (position, baseline) in lines {
            let clearing = players.filter {
                $0.position == position
                    && $0.games >= Baselines.minimumGamesForLine
                    && $0.pointsPerGame >= baseline.startLine
            }
            XCTAssertEqual(
                clearing.count, baseline.starters,
                "\(position.rawValue): \(clearing.count) clear a line \(baseline.starters) should"
            )
        }
    }

    /// The measured numbers on the shipped 2025 file. The brief names 23.9 for
    /// QB; if this drifts, the scoring engine or the pace definition moved.
    func testMeasuredLinesOnTheShippedFile() throws {
        let lines = try baselines()

        let qb = try XCTUnwrap(lines[.qb])
        XCTAssertEqual(qb.starters, 8)
        XCTAssertEqual(qb.pool, 70)
        XCTAssertEqual(qb.startLine, 23.9, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(qb.replacementLine), 23.34, accuracy: 0.001)

        let rb = try XCTUnwrap(lines[.rb])
        XCTAssertEqual(rb.starters, 16)
        XCTAssertEqual(rb.startLine, 16.08, accuracy: 0.001)

        let wr = try XCTUnwrap(lines[.wr])
        XCTAssertEqual(wr.starters, 16)
        XCTAssertEqual(wr.startLine, 12.84, accuracy: 0.001)

        let te = try XCTUnwrap(lines[.te])
        XCTAssertEqual(te.starters, 8)
        XCTAssertEqual(te.startLine, 9.99, accuracy: 0.001)

        let kicker = try XCTUnwrap(lines[.k])
        XCTAssertEqual(kicker.starters, 8)
        XCTAssertEqual(kicker.startLine, 9.65, accuracy: 0.001)
    }

    func testStartLineSitsAboveReplacement() throws {
        for (position, baseline) in try baselines() {
            let replacement = try XCTUnwrap(
                baseline.replacementLine, "\(position.rawValue) should have a deep enough pool"
            )
            XCTAssertGreaterThan(baseline.startLine, replacement, position.rawValue)
        }
    }

    /// No baseline is invented for a position with no weekly production data.
    /// DEF and IDP are three of this league's eleven starting slots and the file
    /// holds nothing for them — that absence is the honest answer, not a zero
    /// line (§3.2).
    func testNoBaselineIsInventedForPositionsWithoutData() throws {
        let lines = try baselines()
        XCTAssertNil(lines[.def])
        XCTAssertNil(lines[.lb])
        XCTAssertNil(lines[.dl])
        XCTAssertNil(lines[.db])
        XCTAssertEqual(Set(lines.keys), Position.coveredByWeeklyData)
    }

    /// Flex slots are excluded from the starter counts on purpose: charging flex
    /// demand fully to RB, WR and TE would count the same slot three times and
    /// push all three lines too high (§5.7).
    func testFlexSlotsDoNotInflateStarterCounts() throws {
        let lines = try baselines()
        XCTAssertEqual(lines[.rb]?.starters, 16, "two dedicated RB slots x 8 teams, not three")
        XCTAssertEqual(lines[.wr]?.starters, 16)
        XCTAssertEqual(lines[.te]?.starters, 8)
    }

    /// Below three games a per-game average is an artefact of one hot afternoon.
    func testMinimumGamesGuardExcludesTinySamples() throws {
        let players = try scan()
        let strict = Baselines.seasonPace(
            players: players, template: Fixtures.leagueTemplate,
            teamCount: Fixtures.leagueTeamCount, minimumGames: 3
        )
        let loose = Baselines.seasonPace(
            players: players, template: Fixtures.leagueTemplate,
            teamCount: Fixtures.leagueTeamCount, minimumGames: 1
        )

        XCTAssertGreaterThan(
            try XCTUnwrap(strict[.qb]).pool, 0
        )
        XCTAssertGreaterThan(
            try XCTUnwrap(loose[.qb]).pool, try XCTUnwrap(strict[.qb]).pool,
            "a one-game minimum must admit more players"
        )
    }

    /// A shallow pool cannot name an Nth-best player. The line still has to be
    /// defined, and there is no replacement below it to report.
    func testShallowPoolFallsBackToTheWorstQualifyingPlayer() {
        let players = (1...3).map { index in
            SeasonProfile(
                gsisID: "p\(index)", name: "P\(index)", position: .rb, team: "PHI", games: 10,
                pointsPerGame: Double(20 - index), formPointsPerGame: nil, floor: nil,
                ceiling: nil, median: nil, targetShare: nil, recentTargetShare: nil,
                airYardsShare: nil, weeks: []
            )
        }
        let lines = Baselines.seasonPace(
            players: players, template: RosterSlots.parse(["RB", "RB"]), teamCount: 8
        )
        let rb = lines[.rb]

        XCTAssertEqual(rb?.starters, 16)
        XCTAssertEqual(rb?.pool, 3)
        XCTAssertEqual(rb?.startLine, 17)
        XCTAssertNil(rb?.replacementLine)
    }

    func testNoTeamsMeansNoBaselines() throws {
        let lines = Baselines.seasonPace(
            players: try scan(), template: Fixtures.leagueTemplate, teamCount: 0
        )
        XCTAssertTrue(lines.isEmpty)
    }

    /// The scan covers only what the file covers, and says so by omission.
    func testScanCoversOnlyTheFivePositionsTheFileCarries() throws {
        let players = try scan()
        XCTAssertEqual(Set(players.map(\.position)), Position.coveredByWeeklyData)
        XCTAssertEqual(players.count, 652)
    }
}
