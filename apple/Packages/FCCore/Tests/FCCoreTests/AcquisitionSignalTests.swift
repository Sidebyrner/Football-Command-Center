import XCTest
@testable import FCCore

final class AcquisitionSignalTests: XCTestCase {
    private func scanned() throws -> ([SeasonProfile], [Position: PositionBaseline]) {
        let players = SeasonScan.run(file: try Fixtures.weekly2025(), profile: .leagueDefault)
        let lines = Baselines.seasonPace(
            players: players,
            template: Fixtures.leagueTemplate,
            teamCount: Fixtures.leagueTeamCount
        )
        return (players, lines)
    }

    private func profile(
        position: Position = .wr,
        games: Int = 10,
        pointsPerGame: Double,
        form: Double? = nil,
        recentTargetShare: Double? = nil
    ) -> SeasonProfile {
        SeasonProfile(
            gsisID: "test", name: "Test Player", position: position, team: "PHI", games: games,
            pointsPerGame: pointsPerGame, formPointsPerGame: form, floor: nil, ceiling: nil,
            median: nil, targetShare: recentTargetShare, recentTargetShare: recentTargetShare,
            airYardsShare: nil, weeks: []
        )
    }

    private let line = PositionBaseline(
        position: .wr, starters: 16, startLine: 12.0, replacementLine: 10.0, pool: 200
    )

    func testStartableAndAboveReplacementAreMutuallyExclusive() throws {
        let (players, lines) = try scanned()
        var startable = 0
        var aboveReplacement = 0

        for player in players {
            let keys = Set(
                AcquisitionSignals.signals(for: player, baselines: lines).map(\.signal)
            )
            XCTAssertFalse(
                keys.contains(.startable) && keys.contains(.aboveReplacement),
                "\(player.name) fired both"
            )
            if keys.contains(.startable) { startable += 1 }
            if keys.contains(.aboveReplacement) { aboveReplacement += 1 }
        }

        XCTAssertGreaterThan(startable, 0)
        XCTAssertGreaterThan(aboveReplacement, 0)
    }

    /// Opportunity is the buy-low: usage already ahead of the points. Every one
    /// must be genuinely below the start line with a real target share.
    func testEveryOpportunityFlagIsBelowTheStartLineWithRealUsage() throws {
        let (players, lines) = try scanned()
        var fired = 0

        for player in players {
            let keys = Set(
                AcquisitionSignals.signals(for: player, baselines: lines).map(\.signal)
            )
            guard keys.contains(.opportunity) else { continue }
            fired += 1
            let baseline = try XCTUnwrap(lines[player.position])
            XCTAssertLessThan(player.pointsPerGame, baseline.startLine, player.name)
            XCTAssertGreaterThanOrEqual(
                try XCTUnwrap(player.recentTargetShare),
                AcquisitionSignals.opportunityTargetShare,
                player.name
            )
        }

        XCTAssertGreaterThan(fired, 0, "the signal must actually fire on real data")
    }

    /// A position with no baseline produces zero signals rather than a bogus
    /// one. DEF and IDP have no production data at all and must never be ranked
    /// against positions the file does cover (§3.2).
    func testAPositionWithNoBaselineProducesNoSignals() {
        let linebacker = profile(position: .lb, pointsPerGame: 40)
        XCTAssertTrue(AcquisitionSignals.signals(for: linebacker, baselines: [:]).isEmpty)
        XCTAssertTrue(
            AcquisitionSignals.signals(for: linebacker, baselines: [.wr: line]).isEmpty
        )
        XCTAssertNil(
            AcquisitionSignals.valueOverStartLine(linebacker, baselines: [.wr: line])
        )
    }

