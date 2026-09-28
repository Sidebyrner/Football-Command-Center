import SwiftUI
import FCCore

// The Compare panel's section cards beyond the charts: position profile,
// usage mix, schedule ahead and status. Each draws from `PlayerComparison`
// alone and avoids lazy containers so the panel still renders to an image.

// MARK: - Position profile

/// Each player against his own position, on shared dimensions — so players at
/// different positions sit on one 0–100 scale.
struct CompareProfileCard: View {
    let comparison: PlayerComparison
    @State private var showNumbers = false

    private var dimensions: [PlayerComparison.ProfileDimension] {
        PlayerComparison.ProfileDimension.allCases.filter { dimension in
            comparison.players.contains { $0.profile[dimension] != nil }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if dimensions.isEmpty {
                Text("No grades yet — each needs a few games and a full position cohort.")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(dimensions) { dimension in row(dimension) }
                    scale
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Percentiles against each player's own position")
                gradeLine
                DisclosureGroup(isExpanded: $showNumbers) {
                    numbers.padding(.top, 4)
                } label: {
                    Text("The numbers behind it").font(.caption2.weight(.semibold))
                }
            }
            PanelFootnote(text: "Percentile against his own position this season; 50 is the middle. Lower-is-better measures are flipped.")
        }
    }

    private static let labelWidth: CGFloat = 118

