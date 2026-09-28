import SwiftUI
import FCCore

// MARK: - Picking a metric

extension PlayerMetric {
    /// Where the metric sits in the picker.
    enum Group: String, CaseIterable, Identifiable {
        case scoring = "Scoring", usage = "Usage", passing = "Passing", receiving = "Receiving", rushing = "Rushing",
             kicking = "Kicking", teamDefense = "Team defense", defense = "Defensive players"
        var id: String { rawValue }
    }

    var group: Group {
        switch self {
        case .fantasyPoints, .expectedPoints, .rushTouchdowns, .receivingTouchdowns: return .scoring
        case .snapShare, .targetShare, .redZoneTouches, .redZoneTargets, .expectedRushPoints, .expectedReceivingPoints: return .usage
        case .passAttempts, .passYards, .passTouchdowns, .interceptionsThrown, .completionPct: return .passing
        case .targets, .receptions, .receivingYards, .airYards, .drops: return .receiving
        case .carries, .rushingYards, .yardsAfterContact, .brokenTackles: return .rushing
        case .fieldGoalsMade, .fieldGoalAttempts, .longFieldGoals: return .kicking
        case .defenseSacks, .takeaways, .pointsAllowed: return .teamDefense
        case .tackles, .sacks, .soloTackles, .tacklesForLoss, .quarterbackHits, .passesDefended: return .defense
        }
    }

    /// One line on what the number is.
    var blurb: String {
        switch self {
        case .fantasyPoints: return "Points scored in your league's scoring"
        case .expectedPoints: return "What his usage should have scored"
        case .snapShare: return "Share of his side's snaps he played"
        case .targetShare: return "His targets over his team's"
        case .redZoneTouches: return "Red-zone targets plus carries"
        case .targets: return "Passes thrown his way"
        case .receptions: return "Catches"
        case .receivingYards: return "Yards after the catch included"
        case .airYards: return "How far downfield his targets were"
        case .carries: return "Rushing attempts"
        case .rushingYards: return "Yards on the ground"
        case .yardsAfterContact: return "Per carry, after first contact"
        case .tackles: return "Solo plus assisted"
        case .sacks: return "Quarterback takedowns"
        case .passAttempts: return "Passes thrown"
        case .passYards: return "Yards through the air"
        case .passTouchdowns: return "Touchdowns thrown"
        case .interceptionsThrown: return "Picks thrown — fewer is better"
        case .completionPct: return "Completions over attempts"
        case .rushTouchdowns: return "Touchdowns on the ground"
        case .receivingTouchdowns: return "Touchdown catches"
        case .expectedRushPoints: return "What his carries should have scored"
        case .expectedReceivingPoints: return "What his targets should have scored"
        case .redZoneTargets: return "Targets inside the 20"
        case .brokenTackles: return "Missed tackles he forced"
        case .drops: return "Catchable balls dropped — fewer is better"
        case .fieldGoalsMade: return "Kicks through"
        case .fieldGoalAttempts: return "Kicks tried — a sign of the offense stalling in range"
        case .longFieldGoals: return "Made from 50 yards or more"
        case .defenseSacks: return "The unit's sacks"
        case .takeaways: return "Interceptions plus fumble recoveries"
        case .pointsAllowed: return "Points the unit gave up — fewer is better"
        case .soloTackles: return "Tackles made alone"
        case .tacklesForLoss: return "Stops behind the line"
        case .quarterbackHits: return "Hits on the passer"
        case .passesDefended: return "Passes broken up or picked"
        }
    }
}

