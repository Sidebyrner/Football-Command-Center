import XCTest
import FCCore
@testable import FCApp

final class StartVerdictTests: XCTestCase {
    /// Every point signal at one value, so a test can move just the ones it
    /// cares about.
    private func player(_ id: String, _ value: Double, position: Position = .wr, incumbent: Bool = false,
                        freeAgent: Bool = false, _ overrides: [StartSignal: Double?] = [:]) -> StartVerdict.Input {
        var signals: [StartSignal: Double] = [:]
        for signal in StartSignal.allCases where signal != .environment { signals[signal] = value }
        signals[.environment] = 22
        for (signal, value) in overrides { signals[signal] = value }
        return StartVerdict.Input(id: id, name: id.capitalized, position: position, isFreeAgent: freeAgent,
                                  isIncumbent: incumbent, signals: signals)
    }

    func testThePlayerWhoWinsTheMostHeadToHeadsStarts() {
        let verdict = StartVerdict.compute(
            [player("waddle", 10, incumbent: true), player("pittman", 13), player("addison", 8)],
            posture: .close(2), slot: "WR2"
        )
        XCTAssertEqual(verdict.ranked.map(\.id), ["pittman", "waddle", "addison"])
        XCTAssertEqual(verdict.headline, "Start Pittman over Waddle")
        XCTAssertEqual(verdict.alternativeID, "waddle", "the incumbent is the one passed over")
        XCTAssertEqual(verdict.confidence, .clear)
        XCTAssertEqual(verdict.edgeLine, "Beats Waddle on 5 of 6 signals.", "environment is level, so it doesn't count")
        XCTAssertEqual(verdict.votingSignals.count, 6, "a close matchup leaves floor and ceiling as context")
    }

    func testOutByeLockedAndRivalPlayersCantStart() {
        var out = player("out", 30); out.availability = .unavailable("Out")
        var bye = player("bye", 30); bye.onBye = true
        var locked = player("locked", 30); locked.isLocked = true
        var rival = player("rival", 30); rival.rivalManager = "Sam"
        let verdict = StartVerdict.compute([out, bye, locked, rival, player("ok", 5)], posture: .unknown, slot: "WR1")
        XCTAssertEqual(verdict.ranked.map(\.id), ["ok"])
        XCTAssertEqual(verdict.blocked.map(\.reason), ["Out", "On bye", "Game has started", "On Sam's roster"])
        XCTAssertEqual(verdict.headline, "Start Ok at WR1")
    }

    func testNobodyEligible() {
        var out = player("out", 30); out.availability = .unavailable("IR")
        let verdict = StartVerdict.compute([out], posture: .unknown)
        XCTAssertNil(verdict.pickID)
        XCTAssertEqual(verdict.headline, "Nobody here can start this week")
    }

    func testDeadHeatGoesToTheProjection() {
        let verdict = StartVerdict.compute(
            [player("a", 10, [.projected: 10.2]), player("b", 10, [.projected: 10.4])],
            posture: .close(0), slot: "FLEX"
        )
        XCTAssertEqual(verdict.pickID, "b", "inside every tie band, the higher projection breaks the tie")
        XCTAssertEqual(verdict.confidence, .coinFlip)
    }

    func testPostureDecidesWhetherFloorOrCeilingCounts() {
        // Even on everything but range: steady has the floor, boom the ceiling.
        let steady = player("steady", 10, [.floor: 8, .ceiling: 12])
        let boom = player("boom", 10, [.floor: 3, .ceiling: 20])
        let ahead = StartVerdict.compute([steady, boom], posture: .favourite(14))
        XCTAssertEqual(ahead.pickID, "steady")
        XCTAssertEqual(ahead.postureLine, "You're projected +14.0, so Floor counts — protect the lead.")
        let behind = StartVerdict.compute([steady, boom], posture: .underdog(-10))
        XCTAssertEqual(behind.pickID, "boom")
        XCTAssertTrue(behind.votingSignals.contains(.ceiling))
        XCTAssertFalse(behind.votingSignals.contains(.floor))
    }

    func testPostureThresholds() {
        XCTAssertEqual(MatchupPosture.from(mine: 120, theirs: 112), .favourite(8))
        guard case .close = MatchupPosture.from(mine: 100, theirs: 107.9) else { return XCTFail("inside the margin is close") }
        XCTAssertEqual(MatchupPosture.from(mine: nil, theirs: 100), .unknown)
    }

