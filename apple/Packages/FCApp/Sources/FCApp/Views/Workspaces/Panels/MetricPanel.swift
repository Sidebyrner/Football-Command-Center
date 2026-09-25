import SwiftUI
import Charts
import FCCore
import FCData

/// Whose numbers a Metric panel shows.
enum MetricScope: String, CaseIterable, Identifiable {
    case player, compare, pinned, roster

    var id: String { rawValue }

    var label: String {
        switch self {
        case .player: return "Clicked player"
        case .compare: return "Compare list"
        case .pinned: return "Pinned players"
        case .roster: return "My roster"
        }
    }

    var systemImage: String {
        switch self {
        case .player: return "person"
        case .compare: return "person.2"
        case .pinned: return "pin"
        case .roster: return "person.3"
        }
    }
}

/// One stat with its numbers and a chart — for the clicked player, the link
/// colour's compare list, players pinned to this panel, or your roster. A
/// board of these is a comparison dashboard of your own design.
struct MetricPanel: View {
    let services: AppServices
    @ObservedObject var discovery: DiscoveryModel
    let settings: PanelSettings
    let lastN: Int
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var group
    @Environment(\.panelSettingsUpdate) private var update
    @State private var pinSearch = ""

    private var metric: PlayerMetric {
        settings.extra["metric"].flatMap(PlayerMetric.init(rawValue:)) ?? .fantasyPoints
    }

    private var scope: MetricScope {
        settings.extra["scope"].flatMap(MetricScope.init(rawValue:)) ?? .player
    }

    private var pinned: [String] {
        (settings.extra["pinned"] ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty }
    }

    var body: some View {
        if let index = discovery.metrics {
            VStack(alignment: .leading, spacing: 8) {
                controls
                content(index)
            }
            .padding(.top, 8)
        } else if let error = discovery.errorMessage, !discovery.isLoading {
            PanelMessage(style: .error, text: error)
        } else {
            PanelMessage(style: .loading, text: "Loading…")
        }
    }

    // MARK: - Controls