    /// One dimension: its name, then a bar per player on a 0–100 track with
    /// the middle marked.
    private func row(_ dimension: PlayerComparison.ProfileDimension) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text(dimension.label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .frame(width: Self.labelWidth, alignment: .leading)
            VStack(spacing: 3) {
                ForEach(comparison.players) { player in
                    bar(player.profile[dimension], tint: ChartPalette.color(player.seriesIndex))
                        .accessibilityLabel("\(player.name), \(dimension.label): "
                            + (player.profile[dimension].map { "\(Int(($0.percentile * 100).rounded()))th percentile" } ?? "no measure"))
                }
            }
        }
    }

    private func bar(_ value: PlayerComparison.ProfileValue?, tint: Color) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surface)
                if let value {
                    Capsule().fill(tint).frame(width: max(geo.size.width * value.percentile, 3))
                }
                Rectangle()
                    .fill(Color.secondary.opacity(0.5))
                    .frame(width: 1)
                    .offset(x: geo.size.width / 2)
            }
        }
        .frame(height: 7)
    }

    private var scale: some View {
        HStack(spacing: 8) {
            Color.clear.frame(width: Self.labelWidth, height: 1)
            HStack {
                Text("0"); Spacer(); Text("50th"); Spacer(); Text("100")
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
        }
    }

    private var gradeLine: some View {
        HStack(spacing: 10) {
            ForEach(comparison.players) { player in
                HStack(spacing: 4) {
                    Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
                    Text(StreamFormat.shortName(player.name)).lineLimit(1)
                    Text(player.values[.gradeScore].map { "\(Int($0))" } ?? "—").fontWeight(.bold).monospacedDigit()
                }
                .font(.caption2)
            }
            Spacer(minLength: 0)
            Text("grade").font(.caption2).foregroundStyle(.tertiary)
        }
    }

    /// One row per measure, one column per player: value and percentile.
    private var numbers: some View {
        Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 3) {
            ForEach(dimensions) { dimension in
                GridRow {
                    Text(dimension.label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                        .gridColumnAlignment(.leading)
                        .gridCellColumns(comparison.players.count + 1)
                }
                ForEach(measures(dimension), id: \.self) { metric in
                    GridRow {
                        Text(metric.label).font(.caption2).foregroundStyle(.secondary).gridColumnAlignment(.leading)
                        ForEach(comparison.players) { player in
                            if let factor = player.profile[dimension]?.factors.first(where: { $0.metric == metric }) {
                                Text("\(GradeValueFormat.format(factor.value, metric)) · \(Int((factor.percentile * 100).rounded()))")
                                    .font(.caption2.monospacedDigit())
                            } else {
                                Text("—").font(.caption2).foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
        }
    }

    /// Every measure any player has in this dimension, in a stable order.
    private func measures(_ dimension: PlayerComparison.ProfileDimension) -> [GradeMetric] {
        var seen: [GradeMetric] = []
        for player in comparison.players {
            for factor in player.profile[dimension]?.factors ?? [] where !seen.contains(factor.metric) {
                seen.append(factor.metric)
            }
        }
        return seen
    }
}

enum GradeValueFormat {
    static func format(_ value: Double, _ metric: GradeMetric) -> String {
        switch metric {
        case .snapShare, .targetShare, .airYardsShare, .catchRate, .dropRate, .completionPct, .interceptionRate,
             .sackRate, .fieldGoalPct, .defensiveSnapShare:
            return "\(Int((value * 100).rounded()))%"
        case .passerRating:
            return "\(Int(value.rounded()))"
        default:
            return value.formatted(.number.precision(.fractionLength(1)))
        }
    }
}

// MARK: - Usage mix

/// Where each player's expected points come from — passing, rushing,
/// receiving — with
/// a tick at what he actually scored.
struct CompareUsageCard: View {
    let comparison: PlayerComparison

    private var players: [PlayerComparison.Player] { comparison.players.filter { $0.usage != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if players.isEmpty {
                Text("Usage covers quarterbacks, backs, receivers and tight ends with expected-points data.")
                    .font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 100)
            } else {
                let top = players.map { max($0.usage!.expectedPerGame, $0.usage!.pointsPerGame ?? 0) }.max() ?? 1
                ForEach(players) { player in row(player, usage: player.usage!, top: max(top, 1)) }
                legend
            }
            PanelFootnote(text: "Per game over the last \(comparison.lastN) played; expected points from ffopportunity.")
        }
    }

    private func row(_ player: PlayerComparison.Player, usage: PlayerComparison.UsageMix, top: Double) -> some View {
        let tint = ChartPalette.color(player.seriesIndex)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle().fill(tint).frame(width: 7, height: 7)
                Text(StreamFormat.shortName(player.name)).font(.caption.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 4)
                Text(summary(usage)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary).lineLimit(1)
            }
            GeometryReader { geo in
                let width = geo.size.width
                let rush = width * usage.expectedRushPerGame / top
                let receiving = width * usage.expectedReceivingPerGame / top
                let passing = width * usage.expectedPassingPerGame / top
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surface)
                    HStack(spacing: 0) {
                        Rectangle().fill(tint.opacity(0.7)).frame(width: passing)
                        Rectangle().fill(tint).frame(width: rush)
                        Rectangle().fill(tint.opacity(0.4)).frame(width: receiving)
                    }
                    .clipShape(Capsule())
                    if let points = usage.pointsPerGame {
                        Rectangle()
                            .fill(Color.primary)
                            .frame(width: 2, height: 16)
                            .offset(x: min(width * points / top, width - 2))
                    }
                }
            }
            .frame(height: 12)
            .accessibilityElement()
            .accessibilityLabel(accessibility(player, usage))
        }
    }

    private func summary(_ usage: PlayerComparison.UsageMix) -> String {
        var parts = ["xFP \(PanelFormat.points(usage.expectedPerGame))"]
        if let points = usage.pointsPerGame { parts.append("scored \(PanelFormat.points(points))") }
        if let snaps = usage.snapShare { parts.append("\(Int((snaps * 100).rounded()))% snaps") }
        if let targets = usage.targetsPerGame, targets > 0 { parts.append("\(targets.formatted(.number.precision(.fractionLength(1)))) tgt") }
        if let carries = usage.carriesPerGame, carries > 0 { parts.append("\(carries.formatted(.number.precision(.fractionLength(1)))) car") }
        return parts.joined(separator: " · ")
    }

    private func accessibility(_ player: PlayerComparison.Player, _ usage: PlayerComparison.UsageMix) -> String {
        "\(player.name): "
            + (usage.expectedPassingPerGame > 0 ? "\(PanelFormat.points(usage.expectedPassingPerGame)) expected passing, " : "")
            + "\(PanelFormat.points(usage.expectedRushPerGame)) expected rushing, "
            + "\(PanelFormat.points(usage.expectedReceivingPerGame)) expected receiving"
            + (usage.pointsPerGame.map { ", scored \(PanelFormat.points($0))" } ?? "")
    }

    private var legend: some View {
        HStack(spacing: 12) {
            if players.contains(where: { $0.usage!.expectedPassingPerGame > 0 }) {
                HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Color.secondary.opacity(0.7)).frame(width: 12, height: 8); Text("Passing") }
            }
            HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Color.secondary).frame(width: 12, height: 8); Text("Rushing") }
            HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Color.secondary.opacity(0.4)).frame(width: 12, height: 8); Text("Receiving") }
            HStack(spacing: 4) { Rectangle().fill(Color.primary).frame(width: 2, height: 10); Text("Actual") }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
}

// MARK: - Schedule ahead

/// The next few weeks for each player, shaded by how soft each defense has
/// been against his position.
struct CompareScheduleCard: View {
    let comparison: PlayerComparison