    func testThinDataCapsAtLean() {
        let sparse: [StartSignal: Double?] = [.commandCenter: nil, .thisSeason: nil, .form: nil, .usage: nil, .environment: nil]
        // Projected and floor are all there is: a big gap, but two signals.
        let verdict = StartVerdict.compute([player("a", 20, sparse), player("b", 5, sparse)], posture: .favourite(10))
        XCTAssertTrue(verdict.thinData)
        XCTAssertEqual(verdict.confidence, .lean)
    }

    func testQuestionableWhoMissedPracticeCapsAtLean() {
        var hurt = player("hurt", 20)
        hurt.availability = .questionable
        hurt.practice = .didNotParticipate
        let verdict = StartVerdict.compute([hurt, player("backup", 8)], posture: .close(0))
        XCTAssertEqual(verdict.pickID, "hurt", "Questionable is ranked on his full value, as in Sit/Start")
        XCTAssertEqual(verdict.confidence, .lean)
    }

    func testContingencyNamesALaterPivot() {
        let sunday = Date(timeIntervalSince1970: 1_791_000_000)
        var hurt = player("hurt", 20); hurt.availability = .questionable; hurt.kickoff = sunday
        var late = player("late", 9); late.kickoff = sunday.addingTimeInterval(3 * 3600)
        let verdict = StartVerdict.compute([hurt, late], posture: .close(0))
        XCTAssertEqual(verdict.contingency,
                       "Hurt is questionable. Inactives come out about 90 minutes before his kickoff — if he's out, swap to Late, who plays later.")
    }

    func testContingencyWarnsWhenThereIsNoPivot() {
        let sunday = Date(timeIntervalSince1970: 1_791_000_000)
        var hurt = player("hurt", 20); hurt.availability = .questionable; hurt.kickoff = sunday.addingTimeInterval(7 * 3600)
        var early = player("early", 9); early.kickoff = sunday
        let verdict = StartVerdict.compute([hurt, early], posture: .close(0))
        XCTAssertEqual(verdict.contingency,
                       "Hurt is questionable and there's no later pivot — Early doesn't play after him. If you can't wait on him, start Early.")
    }

    func testAFreeAgentWhoWinsIsAnAddAndStart() {
        let verdict = StartVerdict.compute(
            [player("starter", 8, incumbent: true), player("dell", 14, freeAgent: true)], posture: .close(0), slot: "WR2"
        )
        XCTAssertEqual(verdict.headline, "Add Dell, start over Starter")
        XCTAssertTrue(verdict.pickIsFreeAgent)
        XCTAssertEqual(verdict.notes.first, "Check Dell can be added before his kickoff — he may still be on waivers.")
    }

    func testFlexMixesPositionsAndSaysSo() {
        let verdict = StartVerdict.compute(
            [player("rb", 12, position: .rb, incumbent: true), player("wr", 11, position: .wr), player("te", 9, position: .te)],
            posture: .close(0), slot: "FLEX"
        )
        XCTAssertEqual(verdict.headline, "Keep Rb in at FLEX")
        XCTAssertEqual(verdict.alternativeID, "wr", "the incumbent won, so the runner-up is the alternative")
        XCTAssertTrue(verdict.notes.contains { $0.hasPrefix("Mixed positions") })
    }

    func testEmptySlot() {
        let verdict = StartVerdict.compute([player("a", 12), player("b", 6)], posture: .close(0), slot: "TE")
        XCTAssertEqual(verdict.headline, "Start A at TE")
    }

    func testOutsideALineupNamesTheRunnerUp() {
        let verdict = StartVerdict.compute([player("a", 12), player("b", 6)], posture: .unknown)
        XCTAssertEqual(verdict.headline, "Start A over B")
    }

    func testSignalLeaders() {
        let verdict = StartVerdict.compute([player("a", 12, [.usage: 4]), player("b", 6)], posture: .unknown)
        XCTAssertEqual(verdict.signalLeaders[.projected], "a")
        XCTAssertEqual(verdict.signalLeaders[.usage], "b")
        XCTAssertNil(verdict.signalLeaders[.environment], "level values have no leader")
        XCTAssertEqual(verdict.ranked[0].topOn, [.projected, .commandCenter, .thisSeason, .form])
    }
}
