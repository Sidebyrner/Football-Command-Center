import SwiftUI
import FCCore
import FCData

/// Planning — "get ahead of the schedule" (§7.4).
///
/// Three jobs, one at a time, each opening with the sentence that says what it
/// is for: fix your bye weeks, find a trade partner, or grab a free agent before
/// you need him. A first-visit card explains all three once.
public struct PlanningView: View {
    @ObservedObject var model: PlanningModel
    let introSeen: Bool
    let onDismissIntro: () -> Void

    public init(model: PlanningModel, introSeen: Bool = true, onDismissIntro: @escaping () -> Void = {}) {
        self.model = model
        self.introSeen = introSeen
        self.onDismissIntro = onDismissIntro
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Loading your season…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    if !introSeen {
                        PlanningIntroCard(onDismiss: onDismissIntro)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        SlidingPicker(options: PlanningMode.allCases, selection: $model.mode) { $0.rawValue }
                        Label(model.mode.purpose, systemImage: model.mode.systemImage)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .id(model.mode)
                            .transition(.opacity)
                    }

                    Group {
                        switch model.mode {
                        case .byes: ByesSection(model: model, context: context)
                        case .trades: TradesSection(model: model)
                        case .waivers: WaiversSection(model: model)
                        }
                    }
                    .id(model.mode)
                    .transition(.opacity)

                    VStack(alignment: .leading, spacing: 4) {
                        FreshnessBanner(provenance: context.provenance)
                        if let note = context.statsSeasonNote {
                            CoverageNote(text: note)
                        }
                        if let warning = model.coverageWarning {
                            CoverageNote(text: warning)
                        }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.mode)
            .motion(Motion.smooth, value: introSeen)
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("Planning")
    }
}

// MARK: - Intro

struct PlanningIntroCard: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Plan ahead")
                .font(.title3.weight(.bold))
            Text("Planning looks at the rest of your season so problems don't catch you on a Sunday.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(PlanningMode.allCases, id: \.self) { mode in
                Label {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(mode.rawValue).font(.subheadline.weight(.semibold))
                        Text(mode.purpose)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } icon: {
                    Image(systemName: mode.systemImage).foregroundStyle(Color.accentColor)
                }
            }
            Button("Got it", action: onDismiss)
                .buttonStyle(.borderedProminent)
                .padding(.top, 2)
        }
        .card(fill: Color.accentColor.opacity(0.10))
    }
}

// MARK: - Byes

struct ByesSection: View {
    @ObservedObject var model: PlanningModel
    let context: LeagueContext

    var body: some View {
        let short = model.userShortWeeks()
        VStack(alignment: .leading, spacing: 12) {
            if short.isEmpty {
                Label("You can field a full lineup in every remaining week.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.start)
                    .card(fill: Palette.start.opacity(0.10))
            } else {
                Text("Short in \(short.count) of \(context.remainingWeeks.count) remaining weeks. Tap a week to fix it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ForEach(Array(short.enumerated()), id: \.element.id) { offset, cell in
                    ShortWeekCard(model: model, cell: cell)
                        .appear(index: offset)
                        .scrollFade()
                }
            }

            DisclosureGroup {
                LeagueGrid(model: model, context: context)
                    .padding(.top, 8)
            } label: {
                SectionHeader(
                    title: "League view",
                    subtitle: "Every team, every week. Numbers are starting slots that team can't fill."
                )
            }
            .card()
        }
    }
}

struct ShortWeekCard: View {
    @ObservedObject var model: PlanningModel
    let cell: CrunchCell

