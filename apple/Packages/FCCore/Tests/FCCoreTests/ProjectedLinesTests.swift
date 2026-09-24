import XCTest
@testable import FCCore

/// `Baselines.lines` is the Nth-best construction the season-pace baseline
/// uses, exposed so a projected start line is built the same way.
final class ProjectedLinesTests: XCTestCase {
    private let template = RosterSlots.parse(["QB", "RB", "RB", "WR", "FLEX", "BN"])

    func testNthBestPerDedicatedSlotTimesTeams() {
        let lines = Baselines.lines(
            byPosition: [
                .rb: [30, 25, 20, 15, 10, 5],
                .qb: [22, 18, 14],
            ],
            template: template,
            teamCount: 2
        )
        // Two RB slots × two teams → the 4th-best back sets the line, the 5th
        // is the replacement. Flex is excluded on purpose.
        XCTAssertEqual(lines[.rb]?.starters, 4)
        XCTAssertEqual(lines[.rb]?.startLine, 15)
        XCTAssertEqual(lines[.rb]?.replacementLine, 10)
        XCTAssertEqual(lines[.qb]?.starters, 2)
        XCTAssertEqual(lines[.qb]?.startLine, 18)
        XCTAssertEqual(lines[.qb]?.replacementLine, 14)
    }

    func testAShallowPoolFallsBackToItsWorstAndHasNoReplacement() {
        let lines = Baselines.lines(byPosition: [.rb: [12, 9]], template: template, teamCount: 2)
        XCTAssertEqual(lines[.rb]?.startLine, 9)
        XCTAssertNil(lines[.rb]?.replacementLine)
    }

    func testPositionsWithoutADedicatedSlotOrValuesGetNoLine() {
        let lines = Baselines.lines(byPosition: [.te: [10, 8], .wr: []], template: template, teamCount: 2)
        XCTAssertNil(lines[.te], "TE is flex-only here, so no line")
        XCTAssertNil(lines[.wr])
        XCTAssertTrue(Baselines.lines(byPosition: [.rb: [1]], template: template, teamCount: 0).isEmpty)
    }

    /// The season-pace baseline and the generic builder agree on real data.
    func testSeasonPaceIsTheSameConstruction() throws {
        let weekly = try JSONDecoder().decode(WeeklyFile.self, from: Fixtures.data("weekly-2025.json"))
        let profiles = SeasonScan.run(file: weekly, profile: .leagueDefault)
        let league = RosterSlots.parse(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN"])
        let viaSeason = Baselines.seasonPace(players: profiles, template: league, teamCount: 8)
        var byPosition: [Position: [Double]] = [:]
        for player in profiles where player.games >= Baselines.minimumGamesForLine {
            byPosition[player.position, default: []].append(player.pointsPerGame)
        }
        let viaLines = Baselines.lines(byPosition: byPosition, template: league, teamCount: 8)
        XCTAssertEqual(viaSeason, viaLines)
    }
}