    private var controls: some View {
        HStack(spacing: 6) {
            Menu {
                ForEach(PlayerMetric.allCases) { option in
                    Button {
                        update { $0.extra["metric"] = option.rawValue }
                    } label: {
                        Label(option.label, systemImage: option == metric ? "checkmark" : option.systemImage)
                    }
                }
            } label: {
                chip(metric.label, systemImage: metric.systemImage)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Which stat")
            Menu {
                ForEach(MetricScope.allCases) { option in
                    Button {
                        update { $0.extra["scope"] = option.rawValue }
                    } label: {
                        Label(option.label, systemImage: option == scope ? "checkmark" : option.systemImage)
                    }
                }
            } label: {
                chip(scope.label, systemImage: scope.systemImage)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Whose numbers")
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
    }

    private func chip(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Palette.surface))
    }

    // MARK: - Content

    private func ids(_ index: PlayerMetricsIndex) -> [String] {
        switch scope {
        case .player: return linkBus.selection(for: group)?.playerID.map { [$0] } ?? []
        case .compare: return linkBus.compareList(for: group)
        case .pinned: return pinned
        case .roster: return index.rosterPlayers(metric)
        }
    }

    @ViewBuilder
    private func content(_ index: PlayerMetricsIndex) -> some View {
        let ids = ids(index)
        PanelScroll {
            if scope == .pinned { pinEditor(index.context) }
            if ids.isEmpty {
                emptyState
            } else if ids.count == 1, scope == .player {
                single(ids[0], index: index)
            } else {
                several(ids, index: index)
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        let colour = group?.name.lowercased() ?? "linked"
        switch scope {
        case .player:
            if group == nil {
                message("Pick a link colour on this panel, then click a player in a panel of the same colour.")
            } else {
                message("Click a player in any \(colour) panel.")
            }
        case .compare:
            message("⌘-click players (or ＋ in Player search) to add them to the \(colour) compare list.")
        case .pinned:
            message("Search above to pin players to this panel.")
        case .roster:
            message("None of your players has \(metric.label.lowercased()) yet.")
        }
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 60)
            .multilineTextAlignment(.center)
    }

    // MARK: One player

    @ViewBuilder
    private func single(_ id: String, index: PlayerMetricsIndex) -> some View {
        let context = index.context
        let position = context.position(id)
        HStack(spacing: 8) {
            PlayerAvatar(sleeperID: id, name: context.playerName(id) ?? id, position: position, size: 26)
            VStack(alignment: .leading, spacing: 0) {
                Text(context.playerName(id) ?? id).font(.caption.weight(.semibold)).lineLimit(1)
                Text([position?.rawValue, context.nflTeam(of: id)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        if !metric.applies(to: position) {
            message("\(metric.label) doesn't apply to a \(position?.rawValue ?? "player like him").")
        } else if let summary = index.summary(metric, playerID: id) {
            headline(summary, position: position)
            MetricChart(
                series: [MetricChart.Series(id: id, name: context.playerName(id) ?? id,
                                            color: group?.color ?? .accentColor,
                                            points: Array(index.series(metric, playerID: id).suffix(lastN)))],
                metric: metric,
                reference: summary.positionAverage.map { ("\(position?.rawValue ?? "") avg", $0) }
            )
            PanelFootnote(text: metric.source + ".")
        } else {
            message("No \(metric.label.lowercased()) logged for him yet.")
        }
    }

    private func headline(_ summary: MetricSummary, position: Position?) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 14) { headlineParts(summary, position: position) }
            VStack(alignment: .leading, spacing: 6) { headlineParts(summary, position: position) }
        }
    }

    @ViewBuilder
    private func headlineParts(_ summary: MetricSummary, position: Position?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(metric.format(summary.seasonAverage))
                    .font(.title.weight(.bold).monospacedDigit())
                if !metric.unit.isEmpty {
                    Text(metric.unit).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text("per game · \(summary.games) game\(summary.games == 1 ? "" : "s")")
                .font(.caption2).foregroundStyle(.secondary)
        }
        VStack(alignment: .leading, spacing: 2) {
            if let last = summary.lastGame, let week = summary.lastWeek {
                stat("Last game (W\(week))", metric.format(last))
            }
            if let three = summary.lastThreeAverage {
                HStack(spacing: 4) {
                    stat("Last 3", metric.format(three))
                    if let trend = summary.trend, trend != 0 {
                        Image(systemName: trend > 0 ? "arrow.up.right" : "arrow.down.right")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(trend > 0 ? Palette.start : Palette.sit)
                    }
                }
            }
        }
        if let rank = summary.rank {
            VStack(alignment: .leading, spacing: 0) {
                Text("#\(rank)")
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(rank <= max(3, summary.rankOf / 10) ? Palette.start : .primary)
                Text("of \(summary.rankOf) \(position?.rawValue ?? "")s")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.semibold).monospacedDigit())
        }
    }

    // MARK: Several players

    @ViewBuilder
    private func several(_ ids: [String], index: PlayerMetricsIndex) -> some View {
        let context = index.context
        let rows: [(id: String, name: String, summary: MetricSummary?, color: Color)] = ids.enumerated().map { offset, id in
            (id, context.playerName(id) ?? id, index.summary(metric, playerID: id), ChartPalette.color(offset))
        }
        let series = rows.map { row in
            MetricChart.Series(id: row.id, name: row.name, color: row.color,
                               points: Array(index.series(metric, playerID: row.id).suffix(lastN)))
        }
        if series.allSatisfy(\.points.isEmpty) {
            message("No \(metric.label.lowercased()) logged for these players yet.")
        } else {
            MetricChart(series: series, metric: metric)
        }
        let ranked = rows.sorted { ($0.summary?.seasonAverage ?? -.infinity) > ($1.summary?.seasonAverage ?? -.infinity) }
        Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 3) {
            GridRow {
                Text("").gridColumnAlignment(.leading)
                header("Avg")
                header("Last 3")
                header("Rank")
                if scope == .pinned { Text("") }
            }
            ForEach(ranked, id: \.id) { row in
                GridRow {
                    HStack(spacing: 5) {
                        Circle().fill(row.color).frame(width: 7, height: 7)
                        Text(StreamFormat.shortName(row.name)).font(.caption.weight(.medium)).lineLimit(1)
                    }
                    .gridColumnAlignment(.leading)
                    .panelPlayerTap(row.id, context: context)
                    Text(row.summary.map { metric.format($0.seasonAverage) } ?? "—").font(.caption.monospacedDigit().weight(.semibold))
                    Text(row.summary?.lastThreeAverage.map(metric.format) ?? "—").font(.caption.monospacedDigit())
                    Text(row.summary?.rank.map { "#\($0)" } ?? "—").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    if scope == .pinned {
                        Button {
                            setPinned(pinned.filter { $0 != row.id })
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Unpin \(row.name)")
                    }
                }
            }
        }
        PanelFootnote(text: "Per game this season; rank at his position among players with \(PlayerMetricsIndex.minimumGamesForRank)+ games. \(metric.source).")
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
    }

    // MARK: Pinned

    private func pinEditor(_ context: LeagueContext) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "pin").foregroundStyle(.secondary)
                TextField(pinned.count >= 6 ? "Six is the most" : "Pin a player…", text: $pinSearch)
                    .textFieldStyle(.plain)
                    .font(.caption)
                    .disabled(pinned.count >= 6)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
            ForEach(PlayerLookup.matches(pinSearch, in: context, excluding: pinned, limit: 5), id: \.id) { player in
                Button {
                    setPinned(pinned + [player.id])
                    pinSearch = ""
                } label: {
                    PanelPlayerRow(playerID: player.id, name: player.name, position: player.position,
                                   detail: [player.position?.rawValue, player.team].compactMap { $0 }.joined(separator: " · ")) {
                        Image(systemName: "pin.circle").foregroundStyle(Color.accentColor)
                    }
                }
                .buttonStyle(PanelRowStyle())
            }
        }
    }

    private func setPinned(_ ids: [String]) {
        update { $0.extra["pinned"] = ids.isEmpty ? nil : ids.joined(separator: ",") }
    }
}

/// A metric by week: one line per player, with an optional reference rule
/// (his position's average).
struct MetricChart: View {
    struct Series: Identifiable {
        let id: String
        let name: String
        let color: Color
        let points: [MetricPoint]
    }

    let series: [Series]
    let metric: PlayerMetric
    var reference: (label: String, value: Double)? = nil
    var height: CGFloat = 150

    private var weeks: [Int] { Array(Set(series.flatMap { $0.points.map(\.week) })).sorted() }

    var body: some View {
        Chart {
            ForEach(series) { line in
                if series.count == 1 {
                    ForEach(line.points) { point in
                        AreaMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                            .foregroundStyle(LinearGradient(colors: [line.color.opacity(0.22), line.color.opacity(0.02)],
                                                            startPoint: .top, endPoint: .bottom))
                            .interpolationMethod(.monotone)
                    }
                }
                ForEach(line.points) { point in
                    LineMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value),
                             series: .value("Player", line.name))
                        .foregroundStyle(line.color)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                        .interpolationMethod(.monotone)
                    PointMark(x: .value("Week", Double(point.week)), y: .value(metric.label, point.value))
                        .foregroundStyle(line.color)
                        .symbolSize(24)
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
        .accessibilityLabel("\(metric.label) by week for \(series.map(\.name).joined(separator: ", "))")
    }
}
