import XCTest
@testable import FCCore

/// The QB, D/ST and K engines pinned to the reference implementation's output
/// on its frozen week-3 2026 dataset (32 players each), under all three
/// horizons, with the incumbent the reference used.
final class QBDSTKStreamParityTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ file: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Fixtures.data("qb-dst-k-stream/\(file)"))
    }

    private struct File<C: Decodable>: Decodable { let candidates: [C] }

    private func reference(_ file: String) throws -> [[String: Any]] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("qb-dst-k-stream/\(file)"))
        return try XCTUnwrap(json as? [[String: Any]])
    }

    private func check(_ name: String, _ ref: [String: Any], _ key: String, _ value: Double?, line: UInt = #line) {
        if ref[key] is NSNull, value == nil { return }
        guard let expected = (ref[key] as? NSNumber)?.doubleValue else { return XCTFail("\(name): no \(key)", line: line) }
        guard let value else { return XCTFail("\(name): nil \(key)", line: line) }
        XCTAssertEqual(value, expected, accuracy: 1e-6, "\(name) \(key)", line: line)
    }

    private func checkROS(_ name: String, _ ref: [String: Any], _ ros: StreamROS, perGame: Double, line: UInt = #line) {
        XCTAssertEqual(ros.games, ref["ros_games"] as? Int, "\(name) ros_games", line: line)
        check(name, ref, "ros_avg_dvp", ros.avgDvp, line: line)
        check(name, ref, "ros_per_game", perGame, line: line)
        check(name, ref, "ros_total", ros.total, line: line)
        check(name, ref, "playoff_avg_dvp", ros.playoffAvgDvp, line: line)
        XCTAssertEqual(ros.byeWeek, ref["bye_week"] as? Int, "\(name) bye", line: line)
        XCTAssertEqual(ros.hardest, ref["ros_hardest"] as? [String], "\(name) hardest", line: line)
        XCTAssertEqual(ros.easiest, ref["ros_easiest"] as? [String], "\(name) easiest", line: line)
    }

    private func checkDecision<P: StreamProjection>(_ p: P, _ ref: [String: Any], line: UInt = #line) {
        if ref["p_beat_incumbent"] is NSNull {
            XCTAssertNil(p.pBeatIncumbent, p.name, line: line)
        } else {
            check(p.name, ref, "p_beat_incumbent", p.pBeatIncumbent, line: line)
            check(p.name, ref, "exp_gain", p.expGain, line: line)
            XCTAssertEqual(p.bidBand?.label, ref["faab_band"] as? String, p.name, line: line)
        }
    }

    // MARK: QB

    func testQBMatchesReferenceUnderEveryHorizon() throws {
        let candidates = try decode(File<QBCandidate>.self, "qb_week3_2026.json").candidates
        XCTAssertEqual(candidates.count, 32)
        for horizon in StreamHorizon.allCases {
            let reference = try reference("qb_\(horizon.rawValue).json")
            let projections = candidates.map { QBStreamEngine.project($0, scoring: .referenceDefaults, horizon: horizon) }
            let incumbent = projections.first { $0.name == "Bryce Young" }
            let ranked = StreamDecision.rank(projections, incumbent: incumbent)
            XCTAssertEqual(ranked.map(\.name), reference.compactMap { $0["name"] as? String }, "QB order, \(horizon)")
            let byName = Dictionary(uniqueKeysWithValues: reference.map { ($0["name"] as! String, $0) })
            for p in ranked {
                let ref = try XCTUnwrap(byName[p.name])
                for (key, value) in [
                    ("exp_dropbacks", p.expDropbacks), ("env_mult", p.envMult), ("exp_att", p.expAtt), ("e_comp", p.eComp),
                    ("e_inc", p.eInc), ("comp_rate", p.compRate), ("e_pass_yd", p.ePassYd), ("e_pass_td", p.ePassTd),
                    ("e_int", p.eInt), ("e_sacks", p.eSacks), ("e_pass_fd", p.ePassFd), ("e_rush_att", p.eRushAtt),
                    ("e_rush_yd", p.eRushYd), ("e_rush_fd", p.eRushFd), ("e_rush_td", p.eRushTd), ("dvp_mult", p.dvpMult),
                    ("comp_adj", p.compAdj), ("sack_adj", p.sackAdj), ("int_adj", p.intAdj),
                    ("mean_if_plays", p.meanIfPlays), ("sd_if_plays", p.sdIfPlays), ("p_play", p.pPlay),
                    ("exp_pts", p.expPts), ("floor_p25", p.floorP25), ("ceiling_p75", p.ceilingP75),
                    ("utility", p.utility), ("neutral_mean", p.neutralMean),
                ] {
                    check(p.name, ref, key, value)
                }
                checkROS(p.name, ref, p.ros, perGame: p.ros.perGame)
                checkDecision(p, ref)
                XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
            }
        }
    }

    // MARK: D/ST

    func testDSTMatchesReferenceUnderEveryHorizon() throws {
        let candidates = try decode(File<DSTCandidate>.self, "dst_week3_2026.json").candidates
        XCTAssertEqual(candidates.count, 32)
        for horizon in StreamHorizon.allCases {
            let reference = try reference("dst_\(horizon.rawValue).json")
            let projections = candidates.map { DSTStreamEngine.project($0, scoring: .referenceDefaults, horizon: horizon) }
            let incumbent = projections.first { $0.name == "MIN D/ST" }
            let ranked = StreamDecision.rank(projections, incumbent: incumbent)
            XCTAssertEqual(ranked.map(\.name), reference.compactMap { $0["name"] as? String }, "D/ST order, \(horizon)")
            let byName = Dictionary(uniqueKeysWithValues: reference.map { ($0["name"] as! String, $0) })
            for p in ranked {
                let ref = try XCTUnwrap(byName[p.name])
                for (key, value) in [
                    ("exp_dropbacks", p.expDropbacks), ("e_sacks", p.eSacks), ("e_int", p.eInt), ("e_fr", p.eFr),
                    ("e_td", p.eTd), ("implied_opp", p.impliedOpp), ("pa_mean", p.paMean), ("pa_pts", p.paPts),
                    ("ya_mean", p.yaMean), ("ya_pts", p.yaPts), ("dvp_mult", p.dvpMult), ("qb_adj", p.qbAdj),
                    ("mean_if_plays", p.meanIfPlays), ("sd_if_plays", p.sdIfPlays), ("exp_pts", p.expPts),
                    ("floor_p25", p.floorP25), ("ceiling_p75", p.ceilingP75), ("utility", p.utility),
                    ("neutral_mean", p.neutralMean), ("ros_avg_opp_ppg", p.rosAvgOppPpg),
                ] {
                    check(p.name, ref, key, value)
                }
                checkROS(p.name, ref, p.ros, perGame: p.ros.perGame)
                checkDecision(p, ref)
                XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
            }
        }
    }

    // MARK: K

    func testKMatchesReferenceUnderEveryHorizon() throws {
        let candidates = try decode(File<KCandidate>.self, "k_week3_2026.json").candidates
        XCTAssertEqual(candidates.count, 32)
        for horizon in StreamHorizon.allCases {
            let reference = try reference("k_\(horizon.rawValue).json")
            let projections = candidates.map { KStreamEngine.project($0, scoring: .referenceDefaults, horizon: horizon) }
            let incumbent = projections.first { $0.name == "Harrison Butker" }
            let ranked = StreamDecision.rank(projections, incumbent: incumbent)
            XCTAssertEqual(ranked.map(\.name), reference.compactMap { $0["name"] as? String }, "K order, \(horizon)")
            let byName = Dictionary(uniqueKeysWithValues: reference.map { ($0["name"] as! String, $0) })
            for p in ranked {
                let ref = try XCTUnwrap(byName[p.name])
                for (key, value) in [
                    ("implied", p.implied), ("e_fga", p.eFga), ("e_fgm", p.eFgm), ("e_miss", p.eMiss),
                    ("e_xpa", p.eXpa), ("e_xpm", p.eXpm), ("e_50p_att", p.e50pAtt), ("stall", p.stall),
                    ("dvp_mult", p.dvpMult), ("wind_over", p.windOver), ("mean_if_plays", p.meanIfPlays),
                    ("sd_if_plays", p.sdIfPlays), ("exp_pts", p.expPts), ("floor_p25", p.floorP25),
                    ("ceiling_p75", p.ceilingP75), ("utility", p.utility), ("neutral_mean", p.neutralMean),
                ] {
                    check(p.name, ref, key, value)
                }
                checkROS(p.name, ref, p.ros, perGame: p.ros.perGame)
                checkDecision(p, ref)
                XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
            }
        }
    }
}

