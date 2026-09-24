import SwiftUI
import FCCore
import FCData

/// Opens the Player Card for a player from anywhere, without the caller
/// holding the shell. The shell decides how: a sheet on phone, a sheet or a
/// separate window on Mac and iPad.
public struct OpenPlayerCardAction: Sendable {
    let handler: @MainActor @Sendable (String, LeagueContext) -> Void

    @MainActor
    public func callAsFunction(_ playerID: String, context: LeagueContext) {
        handler(playerID, context)
    }
}

private struct OpenPlayerCardKey: EnvironmentKey {
    static let defaultValue = OpenPlayerCardAction { _, _ in }
}

public extension EnvironmentValues {
    var openPlayerCard: OpenPlayerCardAction {
        get { self[OpenPlayerCardKey.self] }
        set { self[OpenPlayerCardKey.self] = newValue }
    }
}

extension View {
    /// Adds "Open Player Card" to a row's context menu — long-press on phone,
    /// right-click on Mac.
    func playerCardMenu(_ playerID: String?, context: LeagueContext?) -> some View {
        modifier(PlayerCardMenu(playerID: playerID, context: context))
    }
}

struct PlayerCardMenu: ViewModifier {
    let playerID: String?
    let context: LeagueContext?
    @Environment(\.openPlayerCard) private var openPlayerCard

    func body(content: Content) -> some View {
        if let playerID, let context {
            content.contextMenu {
                Button {
                    openPlayerCard(playerID, context: context)
                } label: {
                    Label("Open Player Card", systemImage: "person.text.rectangle")
                }
                Button {
                    Clipboard.copy(context.playerName(playerID) ?? playerID)
                } label: {
                    Label("Copy name", systemImage: "doc.on.doc")
                }
            }
        } else {
            content
        }
    }
}

/// The clipboard on both platforms.
enum Clipboard {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

/// The Player Card.
public struct PlayerCardView: View {
    @ObservedObject var model: PlayerCardModel
    @State private var tab: Tab = .overview

    enum Tab: String, CaseIterable, Hashable {
        case overview = "Overview"
        case log = "Log"
        case projections = "Projections"
        case grade = "Grade"
    }

    public init(model: PlayerCardModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                SlidingPicker(options: Tab.allCases, selection: $tab) { $0.rawValue }
                Group {
                    switch tab {
                    case .overview: overview
                    case .log: logSection
                    case .projections: projectionsSection
                    case .grade: gradeSection
                    }
                }
                .id(tab)
                .transition(.opacity)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: tab)
        }
        .navigationTitle(model.name)
        .task { await model.load() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 12) {
            PlayerAvatar(sleeperID: model.id, name: model.name, position: model.position, size: 56)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(model.name).font(.title3.weight(.bold))
                    PositionChip(position: model.position)
                }
                if let status = model.status {
                    Text([model.team, status.opponent.map { "vs \($0) this week" }, status.availability.label]
                            .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let url = model.context.league.leagueID.isEmpty ? nil : SleeperLinks.team(leagueID: model.context.league.leagueID) {
                Link(destination: url) {
                    Label("Sleeper", systemImage: "arrow.up.forward.app").font(.caption.weight(.semibold))
                }
            }
        }
    }

    // MARK: - Overview

