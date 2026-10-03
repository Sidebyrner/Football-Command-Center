import SwiftUI
import Charts
import FCCore
import FCData

/// Two to four players side by side, as cards the panel adds, removes and
/// reorders: trend charts of any metric, per-game bars, a table with the best
/// value on each row picked out, ranges, a position profile, usage mix,
/// schedule and status. Players come from the link colour's compare list —
/// ⌘-click (or long-press) a player in any panel of the same colour, or
/// search here.
struct ComparePanel: View {
    let services: AppServices
    @ObservedObject var discovery: DiscoveryModel
    let rows: Int
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var group
    @Environment(\.linkPublish) private var publish
    @State private var search = ""
    /// Bumped when the cards finish loading, so the comparison is rebuilt
    /// with their projections.
    @State private var loadedGeneration = 0
    @Environment(\.panelSettingsUpdate) private var update
    /// Players hidden on every chart, from the legends.
    @State private var hidden: Set<String> = []

    /// The panel's cards, in order.
    private var cards: [CompareCardSpec] { CompareCardSpec.list(from: update.settings.extra["charts"]) }

    private var ids: [String] { linkBus.compareList(for: group) }

    var body: some View {
        if let group {
            if let context = services.dashboard.context {
                content(group: group, context: context)
            } else {
                PanelMessage(style: .loading, text: "Loading…")
            }
        } else {
            PanelMessage(style: .empty, text: "Pick a link colour on this panel, then ⌘-click players in panels of the same colour.")
        }
    }

    @ViewBuilder
    private func content(group: LinkGroup, context: LeagueContext) -> some View {
        let cards = ids.map { services.playerCard($0, context: context) }
        // Read so a finished load re-renders the panel with the loaded cards.
        let _ = loadedGeneration
        let baseline = group == LinkBus.watchlistGroup ? services.watchlist.baselineID : nil
        let comparison = PlayerComparison.build(cards: cards, rows: discovery.row(for:), defense: discovery.defense, lastN: rows,
                                                baselineID: baseline)
        PanelScroll {
            header(comparison, group: group, context: context)
            if comparison.players.isEmpty {
                emptyState(group)
            } else {
                cardGrid(comparison, context: context)
            }
        }
        .task(id: ids.joined(separator: ",")) {
            await withTaskGroup(of: Void.self) { tasks in
                for card in cards { tasks.addTask { await card.load() } }
            }
            loadedGeneration += 1
        }
    }

    // MARK: - Header