/// A bordered pill that reads as a control — the metric and a chevron —
/// opening a grouped picker.
struct MetricPicker: View {
    let selection: PlayerMetric
    /// Metrics already charted elsewhere, marked in the list.
    var inUse: Set<PlayerMetric> = []
    /// Positions being compared, to mark metrics that don't apply to anyone.
    var positions: [Position?] = []
    var prominent = true
    let onPick: (PlayerMetric) -> Void
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: selection.systemImage)
                Text(selection.label).lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2.weight(.bold)).opacity(0.7)
            }
            .font((prominent ? Font.subheadline : .caption).weight(.semibold))
            .foregroundStyle(Color.accentColor)
            .padding(.horizontal, prominent ? 10 : 8)
            .padding(.vertical, prominent ? 5 : 4)
            .background(Capsule().fill(Color.accentColor.opacity(0.10)))
            .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.35)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help("Change what this chart shows")
        .accessibilityLabel("Chart data: \(selection.label). Change")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            MetricPickerList(selection: selection, inUse: inUse, positions: positions) { metric in
                open = false
                onPick(metric)
            }
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// Every metric, grouped, with what it measures — and, when adding to a
/// Compare panel, the section cards it doesn't have yet.
struct MetricPickerList: View {
    let selection: PlayerMetric?
    var inUse: Set<PlayerMetric> = []
    var positions: [Position?] = []
    var sections: [CompareCardSpec.Section] = []
    var onPickSection: (CompareCardSpec.Section) -> Void = { _ in }
    let onPick: (PlayerMetric) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if !sections.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        groupHeader("Cards")
                        ForEach(sections) { section in sectionRow(section) }
                    }
                    groupHeader("Chart a stat by week")
                }
                ForEach(PlayerMetric.Group.allCases) { group in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.rawValue.uppercased())
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                        ForEach(PlayerMetric.allCases.filter { $0.group == group }) { metric in
                            row(metric)
                        }
                    }
                }
            }
            .padding(10)
        }
        .frame(width: 290)
        .frame(maxHeight: 460)
    }

    private func groupHeader(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption2.weight(.bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
    }

    private func sectionRow(_ section: CompareCardSpec.Section) -> some View {
        Button { onPickSection(section) } label: {
            HStack(spacing: 8) {
                Image(systemName: section.systemImage)
                    .frame(width: 18)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(section.title).font(.callout.weight(.medium))
                    Text(section.blurb).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("compare.addCard.\(section.rawValue)")
    }

    private func row(_ metric: PlayerMetric) -> some View {
        let applies = positions.isEmpty || positions.contains { metric.applies(to: $0) }
        return Button { onPick(metric) } label: {
            HStack(spacing: 8) {
                Image(systemName: metric.systemImage)
                    .frame(width: 18)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(metric.label).font(.callout.weight(metric == selection ? .bold : .medium))
                    Text(applies ? metric.blurb : "Doesn't apply to these players")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                if metric == selection {
                    Image(systemName: "checkmark").foregroundStyle(Color.accentColor)
                } else if inUse.contains(metric) {
                    Text("charted").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(metric == selection ? Color.accentColor.opacity(0.10) : .clear))
            .opacity(applies ? 1 : 0.5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chart cards

/// One chart in a Compare panel: its data picker up top, then the lines and
/// a legend. Its menu smooths, moves or removes it.
struct CompareChartCard: View {
    let spec: TrendChartSpec
    let trend: TrendComparison?
    let inUse: Set<PlayerMetric>
    let canMoveEarlier: Bool
    let canMoveLater: Bool
    @Binding var hidden: Set<String>
    let onChange: (TrendChartSpec) -> Void
    let onMove: (Int) -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                MetricPicker(selection: spec.metric, inUse: inUse, positions: trend?.lines.map(\.position) ?? []) { metric in
                    var next = spec
                    next.metric = metric
                    onChange(next)
                }
                if spec.smoothing > 1 {
                    Text("3-game avg")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Palette.surface))
                }
                Spacer(minLength: 0)
                menu
            }
            content
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surface.opacity(0.7)))
    }

    @ViewBuilder
    private var content: some View {
        if let trend {
            if trend.lines.allSatisfy({ $0.points.isEmpty }) {
                Text("No \(spec.metric.label.lowercased()) logged for these players.")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 170)
            } else {
                TrendComparisonChart(comparison: trend, hidden: hidden, height: 170)
                TrendLegend(comparison: trend, hidden: $hidden)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, minHeight: 170)
        }
    }

    private var menu: some View {
        Menu {
            Button {
                var next = spec
                next.smoothing = spec.smoothing > 1 ? 1 : 3
                onChange(next)
            } label: {
                Label(spec.smoothing > 1 ? "Show raw weeks" : "Smooth (3-game average)", systemImage: "waveform.path")
            }
            Divider()
            Button { onMove(-1) } label: { Label("Move earlier", systemImage: "arrow.left") }
                .disabled(!canMoveEarlier)
            Button { onMove(1) } label: { Label("Move later", systemImage: "arrow.right") }
                .disabled(!canMoveLater)
            Divider()
            Button(role: .destructive, action: onRemove) { Label("Remove chart", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Chart options")
        .accessibilityLabel("Chart options")
    }
}

/// A section card on a Compare panel: its title, and a menu that moves or
/// removes it, as a chart card's does.
struct CompareCardFrame<Content: View>: View {
    let section: CompareCardSpec.Section
    let canMoveEarlier: Bool
    let canMoveLater: Bool
    let onMove: (Int) -> Void
    let onRemove: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Label(section.title, systemImage: section.systemImage)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                menu
            }
            content
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.surface.opacity(0.7)))
        .accessibilityIdentifier("compare.card.\(section.rawValue)")
    }

    private var menu: some View {
        Menu {
            Button { onMove(-1) } label: { Label("Move earlier", systemImage: "arrow.left") }
                .disabled(!canMoveEarlier)
            Button { onMove(1) } label: { Label("Move later", systemImage: "arrow.right") }
                .disabled(!canMoveLater)
            Divider()
            Button(role: .destructive, action: onRemove) { Label("Remove card", systemImage: "trash") }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.body)
                .foregroundStyle(.secondary)
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Card options")
        .accessibilityLabel("\(section.title) options")
    }
}

