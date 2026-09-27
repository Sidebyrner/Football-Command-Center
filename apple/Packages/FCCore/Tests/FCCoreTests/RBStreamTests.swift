import XCTest
@testable import FCCore

/// The RB engine is pinned to the reference implementation's output on its
/// frozen week-3 2026 dataset: 15 researched backs, reference scoring, and the
/// incumbent the reference used (Tyler Allgeier).
final class RBStreamParityTests: XCTestCase {
    private struct CandidatesFile: Decodable {
        let candidates: [RBCandidate]
    }

    private func candidates() throws -> [RBCandidate] {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(CandidatesFile.self, from: Fixtures.data("rb-stream/week3_2026_candidates.json")).candidates
    }

    private func rows(_ fixture: String) throws -> [String: [String: Any]] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("rb-stream/\(fixture)"))
        let rows = try XCTUnwrap(json as? [[String: Any]])
        return Dictionary(uniqueKeysWithValues: rows.compactMap { r in (r["name"] as? String).map { ($0, r) } })
    }

    private func check(_ p: RBProjection, _ ref: [String: Any], _ key: String, _ value: Double?,
                       line: UInt = #line) {
        guard let expected = ref[key] as? Double else { return XCTFail("\(p.name): no \(key)", line: line) }
        guard let value else { return XCTFail("\(p.name): nil \(key)", line: line) }
        XCTAssertEqual(value, expected, accuracy: 1e-6, "\(p.name) \(key)", line: line)
    }

    func testMatchesReferenceProjectionsForEveryBack() throws {
        let all = try candidates()
        XCTAssertEqual(all.count, 15)
        let reference = try rows("week3_2026_rb_projections.json")
        for c in all {
            let p = RBStreamEngine.project(c, scoring: .referenceDefaults)
            let ref = try XCTUnwrap(reference[p.name], "no reference row for \(p.name)")
            check(p, ref, "exp_rush_att", p.expRushAttempts)
            check(p, ref, "exp_pass_att", p.expPassAttempts)
            check(p, ref, "rush_env", p.rushEnv)
            check(p, ref, "pass_env", p.passEnv)
            check(p, ref, "implied", p.implied)
            check(p, ref, "implied_mult", p.impliedMult)
            check(p, ref, "carry_share", p.carryShare)
            check(p, ref, "tgt_share", p.targetShare)
            check(p, ref, "exp_carries", p.expCarries)
            check(p, ref, "exp_targets", p.expTargets)
            check(p, ref, "dvp_mult", p.dvpMult)
            check(p, ref, "line_mult", p.lineMult)
            check(p, ref, "rz_mult", p.redZoneMult)
            check(p, ref, "e_rush_yd", p.eRushYd)
            check(p, ref, "e_rush_fd", p.eRushFirstDowns)
            check(p, ref, "e_rush_td", p.eRushTouchdowns)
            check(p, ref, "e_rec", p.eRec)
            check(p, ref, "e_rec_yd", p.eRecYd)
            check(p, ref, "e_rec_fd", p.eRecFirstDowns)
            check(p, ref, "e_rec_td", p.eRecTouchdowns)
            check(p, ref, "e_30", p.e30)
            check(p, ref, "e_40", p.e40)
            check(p, ref, "e_50", p.e50)
            check(p, ref, "e_fumbles", p.eFumbles)
            check(p, ref, "mean_if_plays", p.meanIfPlays)
            check(p, ref, "sd_if_plays", p.sdIfPlays)
            check(p, ref, "exp_pts", p.expPts)
            check(p, ref, "floor_p25", p.floorP25)
            check(p, ref, "ceiling_p75", p.ceilingP75)
            check(p, ref, "utility", p.utility)
            XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
        }
    }

    func testRankingOrderMatchesReference() throws {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("rb-stream/week3_2026_rb_projections.json"))
        let order = try XCTUnwrap(json as? [[String: Any]]).compactMap { $0["name"] as? String }
        let report = RBStreamEngine.report(candidates: try candidates(), scoring: .referenceDefaults)
        XCTAssertEqual(report.ranked.map(\.name), order)
    }

    private func checkAgainstIncumbentFixture(_ fixture: String, scoring: RBScoring) throws {
        let expected = try rows(fixture)
        let report = RBStreamEngine.report(candidates: try candidates(), scoring: scoring, incumbentID: "Tyler Allgeier")
        XCTAssertEqual(report.incumbent?.name, "Tyler Allgeier")
        let all = report.ranked + [report.incumbent].compactMap { $0 }
        XCTAssertEqual(all.count, expected.count)
        for p in all {
            let ref = try XCTUnwrap(expected[p.name], "no expected row for \(p.name)")
            check(p, ref, "exp_pts", p.expPts)
            check(p, ref, "utility", p.utility)
            check(p, ref, "sd_if_plays", p.sdIfPlays)
            check(p, ref, "mean_if_plays", p.meanIfPlays)
            check(p, ref, "floor_p25", p.floorP25)
            check(p, ref, "ceiling_p75", p.ceilingP75)
            check(p, ref, "exp_carries", p.expCarries)
            check(p, ref, "exp_targets", p.expTargets)
            if p.name != "Tyler Allgeier" { check(p, ref, "p_beat_incumbent", p.pBeatIncumbent) }
        }
    }

    func testMatchesReferenceAgainstTheIncumbent() throws {
        try checkAgainstIncumbentFixture("expected_rb_week3.json", scoring: .referenceDefaults)
    }

    func testMatchesReferenceWithLongPlayBonuses() throws {
        var scoring = RBScoring.referenceDefaults
        scoring.setLongPlayBonuses(2, 3, 5)
        try checkAgainstIncumbentFixture("expected_rb_week3_bonus235.json", scoring: scoring)
    }
}