    private var expanded: Bool { model.selectedWeek == cell.week }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                model.selectedWeek = expanded ? nil : cell.week
            } label: {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Week \(cell.week)").font(.headline)
                        HStack(spacing: 4) {
                            ForEach(model.neededPositions(week: cell.week).sorted { $0.rawValue < $1.rawValue }, id: \.self) {
                                PositionChip(position: $0)
                            }
                        }
                    }
                    Spacer()
                    Text("\(cell.shortfall) short")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(cell.shortfall >= 2 ? Palette.sit : Palette.caution))
                    Image(systemName: "chevron.down")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.selection, trigger: expanded)

            if expanded {
                weekDetail
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .card()
        .motion(Motion.snappy, value: expanded)
    }

    @ViewBuilder
    private var weekDetail: some View {
        let pickups = model.pickups(for: cell.week, limit: 5)
        let partners = model.tradePartners(week: cell.week)

        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Text("Pick up").font(.subheadline.weight(.semibold))
            if pickups.isEmpty {
                Text("No one available at these positions plays in week \(cell.week).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(pickups) { PlanningPlayerRow(player: $0, showWeeks: false) }
            }

            Text("Trade with").font(.subheadline.weight(.semibold)).padding(.top, 4)
            if partners.isEmpty {
                Text("Every rival is short in week \(cell.week) too.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text(partners.map(\.manager).joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("They can field a full lineup that week — see Trades for who they can spare.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

struct LeagueGrid: View {
    @ObservedObject var model: PlanningModel
    let context: LeagueContext

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 2, verticalSpacing: 2) {
                GridRow {
                    Text("Team")
                        .font(.caption.weight(.semibold))
                        .frame(width: 104, alignment: .leading)
                    ForEach(context.remainingWeeks, id: \.self) { week in
                        Text("\(week)")
                            .font(.caption2.monospacedDigit())
                            .frame(width: 28)
                            .foregroundStyle(model.selectedWeek == week ? Color.accentColor : Color.secondary)
                    }
                }
                ForEach(context.teams) { team in
                    GridRow {
                        Text(team.manager)
                            .font(.caption)
                            .lineLimit(1)
                            .fontWeight(team.isUser ? .bold : .regular)
                            .frame(width: 104, alignment: .leading)
                        ForEach(context.remainingWeeks, id: \.self) { week in
                            cellView(model.cell(rosterID: team.rosterID, week: week))
                        }
                    }
                }
            }
        }
    }

    private func cellView(_ cell: CrunchCell?) -> some View {
        Text(cell.map { $0.shortfall > 0 ? "\($0.shortfall)" : "·" } ?? "–")
            .font(.caption2.weight(cell?.isShort == true ? .bold : .regular).monospacedDigit())
            .frame(width: 28, height: 22)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(colour(cell))
            )
            .foregroundStyle(cell?.isShort == true ? Color.white : Color.secondary)
    }

    private func colour(_ cell: CrunchCell?) -> Color {
        guard let cell, cell.isShort else { return Palette.surface }
        return cell.shortfall >= 2 ? Palette.sit.opacity(0.9) : Palette.caution.opacity(0.9)
    }
}

// MARK: - Trades

struct TradesSection: View {
    @ObservedObject var model: PlanningModel
    @Environment(\.openTrade) private var openTrade

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            StartTradeCard { openTrade() }
                .disabled(model.context == nil)

            if model.userShortWeeks().isEmpty {
                Label("No short weeks — the wizard can still find an upgrade.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.start)
                    .card(fill: Palette.start.opacity(0.10))
            } else if model.tradeTargets.isEmpty {
                Text("No rival has a spare bench player who plays in your short weeks.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .card()
            } else {
                Text("Rivals who aren't short in your problem weeks and have a bench player at a position you need.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(model.tradeTargets.enumerated()), id: \.element.id) { offset, target in
                    TradeTargetCard(target: target) {
                        openTrade(TradeWizardPrefill(
                            positions: Set(target.candidates.map(\.position)),
                            weeks: target.weeksCovered,
                            rivalRosterID: target.rival.rosterID,
                            theirPlayerID: target.candidates.first?.id
                        ))
                    }
                    .appear(index: offset)
                }
            }
        }
    }
}