/// The shared rest-of-season layer and the league's own scoring.
final class StreamRestOfSeasonTests: XCTestCase {
    func testByeAndPlayoffWeeks() {
        let schedule = [1: "A", 2: "B", 3: "C", 4: "D", 6: "E", 15: "F", 16: "G", 17: "H"]
        let ros = StreamRestOfSeason.summary(currentWeek: 3, schedule: schedule,
                                             oppDvp: ["D": 10, "E": -20, "F": 30, "G": 0, "H": 20],
                                             dvpGames: 6, neutralMean: 10)
        XCTAssertEqual(ros.games, 5, "only weeks after the current one")
        XCTAssertEqual(ros.byeWeek, 5, "the first unscheduled week ahead")
        XCTAssertEqual(ros.playoffGames, 3)
        XCTAssertEqual(ros.playoffAvgDvp, 50.0 / 3, accuracy: 1e-9)
        XCTAssertEqual(ros.hardest.first, "W6 E (-20%)")
        XCTAssertEqual(ros.easiest.first, "W15 F (+30%)")
    }

    func testAnEmptyScheduleIsNeutral() {
        let ros = StreamRestOfSeason.summary(currentWeek: 3, schedule: [:], oppDvp: [:], dvpGames: 2, neutralMean: 12)
        XCTAssertEqual(ros.games, 0)
        XCTAssertEqual(ros.perGame, 12)
        XCTAssertEqual(ros.mult, 1)
    }

