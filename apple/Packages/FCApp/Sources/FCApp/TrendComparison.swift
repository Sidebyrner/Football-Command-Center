import Foundation
import FCCore

/// Several players' weekly trend on one metric, ready to overlay on one chart:
/// the link colour's compare list, plus whoever was clicked if he isn't in it.
public struct TrendComparison: Sendable {
    public struct Line: Identifiable, Hashable, Sendable {
        public let id: String
        public let name: String
        public let position: Position?
        /// Index in the compare list — the chart colour — or `nil` for a
        /// clicked player who isn't being compared.
        public let compareIndex: Int?
        public let isFocused: Bool
        /// Weeks he played, oldest first, the last N — smoothed when asked.
        public let points: [MetricPoint]
        public let summary: MetricSummary?
        /// False when the metric doesn't apply to his position.
        public let applies: Bool
    }

    /// Whose trend the chart shows.
    public enum Scope: String, CaseIterable, Sendable {
        /// The compare list, plus the clicked player.
        case compare
        /// Only the clicked player.
        case player

        public var label: String {
            switch self {
            case .compare: return "Compare list + clicked"
            case .player: return "Clicked player only"
            }
        }
    }

    public let metric: PlayerMetric
    public let lines: [Line]
    /// Every week any line has, ascending.
    public var weeks: [Int] { Array(Set(lines.flatMap { $0.points.map(\.week) })).sorted() }

    @MainActor
    public static func build(index: PlayerMetricsIndex, metric: PlayerMetric, compareIDs: [String], focusedID: String?,
                             scope: Scope, lastN: Int, smoothing: Int = 1) -> TrendComparison {
        var ids: [(id: String, compareIndex: Int?)] = []
        if scope == .compare {
            ids = compareIDs.enumerated().map { ($0.element, $0.offset) }
        }
        if let focusedID, !ids.contains(where: { $0.id == focusedID }) {
            ids.append((focusedID, nil))
        }
        let context = index.context
        let lines = ids.map { entry -> Line in
            let position = context.position(entry.id)
            let applies = metric.applies(to: position)
            let raw = applies ? index.series(metric, playerID: entry.id) : []
            let window = Array(raw.suffix(max(lastN, 1)))
            return Line(
                id: entry.id, name: context.playerName(entry.id) ?? entry.id, position: position,
                compareIndex: entry.compareIndex, isFocused: entry.id == focusedID,
                points: smoothed(window, over: smoothing, history: raw),
                summary: applies ? index.summary(metric, playerID: entry.id) : nil,
                applies: applies
            )
        }
        return TrendComparison(metric: metric, lines: lines)
    }

    /// A rolling average of `window` games at each point, looking back into
    /// the full history so the first point in view is averaged too.
    public static func smoothed(_ points: [MetricPoint], over window: Int, history: [MetricPoint]) -> [MetricPoint] {
        guard window > 1 else { return points }
        return points.map { point in
            let upTo = history.filter { $0.week <= point.week }.suffix(window)
            let mean = upTo.map(\.value).reduce(0, +) / Double(max(upTo.count, 1))
            return MetricPoint(week: point.week, value: mean)
        }
    }

    /// The metric a stored setting names, reading the Trend panel's older keys.
    public static func metric(storedAs key: String?) -> PlayerMetric? {
        guard let key else { return nil }
        if key == "points" { return .fantasyPoints }
        return PlayerMetric(rawValue: key)
    }
}
