import XCTest
@testable import FCCore

/// The generic defense-vs-position path — already-scored player-weeks — which
/// is what Sleeper's stat lines feed, and which must agree with the file path.
final class DefenseFacingTests: XCTestCase {
    func testPerGameDividesByGamesNotPlayerWeeks() {
        let facing = [
            DefenseFacing(week: 1, position: .wr, defense: "KC", points: 10),
            DefenseFacing(week: 1, position: .wr, defense: "KC", points: 6),
            DefenseFacing(week: 2, position: .wr, defense: "KC", points: 8),
            DefenseFacing(week: 1, position: .wr, defense: "LAR", points: 4),
            DefenseFacing(week: 2, position: .wr, defense: "LAR", points: 4),
        ]
        let table = DefenseVsPosition.compute(facing: facing, positions: [.wr], minimumGames: 2)
        let kc = try! XCTUnwrap(table.cell(defense: "KC", position: .wr))
        XCTAssertEqual(kc.games, 2)
        XCTAssertEqual(kc.playerWeeks, 3)
        XCTAssertEqual(kc.perGame, 12)
        XCTAssertEqual(kc.rank, 1, "softest")
        // Sleeper spelling resolves to the same cell.
        XCTAssertEqual(table.cell(defense: "LAR", position: .wr)?.rank, 2)
        XCTAssertEqual(table.cell(defense: "LA", position: .wr)?.rank, 2)
        XCTAssertEqual(table.leagueAverage[.wr], 8)
        XCTAssertTrue(table.covers(.wr))
        XCTAssertFalse(table.covers(.lb))
    }

    func testUnderTheSampleFloorIsUnrankedNotAverage() {
        let table = DefenseVsPosition.compute(
            facing: [DefenseFacing(week: 1, position: .lb, defense: "NE", points: 9)],
            positions: [.lb], minimumGames: 4
        )
        let cell = try! XCTUnwrap(table.cell(defense: "NE", position: .lb))
        XCTAssertEqual(cell.perGame, 9)
        XCTAssertNil(cell.rank)
        XCTAssertNil(cell.vsLeagueAverage)
    }

    func testAWeekWithNoPointsStillCountsAsAGame() {
        let table = DefenseVsPosition.compute(
            facing: [
                DefenseFacing(week: 1, position: .rb, defense: "SF", points: 20),
                DefenseFacing(week: 2, position: .rb, defense: "SF", points: .nan),
            ],
            positions: [.rb], minimumGames: 1
        )
        XCTAssertEqual(table.cell(defense: "SF", position: .rb)?.games, 2)
        XCTAssertEqual(table.cell(defense: "SF", position: .rb)?.perGame, 10)
    }

    /// The file path and the facing path are one computation.
    func testFilePathAgreesWithFacingPath() throws {
        let weekly = try JSONDecoder().decode(WeeklyFile.self, from: Fixtures.data("weekly-2025.json"))
        let viaFile = DefenseVsPosition.compute(file: weekly, profile: .leagueDefault, positions: [.te])
        var facing: [DefenseFacing] = []
        for player in weekly.allPlayers() where player.position == .te {
            for row in player.rows {
                guard let defense = row.opponent else { continue }
                let points = ScoringEngine.score(row, profile: .leagueDefault, position: .te).points
                facing.append(DefenseFacing(week: row.week, position: .te, defense: defense, points: points ?? .nan))
            }
        }
        let viaFacing = DefenseVsPosition.compute(facing: facing, positions: [.te])
        XCTAssertEqual(viaFile.ranked[.te], viaFacing.ranked[.te])
        XCTAssertEqual(viaFile.leagueAverage[.te], viaFacing.leagueAverage[.te])
    }
}