    private var weeks: [Int] {
        Array(Set(comparison.players.flatMap { $0.schedule.map(\.week) })).sorted().prefix(PlayerComparison.scheduleWeeks).map { $0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if weeks.isEmpty {
                Text("The regular season is over.").font(.caption).foregroundStyle(.secondary)
            } else {
                Grid(horizontalSpacing: 4, verticalSpacing: 4) {
                    GridRow {
                        Text("").gridColumnAlignment(.leading)
                        ForEach(weeks, id: \.self) { week in
                            Text("W\(week)").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        }
                        Text("SoS").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    }
                    ForEach(comparison.players) { player in
                        GridRow {
                            HStack(spacing: 4) {
                                Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
                                Text(StreamFormat.shortName(player.name)).lineLimit(1)
                            }
                            .font(.caption2.weight(.semibold))
                            .gridColumnAlignment(.leading)
                            ForEach(weeks, id: \.self) { week in
                                cell(player.schedule.first { $0.week == week })
                            }
                            sosCell(player.strengthOfSchedule)
                        }
                    }
                }
            }
            PanelFootnote(text: "Green is a softer defense against his position; the small number is his team's implied total. SoS above 1× is softer than average.")
        }
    }

    @ViewBuilder
    private func cell(_ week: PlayerSchedule.Week?) -> some View {
        if let week, week.isBye {
            Text("BYE")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity, minHeight: 34)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.secondary.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
        } else if let week, let opponent = week.opponent {
            VStack(spacing: 0) {
                Text((week.isHome == false ? "@" : "") + opponent).font(.caption2.weight(.semibold))
                Text(week.impliedTotal.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? " ")
                    .font(.system(size: 9).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Self.tint(week.defenseVsAverage)))
            .help(week.defenseRank.map { "#\($0) softest vs his position" } ?? "No defense data yet")
        } else {
            Text("—").font(.caption2).foregroundStyle(.tertiary).frame(maxWidth: .infinity, minHeight: 34)
        }
    }

    private func sosCell(_ sos: Double?) -> some View {
        Text(sos.map { $0.formatted(.number.precision(.fractionLength(2))) + "×" } ?? "—")
            .font(.caption2.weight(.bold).monospacedDigit())
            .foregroundStyle(sos.map { $0 >= 1.05 ? Palette.start : $0 <= 0.95 ? Palette.sit : Color.primary } ?? .secondary)
            .frame(minWidth: 40)
    }

    /// Green for a defense that gives up more than average to the position,
    /// red for less; stronger the further from average.
    static func tint(_ vsAverage: Double?) -> Color {
        guard let vsAverage else { return Palette.surface }
        let strength = min(abs(vsAverage) / 0.25, 1) * 0.35 + 0.08
        return (vsAverage >= 0 ? Palette.start : Palette.sit).opacity(strength)
    }
}

// MARK: - Status & situation

/// Injury, practice, depth chart and team total for each player, then his
/// situation as percentile dots.
struct CompareStatusCard: View {
    let comparison: PlayerComparison

