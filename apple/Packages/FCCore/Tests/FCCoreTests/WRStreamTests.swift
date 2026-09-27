import XCTest
@testable import FCCore

/// The WR engine is pinned to the reference implementation's output on its
/// frozen week-3 2026 dataset: 19 researched receivers, reference scoring.
final class WRStreamParityTests: XCTestCase {
    private struct CandidatesFile: Decodable {
        let candidates: [WRCandidate]
    }

    private func candidates() throws -> [WRCandidate] {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(CandidatesFile.self, from: Fixtures.data("wr-stream/week3_2026_candidates.json")).candidates
    }

    private func reference() throws -> [[String: Any]] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("wr-stream/week3_2026_wr_projections.json"))
        return try XCTUnwrap(json as? [[String: Any]])
    }

    func testMatchesReferenceProjectionsForEveryReceiver() throws {
        let all = try candidates()
        XCTAssertEqual(all.count, 19)
        let rows = Dictionary(uniqueKeysWithValues: try reference().compactMap { r in (r["name"] as? String).map { ($0, r) } })
        for c in all {
            let p = WRStreamEngine.project(c, scoring: .referenceDefaults)
            let ref = try XCTUnwrap(rows[p.name], "no reference row for \(p.name)")
            func check(_ key: String, _ value: Double, line: UInt = #line) {
                guard let expected = ref[key] as? Double else { return XCTFail("\(p.name): no \(key)", line: line) }
                XCTAssertEqual(value, expected, accuracy: 1e-6, "\(p.name) \(key)", line: line)
            }
            check("exp_pass_att", p.expPassAttempts)
            check("env_mult", p.envMult)
            check("tgt_share", p.targetShare)
            check("exp_targets", p.expTargets)
            check("dvp_mult", p.dvpMult)
            check("cov_mult", p.coverageMult)
            check("rz_mult", p.redZoneMult)
            check("e_rec", p.eRec)
            check("e_rec_yd", p.eRecYd)
            check("e_fd", p.eFirstDowns)
            check("e_td", p.eTouchdowns)
            check("e_30", p.e30)
            check("e_40", p.e40)
            check("e_50", p.e50)
            check("e_rush_yd", p.eRushYd)
            check("e_rush_fd", p.eRushFirstDowns)
            check("mean_if_plays", p.meanIfPlays)
            check("sd_if_plays", p.sdIfPlays)
            check("p_play", p.pPlay)
            check("exp_pts", p.expPts)
            check("floor_p25", p.floorP25)
            check("ceiling_p75", p.ceilingP75)
            check("utility", p.utility)
            XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
        }
    }

    func testRankingOrderMatchesReference() throws {
        let report = WRStreamEngine.report(candidates: try candidates(), scoring: .referenceDefaults)
        XCTAssertEqual(report.ranked.map(\.name), try reference().compactMap { $0["name"] as? String })
    }

    /// The reference's second report sets illustrative stacked bonuses 2/3/5;
    /// its E[pts] column is printed to one decimal.
    func testMatchesReferenceWithLongCatchBonuses() throws {
        var scoring = WRScoring.referenceDefaults
        scoring.bonus30 = 2; scoring.bonus40 = 3; scoring.bonus50 = 5
        let text = try XCTUnwrap(String(data: Fixtures.data("wr-stream/week3_2026_wr_stream_report_with_bonuses.md"), encoding: .utf8))
        var expected: [String: Double] = [:]
        for line in text.split(separator: "\n") where line.hasPrefix("| ") {
            let cells = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
            guard cells.count > 6, Int(cells[0]) != nil, let pts = Double(cells[5]) else { continue }
            expected[cells[1]] = pts
        }
        XCTAssertEqual(expected.count, 19)
        for c in try candidates() {
            let p = WRStreamEngine.project(c, scoring: scoring)
            XCTAssertEqual(p.expPts, try XCTUnwrap(expected[p.name]), accuracy: 0.05, p.name)
        }
    }
}

final class WRScoringTests: XCTestCase {
    private func whackAMole() throws -> [String: Double] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("scoring-whack-a-mole.json"))
        if let dict = json as? [String: Any], let nested = dict["scoring_settings"] as? [String: Double] { return nested }
        return try XCTUnwrap(json as? [String: Double])
    }

    func testSleeperRangesBecomeStackedTiers() throws {
        let s = WRScoring.from(sleeperSettings: try whackAMole())
        XCTAssertEqual(s.reception, 0)
        XCTAssertEqual(s.receivingYard, 0.1)
        XCTAssertEqual(s.firstDown, 1)
        XCTAssertEqual(s.touchdown, 6)
        XCTAssertEqual(s.bonus30, 1)
        XCTAssertEqual(s.bonus40, 1, "a 40+ catch earns rec_40p = 2 in total")
        XCTAssertEqual(s.bonus30 + s.bonus40, 2)
        XCTAssertEqual(s.bonus50, 0, "no rec_50p key in this league")
        XCTAssertEqual(s.touchdownBonus40, 4)
        XCTAssertEqual(s.touchdownBonus50, 8)
        let unmodelled = WRScoring.unmodelledKeys(sleeperSettings: try whackAMole())
        XCTAssertTrue(unmodelled.contains("bonus_rec_yd_200"))
        XCTAssertTrue(unmodelled.contains("rec_2pt"))
        XCTAssertFalse(unmodelled.contains("rec_fd"))
    }

    func testLongTouchdownBonusesOnlyAddWhenScored() {
        let c = WRCandidate(name: "Deep", team: "CLE", role: .deep, opponent: "vs CAR", teamPassAttempts: 66, teamGames: 2,
                            targetShareLast1: 0.2, targetShareLast3: 0.2, roleConf: 0.8, statTargets: 12, receptions: 6,
                            receivingYards: 140, firstDowns: 5, touchdowns: 2, catches30: 2, catches40: 2, catches50: 1)
        var scoring = WRScoring.referenceDefaults
        let without = WRStreamEngine.project(c, scoring: scoring)
        XCTAssertGreaterThan(without.eTouchdowns40, 0)
        scoring.touchdownBonus40 = 4; scoring.touchdownBonus50 = 8
        let with = WRStreamEngine.project(c, scoring: scoring)
        XCTAssertEqual(with.meanIfPlays - without.meanIfPlays, with.eTouchdowns40 * 4 + with.eTouchdowns50 * 8, accuracy: 1e-9)
        XCTAssertGreaterThan(with.sdIfPlays, without.sdIfPlays)
        XCTAssertEqual(with.pointsBreakdown(scoring: scoring).reduce(0) { $0 + $1.points }, with.meanIfPlays, accuracy: 1e-9)
    }

    func testRolePriorsApplyWithNoStats() {
        let c = WRCandidate(name: "New", team: "KC", role: .slot, opponent: "@MIA")
        let p = WRStreamEngine.project(c, scoring: .referenceDefaults)
        XCTAssertEqual(p.targetShare, WRStreamPriors.targetShare(for: .slot), accuracy: 0.03)
        XCTAssertTrue(p.flags.contains("thin target sample"))
        XCTAssertTrue(p.flags.contains("target share estimated"))
    }
}