final class RBScoringTests: XCTestCase {
    private func whackAMole() throws -> [String: Double] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("scoring-whack-a-mole.json"))
        if let dict = json as? [String: Any], let nested = dict["scoring_settings"] as? [String: Double] { return nested }
        return try XCTUnwrap(json as? [String: Double])
    }

    func testRunsAndCatchesAreTieredSeparately() throws {
        let s = RBScoring.from(sleeperSettings: try whackAMole())
        XCTAssertEqual(s.rushingYard, 0.1)
        XCTAssertEqual(s.firstDown, 1)
        XCTAssertEqual(s.touchdown, 6)
        XCTAssertEqual(s.runBonus30, 0, "no 30–39 run tier in this league")
        XCTAssertEqual(s.runBonus40, 2)
        XCTAssertEqual(s.catchBonus30, 1)
        XCTAssertEqual(s.catchBonus30 + s.catchBonus40, 2)
        XCTAssertEqual(s.touchdownBonus40, 4)
        XCTAssertEqual(s.touchdownBonus50, 8)
        // A lost fumble records both fum and fum_lost: −3 and −5 more.
        XCTAssertEqual(s.fumble, -3)
        XCTAssertEqual(s.fumbleLost, -5)
        let unmodelled = RBScoring.unmodelledKeys(sleeperSettings: try whackAMole())
        XCTAssertTrue(unmodelled.contains("bonus_rush_yd_200"))
        XCTAssertTrue(unmodelled.contains("rush_2pt"))
        XCTAssertFalse(unmodelled.contains("rush_fd"))
    }

    private func back(spread: Double) -> RBCandidate {
        RBCandidate(name: "Back", team: "KC", role: .lead, opponent: "@MIA", spreadOff: spread, total: 46,
                    teamRushAttempts: 52, teamPassAttempts: 66, teamGames: 2, carryShareLast1: 0.5, carryShareLast3: 0.5,
                    roleConf: 0.8, statCarries: 26, rushYards: 120, rushFirstDowns: 7, rushTouchdowns: 1,
                    runs30: 1, runs40: 1, runs50: 1)
    }

    func testFavoritesRunMoreAndScoreMore() {
        let fav = RBStreamEngine.project(back(spread: -7), scoring: .referenceDefaults)
        let dog = RBStreamEngine.project(back(spread: 7), scoring: .referenceDefaults)
        XCTAssertGreaterThan(fav.expCarries, dog.expCarries)
        XCTAssertGreaterThan(fav.implied, dog.implied)
        XCTAssertGreaterThan(dog.expTargets, fav.expTargets, "underdogs throw more")
    }

    func testLongRushingTouchdownsOnlyAddWhenScored() {
        var scoring = RBScoring.referenceDefaults
        let without = RBStreamEngine.project(back(spread: 0), scoring: scoring)
        scoring.touchdownBonus40 = 4; scoring.touchdownBonus50 = 8
        let with = RBStreamEngine.project(back(spread: 0), scoring: scoring)
        XCTAssertEqual(with.meanIfPlays - without.meanIfPlays, with.eTouchdowns40 * 4 + with.eTouchdowns50 * 8, accuracy: 1e-9)
        XCTAssertEqual(with.pointsBreakdown(scoring: scoring).reduce(0) { $0 + $1.points }, with.meanIfPlays, accuracy: 1e-9)
    }

    func testCatchTiersScoreOnlyTheReceivingLongPlays() {
        var runOnly = RBScoring.referenceDefaults
        runOnly.runBonus40 = 2
        var catchOnly = RBScoring.referenceDefaults
        catchOnly.catchBonus40 = 2
        let base = RBStreamEngine.project(back(spread: 0), scoring: .referenceDefaults)
        let r = RBStreamEngine.project(back(spread: 0), scoring: runOnly)
        let c = RBStreamEngine.project(back(spread: 0), scoring: catchOnly)
        XCTAssertEqual(r.meanIfPlays - base.meanIfPlays, 2 * base.eRun40, accuracy: 1e-9)
        XCTAssertEqual(c.meanIfPlays - base.meanIfPlays, 2 * (base.e40 - base.eRun40), accuracy: 1e-9)
    }
}
