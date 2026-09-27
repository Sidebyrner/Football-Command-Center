import SwiftUI
import Charts
import FCCore

/// One colour per compared player: the link colours, in order.
enum ChartPalette {
    static let series: [Color] = LinkGroup.allCases.map(\.color)

    static func color(_ index: Int) -> Color { series[index % series.count] }

    /// A clicked player who isn't in the compare list.
    static let focused = Color.primary

    static func color(for line: TrendComparison.Line) -> Color {
        line.compareIndex.map(color) ?? focused
    }

    /// Weeks with half a week of room either side, so the first and last
    /// labels and points aren't clipped.
    static func weekDomain(_ weeks: [Int]) -> ClosedRange<Double> {
        let first = Double(weeks.min() ?? 1)
        let last = Double(max(weeks.max() ?? 1, weeks.min() ?? 1))
        return (first - 0.5)...(last + 0.5)
    }
}

/// Several players' weekly trend on one chart. The clicked player's line is
/// heavier; a single player gets a soft fill and, for fantasy points, his
/// weekly projection dashed behind.
struct TrendComparisonChart: View {
    let comparison: TrendComparison
    var hidden: Set<String> = []
    /// Week → projection, drawn when there's one line and the metric is points.
    var projection: [Int: Double] = [:]
    var reference: (label: String, value: Double)? = nil
    var height: CGFloat = 180

    private var lines: [TrendComparison.Line] {
        comparison.lines.filter { !hidden.contains($0.id) && !$0.points.isEmpty }
    }

    var body: some View {
        let metric = comparison.metric
        let lines = self.lines
        let single = lines.count == 1
        let weeks = comparison.weeks
        Chart {
            if single, let line = lines.first {
                let color = ChartPalette.color(for: line)
                ForEach(line.points) { point in
                    AreaMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                        .foregroundStyle(LinearGradient(colors: [color.opacity(0.22), color.opacity(0.02)],
                                                        startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                }
                if metric == .fantasyPoints {
                    ForEach(line.points.compactMap { p in projection[p.week].map { MetricPoint(week: p.week, value: $0) } }) { point in
                        LineMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value),
                                 series: .value("Line", "Projection"))
                            .foregroundStyle(color.opacity(0.45))
                            .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                            .interpolationMethod(.monotone)
                    }
                }
            }
            ForEach(lines) { line in
                let color = ChartPalette.color(for: line)
                ForEach(line.points) { point in
                    LineMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value),
                             series: .value("Player", line.id))
                        .foregroundStyle(color)
                        .lineStyle(StrokeStyle(lineWidth: line.isFocused || single ? 3 : 2, lineCap: .round))
                        .interpolationMethod(.monotone)
                    PointMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                        .foregroundStyle(color)
                        .symbolSize(line.isFocused || single ? 34 : 20)
                }
            }
            if let reference {
                RuleMark(y: .value("Reference", reference.value))
                    .foregroundStyle(Color.secondary.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .annotation(position: .top, alignment: .leading) {
                        Text("\(reference.label) \(metric.format(reference.value))").font(.caption2).foregroundStyle(.secondary)
                    }
            }
        }
        .chartXAxis {
            AxisMarks(values: weeks.map(Double.init)) { value in
                AxisGridLine()
                AxisValueLabel { if let week = value.as(Double.self) { Text("W\(Int(week))") } }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine()
                AxisValueLabel { if let v = value.as(Double.self) { Text(metric.format(v)) } }
            }
        }
        .chartXScale(domain: ChartPalette.weekDomain(weeks))
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(metric.label) by week for \(lines.map(\.name).joined(separator: ", "))")
    }
}

