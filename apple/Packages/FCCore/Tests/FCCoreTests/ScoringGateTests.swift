import XCTest
@testable import FCCore

/// The correctness gate: score every row in the shipped weekly file under the
/// PPR reference profile and compare to that row's own nflverse
/// `fantasy_points_ppr`.
///
/// This is the highest-value test in the package. It proves the engine against
/// thousands of real stat lines rather than a handful of hand-written cases, so
/// a sign flip, a unit error, or a missing term cannot survive it (§4, §10).
final class ScoringGateTests: XCTestCase {
    func testEveryRowMatchesNflverseReference() throws {
        let file = try Fixtures.weekly2025()
        let report = ScoringEngine.validateAgainstReference(file: file)

        XCTAssertEqual(report.mismatchRows, 0, "worst disagreements: \(report.worst)")
        XCTAssertEqual(report.maxDelta, 0, accuracy: ScoringEngine.referenceTolerance)
        XCTAssertTrue(report.passed)
    }

    /// A gate that checks nothing passes trivially. The shipped 2025 file has
    /// 6,580 rows, of which 6,037 are checkable — kickers and rows without a
    /// reference value are the rest.
    func testGateActuallyBites() throws {
        let file = try Fixtures.weekly2025()
        let report = ScoringEngine.validateAgainstReference(file: file)

        XCTAssertEqual(report.checkedRows, 6_037)
        XCTAssertEqual(report.skippedRows, 543)
        XCTAssertEqual(report.checkedRows + report.skippedRows, file.rowCount)
    }

    /// Kickers are excluded on purpose: nflverse reports PPR points as zero for
    /// K, so a comparison there measures nothing.
    func testKickersAreSkippedRatherThanFailed() throws {
        let file = try Fixtures.weekly2025()
        let kickerRows = file.allPlayers()
            .filter { $0.meta?.position == .k }
            .reduce(0) { $0 + $1.rows.count }

        XCTAssertGreaterThan(kickerRows, 0, "fixture should contain kickers")

        let report = ScoringEngine.validateAgainstReference(file: file)
        XCTAssertGreaterThanOrEqual(report.skippedRows, kickerRows)
    }

    /// A deliberately broken profile must fail the gate. Without this, a gate
    /// that always passes would look identical to a gate that works.
    func testGateDetectsASignFlip() throws {
        let file = try Fixtures.weekly2025()
        var broken = ScoringProfile.pprReference
        broken.rushingTD = -6

        // Re-run the comparison by hand against the broken profile.
        var mismatches = 0
        for player in file.allPlayers() {
            let position = player.position
            if position == .k || position == .def { continue }
            for row in player.rows {
                guard let reference = row.value(.pprReference),
                      let points = ScoringEngine.score(
                        row, profile: broken, position: position
                      ).points
                else { continue }
                if abs(points - reference) > ScoringEngine.referenceTolerance { mismatches += 1 }
            }
        }

        XCTAssertGreaterThan(mismatches, 100, "a flipped rushing TD must break many rows")
    }
}
