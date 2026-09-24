import Foundation

/// Percentile rank against a real cohort — never a fabricated distribution.
public enum Percentile {
    /// The fraction of `sortedPeers` at or below `value`, 0…1. `peers` must be
    /// sorted ascending; the cohorts are built sorted so this stays a binary
    /// search on the hot path. An empty cohort answers 0.5, as the web app
    /// does, but callers should not ask: a percentile against nobody is not a
    /// percentile, and `PlayerGrade` drops such metrics instead.
    public static func rank(_ value: Double, in sortedPeers: [Double]) -> Double {
        guard !sortedPeers.isEmpty, value.isFinite else { return 0.5 }
        var low = 0
        var high = sortedPeers.count
        while low < high {
            let mid = (low + high) >> 1
            if sortedPeers[mid] <= value { low = mid + 1 } else { high = mid }
        }
        return Double(low) / Double(sortedPeers.count)
    }
}
