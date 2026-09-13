import Foundation

/// Floor, median and ceiling a player **actually produced**, plus the spread.
///
/// This is not a modelled range. The web app also has a modelled floor/ceiling
/// estimated from season-long rate stats; the two are different claims and the
/// UI must label them differently. Do not merge them (§5.2).
public struct Distribution: Hashable, Sendable {
    /// 20th percentile of scored weeks.
    public let floor: Double?
    public let median: Double?
    /// 80th percentile of scored weeks.
    public let ceiling: Double?
    public let mean: Double?
    public let standardDeviation: Double?
    /// Coefficient of variation — comparable across players with different
    /// volumes, unlike raw standard deviation. `nil` rather than an infinity
    /// when the mean is at or near zero.
    public let coefficientOfVariation: Double?
    public let sampleCount: Int

    public static let empty = Distribution(
        floor: nil, median: nil, ceiling: nil, mean: nil,
        standardDeviation: nil, coefficientOfVariation: nil, sampleCount: 0
    )

    /// Below this mean, a coefficient of variation is noise dressed as a number.
    public static let minimumMeanForCoefficient: Double = 0.5

    /// p20/p80 rather than min/max on purpose: one injury exit and one
    /// garbage-time touchdown should not define a player's range.
    public init(points: [Double]) {
        let values = points.filter { $0.isFinite }
        guard !values.isEmpty else {
            self = .empty
            return
        }

        let ascending = values.sorted()
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
        let standardDeviation = variance.squareRoot()

        self.floor = Distribution.percentile(ascending, 0.2).map { roundHalfUp($0, places: 2) }
        self.median = Distribution.percentile(ascending, 0.5).map { roundHalfUp($0, places: 2) }
        self.ceiling = Distribution.percentile(ascending, 0.8).map { roundHalfUp($0, places: 2) }
        self.mean = roundHalfUp(mean, places: 2)
        self.standardDeviation = roundHalfUp(standardDeviation, places: 2)
        self.coefficientOfVariation = mean > Distribution.minimumMeanForCoefficient
            ? roundHalfUp(standardDeviation / mean, places: 2)
            : nil
        self.sampleCount = values.count
    }

    public init(weeks: [ScoredWeek]) {
        self.init(points: weeks.map(\.points))
    }

    private init(
        floor: Double?, median: Double?, ceiling: Double?, mean: Double?,
        standardDeviation: Double?, coefficientOfVariation: Double?, sampleCount: Int
    ) {
        self.floor = floor
        self.median = median
        self.ceiling = ceiling
        self.mean = mean
        self.standardDeviation = standardDeviation
        self.coefficientOfVariation = coefficientOfVariation
        self.sampleCount = sampleCount
    }

    /// Linear-interpolated percentile over an ascending array.
    static func percentile(_ ascending: [Double], _ quantile: Double) -> Double? {
        guard let first = ascending.first else { return nil }
        guard ascending.count > 1 else { return first }
        let index = Double(ascending.count - 1) * quantile
        let low = Int(index.rounded(.down))
        let high = Int(index.rounded(.up))
        if low == high { return ascending[low] }
        return ascending[low] + (ascending[high] - ascending[low]) * (index - Double(low))
    }
}