/// Tappable legend chips: colour, name, season average — tap to hide or show
/// a line.
struct TrendLegend: View {
    let comparison: TrendComparison
    @Binding var hidden: Set<String>

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(comparison.lines) { line in
                let off = hidden.contains(line.id)
                Button {
                    withAnimation(Motion.snappy) {
                        if off { hidden.remove(line.id) } else { hidden.insert(line.id) }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Circle()
                            .fill(off ? Color.clear : ChartPalette.color(for: line))
                            .overlay(Circle().stroke(ChartPalette.color(for: line), lineWidth: 1.5))
                            .frame(width: 9, height: 9)
                        Text(StreamFormat.shortName(line.name))
                            .font(.caption.weight(line.isFocused ? .bold : .medium))
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(line.applies ? (line.summary.map { comparison.metric.format($0.seasonAverage) } ?? "–") : "n/a")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Palette.surface))
                    .opacity(off ? 0.45 : 1)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(off ? "Show" : "Hide") \(line.name)")
            }
        }
    }
}

/// Season average, last 3 with the trend arrow, and rank, one row per player.
struct TrendSummaryTable: View {
    let comparison: TrendComparison

    var body: some View {
        let metric = comparison.metric
        Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 4) {
            GridRow {
                Text("").gridColumnAlignment(.leading)
                header("Avg")
                header("Last 3")
                header("Trend")
                header("Rank")
            }
            ForEach(comparison.lines.sorted { ($0.summary?.seasonAverage ?? -.infinity) > ($1.summary?.seasonAverage ?? -.infinity) }) { line in
                GridRow {
                    HStack(spacing: 5) {
                        Circle().fill(ChartPalette.color(for: line)).frame(width: 7, height: 7)
                        Text(StreamFormat.shortName(line.name)).font(.caption.weight(line.isFocused ? .bold : .medium)).lineLimit(1)
                    }
                    .gridColumnAlignment(.leading)
                    if let s = line.summary {
                        Text(metric.format(s.seasonAverage)).font(.caption.monospacedDigit().weight(.semibold))
                        Text(s.lastThreeAverage.map(metric.format) ?? "–").font(.caption.monospacedDigit())
                        trend(s.trend)
                        Text(s.rank.map { "#\($0)" } ?? "–").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    } else {
                        Text(line.applies ? "–" : "n/a").font(.caption).foregroundStyle(.tertiary)
                        Text("")
                        Text("")
                        Text("")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func trend(_ value: Double?) -> some View {
        if let value, value != 0 {
            Image(systemName: value > 0 ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2.weight(.bold))
                .foregroundStyle(value > 0 ? Palette.start : Palette.sit)
        } else {
            Text("–").font(.caption).foregroundStyle(.tertiary)
        }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
    }
}

/// The Trend panel: every player being compared in this link colour, plus
/// whoever was clicked, on one chart — any metric, raw or smoothed.
struct TrendComparePanel: View {
    let services: AppServices
    @ObservedObject var discovery: DiscoveryModel
    let settings: PanelSettings
    let rows: Int
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var group
    @Environment(\.panelSettingsUpdate) private var update
    @State private var hidden: Set<String> = []

    private var metric: PlayerMetric { TrendComparison.metric(storedAs: settings.extra["metric"]) ?? .fantasyPoints }
    private var scope: TrendComparison.Scope {
        settings.extra["trendScope"].flatMap(TrendComparison.Scope.init(rawValue:)) ?? .compare
    }
    private var smoothing: Int { settings.extra["smooth"] == "3" ? 3 : 1 }

    var body: some View {
        if let index = discovery.metrics {
            content(index)
        } else if let error = discovery.errorMessage, !discovery.isLoading {
            PanelMessage(style: .error, text: error)
        } else {
            PanelMessage(style: .loading, text: "Loading…")
        }
    }

    @ViewBuilder
    private func content(_ index: PlayerMetricsIndex) -> some View {
        let focused = linkBus.selection(for: group)?.playerID
        let comparison = TrendComparison.build(index: index, metric: metric, compareIDs: linkBus.compareList(for: group),
                                               focusedID: focused, scope: scope, lastN: rows, smoothing: smoothing)
        VStack(alignment: .leading, spacing: 8) {
            TrendControls(metric: metric, scope: scope, smoothing: smoothing) { change in update(change) }
                .padding(.horizontal, 10)
            PanelScroll {
                if group == nil {
                    message("Pick a link colour on this panel, then click or ⌘-click players in panels of the same colour.")
                } else if comparison.lines.isEmpty {
                    message("Click a player in any \(group!.name.lowercased()) panel, or ⌘-click several to compare their trends.")
                } else if comparison.lines.allSatisfy({ $0.points.isEmpty }) {
                    message("No \(metric.label.lowercased()) logged for \(comparison.lines.count == 1 ? "him" : "these players") yet.")
                } else {
                    TrendComparisonChart(
                        comparison: comparison, hidden: hidden, projection: projection(comparison, index: index),
                        reference: reference(comparison, index: index)
                    )
                    TrendLegend(comparison: comparison, hidden: $hidden)
                    TrendSummaryTable(comparison: comparison)
                    PanelFootnote(text: footnote(comparison))
                }
            }
        }
        .padding(.top, 8)
    }

    /// One player on fantasy points gets his weekly projection dashed behind.
    private func projection(_ comparison: TrendComparison, index: PlayerMetricsIndex) -> [Int: Double] {
        guard metric == .fantasyPoints, comparison.lines.count == 1, let line = comparison.lines.first else { return [:] }
        let card = services.playerCard(line.id, context: index.context)
        return Dictionary(card.log.compactMap { w in w.projected.map { (w.week, $0) } }, uniquingKeysWith: { a, _ in a })
    }

    /// One player: his position's average as a rule.
    private func reference(_ comparison: TrendComparison, index: PlayerMetricsIndex) -> (String, Double)? {
        guard comparison.lines.count == 1, let line = comparison.lines.first,
              let average = line.summary?.positionAverage else { return nil }
        return ("\(line.position?.rawValue ?? "") avg", average)
    }

    private func footnote(_ comparison: TrendComparison) -> String {
        var parts = ["Last \(rows) games"]
        if smoothing > 1 { parts.append("3-game rolling average") }
        if comparison.lines.count > 1 { parts.append("tap a name to hide its line") }
        parts.append(metric.source)
        return parts.joined(separator: " · ") + "."
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 80)
    }
}

/// Metric, whose trend, and smoothing — the header of a trend chart.
struct TrendControls: View {
    let metric: PlayerMetric
    let scope: TrendComparison.Scope
    let smoothing: Int
    var showsScope = true
    var showsSmoothing = true
    let onChange: ((inout PanelSettings) -> Void) -> Void

    var body: some View {
        HStack(spacing: 6) {
            MetricPicker(selection: metric, prominent: false) { option in
                onChange { $0.extra["metric"] = option.rawValue }
            }
            if showsScope { scopeMenu }
            if showsSmoothing { smoothingButton }
            Spacer(minLength: 0)
        }
    }

    private var scopeMenu: some View {
        Menu {
            ForEach(TrendComparison.Scope.allCases, id: \.self) { option in
                Button {
                    onChange { $0.extra["trendScope"] = option.rawValue }
                } label: {
                    Label(option.label, systemImage: option == scope ? "checkmark" : (option == .compare ? "person.2" : "person"))
                }
            }
        } label: {
            chip(scope == .compare ? "Compare" : "One player", systemImage: scope == .compare ? "person.2" : "person")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private var smoothingButton: some View {
        Button {
            onChange { $0.extra["smooth"] = smoothing > 1 ? nil : "3" }
        } label: {
            chip(smoothing > 1 ? "3-game avg" : "Raw", systemImage: "waveform.path")
        }
        .buttonStyle(.plain)
        .help("Smooth each line with a 3-game rolling average")
    }

    private func chip(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Palette.surface))
    }
}