    @ViewBuilder
    private var overview: some View {
        if let status = model.status {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title: "Status", systemImage: "cross.case")
                row("Injury", value: injuryText(status), tint: status.sleeperTag == nil && status.report?.designation == nil ? .secondary : Palette.caution)
                row("Depth chart", value: status.depthRank.map { "#\($0 + 1) at \(model.position?.rawValue ?? "")" } ?? "not listed", source: "official, nflverse")
                row("Bye", value: status.byeWeek.map { "Week \($0)" } ?? "—")
                if let implied = status.impliedTotal {
                    row("Team total", value: String(format: "%.1f implied", implied), source: "recorded closing line")
                }
            }
            .card()
        }
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "News", systemImage: "newspaper")
            if model.news.isEmpty {
                Text(model.newsUnavailable ? "News could not be loaded." : "No recent news.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.news.prefix(5)) { item in
                VStack(alignment: .leading, spacing: 3) {
                    if let title = item.title { Text(title).font(.subheadline.weight(.semibold)) }
                    if let body = item.metadata?.description {
                        Text(body).font(.caption).fixedSize(horizontal: false, vertical: true)
                    }
                    if let analysis = item.metadata?.analysis {
                        Text(analysis).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    Text([item.sourceLabel, item.publishedAt?.formatted(.relative(presentation: .named))].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption2).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 2)
            }
        }
        .card()
    }

    private func injuryText(_ status: PlayerStatus) -> String {
        var parts: [String] = []
        if let designation = status.report?.designation { parts.append(designation.rawValue) }
        else if let tag = status.sleeperTag { parts.append(tag) }
        if let injury = status.report?.injury ?? status.bodyPart { parts.append(injury) }
        if let practice = status.report?.practice { parts.append(practice.phrase) }
        return parts.isEmpty ? "No designation" : parts.joined(separator: " · ")
    }

    private func row(_ label: String, value: String, source: String? = nil, tint: Color = .primary) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 90, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(value).font(.subheadline).foregroundStyle(tint)
                if let source { Text(source).font(.caption2).foregroundStyle(.tertiary) }
            }
            Spacer()
        }
    }

    // MARK: - Log

    @ViewBuilder
    private var logSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "This season", subtitle: "Points in your scoring from Sleeper's lines; snaps and expected points from nflverse.")
            if model.log.isEmpty {
                Text("No games recorded this season.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(model.log) { week in
                HStack(spacing: 10) {
                    Text("W\(week.week)").font(.caption.weight(.bold).monospacedDigit()).frame(width: 32, alignment: .leading)
                    Text(week.opponent.map { "vs \($0)" } ?? "—").font(.caption).frame(width: 60, alignment: .leading)
                    Spacer()
                    if let snap = week.snapShare { StatPill(label: "snaps", value: snap.formatted(.percent.precision(.fractionLength(0))), tint: .secondary) }
                    if let targets = week.targets, targets > 0 { StatPill(label: "tgt", value: targets.formatted(), tint: .secondary) }
                    if let rush = week.rushAttempts, rush > 0 { StatPill(label: "att", value: rush.formatted(), tint: .secondary) }
                    if let xfp = week.expectedPoints { StatPill(label: "xFP", value: xfp.formatted(.number.precision(.fractionLength(1))), tint: .secondary) }
                    if let projected = week.projected { StatPill(label: "proj", value: projected.formatted(.number.precision(.fractionLength(1))), tint: .secondary) }
                    StatPill(label: "pts", value: week.points.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—")
                }
            }
        }
        .card()
    }

    // MARK: - Projections

    @ViewBuilder
    private var projectionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "This week", subtitle: "Two separate projections. Neither is blended into the other.")
            HStack(spacing: 24) {
                StatPill(label: model.context.inSeason.projectionSourceLabel ?? "Rotowire via Sleeper",
                         value: model.rotowireThisWeek.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—")
                StatPill(label: CommandCenterProjection.sourceLabel,
                         value: model.commandCenter?.weekly.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—",
                         tint: Color.accentColor)
                if let ros = model.commandCenter?.restOfSeasonPerGame {
                    StatPill(label: "rest of season /gm", value: ros.formatted(.number.precision(.fractionLength(1))), tint: Color.accentColor)
                }
            }
            if let projection = model.commandCenter {
                if let note = projection.note {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(projection.factors) { factor in
                    HStack(alignment: .firstTextBaseline) {
                        Text(factor.name).font(.caption.weight(.semibold)).frame(width: 120, alignment: .leading)
                        Text(factor.name == "Pace" ? factor.value.formatted(.number.precision(.fractionLength(1))) : "×" + factor.value.formatted(.number.precision(.fractionLength(2))))
                            .font(.caption.monospacedDigit())
                            .frame(width: 44, alignment: .trailing)
                        Text(factor.detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .card()

        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "How each has done", subtitle: "Past weeks this season. Command Center is rebuilt from the weeks before each game, without the matchup term.")
            if model.calibration.isEmpty {
                Text("No completed games to check against yet.").font(.caption).foregroundStyle(.secondary)
            } else {
                if let summary = model.calibrationSummary {
                    HStack(spacing: 20) {
                        StatPill(label: "Rotowire avg miss", value: summary.rotowireError.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—")
                        StatPill(label: "Command Center avg miss", value: summary.commandCenterError.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—", tint: Color.accentColor)
                        StatPill(label: "games", value: "\(summary.weeks)", tint: .secondary)
                    }
                }
                ForEach(model.calibration) { week in
                    HStack {
                        Text("W\(week.week)").font(.caption.weight(.bold)).frame(width: 32, alignment: .leading)
                        Spacer()
                        StatPill(label: "Rotowire", value: week.rotowire.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—", tint: .secondary)
                        StatPill(label: "CC", value: week.commandCenter.map { $0.formatted(.number.precision(.fractionLength(1))) } ?? "—", tint: .secondary)
                        StatPill(label: "actual", value: week.actual.formatted(.number.precision(.fractionLength(1))))
                    }
                }
            }
        }
        .card()
    }

    // MARK: - Grade

    @ViewBuilder
    private var gradeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                SectionHeader(title: "Cohort grade", subtitle: "Percentile against \(model.position?.rawValue ?? "his position") players with real snaps this season, weighted for your scoring.")
                Spacer()
                gradeBadge(model.grade?.score, thin: model.grade?.isThin ?? true)
            }
            if let grade = model.grade {
                Text("\(grade.tier ?? "No tier") · \(Int(grade.coverage * 100))% of the model's weight had data")
                    .font(.caption).foregroundStyle(grade.isThin ? Palette.caution : .secondary)
                ForEach(grade.topFactors) { factor in
                    HStack {
                        Text(factor.metric.label).font(.caption)
                        Spacer()
                        ProgressView(value: factor.percentile).frame(width: 80)
                        Text("\(Int(factor.percentile * 100))").font(.caption.monospacedDigit()).frame(width: 28, alignment: .trailing)
                    }
                }
                if !grade.missing.isEmpty {
                    Text("Not available: " + grade.missing.map(\.label).joined(separator: ", ") + ". Left out, never defaulted.")
                        .font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                Text("No current-season line to grade.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .card()

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Situation", subtitle: "Each its own number, from its own source. None is inside the grade above.")
            if model.chips.isEmpty {
                Text("No situation data for this player yet.").font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(model.chips) { chip in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(chip.metric.label).font(.caption.weight(.semibold))
                            Spacer()
                            if let pct = chip.percentile {
                                Text("\(Int(pct * 100))").font(.caption.weight(.bold).monospacedDigit())
                                    .foregroundStyle(pct >= 0.6 ? Palette.start : (pct <= 0.4 ? Palette.sit : .secondary))
                            }
                        }
                        Text(chip.detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        Text(chip.percentile == nil ? chip.metric.source : "vs \(chip.comparedTo) · \(chip.metric.source)")
                            .font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Palette.surfaceRaised))
                }
            }
        }
        .card()

        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $model.showWeighted) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Weighted view").font(.headline)
                    Text("Your own composite of the grade and the situation, under weights you set. Optional, and labelled as yours.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if model.showWeighted, let weighted = model.weighted {
                HStack {
                    gradeBadge(weighted.score, thin: weighted.coverage < PlayerGrade.thinCoverage)
                    Text("\(Int(weighted.coverage * 100))% of your weight had a number behind it")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Reset") { model.resetWeights() }.font(.caption)
                }
                weightSlider(key: WeightedGrade.gradeKey, label: "Cohort grade")
                ForEach(SituationMetric.allCases) { metric in
                    weightSlider(key: metric.rawValue, label: metric.label)
                }
            }
        }
        .card()
    }

    private func weightSlider(key: String, label: String) -> some View {
        HStack {
            Text(label).font(.caption).frame(width: 130, alignment: .leading)
            Slider(value: Binding(
                get: { model.weight(for: key) },
                set: { model.weights[key] = ($0 * 2).rounded() / 2 }
            ), in: 0...50)
            Text(model.weight(for: key).formatted(.number.precision(.fractionLength(0))))
                .font(.caption.monospacedDigit()).frame(width: 24, alignment: .trailing)
        }
    }

    private func gradeBadge(_ score: Int?, thin: Bool) -> some View {
        Text(score.map(String.init) ?? "—")
            .font(.title2.weight(.bold).monospacedDigit())
            .foregroundStyle(thin ? Color.secondary : Color.accentColor)
            .frame(width: 56, height: 56)
            .background(Circle().strokeBorder(thin ? Color.secondary.opacity(0.4) : Color.accentColor, style: StrokeStyle(lineWidth: 3, dash: thin ? [4, 3] : [])))
            .accessibilityLabel(score.map { "Grade \($0)\(thin ? ", thin" : "")" } ?? "No grade")
    }
}

/// A Player Card in its own navigation stack, for sheets and windows.
public struct PlayerCardSheet: View {
    @StateObject var model: PlayerCardModel
    @Environment(\.dismiss) private var dismiss

    public init(model: PlayerCardModel) {
        _model = StateObject(wrappedValue: model)
    }

    public var body: some View {
        NavigationStack {
            PlayerCardView(model: model)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 640)
        #endif
    }
}