/// A dashed tile that adds a card: a section, or a chart of whatever's picked.
struct AddChartTile: View {
    let inUse: Set<PlayerMetric>
    let positions: [Position?]
    let remaining: Int
    var sections: [CompareCardSpec.Section] = []
    var onAddSection: (CompareCardSpec.Section) -> Void = { _ in }
    let onAdd: (PlayerMetric) -> Void
    @State private var open = false

    var body: some View {
        Button { open.toggle() } label: {
            VStack(spacing: 6) {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                Text("Add card").font(.subheadline.weight(.semibold))
                Text(remaining > 0 ? "A chart of any stat, or a profile, schedule or status card"
                                   : "\(CompareCardSpec.maxCards) cards is the most")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 120)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.accentColor.opacity(0.04)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(0.4), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(remaining <= 0)
        .accessibilityIdentifier("compare.addChart")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            MetricPickerList(selection: nil, inUse: inUse, positions: positions, sections: sections,
                             onPickSection: { section in
                                 open = false
                                 onAddSection(section)
                             }) { metric in
                open = false
                onAdd(metric)
            }
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// Cards in as many columns as fit (up to three), laid out without lazy
/// containers so the panel still renders to an image.
struct AdaptiveCardGrid<Item: Identifiable, Card: View>: View {
    let items: [Item]
    var minWidth: CGFloat = 320
    var spacing: CGFloat = 12
    @ViewBuilder let card: (Item) -> Card

    var body: some View {
        ViewThatFits(in: .horizontal) {
            columns(3)
            columns(2)
            columns(1)
        }
    }

    @ViewBuilder
    private func columns(_ count: Int) -> some View {
        let rows = stride(from: 0, to: items.count, by: count).map { Array(items[$0..<min($0 + count, items.count)]) }
        VStack(alignment: .leading, spacing: spacing) {
            ForEach(rows.indices, id: \.self) { r in
                HStack(alignment: .top, spacing: spacing) {
                    ForEach(rows[r]) { item in
                        card(item).frame(minWidth: count == 1 ? nil : minWidth, maxWidth: .infinity)
                    }
                    ForEach(0..<(count - rows[r].count), id: \.self) { _ in
                        Color.clear.frame(minWidth: minWidth, maxWidth: .infinity, maxHeight: 1)
                    }
                }
            }
        }
    }
}
