import XCTest
@testable import FCCore

final class PlayerGradeTests: XCTestCase {
    /// Reproduces `percentile.js`: the fraction of the cohort at or below.
    func testPercentileRankMatchesTheWebApp() {
        let cohort: [Double] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        XCTAssertEqual(Percentile.rank(5, in: cohort), 0.5)
        XCTAssertEqual(Percentile.rank(10, in: cohort), 1)
        XCTAssertEqual(Percentile.rank(0.5, in: cohort), 0)
        XCTAssertEqual(Percentile.rank(5.5, in: cohort), 0.5)
        XCTAssertEqual(Percentile.rank(5, in: []), 0.5)
    }

    private let cohort: [Double] = (1...20).map(Double.init)

    func testGradeIsTheWeightedPercentileOverMetricsWithData() {
        let grade = PlayerGrade.compute(
            metrics: [.targetShare: 15, .targetsPerGame: 20, .dropRate: 2],
            cohorts: [.targetShare: cohort, .targetsPerGame: cohort, .dropRate: cohort, .snapShare: cohort],
            weights: [.targetShare: 10, .targetsPerGame: 10, .dropRate: 10, .snapShare: 10]
        )
        // 0.75×10 + 1.0×10 + (1−0.1)×10 = 26.5 over 30 used weight → 88.
        XCTAssertEqual(grade.score, 88)
        XCTAssertEqual(grade.coverage, 0.75)
        XCTAssertEqual(grade.missing, [.snapShare])
        XCTAssertFalse(grade.isThin)
        XCTAssertEqual(grade.tier, "Tier 1 — Elite")
        XCTAssertEqual(grade.topFactors.first?.metric, .targetsPerGame)
        XCTAssertEqual(grade.factors.first { $0.metric == .dropRate }?.percentile, 0.9, "inverted: fewer drops is better")
    }

    func testAThinCohortOrMissingValueIsExcludedNotDefaulted() {
        let grade = PlayerGrade.compute(
            metrics: [.targetShare: 15],
            cohorts: [.targetShare: [1, 2, 3], .snapShare: cohort],
            weights: [.targetShare: 10, .snapShare: 10]
        )
        XCTAssertNil(grade.score, "nothing had both a value and a cohort")
        XCTAssertEqual(grade.coverage, 0)
        XCTAssertTrue(grade.isThin)
        XCTAssertNil(grade.tier)
    }

    func testProfileNudgesWeightsTowardWhatTheLeaguePays() {
        var profile = ScoringProfile.leagueDefault
        profile.receptionPoints = 0
        profile.incompletion = -1
        profile.idpSack = 5
        profile.idpTackle = 0
        let wr = GradeWeights.applyProfile(GradeWeights.weekly(for: .wr), profile: profile)
        XCTAssertEqual(wr[.targetsPerGame], 7)
        XCTAssertEqual(wr[.yardsPerTarget], 9)
        let qb = GradeWeights.applyProfile(GradeWeights.weekly(for: .qb), profile: profile)
        XCTAssertEqual(qb[.completionPct], 11)
        let lb = GradeWeights.applyProfile(GradeWeights.weekly(for: .lb), profile: profile)
        XCTAssertEqual(lb[.sacksPerGame], 9)
        XCTAssertEqual(lb[.tacklesPerGame], 5)
        XCTAssertNil(lb[.targetShare], "only metrics in the table move")
    }

    func testWeightedGradeFoldsChipsUnderVisibleWeightsAndReportsCoverage() {
        let grade = PlayerGrade.compute(
            metrics: [.pointsPerGame: 20], cohorts: [.pointsPerGame: cohort], weights: [.pointsPerGame: 10]
        )
        let chips = [
            SituationChip(metric: .quarterbackPlay, value: 80, percentile: 0.5, detail: "", comparedTo: "32 teams"),
            SituationChip(metric: .teamPace, value: 60, percentile: nil, detail: "", comparedTo: ""),
        ]
        let weighted = WeightedGrade.compute(grade: grade, chips: chips, weights: ["cohortGrade": 50, "quarterbackPlay": 50])
        // Grade 1.0×50 + QB 0.5×50 = 75 over 100 used → 75; the other chips are
        // missing and count against coverage at their default weights.
        XCTAssertEqual(weighted.score, 75)
        XCTAssertTrue(weighted.missing.contains("Team pace"))
        XCTAssertLessThan(weighted.coverage, 1)
        XCTAssertEqual(weighted.parts.first?.name, "Cohort grade")
    }
}
