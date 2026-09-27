import XCTest
import FCCore
@testable import FCApp

/// `MatchupModel.pair` as a pure function, with rows built by hand so each rule
/// is exercised in isolation.
final class MatchupPairingTests: XCTestCase {
    private func row(
        _ index: Int, slot: String = "RB", name: String? = "Player",
        live: Double? = nil, season: Double? = nil, onBye: Bool = false
    ) -> MatchupRow {
        MatchupRow(
            index: index, slot: slot, playerID: name == nil ? nil : "p\(index)\(name!)",
            name: name, position: .rb, nflTeam: "PHI", opponent: onBye ? nil : "DAL",
            isHome: true, onBye: onBye, livePoints: live,
            season: season.map { SeasonLine(games: 10, pointsPerGame: $0, formPointsPerGame: nil, floor: nil, ceiling: nil) },
            defense: nil, impliedTotal: nil
        )
    }

    private func side(_ rows: [MatchupRow]) -> MatchupSide {
        MatchupSide(
            rosterID: 1, manager: "x", isUser: true, livePoints: nil, rows: rows,
            environment: LineupEnvironment(total: nil, teamCount: 0, missingTeams: [])
        )
    }

    func testBeforeKickoffTheBasisIsSeasonAverage() {
        let result = MatchupModel.pair(
            mine: side([row(0, season: 18)]),
            theirs: side([row(0, season: 12)])
        )
        XCTAssertEqual(result.basis, .seasonAverage)
        XCTAssertEqual(result.slots[0].leader, .mine)
        XCTAssertEqual(result.slots[0].myShare ?? 0, 0.6, accuracy: 0.001)
    }

    /// One basis for the whole matchup: once anyone has a live number, season
    /// averages are not mixed in for the others.
    func testOneLiveScoreAnywhereSwitchesEverySlotToLive() {
        let result = MatchupModel.pair(
            mine: side([row(0, live: 4, season: 30), row(1, season: 20)]),
            theirs: side([row(0, live: 9, season: 5), row(1, season: 10)])
        )
        XCTAssertEqual(result.basis, .livePoints)
        XCTAssertEqual(result.slots[0].leader, .theirs, "live points win over a better season")
        XCTAssertEqual(result.slots[1].leader, .undecided, "no live numbers yet in slot 2")
    }

    /// A starter on bye is a certain zero on either basis.
    func testAByeStarterCountsAsZero() {
        let result = MatchupModel.pair(
            mine: side([row(0, season: 40, onBye: true)]),
            theirs: side([row(0, season: 8)])
        )
        XCTAssertEqual(result.slots[0].myValue, 0)
        XCTAssertEqual(result.slots[0].leader, .theirs)
    }

    func testCloseValuesAreEven() {
        let result = MatchupModel.pair(
            mine: side([row(0, season: 12.02)]),
            theirs: side([row(0, season: 12.0)])
        )
        XCTAssertEqual(result.slots[0].leader, .even)
    }

    /// Two empty slots, or an empty slot against a bye, decide nothing.
    func testEmptyAgainstByeIsUndecided() {
        let result = MatchupModel.pair(
            mine: side([row(0, name: nil)]),
            theirs: side([row(0, season: 10, onBye: true)])
        )
        XCTAssertEqual(result.slots[0].leader, .undecided)
    }

    func testNoOpponentStillPairsMySide() {
        let result = MatchupModel.pair(mine: side([row(0, season: 10)]), theirs: nil)
        XCTAssertEqual(result.slots.count, 1)
        XCTAssertNil(result.slots[0].theirs)
        XCTAssertNil(result.slots[0].myShare)
    }
}
