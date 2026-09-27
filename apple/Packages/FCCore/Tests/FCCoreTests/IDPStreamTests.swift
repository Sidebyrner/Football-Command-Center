import XCTest
@testable import FCCore

/// The IDP streaming engine is pinned to the reference implementation's output
/// on its frozen week-3 2026 dataset: 34 researched candidates, incumbent Cedric
/// Gray, neutral risk. A mismatch means the port drifted from the reference.
final class IDPStreamParityTests: XCTestCase {
    private struct CandidatesFile: Decodable {
        let scoring: IDPScoring
        let candidates: [IDPCandidate]
    }

    private func candidatesFile() throws -> CandidatesFile {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(CandidatesFile.self, from: Fixtures.data("idp-stream/week3_2026_candidates.json"))
    }

    private func referenceRows() throws -> [String: [String: Any]] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("idp-stream/week3_2026_projections.json"))
        let rows = try XCTUnwrap(json as? [[String: Any]])
        return Dictionary(uniqueKeysWithValues: rows.compactMap { row in (row["name"] as? String).map { ($0, row) } })
    }

    func testMatchesReferenceProjectionsForEveryCandidate() throws {
        let file = try candidatesFile()
        XCTAssertEqual(file.candidates.count, 34)
        let reference = try referenceRows()
        let report = IDPStreamEngine.report(candidates: file.candidates, scoring: file.scoring,
                                            incumbentID: "Cedric Gray", risk: .neutral)
        let all = report.ranked + [report.incumbent].compactMap { $0 }
        XCTAssertEqual(all.count, 34)
        XCTAssertEqual(report.incumbent?.name, "Cedric Gray")

        for p in all {
            let ref = try XCTUnwrap(reference[p.name], "no reference row for \(p.name)")
            func check(_ key: String, _ value: Double, file: StaticString = #filePath, line: UInt = #line) {
                guard let expected = ref[key] as? Double else {
                    XCTFail("\(p.name): reference has no \(key)", file: file, line: line); return
                }
                XCTAssertEqual(value, expected, accuracy: 1e-6, "\(p.name) \(key)", file: file, line: line)
            }
            check("exp_plays", p.expPlays)
            check("snap_share", p.snapShare)
            check("e_solo", p.eSolo)
            check("e_ast", p.eAst)
            check("e_sack", p.eSack)
            check("e_tfl", p.eTfl)
            check("mean_if_plays", p.meanIfPlays)
            check("sd_if_plays", p.sdIfPlays)
            check("exp_pts", p.expPts)
            check("floor_p25", p.floorP25)
            check("ceiling_p75", p.ceilingP75)
            check("utility", p.utility)
            if p.name != "Cedric Gray" {
                check("p_beat_incumbent", try XCTUnwrap(p.pBeatIncumbent))
                check("exp_gain", try XCTUnwrap(p.expGain))
                XCTAssertEqual(p.bidBand?.label, ref["faab_band"] as? String, p.name)
            }
            XCTAssertEqual(p.flags, ref["flags"] as? [String], p.name)
        }
    }

    func testRankingOrderMatchesReference() throws {
        let file = try candidatesFile()
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("idp-stream/week3_2026_projections.json"))
        let referenceOrder = try XCTUnwrap(json as? [[String: Any]]).compactMap { $0["name"] as? String }
        let report = IDPStreamEngine.report(candidates: file.candidates, scoring: file.scoring, incumbentID: "Cedric Gray")
        XCTAssertEqual(report.ranked.map(\.name), referenceOrder.filter { $0 != "Cedric Gray" })
    }
}

final class IDPStreamEngineTests: XCTestCase {
    private let scoring = IDPScoring(solo: 2, ast: 1, sack: 5, tfl: 2)

    private func candidate(practice: StreamPractice = .none, statSnaps: Double = 0, dvpPct: Double = 0,
                           dvpGames: Int = 0) -> IDPCandidate {
        IDPCandidate(name: "Test LB", team: "TEN", position: .lb, opponent: "@NYG",
                     teamDefPlays: 124, teamGames: 2, snapShareLast1: 1, snapShareLast3: 1,
                     roleConf: 0.9, statSnaps: statSnaps, dvpPct: dvpPct, dvpGames: dvpGames,
                     practice: practice, available: true, playerID: "1")
    }

    func testNoStatsFallsBackToPositionPrior() {
        let p = IDPStreamEngine.project(candidate(), scoring: scoring)
        let prior = IDPStreamPriors.prior(for: .lb)
        XCTAssertEqual((p.eSolo + p.eAst) / (p.expSnaps * p.tklMult), prior.tackles, accuracy: 1e-9)
        XCTAssertTrue(p.flags.contains("thin conversion sample"))
    }

