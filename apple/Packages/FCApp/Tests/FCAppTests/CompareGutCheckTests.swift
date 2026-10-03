import XCTest
import FCCore
@testable import FCApp

final class CompareGutCheckTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func week(_ week: Int, points: Double?, expected: Double? = nil, snaps: Double? = nil) -> PlayerLogWeek {
        PlayerLogWeek(week: week, opponent: nil, played: true, points: points, snapShare: snaps, targets: nil,
                      rushAttempts: nil, expectedPoints: expected, projected: nil)
    }

    private func player(_ name: String, log: [PlayerLogWeek] = [], values: [PlayerComparison.Metric: Double] = [:],
                        ceiling: Double? = nil) -> PlayerComparison.Player {
        PlayerComparison.Player(id: name.lowercased(), name: name, position: .wr, team: nil, opponent: nil, seriesIndex: 0,
                                log: log, values: values, floor: nil, expected: nil, ceiling: ceiling)
    }

    private func texts(_ points: [CompareGutCheck.Point]) -> String { points.map(\.text).joined(separator: " | ") }

    func testUnluckyPlayerHasACase() {
        let bravo = player("Bravo", log: [week(1, points: 6, expected: 11), week(2, points: 7, expected: 12)])
        let check = CompareGutCheck.assess(pick: player("Alpha"), alternative: bravo, margin: 0.3, now: now)
        XCTAssertTrue(texts(check.caseForAlternative).contains("Scoring 5.0 pts/gm under his expected points"),
                      texts(check.caseForAlternative))
        XCTAssertEqual(check.caseForAlternative.first?.strength, 2)
    }

    func testLuckFallsBackToTheTableValues() {
        let bravo = player("Bravo", values: [.expectedPointsLast4: 12, .pointsPerGame: 9])
        XCTAssertEqual(CompareGutCheck.luck(bravo), 3)
    }

    func testAGrowingRoleAndAHotStretch() {
        let log = [week(1, points: 5, snaps: 0.40), week(2, points: 6, snaps: 0.46),
                   week(3, points: 14, snaps: 0.70), week(4, points: 16, snaps: 0.76)]
        let bravo = player("Bravo", log: log, values: [.pointsPerGame: 9])
        let text = texts(CompareGutCheck.assess(pick: player("Alpha"), alternative: bravo, margin: 0.3, now: now).caseForAlternative)
        XCTAssertTrue(text.contains("Snap share up from 43% to 73%"), text)
        XCTAssertTrue(text.contains("Averaging 12.0 over his last 3, up from 9.0"), text)
    }

    func testCeilingDepthAndSchedule() {
        var alpha = player("Alpha", values: [.depthRank: 2], ceiling: 18)
        alpha.strengthOfSchedule = 0.95
        var bravo = player("Bravo", values: [.depthRank: 1], ceiling: 27)
        bravo.strengthOfSchedule = 1.10
        let text = texts(CompareGutCheck.assess(pick: alpha, alternative: bravo, margin: 0.3, now: now).caseForAlternative)
        XCTAssertTrue(text.contains("Best game 27.0 vs 18.0"), text)
        XCTAssertTrue(text.contains("First on his depth chart; Alpha is No. 2."), text)
        XCTAssertTrue(text.contains("Softer schedule ahead (1.10× vs 0.95×)"), text)
    }

    func testRisksForThePick() {
        var alpha = player("Alpha", values: [.expectedPointsLast4: 8, .pointsPerGame: 13])
        alpha.injuryDesignation = "Questionable"
        let check = CompareGutCheck.assess(pick: alpha, alternative: player("Bravo"), margin: 0.3, now: now)
        let text = texts(check.risksForPick)
        XCTAssertTrue(text.contains("Alpha is listed Questionable."), text)
        XCTAssertTrue(text.contains("scoring 5.0 pts/gm over his expected points"), text)
    }

    func testRecentNewsIsContextOnlyAndOldNewsIsDropped() {
        var bravo = player("Bravo")
        bravo.headline = .init(title: "Named the starter", published: now.addingTimeInterval(-3_600))
        let fresh = CompareGutCheck.assess(pick: player("Alpha"), alternative: bravo, margin: 0.3, now: now)
        XCTAssertEqual(fresh.caseForAlternative.map(\.strength), [0])
        XCTAssertEqual(fresh.confidence, .clear, "news alone doesn't move the call")

        bravo.headline = .init(title: "Old news", published: now.addingTimeInterval(-10 * 24 * 3_600))
        XCTAssertTrue(CompareGutCheck.assess(pick: player("Alpha"), alternative: bravo, margin: 0.3, now: now).caseForAlternative.isEmpty)
    }

    func testConfidenceBands() {
        let strong = player("Bravo", log: [week(1, points: 4, expected: 10), week(2, points: 5, expected: 11)], ceiling: 30)
        XCTAssertEqual(CompareGutCheck.assess(pick: player("Alpha"), alternative: player("Bravo"), margin: 0.02, now: now).confidence,
                       .coinFlip, "a tiny margin is a coin flip on its own")
        XCTAssertEqual(CompareGutCheck.assess(pick: player("Alpha"), alternative: strong, margin: 0.10, now: now).confidence,
                       .coinFlip, "a strong case inside a lean margin")
        XCTAssertEqual(CompareGutCheck.assess(pick: player("Alpha"), alternative: player("Bravo"), margin: 0.08, now: now).confidence,
                       .lean)
        XCTAssertEqual(CompareGutCheck.assess(pick: player("Alpha"), alternative: strong, margin: 0.4, now: now).confidence,
                       .lean, "a big margin with a real case is still only a lean")
        let clear = CompareGutCheck.assess(pick: player("Alpha"), alternative: player("Bravo"), margin: 0.4, now: now)
        XCTAssertEqual(clear.confidence, .clear)
        XCTAssertTrue(clear.summary.contains("Paper and gut agree"), clear.summary)
    }

    func testBuildFollowsTheVerdictsPickAndAlternative() {
        var alpha = player("Alpha", values: [.restOfSeason: 14, .projectedThisWeek: 14, .expectedPointsLast4: 14])
        alpha.availability = .mine
        var bravo = player("Bravo", values: [.restOfSeason: 9, .projectedThisWeek: 9, .expectedPointsLast4: 9])
        bravo.availability = .freeAgent
        let comparison = PlayerComparison(players: [alpha, bravo], lastN: 4, weeks: [])
        let verdict = CompareVerdict.compute(CompareVerdict.inputs(from: comparison),
                                             league: .init(waivers: .reverseStandings, teamCount: 8))
        let check = CompareGutCheck.build(comparison: comparison, verdict: verdict, now: now)
        XCTAssertEqual(check?.pickName, "Alpha")
        XCTAssertEqual(check?.alternativeName, "Bravo")

        let single = PlayerComparison(players: [alpha], lastN: 4, weeks: [])
        let alone = CompareVerdict.compute(CompareVerdict.inputs(from: single), league: .init(waivers: .reverseStandings))
        XCTAssertNil(CompareGutCheck.build(comparison: single, verdict: alone, now: now))
    }
}
