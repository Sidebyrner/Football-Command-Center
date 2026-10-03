import XCTest
import FCCore
@testable import FCApp

final class CompareVerdictTests: XCTestCase {
    private let priorityLeague = CompareVerdict.League(waivers: .reverseStandings, waiverPosition: 3, teamCount: 8, currentWeek: 4)

    private func fa(_ id: String, ros: Double?, adds: Double? = nil, playoffs: Double? = nil,
                    injury: String? = nil) -> CompareVerdict.Input {
        CompareVerdict.Input(id: id, name: id.capitalized, availability: .freeAgent, restOfSeason: ros,
                             projectedThisWeek: ros, expectedPointsLast4: ros, trendingAdds: adds,
                             playoffMatchups: playoffs, injuryDesignation: injury)
    }

    func testRanksTargetsAndNamesTheTopTwo() {
        let verdict = CompareVerdict.compute([fa("low", ros: 6), fa("high", ros: 14), fa("mid", ros: 10)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.map(\.id), ["high", "mid", "low"])
        XCTAssertEqual(verdict.headline, "Best add: High, then Mid")
        XCTAssertNil(verdict.faab, "a priority league never shows a bid")
    }

    private func mine(_ id: String, ros: Double?, baseline: Bool = false) -> CompareVerdict.Input {
        var input = fa(id, ros: ros)
        input.availability = .mine
        input.isBaseline = baseline
        return input
    }

    func testYourBetterPlayerIsKept() {
        let verdict = CompareVerdict.compute([mine("mine", ros: 30), fa("target", ros: 8)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.map(\.id), ["mine", "target"], "your own player is ranked with everyone else")
        XCTAssertTrue(verdict.ranked[0].isMine)
        XCTAssertTrue(verdict.ranked[0].isBaseline)
        XCTAssertEqual(verdict.headline, "Keep Mine over Target")
        guard case .keep(let text) = verdict.priority else { return XCTFail("\(verdict.priority)") }
        XCTAssertTrue(text.contains("22.0 pts/gm less"), text)
        XCTAssertEqual(verdict.pickID, "mine")
        XCTAssertEqual(verdict.alternativeID, "target")
        XCTAssertNil(verdict.faab)
    }

    func testAClearUpgradeSaysAddAndDrop() {
        let verdict = CompareVerdict.compute([mine("mine", ros: 8), fa("big", ros: 12)], league: priorityLeague)
        XCTAssertEqual(verdict.headline, "Add Big, drop Mine")
        guard case .spend(let text) = verdict.priority else { return XCTFail("\(verdict.priority)") }
        XCTAssertTrue(text.contains("+4.0 pts/gm over Mine"), text)
        XCTAssertEqual(verdict.pickID, "big")
        XCTAssertEqual(verdict.alternativeID, "mine")
    }

    func testASmallUpgradeKeepsYourPlayer() {
        let verdict = CompareVerdict.compute([mine("mine", ros: 8), fa("small", ros: 9)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.first?.id, "small", "he edges it on paper")
        XCTAssertEqual(verdict.headline, "Keep Mine over Small")
        guard case .keep(let text) = verdict.priority else { return XCTFail("\(verdict.priority)") }
        XCTAssertTrue(text.contains("only +1.0 pts/gm"), text)
    }

    func testWithoutAChosenBaselineYourWeakestPlayerIsTheYardstick() {
        let verdict = CompareVerdict.compute([mine("star", ros: 20), mine("scrub", ros: 6), fa("target", ros: 10)],
                                             league: priorityLeague)
        XCTAssertEqual(verdict.ranked.map(\.id), ["star", "target", "scrub"])
        XCTAssertEqual(verdict.ranked.first { $0.isBaseline }?.id, "scrub")
        XCTAssertEqual(verdict.headline, "Add Target, drop Scrub")
    }

    func testAChosenBaselineWins() {
        let verdict = CompareVerdict.compute([mine("star", ros: 20, baseline: true), mine("scrub", ros: 6), fa("target", ros: 10)],
                                             league: priorityLeague)
        XCTAssertEqual(verdict.headline, "Keep Star over Target")
    }

    func testARivalTargetAheadOfYourPlayerIsATrade() {
        var starter = fa("starter", ros: 20)
        starter.availability = .rivalStarter(rosterID: 2, manager: "Mike")
        let verdict = CompareVerdict.compute([mine("mine", ros: 6), starter], league: priorityLeague)
        XCTAssertEqual(verdict.headline, "Best target: Starter (trade — Mike), over Mine")
        guard case .notAClaim = verdict.priority else { return XCTFail("\(verdict.priority)") }
    }

    func testAllYoursRanksThem() {
        let verdict = CompareVerdict.compute([mine("a", ros: 6), mine("b", ros: 12)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.map(\.id), ["b", "a"])
        XCTAssertEqual(verdict.headline, "B ranks highest of yours")
        guard case .nothing = verdict.priority else { return XCTFail("\(verdict.priority)") }
    }

    func testARivalStarterIsDiscountedAndReadsAsATrade() {
        var starter = fa("starter", ros: 12)
        starter.availability = .rivalStarter(rosterID: 2, manager: "Mike")
        let close = CompareVerdict.compute([starter, fa("free", ros: 11.5)], league: priorityLeague)
        XCTAssertEqual(close.ranked.first?.id, "free", "a hard trade ask loses a close call to a free claim")

        let runaway = CompareVerdict.compute([starter, fa("free", ros: 4)], league: priorityLeague)
        XCTAssertEqual(runaway.ranked.first?.id, "starter")
        XCTAssertTrue(runaway.headline.hasPrefix("Best target: Starter (trade — Mike)"))
        guard case .notAClaim = runaway.priority else { return XCTFail("\(runaway.priority)") }
    }

    func testAnInjuryPushesAPlayerDown() {
        let verdict = CompareVerdict.compute([fa("hurt", ros: 12, injury: "Out"), fa("healthy", ros: 11)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.first?.id, "healthy")
        XCTAssertTrue(verdict.ranked.last?.reasons.contains("Out") == true)
    }

    func testMissingMeasuresAreFlaggedAsThin() {
        let sparse = CompareVerdict.Input(id: "sparse", name: "Sparse", availability: .freeAgent, pointsPerGame: 9)
        let verdict = CompareVerdict.compute([sparse, fa("full", ros: 9, adds: 10, playoffs: 1)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.first { $0.id == "sparse" }?.thinData, true)
        XCTAssertEqual(verdict.ranked.first { $0.id == "full" }?.thinData, false)
    }

    func testAgainstABaselineTheGapDecidesSpendOrKeep() {
        let base = mine("mine", ros: 8, baseline: true)
        let upgrade = CompareVerdict.compute([base, fa("big", ros: 10.5)], league: priorityLeague)
        guard case .spend(let spend) = upgrade.priority else { return XCTFail("\(upgrade.priority)") }
        XCTAssertTrue(spend.contains("+2.5 pts/gm over Mine"), spend)
        XCTAssertTrue(spend.contains("waiver priority"))

        let marginal = CompareVerdict.compute([base, fa("small", ros: 9)], league: priorityLeague)
        guard case .keep(let keep) = marginal.priority else { return XCTFail("\(marginal.priority)") }
        XCTAssertTrue(keep.contains("only +1.0"), keep)
        XCTAssertFalse(keep.contains("back of the order"))
    }

    func testWithoutABaselineDemandDecides() {
        let contested = CompareVerdict.compute([fa("hot", ros: 12, adds: 40_000), fa("next", ros: 9, adds: 200)], league: priorityLeague)
        guard case .spend = contested.priority else { return XCTFail("\(contested.priority)") }
        let quiet = CompareVerdict.compute([fa("quiet", ros: 12, adds: 50), fa("next", ros: 9, adds: 20)], league: priorityLeague)
        guard case .hold(let text) = quiet.priority else { return XCTFail("\(quiet.priority)") }
        XCTAssertTrue(text.contains("clear waivers"), text)
        XCTAssertFalse(text.contains("back of the order"))
    }

    func testNearTheBackOfTheOrderAHoldSaysAClaimIsCheap() {
        let league = CompareVerdict.League(waivers: .reverseStandings, waiverPosition: 8, teamCount: 8, currentWeek: 4)
        let verdict = CompareVerdict.compute([fa("quiet", ros: 12), fa("next", ros: 11)], league: league)
        XCTAssertTrue(verdict.priority.text.contains("back of the order"), verdict.priority.text)
    }

    func testNothingToGoAfter() {
        let verdict = CompareVerdict.compute([mine("mine", ros: 8)], league: priorityLeague)
        XCTAssertEqual(verdict.ranked.map(\.id), ["mine"])
        XCTAssertEqual(verdict.headline, "Mine is yours")
        XCTAssertNil(verdict.alternativeID)
        guard case .nothing = verdict.priority else { return XCTFail("\(verdict.priority)") }
    }

    func testAKeepNeverShowsABid() {
        let league = CompareVerdict.League(waivers: .faab(budget: 100), faabRemaining: 60, currentWeek: 4)
        XCTAssertNil(CompareVerdict.compute([mine("mine", ros: 14), fa("target", ros: 8, adds: 40_000)], league: league).faab)
        XCTAssertNotNil(CompareVerdict.compute([mine("mine", ros: 6), fa("target", ros: 14, adds: 40_000)], league: league).faab)
    }

    func testAFAABBidStaysInsideTheBudgetAndScalesWithTheCall() throws {
        let league = CompareVerdict.League(waivers: .faab(budget: 100), faabRemaining: 60, currentWeek: 4, playoffStartWeek: 15)
        let hot = try XCTUnwrap(CompareVerdict.compute([fa("hot", ros: 14, adds: 40_000), fa("next", ros: 8)], league: league).faab)
        let quiet = try XCTUnwrap(CompareVerdict.compute([fa("quiet", ros: 12, adds: 10), fa("next", ros: 11.5)], league: league).faab)
        XCTAssertGreaterThan(hot.low, quiet.high, "a contested difference-maker gets a real bid")
        for bid in [hot, quiet] {
            XCTAssertGreaterThanOrEqual(bid.low, 0)
            XCTAssertLessThanOrEqual(bid.high, 60)
            XCTAssertLessThanOrEqual(bid.low, bid.high)
        }
        let broke = CompareVerdict.League(waivers: .faab(budget: 100), faabRemaining: 0, currentWeek: 4)
        XCTAssertNil(CompareVerdict.compute([fa("hot", ros: 14)], league: broke).faab)
    }
}