    func testHorizonWeights() {
        let week = StreamRestOfSeason.blendedUtility(expPts: 20, sd: 5, rosPerGame: 10, pPlay: 1, risk: .neutral, horizon: .week)
        let ros = StreamRestOfSeason.blendedUtility(expPts: 20, sd: 5, rosPerGame: 10, pPlay: 1, risk: .neutral, horizon: .ros)
        XCTAssertEqual(week, 20 - 0.2 * 5, accuracy: 1e-9)
        XCTAssertEqual(ros, 0.15 * 20 + 0.85 * 10 - 0.2 * 5 * (0.15 + 0.425), accuracy: 1e-9)
    }

    func testTheLeaguesScoringMapsFromSleeper() throws {
        let settings = try JSONDecoder().decode([String: Double].self, from: Fixtures.data("scoring-whack-a-mole.json"))
        let qb = QBScoring.from(sleeperSettings: settings)
        XCTAssertEqual(qb.incompletion, -1)
        XCTAssertEqual(qb.sack, -1)
        XCTAssertEqual(qb.interception + qb.pickSixExtra, -15, "Sleeper records a pick-six as both an INT and a pick-six")
        XCTAssertEqual(qb.bonus40, 2, "40+ completion")
        XCTAssertEqual(qb.touchdownBonus50, 8)

        let dst = DSTScoring.from(sleeperSettings: settings)
        XCTAssertEqual(dst.interception, 8)
        XCTAssertEqual(dst.pointsAllowed.first?.points, 15)
        XCTAssertEqual(dst.pointsAllowed.last?.points, -15)
        XCTAssertEqual(dst.yardsAllowed.first?.points, 20)
        XCTAssertFalse(dst.isReferencePlaceholder)
        XCTAssertTrue(DSTScoring.unmodelledKeys(sleeperSettings: settings).contains("def_3_and_out"))

        let k = KScoring.from(sleeperSettings: settings)
        XCTAssertEqual(k.make(.fifty), 6 + 12, "each FG made (6) plus the 50–59 value (12)")
        XCTAssertEqual(k.make(.sixty), 6 + 15)
        XCTAssertEqual(k.miss(.forty), -2)
        XCTAssertEqual(k.extraPoint, 4)
        XCTAssertEqual(k.extraPointMiss, -5)
    }

    func testALeagueWithoutDefenseScoringFallsBackToSleepersDefaults() {
        XCTAssertEqual(DSTScoring.from(sleeperSettings: ["pass_td": 4]), .referenceDefaults)
        XCTAssertTrue(DSTScoring.from(sleeperSettings: [:]).isReferencePlaceholder)
    }

    func testTierExpectedValueIsAWeightedAverageOfTheTiers() {
        let tiers = DSTScoring.referenceDefaults.pointsAllowed
        XCTAssertEqual(DSTStreamEngine.tierEV(mean: -50, sd: 1, tiers: tiers), 10, accuracy: 1e-9, "certain shutout")
        XCTAssertEqual(DSTStreamEngine.tierEV(mean: 100, sd: 1, tiers: tiers), -4, accuracy: 1e-9)
        let middle = DSTStreamEngine.tierEV(mean: 20, sd: 9.5, tiers: tiers)
        XCTAssertLessThan(middle, 7)
        XCTAssertGreaterThan(middle, -4)
    }
}
