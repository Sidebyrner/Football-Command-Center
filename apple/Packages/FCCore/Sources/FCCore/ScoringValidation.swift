import Foundation

/// Result of the scoring correctness gate.
public struct ScoringGateReport: Hashable, Sendable {
    public let checkedRows: Int
    public let skippedRows: Int
    public let maxDelta: Double
    public let mismatchRows: Int
    public let worst: [Mismatch]

    public struct Mismatch: Hashable, Sendable {
        public let gsisID: String
        public let week: Int
        public let team: String?
        public let position: Position?
        public let ours: Double
        public let nflverse: Double
        public let delta: Double
    }

    public var passed: Bool { mismatchRows == 0 }
}

public extension ScoringEngine {
    /// Deltas above this count as a mismatch. The file carries points to the
    /// cent, so anything larger is a real arithmetic disagreement rather than a
    /// float artefact.
    static let referenceTolerance: Double = 0.01

    /// The correctness gate: score every row under `ScoringProfile.pprReference`
    /// and compare to that row's own nflverse `fantasy_points_ppr`.
    ///
    /// This is the highest-value test in the codebase because it proves the
    /// engine against thousands of real stat lines rather than a handful of
    /// hand-written cases (§4).
    ///
    /// Kickers are excluded: nflverse reports PPR points as zero for K, so a
    /// comparison there measures nothing. Team defenses are excluded because the
    /// file has no rows for them at all.
    static func validateAgainstReference(
        file: WeeklyFile,
        maximumMismatchesRecorded: Int = 5
    ) -> ScoringGateReport {
        var checked = 0
        var skipped = 0
        var maxDelta: Double = 0
        var mismatches = 0
        var worst: [ScoringGateReport.Mismatch] = []

        for player in file.allPlayers() {
            let position = player.position
            for row in player.rows {
                if position == .k || position == .def {
                    skipped += 1
                    continue
                }
                guard let reference = row.value(.pprReference) else {
                    skipped += 1
                    continue
                }
                guard let points = score(row, profile: .pprReference, position: position).points
                else {
                    skipped += 1
                    continue
                }

                checked += 1
                let delta = abs(points - reference)
                if delta > maxDelta { maxDelta = delta }
                if delta > referenceTolerance {
                    mismatches += 1
                    if worst.count < maximumMismatchesRecorded {
                        worst.append(
                            ScoringGateReport.Mismatch(
                                gsisID: player.gsisID, week: row.week, team: row.team,
                                position: position, ours: points, nflverse: reference,
                                delta: delta
                            )
                        )
                    }
                }
            }
        }

        return ScoringGateReport(
            checkedRows: checked,
            skippedRows: skipped,
            maxDelta: roundHalfUp(maxDelta, places: 3),
            mismatchRows: mismatches,
            worst: worst
        )
    }
}
