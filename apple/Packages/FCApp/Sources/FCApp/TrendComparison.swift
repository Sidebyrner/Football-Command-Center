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

/// One chart on a Compare panel: a metric, raw or smoothed, stored as
/// `metric` or `metric:3`.
public struct TrendChartSpec: Hashable, Sendable {
    public var metric: PlayerMetric
    /// 1 is raw; 3 is a 3-game rolling average.
    public var smoothing: Int

    public init(metric: PlayerMetric, smoothing: Int = 1) {
        self.metric = metric
        self.smoothing = smoothing
    }

    init?(token: Substring) {
        let parts = token.split(separator: ":")
        guard let metric = parts.first.flatMap({ TrendComparison.metric(storedAs: String($0)) }) else { return nil }
        self.init(metric: metric, smoothing: parts.count > 1 && parts[1] == "3" ? 3 : 1)
    }

    var token: String { smoothing > 1 ? "\(metric.rawValue):\(smoothing)" : metric.rawValue }
}

/// One card on a Compare panel: a trend chart of any metric, or one of the
/// fixed sections. A panel keeps its cards in order in `extra["charts"]`:
/// charts as `metric` or `metric:3`, sections as `@name`.
public enum CompareCardSpec: Hashable, Sendable, Identifiable {
    case trend(TrendChartSpec)
    case section(Section)

    public enum Section: String, CaseIterable, Hashable, Sendable, Identifiable {
        case perGame, table, range, profile, usage, schedule, status, verdict, availability

        public var id: String { rawValue }

        public var title: String {
            switch self {
            case .perGame: return "Per game"
            case .table: return "Side by side"
            case .range: return "Range this season"
            case .profile: return "Position profile"
            case .usage: return "Usage mix"
            case .schedule: return "Schedule ahead"
            case .status: return "Status & situation"
            case .verdict: return "Verdict"
            case .availability: return "Availability & news"
            }
        }

        public var blurb: String {
            switch self {
            case .perGame: return "Points, xFP, projection and rest of season as bars"
            case .table: return "The key numbers in a table, best picked out"
            case .range: return "Worst and best game against this week's projection"
            case .profile: return "Percentiles against his own position — works across positions"
            case .usage: return "Expected points from rushing vs receiving, against what he scored"
            case .schedule: return "The next five weeks, shaded by how soft each defense is"
            case .status: return "Injury, practice, depth chart, team total and situation"
            case .verdict: return "Keep your player or go after someone — and whether it's worth the claim"
            case .availability: return "Free agent or rostered, Sleeper adds, latest headline, bye and playoff weeks"
            }
        }

        public var systemImage: String {
            switch self {
            case .perGame: return "chart.bar"
            case .table: return "tablecells"
            case .range: return "arrow.left.and.right"
            case .profile: return "person.crop.rectangle.stack"
            case .usage: return "chart.bar.doc.horizontal"
            case .schedule: return "calendar"
            case .status: return "cross.case"
            case .verdict: return "checkmark.seal"
            case .availability: return "newspaper"
            }
        }
    }

    public var id: String { token }

    var token: String {
        switch self {
        case .trend(let spec): return spec.token
        case .section(let section): return "@" + section.rawValue
        }
    }

    public static let maxCards = 10
    /// What a Compare panel shows before anyone edits it.
    public static let defaults: [CompareCardSpec] = [.trend(TrendChartSpec(metric: .fantasyPoints)),
                                                      .section(.perGame), .section(.table), .section(.range)]
    /// Sections every panel had before they became cards.
    static let formerlyFixed: [CompareCardSpec] = [.section(.perGame), .section(.table), .section(.range)]
    /// Marks a list saved as cards when it holds no section, so it isn't
    /// read as one from before sections were cards.
    static let formatMarker = "@cards"

    /// The stored list; unset is the defaults. A list with no `@` token was
    /// saved when only charts were cards, so the sections that were fixed
    /// below them come back after them.
    public static func list(from stored: String?) -> [CompareCardSpec] {
        guard let stored else { return defaults }
        let tokens = stored.split(separator: ",")
        var out: [CompareCardSpec] = []
        var sections: Set<Section> = []
        for token in tokens {
            if token.hasPrefix("@") {
                guard let section = Section(rawValue: String(token.dropFirst())), sections.insert(section).inserted else { continue }
                out.append(.section(section))
            } else if let spec = TrendChartSpec(token: token) {
                out.append(.trend(spec))
            }
        }
        if !tokens.contains(where: { $0.hasPrefix("@") }) { out += formerlyFixed }
        return Array(out.prefix(maxCards))
    }

    public static func encode(_ cards: [CompareCardSpec]) -> String {
        let tokens = cards.prefix(maxCards).map(\.token)
        let hasSection = cards.contains { if case .section = $0 { return true } else { return false } }
        return (hasSection ? tokens : [formatMarker] + tokens).joined(separator: ",")
    }
}
