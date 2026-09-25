import SwiftUI
import Charts
import FCCore

/// What the Trend panel plots. Stored in `PanelSettings.extra["metric"]`.
enum TrendMetric: String, CaseIterable, Identifiable {
    case points, snapShare, targets, expectedPoints

    var id: String { rawValue }

    var label: String {
        switch self {
        case .points: return "Points"
        case .snapShare: return "Snap share"
        case .targets: return "Targets"
        case .expectedPoints: return "xFP"
        }
    }

    var isPercent: Bool { self == .snapShare }

    func value(_ week: PlayerLogWeek) -> Double? {
        switch self {
        case .points: return week.points
        case .snapShare: return week.snapShare
        case .targets: return week.targets
        case .expectedPoints: return week.expectedPoints
        }
    }
}

/// One colour per compared player: the link colours, in order.
enum ChartPalette {
    static let series: [Color] = LinkGroup.allCases.map(\.color)

    static func color(_ index: Int) -> Color { series[index % series.count] }

    /// Weeks with half a week of room either side, so the first and last
    /// labels and points aren't clipped.
    static func weekDomain(_ weeks: [Int]) -> ClosedRange<Double> {
        let first = Double(weeks.min() ?? 1)
        let last = Double(max(weeks.max() ?? 1, weeks.min() ?? 1))
        return (first - 0.5)...(last + 0.5)
    }
}

/// One player's metric by week, with Rotowire's projection as a dashed line
/// when plotting points.
struct PointsTrendChart: View {
    struct Point: Identifiable {
        let week: Int
        let value: Double
        let series: String
        var id: String { "\(series)-\(week)" }
    }

    /// Played weeks, oldest first.
    let log: [PlayerLogWeek]
    let metric: TrendMetric
    let tint: Color
    var showProjection: Bool = true
    var height: CGFloat = 160

    private var actual: [Point] {
        log.compactMap { week in metric.value(week).map { Point(week: week.week, value: $0, series: "Actual") } }
    }

    private var projected: [Point] {
        guard showProjection, metric == .points else { return [] }
        return log.compactMap { week in week.projected.map { Point(week: week.week, value: $0, series: "Projected") } }
    }

    private var average: Double? {
        let values = actual.map(\.value)
        return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
    }

    var body: some View {
        Chart {
            ForEach(projected) { point in
                LineMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value), series: .value("Line", "Projected"))
                    .foregroundStyle(tint.opacity(0.45))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                    .interpolationMethod(.monotone)
            }
            ForEach(actual) { point in
                AreaMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                    .foregroundStyle(LinearGradient(colors: [tint.opacity(0.22), tint.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
                LineMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value), series: .value("Line", "Actual"))
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .interpolationMethod(.monotone)
                PointMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                    .foregroundStyle(tint)
                    .symbolSize(28)
            }
            if let average {
                RuleMark(y: .value("Average", average))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
                    .annotation(position: .top, alignment: .leading) {
                        Text("avg " + format(average)).font(.caption2).foregroundStyle(.secondary)
                    }
            }
        }
        .chartXAxis {
            AxisMarks(values: log.map { Double($0.week) }) { value in
                AxisGridLine()
                AxisValueLabel { if let week = value.as(Double.self) { Text("W\(Int(week))") } }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let v = value.as(Double.self) { Text(format(v)) }
                }
            }
        }
        .chartXScale(domain: ChartPalette.weekDomain(log.map(\.week)))
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(metric.label) by week: " + actual.map { "week \($0.week) \(format($0.value))" }.joined(separator: ", "))
    }

    private func format(_ value: Double) -> String {
        metric.isPercent ? "\(Int((value * 100).rounded()))%" : value.formatted(.number.precision(.fractionLength(value < 10 ? 1 : 0)))
    }
}

/// The linked player's trend over his last N games.
struct TrendChartPanel: View {
    @ObservedObject var card: PlayerCardModel
    let settings: PanelSettings
    let rows: Int
    @State private var metric: TrendMetric = .points
    @Environment(\.panelLinkGroup) private var group

    private var window: [PlayerLogWeek] {
        Array(card.log.filter(\.played).sorted { $0.week < $1.week }.suffix(max(rows, 2)))
    }

    var body: some View {
        PanelScroll {
            PanelPlayerHeader(card: card)
            SlidingPicker(options: TrendMetric.allCases, selection: $metric) { $0.label }
            if window.count < 2 {
                Text("Not enough games yet to draw a trend.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else if window.allSatisfy({ metric.value($0) == nil }) {
                Text("No \(metric.label.lowercased()) recorded for his games.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                PointsTrendChart(log: window, metric: metric, tint: group?.color ?? .accentColor)
                if metric == .points {
                    HStack(spacing: 12) {
                        legend("Actual", dashed: false)
                        legend("Rotowire projection", dashed: true)
                    }
                }
            }
        }
        .onAppear {
            if let stored = settings.extra["metric"].flatMap(TrendMetric.init(rawValue:)) { metric = stored }
        }
    }

    private func legend(_ label: String, dashed: Bool) -> some View {
        HStack(spacing: 4) {
            Capsule()
                .stroke(group?.color ?? .accentColor, style: StrokeStyle(lineWidth: 2, dash: dashed ? [3, 2] : []))
                .frame(width: 16, height: 2)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}