    func testSignalThresholds() {
        let baselines: [Position: PositionBaseline] = [.wr: line]

        let clearly = profile(pointsPerGame: 12.0)
        XCTAssertEqual(
            AcquisitionSignals.signals(for: clearly, baselines: baselines).map(\.signal),
            [.startable],
            "at the line counts as clearing it"
        )

        let between = profile(pointsPerGame: 11.0)
        XCTAssertEqual(
            AcquisitionSignals.signals(for: between, baselines: baselines).map(\.signal),
            [.aboveReplacement]
        )

        let below = profile(pointsPerGame: 5.0)
        XCTAssertTrue(AcquisitionSignals.signals(for: below, baselines: baselines).isEmpty)

        let busy = profile(pointsPerGame: 8.0, recentTargetShare: 0.20)
        XCTAssertEqual(
            AcquisitionSignals.signals(for: busy, baselines: baselines).map(\.signal),
            [.opportunity]
        )

        let almostBusy = profile(pointsPerGame: 8.0, recentTargetShare: 0.199)
        XCTAssertTrue(AcquisitionSignals.signals(for: almostBusy, baselines: baselines).isEmpty)

        // Usage ahead of production only, so a startable player never gets it.
        let productive = profile(pointsPerGame: 20.0, recentTargetShare: 0.35)
        XCTAssertEqual(
            AcquisitionSignals.signals(for: productive, baselines: baselines).map(\.signal),
            [.startable]
        )
    }

    func testFormNeedsBothAMarginAndASample() {
        let baselines: [Position: PositionBaseline] = [.wr: line]

        let hot = profile(pointsPerGame: 8.0, form: 11.0)
        XCTAssertEqual(
            AcquisitionSignals.signals(for: hot, baselines: baselines).map(\.signal), [.form]
        )

        let warm = profile(pointsPerGame: 8.0, form: 10.0)
        XCTAssertTrue(
            AcquisitionSignals.signals(for: warm, baselines: baselines).isEmpty,
            "exactly 1.25x is not more than 1.25x"
        )

        let tinySample = profile(games: 3, pointsPerGame: 8.0, form: 30.0)
        XCTAssertTrue(AcquisitionSignals.signals(for: tinySample, baselines: baselines).isEmpty)
    }

    /// Rank by value over the position's own start line, never by raw points per
    /// game. A quarterback outscores every running back in absolute terms, so a
    /// raw sort just lists quarterbacks and buries exactly the undervalued
    /// players the board exists to surface (§5.8).
    func testRankingUsesValueOverTheStartLineNotRawPoints() throws {
        let (players, lines) = try scanned()
        let board = AcquisitionSignals.board(players: players, baselines: lines)

        XCTAssertFalse(board.isEmpty)
        XCTAssertEqual(
            board.map(\.valueOverStartLine),
            board.map(\.valueOverStartLine).sorted(by: >)
        )

        // On the shipped file a raw sort puts four quarterbacks on top.
        let byRawPoints = board.sorted { $0.player.pointsPerGame > $1.player.pointsPerGame }
        XCTAssertEqual(byRawPoints.prefix(4).map(\.player.position), [.qb, .qb, .qb, .qb])

        // Value over the line does not.
        XCTAssertEqual(board.first?.player.position, .rb)
        XCTAssertEqual(board.first?.player.name, "Christian McCaffrey")

        let topPositions = Set(board.prefix(8).map(\.player.position))
        XCTAssertFalse(topPositions == [.qb], "the board must not collapse to one position")
    }

    /// Only players that tripped something make the board.
    func testBoardOnlyCarriesPlayersWithASignal() throws {
        let (players, lines) = try scanned()
        let board = AcquisitionSignals.board(players: players, baselines: lines)

        XCTAssertTrue(board.allSatisfy { !$0.signals.isEmpty })
        XCTAssertLessThan(board.count, players.count)
        XCTAssertTrue(
            board.allSatisfy { Position.coveredByWeeklyData.contains($0.player.position) }
        )
    }

    /// The detail strings are what the UI shows verbatim, so they must name the
    /// numbers that fired the signal.
    func testDetailNamesTheNumbers() {
        let busy = profile(pointsPerGame: 8.0, recentTargetShare: 0.24)
        let hit = AcquisitionSignals.signals(for: busy, baselines: [.wr: line]).first

        XCTAssertEqual(hit?.signal, .opportunity)
        XCTAssertEqual(hit?.label, "Opportunity ahead of production")
        XCTAssertEqual(hit?.detail, "24% target share, still under the start line")
    }
}