/// The wizard's front door: one clear action above the evidence.
struct StartTradeCard: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "wand.and.stars")
                    .font(.title2)
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.accentColor.opacity(0.15)))
                VStack(alignment: .leading, spacing: 2) {
                    Text("Start a trade")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Pick a need, find who can fill it, build the deal, write the pitch.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(PressableCardStyle())
        .accessibilityIdentifier("start-trade")
    }
}

struct TradeTargetCard: View {
    let target: TradeTarget
    var onStart: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(target.rival.manager)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                Text("covers \(target.weeksCovered.count) week\(target.weeksCovered.count == 1 ? "" : "s")")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.accentColor)
            }
            WeekChips(weeks: target.weeksCovered)
            ForEach(target.candidates.prefix(4)) { PlanningPlayerRow(player: $0, showWeeks: true, showAvailability: false) }
            if let onStart {
                Button(action: onStart) {
                    Label("Build a trade with \(target.rival.manager)", systemImage: "arrow.left.arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .padding(.top, 2)
            }
        }
        .card()
    }
}

// MARK: - Waivers

struct WaiversSection: View {
    @ObservedObject var model: PlanningModel
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button {
                openScreen(.waivers)
            } label: {
                Label("Open the Waiver Board — projections, snaps, targets and expected points for every free agent", systemImage: "tray.and.arrow.down")
                    .font(.footnote.weight(.semibold))
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.bordered)
            if model.userShortWeeks().isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "Best available", subtitle: "No short weeks — the best free agents by season points per game.")
                    ForEach(model.bestAvailable) { PlanningPlayerRow(player: $0, showWeeks: false, showAvailability: false) }
                }
                .card()
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "Fills your short weeks", subtitle: "Free agents at a position you need, who play that week.")
                    if model.waiverFills.isEmpty {
                        Text("No free agent with stats fills a short week.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(model.waiverFills) { PlanningPlayerRow(player: $0, showWeeks: true, showAvailability: false) }
                }
                .card()
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    title: "Trending adds",
                    subtitle: "Popularity only — what leagues everywhere are adding. The only signal for DEF and IDP."
                )
                if model.trendingUnavailable {
                    Text("Couldn't load trending adds.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if model.waiverTrending.isEmpty {
                    Text("Nobody trending is available in your league.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ForEach(model.waiverTrending.prefix(8)) { PlanningPlayerRow(player: $0, showWeeks: true, showAvailability: false) }
            }
            .card()
        }
    }
}

// MARK: - Shared rows

struct PlanningPlayerRow: View {
    let player: PlanningPlayer
    var showWeeks: Bool = true
    var showAvailability: Bool = true

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            PositionChip(position: player.position)
                .frame(width: 40, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(player.name)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let team = player.team {
                        Text(team).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if showAvailability {
                    Text(player.availability.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if showWeeks, !player.coversWeeks.isEmpty {
                    WeekChips(weeks: player.coversWeeks, prefix: "covers")
                }
                if let signal = player.signals.first {
                    Text(signal.label)
                        .font(.caption2)
                        .foregroundStyle(Color.accentColor)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 1) {
                if let ppg = player.pointsPerGame {
                    Text(String(format: "%.1f", ppg))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                    Text("pts/gm").font(.caption2).foregroundStyle(.secondary)
                } else if player.popularityOnly {
                    if let adds = player.trendingAdds {
                        Text(adds.formatted(.number.notation(.compactName)))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                    }
                    Text("adds").font(.caption2).foregroundStyle(.secondary)
                } else {
                    Text("no stats").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 2)
    }
}

struct WeekChips: View {
    let weeks: [Int]
    var prefix: String?

    var body: some View {
        HStack(spacing: 4) {
            if let prefix {
                Text(prefix).font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(weeks.prefix(6), id: \.self) { week in
                Text("W\(week)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
            }
            if weeks.count > 6 {
                Text("+\(weeks.count - 6)").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}