    private func header(_ comparison: PlayerComparison, group: LinkGroup, context: LeagueContext) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
                ForEach(comparison.players) { player in
                    playerChip(player)
                }
            }
            HStack(spacing: 8) {
                if linkBus.canAddToCompare(in: group) {
                    addField
                } else {
                    Text("Four is the most — remove one to add another.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if !comparison.players.isEmpty {
                    Button("Clear") { publish(.clearCompare) }
                        .font(.caption2.weight(.semibold))
                        .buttonStyle(.borderless)
                }
            }
            if !search.trimmingCharacters(in: .whitespaces).isEmpty {
                searchResults(context: context)
            }
        }
    }

    private func playerChip(_ player: PlayerComparison.Player) -> some View {
        let tint = ChartPalette.color(player.seriesIndex)
        return HStack(spacing: 6) {
            Button {
                publish(.player(player.id))
            } label: {
                HStack(spacing: 6) {
                    PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 24)
                        .overlay(Circle().stroke(tint, lineWidth: 2))
                    VStack(alignment: .leading, spacing: 0) {
                        Text(player.name).font(.caption.weight(.semibold)).lineLimit(1)
                        HStack(spacing: 4) {
                            Text([player.position?.rawValue, player.team].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(.secondary)
                            if player.isBaseline || player.availability == .mine {
                                Text("YOURS").font(.system(size: 9).weight(.bold)).foregroundStyle(Color.accentColor)
                            } else if case .rivalBench = player.availability {
                                Circle().fill(Palette.caution).frame(width: 6, height: 6).help(player.availability?.label ?? "")
                            } else if case .rivalStarter = player.availability {
                                Circle().fill(Palette.caution).frame(width: 6, height: 6).help(player.availability?.label ?? "")
                            }
                        }
                    }
                }
                .foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            .help("Show in linked panels")
            Spacer(minLength: 2)
            Button {
                publish(.removeCompare(player.id))
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(player.name) from compare")
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(tint.opacity(0.10)))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(tint.opacity(0.35)))
    }

    private var addField: some View {
        HStack(spacing: 6) {
            Image(systemName: "plus.magnifyingglass").foregroundStyle(.secondary)
            TextField("Add a player…", text: $search)
                .textFieldStyle(.plain)
                .font(.caption)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
        .frame(maxWidth: 260)
    }

    static func matches(_ needle: String, in context: LeagueContext, excluding: [String], limit: Int = 6) -> [IndexedPlayer] {
        PlayerLookup.matches(needle, in: context, excluding: excluding, limit: limit)
    }

    private func searchResults(context: LeagueContext) -> some View {
        let needle = search.trimmingCharacters(in: .whitespaces)
        let matches = Self.matches(needle, in: context, excluding: ids)
        return VStack(alignment: .leading, spacing: 2) {
            if matches.isEmpty {
                Text("No player matches “\(needle)”.").font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(matches, id: \.id) { player in
                Button {
                    publish(.addCompare(player.id))
                    search = ""
                } label: {
                    PanelPlayerRow(playerID: player.id, name: player.name, position: player.position,
                                   detail: [player.position?.rawValue, player.team].compactMap { $0 }.joined(separator: " · ")) {
                        Image(systemName: "plus.circle").foregroundStyle(Color.accentColor)
                    }
                }
                .buttonStyle(PanelRowStyle())
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.surface))
    }

    private func emptyState(_ group: LinkGroup) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2.crop.square.stack")
                .font(.title2)
                .foregroundStyle(group.color)
            Text("Compare up to four players")
                .font(.caption.weight(.semibold))
            Text("⌘-click players in any \(group.name.lowercased()) panel (long-press on iPad), or search above.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    // MARK: - Cards

    private enum GridItemKind: Identifiable {
        case card(Int, CompareCardSpec)
        case add
        var id: String {
            switch self {
            case .card(let i, let spec): return "\(i)-\(spec.id)"
            case .add: return "add"
            }
        }
    }

    /// The panel's cards, each with its own menu, then a tile to add another.
    private func cardGrid(_ comparison: PlayerComparison, context: LeagueContext) -> some View {
        let specs = cards
        let inUse = Set(specs.compactMap { if case .trend(let chart) = $0 { return chart.metric } else { return nil } })
        let shownSections = Set(specs.compactMap { if case .section(let section) = $0 { return section } else { return nil } })
        let positions = comparison.players.map(\.position)
        var items = specs.enumerated().map { GridItemKind.card($0.offset, $0.element) }
        if specs.count < CompareCardSpec.maxCards { items.append(.add) }
        return AdaptiveCardGrid(items: items) { item in
            switch item {
            case .card(let i, .trend(let spec)):
                CompareChartCard(
                    spec: spec, trend: trend(spec), inUse: inUse,
                    canMoveEarlier: i > 0, canMoveLater: i < specs.count - 1, hidden: $hidden,
                    onChange: { next in edit { $0[i] = .trend(next) } },
                    onMove: { step in edit { $0.swapAt(i, i + step) } },
                    onRemove: { edit { $0.remove(at: i) } }
                )
            case .card(let i, .section(let section)):
                CompareCardFrame(
                    section: section, canMoveEarlier: i > 0, canMoveLater: i < specs.count - 1,
                    onMove: { step in edit { $0.swapAt(i, i + step) } },
                    onRemove: { edit { $0.remove(at: i) } }
                ) {
                    sectionBody(section, comparison, context: context)
                }
            case .add:
                AddChartTile(
                    inUse: inUse, positions: positions, remaining: CompareCardSpec.maxCards - specs.count,
                    sections: CompareCardSpec.Section.allCases.filter { !shownSections.contains($0) },
                    onAddSection: { section in edit { $0.append(.section(section)) } }
                ) { metric in
                    edit { $0.append(.trend(TrendChartSpec(metric: metric))) }
                }
            }
        }
    }

    @ViewBuilder
    private func sectionBody(_ section: CompareCardSpec.Section, _ comparison: PlayerComparison, context: LeagueContext) -> some View {
        switch section {
        case .perGame: CompareBarsChart(comparison: comparison)
        case .table: CompareMetricTable(comparison: comparison)
        case .range: CompareRangeCard(comparison: comparison)
        case .profile: CompareProfileCard(comparison: comparison)
        case .usage: CompareUsageCard(comparison: comparison)
        case .schedule: CompareScheduleCard(comparison: comparison)
        case .status: CompareStatusCard(comparison: comparison)
        case .verdict:
            VerdictCard(comparison: comparison, context: context, compact: true)
        case .availability: CompareAvailabilityCard(comparison: comparison, playoffWeeks: context.leagueFacts.playoffWeeks)
        }
    }

    private func trend(_ spec: TrendChartSpec) -> TrendComparison? {
        discovery.metrics.map {
            TrendComparison.build(index: $0, metric: spec.metric, compareIDs: ids, focusedID: nil,
                                  scope: .compare, lastN: rows, smoothing: spec.smoothing)
        }
    }

    private func edit(_ change: (inout [CompareCardSpec]) -> Void) {
        var specs = cards
        change(&specs)
        withAnimation(Motion.snappy) {
            update { $0.extra["charts"] = CompareCardSpec.encode(specs) }
        }
    }
}

/// Worst and best game this season for each player, with the dot on this
/// week's projection.
struct CompareRangeCard: View {
    let comparison: PlayerComparison

    var body: some View {
        let top = (comparison.players.compactMap(\.ceiling).max() ?? 0) * 1.05
        VStack(alignment: .leading, spacing: 8) {
            ForEach(comparison.players) { player in
                if let floor = player.floor, let ceiling = player.ceiling {
                    HStack(spacing: 10) {
                        Text(StreamFormat.shortName(player.name))
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                            .frame(width: 84, alignment: .leading)
                        StreamRangeBar(floor: floor, expected: player.expected ?? (floor + ceiling) / 2, ceiling: ceiling,
                                       scaleMax: top, tint: ChartPalette.color(player.seriesIndex))
                    }
                }
            }
            PanelFootnote(text: "Worst and best game this season; the dot is this week's projection, else his average.")
        }
    }
}

/// The per-game numbers that are on one scale, as grouped bars.
struct CompareBarsChart: View {
    let comparison: PlayerComparison

    private static let measures: [PlayerComparison.Metric] = [.pointsPerGame, .expectedPointsLast4, .projectedThisWeek, .restOfSeason]

    private struct Bar: Identifiable {
        let measure: String
        let player: String
        let value: Double
        var id: String { "\(measure)-\(player)" }
    }

    private var bars: [Bar] {
        Self.measures.flatMap { metric in
            comparison.players.compactMap { player in
                player.values[metric].map { Bar(measure: Self.shortLabel(metric), player: player.name, value: $0) }
            }
        }
    }

    static func shortLabel(_ metric: PlayerComparison.Metric) -> String {
        switch metric {
        case .pointsPerGame: return "Pts/gm"
        case .expectedPointsLast4: return "xFP L4"
        case .projectedThisWeek: return "Proj"
        case .restOfSeason: return "RoS"
        default: return metric.label
        }
    }

    var body: some View {
        let names = comparison.players.map(\.name)
        let colors = comparison.players.map { ChartPalette.color($0.seriesIndex) }
        if bars.isEmpty {
            Text("No per-game numbers yet.").font(.caption).foregroundStyle(.secondary).frame(height: 150)
        } else {
            Chart(bars) { bar in
                BarMark(x: .value("Measure", bar.measure), y: .value("Points", bar.value))
                    .foregroundStyle(by: .value("Player", bar.player))
                    .position(by: .value("Player", bar.player))
                    .cornerRadius(3)
            }
            .chartForegroundStyleScale(domain: names, range: colors)
            .chartLegend(.hidden)
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 170)
            .accessibilityLabel("Per-game numbers for \(names.joined(separator: ", "))")
        }
    }
}

/// One row per metric, one column per player; the best value on each row is
/// picked out, respecting which direction is better.
struct CompareMetricTable: View {
    let comparison: PlayerComparison

    var body: some View {
        Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 5) {
            GridRow {
                Text("").gridColumnAlignment(.leading)
                ForEach(comparison.players) { player in
                    HStack(spacing: 4) {
                        Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
                        Text(StreamFormat.shortName(player.name)).lineLimit(1)
                    }
                    .font(.caption2.weight(.bold))
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(PlayerComparison.Metric.allCases) { metric in
                let values = comparison.values(metric)
                if values.contains(where: { $0 != nil }) {
                    let best = comparison.bestIndex(metric)
                    GridRow {
                        Text(metric.label).font(.caption2).foregroundStyle(.secondary).gridColumnAlignment(.leading)
                        ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                            Text(value.map(metric.format) ?? "—")
                                .font(.caption.monospacedDigit().weight(index == best ? .bold : .regular))
                                .foregroundStyle(index == best ? Palette.start : value == nil ? Color.secondary : Color.primary)
                        }
                    }
                }
            }
        }
    }
}