    func testOutPlayerProjectsZero() {
        let p = IDPStreamEngine.project(candidate(practice: .OUT), scoring: scoring)
        XCTAssertEqual(p.expPts, 0)
        XCTAssertEqual(p.floorP25, 0)
        XCTAssertEqual(p.ceilingP75, 0)
    }

    func testMatchupMultiplierIsCapped() {
        let huge = IDPStreamEngine.project(candidate(dvpPct: 500, dvpGames: 16), scoring: scoring)
        XCTAssertEqual(huge.tklMult, 1 + IDPStreamKnobs.dvpCap, accuracy: 1e-12)
        let ignored = IDPStreamEngine.project(candidate(dvpPct: 500, dvpGames: 0), scoring: scoring)
        XCTAssertEqual(ignored.tklMult, 1)
    }

    func testCeilingRiskRanksAboveFloorRisk() {
        let floor = IDPStreamEngine.project(candidate(), scoring: scoring, risk: .floor)
        let ceiling = IDPStreamEngine.project(candidate(), scoring: scoring, risk: .ceiling)
        XCTAssertGreaterThan(ceiling.utility, floor.utility)
        XCTAssertEqual(ceiling.expPts, floor.expPts)
    }

    func testIncumbentIsExcludedFromRankedAndOthersGetComparison() {
        var other = candidate()
        other.name = "Other"; other.playerID = "2"; other.snapShareLast1 = 0.5; other.snapShareLast3 = 0.5
        let report = IDPStreamEngine.report(candidates: [candidate(), other], scoring: scoring, incumbentID: "1")
        XCTAssertEqual(report.incumbent?.id, "1")
        XCTAssertEqual(report.ranked.map(\.id), ["2"])
        XCTAssertNotNil(report.ranked[0].pBeatIncumbent)
        XCTAssertLessThan(report.ranked[0].expGain ?? 0, 0)
    }

    func testOnlyAvailableDropsRosteredButKeepsIncumbent() {
        var mine = candidate(); mine.available = false
        var rival = candidate(); rival.playerID = "2"; rival.name = "Rival"; rival.available = false
        var open = candidate(); open.playerID = "3"; open.name = "Open"
        let report = IDPStreamEngine.report(candidates: [mine, rival, open], scoring: scoring,
                                            incumbentID: "1", onlyAvailable: true)
        XCTAssertEqual(report.incumbent?.id, "1")
        XCTAssertEqual(report.ranked.map(\.id), ["3"])
    }

    func testBidBandDollars() {
        XCTAssertEqual(StreamBidBand.forGain(7).dollars(remaining: 100), "$11–18")
        XCTAssertFalse(StreamBidBand.forGain(1).isSpend)
    }
}

final class IDPScoringTests: XCTestCase {
    func testPerTackleKeyStacksOnSoloAndAssist() {
        let s = IDPScoring.from(sleeperSettings: ["idp_tkl": 1, "idp_tkl_solo": 0.5, "idp_tkl_ast": 0])
        XCTAssertEqual(s.solo, 1.5)
        XCTAssertEqual(s.ast, 1)
    }

    func testMissingKeysScoreZero() {
        let s = IDPScoring.from(sleeperSettings: [:])
        XCTAssertEqual(s, IDPScoring())
    }

    func testWhackAMoleScoring() throws {
        let settings = try whackAMoleSettings()
        let s = IDPScoring.from(sleeperSettings: settings)
        XCTAssertEqual(s.solo, 2)
        XCTAssertEqual(s.ast, 1)
        XCTAssertEqual(s.sack, 5)
        XCTAssertEqual(s.tfl, 2)
        XCTAssertEqual(s.int, 5)
        XCTAssertEqual(s.ff, 3)
        XCTAssertEqual(s.qbHit, 0.5)
        XCTAssertEqual(s.pd, 0)
        let unmodelled = IDPScoring.unmodelledKeys(sleeperSettings: settings)
        XCTAssertTrue(unmodelled.contains("idp_fum_rec"))
        XCTAssertTrue(unmodelled.contains("idp_def_td"))
        XCTAssertFalse(unmodelled.contains("idp_sack"))
        XCTAssertFalse(unmodelled.contains("idp_tkl"), "zero-valued keys are not listed")
    }

    private func whackAMoleSettings() throws -> [String: Double] {
        let json = try JSONSerialization.jsonObject(with: Fixtures.data("scoring-whack-a-mole.json"))
        if let dict = json as? [String: Any], let nested = dict["scoring_settings"] as? [String: Double] { return nested }
        return try XCTUnwrap(json as? [String: Double])
    }
}

