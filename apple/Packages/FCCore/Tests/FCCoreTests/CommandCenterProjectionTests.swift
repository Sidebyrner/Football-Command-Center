import XCTest
@testable import FCCore

/// The Command Center projection is a stated formula; these pin each term.
final class CommandCenterProjectionTests: XCTestCase {
    private func inputs(
        this: Double? = nil, games: Int = 0, last: Double? = nil, replacement: Double? = nil,
        recent: Double? = nil, seasonX: Double? = nil, allowed: Double? = nil, average: Double? = nil,
        remaining: [(allowed: Double, average: Double)] = []
    ) -> CommandCenterInputs {
        CommandCenterInputs(
            position: .rb, thisSeasonPointsPerGame: this, thisSeasonGames: games,
            lastSeasonPointsPerGame: last, replacementLine: replacement,
            expectedPointsRecent: recent, expectedPointsSeason: seasonX,
            opponentAllowedPerGame: allowed, leagueAverageAllowed: average, remainingOpponents: remaining
        )
    }

    func testPaceRegressesThisSeasonTowardLastSeasonByGamesPlayed() {
        // Two games: weight 2/(2+4) = 1/3 on this season.
        let projection = CommandCenterProjection.project(inputs(this: 30, games: 2, last: 12))
        XCTAssertEqual(try XCTUnwrap(projection.pace), 18, accuracy: 0.01)
        XCTAssertEqual(projection.weekly, 18)
        XCTAssertEqual(projection.restOfSeasonPerGame, 18)
        XCTAssertEqual(projection.factors.map(\.name), ["Pace", "Usage", "Matchup"])
    }

    func testTheReplacementLineIsThePriorForARookie() {
        let projection = CommandCenterProjection.project(inputs(this: 20, games: 4, replacement: 8))
        // 4/(4+4) = half and half.
        XCTAssertEqual(try XCTUnwrap(projection.pace), 14, accuracy: 0.01)
        XCTAssertTrue(projection.factors[0].detail.contains("replacement line"))
    }

    func testNoGamesYetFallsBackToLastSeason() {
        let projection = CommandCenterProjection.project(inputs(last: 15))
        XCTAssertEqual(projection.weekly, 15)
    }

    func testNothingToProjectFromIsNilNotZero() {
        let projection = CommandCenterProjection.project(inputs())
        XCTAssertFalse(projection.isValued)
        XCTAssertNil(projection.weekly)
        XCTAssertNotNil(projection.note)
    }

    func testUsageAndMatchupAreBoundedMultipliers() {
        // Usage 30/10 = 3 → clamped to 1.2; matchup allows double the average → 1 + 0.5 = 1.5 → clamped 1.25.
        let projection = CommandCenterProjection.project(
            inputs(this: 10, games: 8, last: 10, recent: 30, seasonX: 10, allowed: 20, average: 10)
        )
        XCTAssertEqual(try XCTUnwrap(projection.pace), 10, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(projection.weekly), 10 * 1.2 * 1.25, accuracy: 0.05)
        XCTAssertEqual(projection.factors.first { $0.name == "Usage" }?.value, 1.2)
        XCTAssertEqual(projection.factors.first { $0.name == "Matchup" }?.value, 1.25)
    }

    func testRestOfSeasonUsesTheMeanRemainingMatchup() {
        let projection = CommandCenterProjection.project(
            inputs(this: 10, games: 8, last: 10, allowed: 10, average: 10,
                   remaining: [(12, 10), (8, 10)])  // 1.1 and 0.9 → mean 1.0
        )
        XCTAssertEqual(projection.weekly, 10)
        XCTAssertEqual(projection.restOfSeasonPerGame, 10)
        XCTAssertEqual(projection.factors.last?.name, "Remaining schedule")
    }

    func testAZeroAverageDoesNotDivide() {
        let projection = CommandCenterProjection.project(inputs(this: 10, games: 8, last: 10, allowed: 5, average: 0))
        XCTAssertEqual(projection.weekly, 10)
    }
}