    private var situation: [SituationMetric] {
        SituationMetric.allCases.filter { metric in
            metric != .depthChartRank && comparison.players.contains { player in player.chips.contains { $0.metric == metric } }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 5) {
                GridRow {
                    Text("")
                    header("Injury")
                    header("Practice")
                    header("Depth")
                    header("Team total")
                    header("Bye")
                }
                ForEach(comparison.players) { player in
                    GridRow {
                        name(player)
                        injury(player.status)
                        Text(player.status?.report?.practice?.rawValue ?? "—")
                            .foregroundStyle(practiceTint(player.status?.report?.practice))
                        Text(depth(player))
                        Text(player.status?.impliedTotal.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—")
                        Text(player.status?.byeWeek.map { "W\($0)" } ?? "—")
                    }
                    .font(.caption2.monospacedDigit())
                }
            }
            if !situation.isEmpty {
                Divider()
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 4) {
                    GridRow {
                        Text("")
                        ForEach(comparison.players) { player in
                            Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
                                .gridColumnAlignment(.center)
                        }
                    }
                    ForEach(situation) { metric in
                        GridRow {
                            Text(metric.label).font(.caption2).foregroundStyle(.secondary)
                            ForEach(comparison.players) { player in
                                dot(player.chips.first { $0.metric == metric })
                            }
                        }
                    }
                }
            }
            PanelFootnote(text: "Situation dots: fuller and greener is a better spot for him, against the league. Hover for the detail.")
        }
    }

    private func header(_ text: String) -> some View {
        Text(text).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
    }

    /// A chip's own number when there's no cohort to rank it against.
    static func raw(_ chip: SituationChip) -> String {
        switch chip.metric {
        case .targetCompetition, .airYardsShare, .redZoneShare:
            return "\(Int((chip.value * 100).rounded()))%"
        case .snapTrend:
            return String(format: "%+.0f pts", chip.value * 100)
        case .depthChartRank:
            return "#\(Int(chip.value))"
        default:
            return chip.value.formatted(.number.precision(.fractionLength(1)))
        }
    }

    private func name(_ player: PlayerComparison.Player) -> some View {
        HStack(spacing: 4) {
            Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
            Text(StreamFormat.shortName(player.name)).lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
    }

    @ViewBuilder
    private func injury(_ status: PlayerStatus?) -> some View {
        if let tag = status?.report?.designation?.rawValue ?? status?.sleeperTag,
           let badge = WaiverTargetsPanel.badge(tag) {
            InjuryBadge(label: badge)
                .help([tag, status?.report?.injury ?? status?.bodyPart].compactMap { $0 }.joined(separator: " — "))
        } else {
            Text("Healthy").foregroundStyle(.secondary)
        }
    }

    private func practiceTint(_ practice: PracticeStatus?) -> Color {
        switch practice {
        case .didNotParticipate: return Palette.sit
        case .limited: return Palette.caution
        case .full: return Palette.start
        case nil: return .secondary
        }
    }

    private func depth(_ player: PlayerComparison.Player) -> String {
        guard let rank = player.status?.depthRank else { return "—" }
        return (player.position?.rawValue ?? "") + "\(rank + 1)"
    }

    @ViewBuilder
    private func dot(_ chip: SituationChip?) -> some View {
        if let chip, let percentile = chip.percentile {
            ZStack {
                Circle().stroke(Color.secondary.opacity(0.3), lineWidth: 1.5)
                Circle()
                    .trim(from: 0, to: percentile)
                    .stroke(percentile >= 0.6 ? Palette.start : percentile <= 0.4 ? Palette.sit : Palette.caution,
                            style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text("\(Int((percentile * 100).rounded()))").font(.system(size: 8).monospacedDigit())
            }
            .frame(width: 22, height: 22)
            .gridColumnAlignment(.center)
            .help("\(chip.detail) — vs \(chip.comparedTo)")
        } else if let chip {
            Text(Self.raw(chip))
                .font(.caption2.monospacedDigit())
                .help(chip.detail)
        } else {
            Text("—").font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

// MARK: - Availability & news

/// Whether each player is a claim or a trade, how hard the league is chasing
/// him, his latest headline, and his bye and playoff weeks.
struct CompareAvailabilityCard: View {
    let comparison: PlayerComparison
    let playoffWeeks: [Int]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(comparison.players) { player in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Circle().fill(ChartPalette.color(player.seriesIndex)).frame(width: 7, height: 7)
                        Text(StreamFormat.shortName(player.name)).font(.caption.weight(.semibold)).lineLimit(1)
                        AvailabilityBadge(availability: player.availability, isBaseline: player.isBaseline)
                        Spacer(minLength: 4)
                        if let adds = player.values[.trendingAdds] {
                            Text("\(adds.formatted(.number.notation(.compactName))) adds")
                                .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        if let designation = player.injuryDesignation {
                            Text(designation).font(.caption2.weight(.bold)).foregroundStyle(InjuryTint.color(designation))
                        }
                    }
                    if let headline = player.headline {
                        Text(headline.title).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                    HStack(spacing: 3) {
                        Text(player.byeWeek.map { "Bye W\($0)" } ?? "Bye —")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(player.byeWeek.map(playoffWeeks.contains) == true ? Palette.sit : Color.secondary)
                            .frame(width: 58, alignment: .leading)
                        ForEach(player.playoffSchedule) { week in
                            Text(week.isBye ? "BYE" : (week.isHome == false ? "@" : "") + (week.opponent ?? "—"))
                                .font(.system(size: 10).weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 22)
                                .background(RoundedRectangle(cornerRadius: 5, style: .continuous)
                                    .fill(week.isBye ? Palette.sit.opacity(0.18) : CompareScheduleCard.tint(week.defenseVsAverage)))
                                .help("Week \(week.week)")
                        }
                    }
                }
            }
            PanelFootnote(text: "Playoff weeks shaded by how soft each defense is against his position. Adds are Sleeper's last 24 hours.")
        }
    }
}