final class IDPStreamDegenerateTests: XCTestCase {
    /// A league with no IDP scoring gives every player zero points and zero
    /// spread; the comparison must stay a number so a snapshot can be saved.
    func testNoScoringGivesFiniteComparison() {
        let a = IDPCandidate(name: "A", team: "KC", position: .lb, opponent: "@MIA", playerID: "1")
        let b = IDPCandidate(name: "B", team: "KC", position: .lb, opponent: "@MIA", playerID: "2")
        let report = IDPStreamEngine.report(candidates: [a, b], scoring: IDPScoring(), incumbentID: "1")
        let p = try? XCTUnwrap(report.ranked.first?.pBeatIncumbent)
        XCTAssertEqual(p ?? .nan, 0.5, accuracy: 1e-9)
    }
}

final class IDPComparisonTests: XCTestCase {
    private let scoring = IDPScoring(solo: 2, ast: 1, sack: 5, tfl: 2, int: 5, ff: 3, qbHit: 0.5)

    private func player(_ id: String, share: Double, practice: StreamPractice = .none) -> IDPProjection {
        let c = IDPCandidate(name: id, team: "KC", position: .edge, opponent: "@MIA", teamDefPlays: 130, teamGames: 2,
                             snapShareLast1: share, snapShareLast3: share, roleConf: 0.8, statSnaps: 120,
                             solo: 6, ast: 4, sacks: 1, tfl: 2, qbHits: 3, practice: practice, playerID: id)
        return IDPStreamEngine.project(c, scoring: scoring)
    }

    func testBreakdownSumsToTheProjectionIfHePlays() {
        let p = player("a", share: 0.8)
        let breakdown = p.pointsBreakdown(scoring: scoring)
        XCTAssertEqual(breakdown.reduce(0) { $0 + $1.points }, p.meanIfPlays, accuracy: 1e-9)
        XCTAssertFalse(breakdown.contains { $0.stat == "Pass def" }, "stats the league does not pay for are left out")
        XCTAssertEqual(breakdown.map(\.points), breakdown.map(\.points).sorted(by: >))
    }

    func testHeadToHeadIsComplementaryWithANilDiagonal() {
        let comparison = IDPComparison(players: [player("a", share: 0.9), player("b", share: 0.6), player("c", share: 0.4)])
        for i in 0..<3 {
            XCTAssertNil(comparison.headToHead[i][i])
            for j in 0..<3 where i != j {
                let sum = (comparison.headToHead[i][j] ?? 0) + (comparison.headToHead[j][i] ?? 0)
                XCTAssertEqual(sum, 1, accuracy: 1e-9)
            }
        }
        XCTAssertGreaterThan(comparison.headToHead[0][2] ?? 0, 0.5, "the bigger role wins more often")
    }
}

final class StreamVerdictTests: XCTestCase {
    private let scoring = IDPScoring(solo: 2, ast: 1, sack: 5, tfl: 2)

    private func player(_ id: String, share: Double, roleConf: Double = 0.85) -> IDPProjection {
        let c = IDPCandidate(name: id, team: "KC", position: .lb, opponent: "@MIA", teamDefPlays: 130, teamGames: 2,
                             snapShareLast1: share, snapShareLast3: share, roleConf: roleConf, statSnaps: 120,
                             solo: 8, ast: 5, playerID: id)
        return IDPStreamEngine.project(c, scoring: scoring)
    }

    func testNoVerdictForOnePlayer() {
        XCTAssertNil(IDPComparison(players: [player("a", share: 1)]).verdict)
    }

    func testClearLeaderIsNamedWithOddsAgainstEveryone() throws {
        let comparison = IDPComparison(players: [player("low", share: 0.4), player("high", share: 1.0), player("mid", share: 0.7)])
        let verdict = try XCTUnwrap(comparison.verdict)
        XCTAssertEqual(comparison.players[verdict.leader].id, "high")
        XCTAssertEqual(verdict.odds.map(\.index), [0, 2])
        XCTAssertTrue(verdict.odds.allSatisfy { $0.pBeats > 0.5 })
        XCTAssertEqual(comparison.players[verdict.runnerUp].id, "mid")
        XCTAssertGreaterThan(verdict.margin, 0)
    }

    func testNearTwinsAreATossUp() throws {
        let verdict = try XCTUnwrap(IDPComparison(players: [player("a", share: 0.90), player("b", share: 0.91)]).verdict)
        XCTAssertEqual(verdict.confidence, .tossUp)
    }
}
