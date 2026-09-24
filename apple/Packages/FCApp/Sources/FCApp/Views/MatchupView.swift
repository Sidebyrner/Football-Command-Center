import SwiftUI
import FCCore
import FCData

/// Matchup — "this week, both sides" (§7.2).
///
/// Head-to-head by default: both lineups paired slot by slot, so nobody has to
/// flip between teams to see who is winning where. You and Opponent show one
/// team in full detail. The three are one swipe apart.
public struct MatchupView: View {
    @ObservedObject var model: MatchupModel
    @State private var selectedPair: PairedSlot?
    @Environment(\.scenePhase) private var scenePhase

    public init(model: MatchupModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            // The lineups are built after the league context arrives, and that
            // build scores the whole season for defense ranks. Until it lands, show
            // the placeholder — drawing the loaded layout with no lineups looked
            // like a broken page ("no games yet", no Opponent tab).
            if let context = model.context, model.mySide != nil || !model.isLoading {
                loaded(context)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if model.isLoading || model.errorMessage == nil {
                            LoadingPlaceholder(label: "Loading matchup…")
                        } else if let error = model.errorMessage {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("Could not load the matchup", systemImage: "exclamationmark.triangle")
                                    .font(.headline)
                                Text(error).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .refreshable { await model.refresh() }
            }
        }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        // Live scores: poll once a minute while the screen is visible and the app
        // active. liveTick() does nothing outside game windows, and the task is
        // cancelled when the screen goes away or the app leaves the foreground.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { break }
                await model.liveTick()
            }
        }
        .navigationTitle("Matchup")
        #if os(iOS)
        // The pinned scoreboard is the headline here; a large title above it
        // pushed the first slot most of the way down the screen.
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(item: $selectedPair) { pair in
            SlotDetailSheet(pair: pair, mine: model.mySide, theirs: model.opponentSide)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    /// The scoreboard and mode picker stay pinned; each mode is a page.
    ///
    /// On iPhone the pages swipe natively. An earlier version put a drag gesture
    /// on the scroll view instead, and it fired exactly once: after the first
    /// switch the content was plain cards, whose horizontal drags the scroll view
    /// claimed and cancelled. Native paging has no such conflict, snaps cleanly,
    /// and every page's content is still pinned to the screen width.
    @ViewBuilder
    private func loaded(_ context: LeagueContext) -> some View {
        VStack(spacing: 10) {
            VStack(spacing: 10) {
                scoreboard
                MatchupModePicker(model: model)
            }
            .padding(.horizontal)
            .padding(.top, 4)

            #if os(iOS)
            TabView(selection: $model.mode) {
                ForEach(model.availableModes, id: \.self) { mode in
                    page(mode, context: context).tag(mode)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            #else
            page(model.mode, context: context)
            #endif
        }
    }

    private func page(_ mode: MatchupModel.Mode, context: LeagueContext) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let error = model.errorMessage {
                    InlineErrorBanner(message: error)
                }
                if let reason = model.noOpponentReason {
                    CoverageNote(text: reason)
                }
                switch mode {
                case .headToHead:
                    headToHead
                case .mine:
                    if let side = model.mySide { individual(side) }
                case .opponent:
                    if let side = model.opponentSide { individual(side) }
                }
                VStack(alignment: .leading, spacing: 4) {
                    FreshnessBanner(provenance: context.provenance)
                    if let note = context.statsSeasonNote {
                        CoverageNote(text: note)
                    }
                    CoverageNote(text: MatchupModel.linesNote)
                    CoverageNote(text: MatchupModel.defenseNote)
                }
            }
            .padding()
            // Nothing in a page may be wider than the screen — content wider than
            // its scroll view is what lets it slide sideways.
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .refreshable { await model.refresh() }
    }

    // MARK: - Scoreboard

    @ViewBuilder
    private var scoreboard: some View {
        if let mine = model.mySide {
            VStack(spacing: 10) {
                HStack(spacing: 8) {
                    if let week = model.week {
                        Text("WEEK \(week)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .kerning(1.2)
                    }
                    if model.anyGameLive {
                        LiveBadge()
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    teamScore(mine, alignment: .leading)
                    Text("vs")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .fixedSize()
                    if let opponent = model.opponentSide {
                        teamScore(opponent, alignment: .trailing)
                    } else {
                        Text("No opponent")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
                if let opponent = model.opponentSide {
                    ScoreShareBar(mine: mine.livePoints ?? 0, theirs: opponent.livePoints ?? 0)
                }
            }
            .card()
        }
    }

    private func teamScore(_ side: MatchupSide, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(side.manager)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(side.livePoints.map { String(format: "%.1f", $0) } ?? "—")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text("\(side.leftToPlay) left to play")
                .font(.caption.weight(.semibold))
                .foregroundStyle(side.leftToPlay > 0 ? Color.primary : Color.secondary)
                .contentTransition(.numericText())
                .lineLimit(1)
            if let average = side.environment.averageTeamTotal {
                Text(String(format: "teams avg %.1f pts", average))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    // MARK: - Head-to-head

    private var headToHead: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.comparisonBasis.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let updated = model.lastLiveUpdate, let context = model.context {
                        TimelineView(.periodic(from: .now, by: 15)) { _ in
                            Text("Updated \(Freshness.relative(context.now().timeIntervalSince(updated)))")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                Spacer()
                if model.opponentSide != nil {
                    Text(slotTally)
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
            }
            ForEach(Array(model.pairedSlots.enumerated()), id: \.element.id) { offset, pair in
                Button {
                    selectedPair = pair
                } label: {
                    PairedSlotRow(pair: pair, hasOpponent: model.opponentSide != nil)
                }
                .buttonStyle(PressableCardStyle())
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("matchup.row.\(pair.index)")
                .appear(index: offset)
                .scrollFade()
            }
        }
    }

    /// "Winning 6 of 11 slots" — the head-to-head read in one line.
    private var slotTally: String {
        let decided = model.pairedSlots.filter { $0.leader == .mine || $0.leader == .theirs }
        let mine = decided.filter { $0.leader == .mine }.count
        return "Ahead in \(mine) of \(model.pairedSlots.count)"
    }

    // MARK: - Individual

    private func individual(_ side: MatchupSide) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sideSummary(side)
            ForEach(Array(side.rows.enumerated()), id: \.element.id) { offset, row in
                MatchupRowView(row: row, context: model.context)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("matchup.detail.\(row.index)")
                    .appear(index: offset)
            }
        }
    }

    @ViewBuilder
    private func sideSummary(_ side: MatchupSide) -> some View {
        let problems = [
            side.emptySlots > 0 ? "\(side.emptySlots) empty slot\(side.emptySlots == 1 ? "" : "s")" : nil,
            side.startersOnBye > 0 ? "\(side.startersOnBye) starter\(side.startersOnBye == 1 ? "" : "s") on bye" : nil,
            side.environment.missingTeams.isEmpty
                ? nil
                : "no line for \(side.environment.missingTeams.joined(separator: ", "))",
        ].compactMap { $0 }

        if !problems.isEmpty {
            Label(problems.joined(separator: " · "), systemImage: "exclamationmark.triangle.fill")
                .font(.caption)
                .foregroundStyle(Palette.caution)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Mode picker

struct MatchupModePicker: View {
    @ObservedObject var model: MatchupModel

    var body: some View {
        SlidingPicker(options: model.availableModes, selection: $model.mode) { $0.rawValue }
    }
}

// MARK: - Rows

/// Both players in one slot, with a bar showing who is ahead.
struct PairedSlotRow: View {
    let pair: PairedSlot
    let hasOpponent: Bool

    var body: some View {
        VStack(spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                side(pair.mine, value: pair.myValue, alignment: .leading, leading: pair.leader == .mine)
                Text(pair.slot)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: 42)
                if hasOpponent {
                    side(pair.theirs, value: pair.theirValue, alignment: .trailing, leading: pair.leader == .theirs)
                } else {
                    Spacer().frame(maxWidth: .infinity)
                }
            }
            if hasOpponent {
                SlotShareBar(share: pair.myShare, leader: pair.leader)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }

    private func side(_ row: MatchupRow?, value: Double?, alignment: HorizontalAlignment, leading: Bool) -> some View {
        let frameAlignment: Alignment = alignment == .leading ? .leading : .trailing
        return VStack(alignment: alignment, spacing: 2) {
            if let row, !row.isEmptySlot {
                HStack(spacing: 4) {
                    if alignment == .trailing { valueText(value, leading: leading, row: row) }
                    Text(row.name ?? "Unknown")
                        .font(.subheadline.weight(leading ? .semibold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if alignment == .leading { valueText(value, leading: leading, row: row) }
                }
                HStack(spacing: 3) {
                    if row.isLive {
                        LiveDot(size: 5)
                    } else if row.isLocked {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 8))
                            .accessibilityLabel("Locked")
                    }
                    Text(subtitle(row))
                        .lineLimit(1)
                }
                .font(.caption2)
                .foregroundStyle(row.onBye ? Palette.sit : Color.secondary)
            } else {
                Text("Empty")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
                Text("set on Sleeper")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
    }

    @ViewBuilder
    private func valueText(_ value: Double?, leading: Bool, row: MatchupRow? = nil) -> some View {
        if let value {
            Text(String(format: "%.1f", value))
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .foregroundStyle(leading ? Color.accentColor : Color.secondary)
                .contentTransition(.numericText())
                .fixedSize()
        } else if let row, let kickoff = row.kickoff, !row.isLocked {
            // Not played yet: say when, rather than a dash that reads as missing.
            Label(KickoffText.time(kickoff), systemImage: "clock")
                .labelStyle(.titleAndIcon)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
                .fixedSize()
        } else {
            Text("–")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .fixedSize()
        }
    }

    private func subtitle(_ row: MatchupRow) -> String {
        if row.onBye { return "\(row.nflTeam ?? "") bye" }
        let position = row.position?.rawValue ?? ""
        guard let opponent = row.opponent else { return position }
        return "\(position) \(row.isHome == true ? "vs" : "@") \(opponent)"
    }
}

/// Split bar for one slot: my share on the left in the accent colour.
struct SlotShareBar: View {
    let share: Double?
    let leader: SlotLeader

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceRaised)
                if let share {
                    Capsule()
                        .fill(Color.accentColor.opacity(leader == .theirs ? 0.45 : 0.9))
                        .frame(width: max(4, geometry.size.width * share))
                }
            }
        }
        .frame(height: 4)
        .motion(Motion.number, value: share)
        .accessibilityHidden(true)
    }
}

/// Whole-matchup share of points.
struct ScoreShareBar: View {
    let mine: Double
    let theirs: Double

    var body: some View {
        let total = max(mine, 0) + max(theirs, 0)
        let share = total > 0 ? max(mine, 0) / total : 0.5
        return GeometryReader { geometry in
            HStack(spacing: 2) {
                Capsule().fill(Color.accentColor)
                    .frame(width: max(6, (geometry.size.width - 2) * share))
                Capsule().fill(Palette.surfaceRaised)
            }
        }
        .frame(height: 6)
        .motion(Motion.number, value: share)
        .accessibilityHidden(true)
    }
}

/// Card-style press feedback for tappable rows.
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(configuration.isPressed ? Palette.surfaceRaised : Palette.surface)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(Motion.snappy, value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// One team's player in full detail.
struct MatchupRowView: View {
    let row: MatchupRow
    var context: LeagueContext? = nil

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text(row.slot)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(width: 44, alignment: .leading)

            if row.isEmptySlot {
                Text("Empty — set this slot on Sleeper")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                PlayerDetail(row: row)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(row.livePoints.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .contentTransition(.numericText())
                    .fixedSize()
            }
        }
        .card(padding: 12)
        .playerCardMenu(row.playerID, context: context)
    }
}

/// Everything known about one player this week. Shared by the individual rows
/// and the head-to-head detail sheet.
struct PlayerDetail: View {
    let row: MatchupRow

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(row.name ?? "Unknown")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                PositionChip(position: row.position)
                if row.isLive {
                    LiveDot()
                } else if row.isLocked {
                    Label("Locked", systemImage: "lock.fill")
                        .labelStyle(.iconOnly)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Text(gameLine)
                .font(.caption)
                .foregroundStyle(row.onBye ? Palette.sit : Color.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if let projected = row.projected {
                Text(String(format: "proj %.1f this week", projected))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Color.accentColor)
            }

            if let thisSeason = row.thisSeason {
                Text(thisSeasonText(thisSeason))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let season = row.season {
                Text(seasonText(season))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if row.thisSeason == nil, !row.hasProductionData {
                Text("No production data for \(row.position?.rawValue ?? "this position")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else if row.thisSeason == nil {
                Text("No season line")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            if let summary = row.defenseSummary {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(defenseColour)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var gameLine: String {
        guard !row.onBye else { return "\(row.nflTeam ?? "") on bye — scores 0" }
        guard let opponent = row.opponent else { return row.nflTeam ?? "" }
        let venue = row.isHome == true ? "vs" : "@"
        let implied = row.impliedTotal.map { String(format: " · team total %.1f", $0) } ?? ""
        return "\(row.nflTeam ?? "") \(venue) \(opponent)\(implied)"
    }

    private func thisSeasonText(_ line: SeasonLine) -> String {
        var parts = [String(format: "this season %.1f/gm", line.pointsPerGame)]
        if let form = line.formPointsPerGame, line.games > 4 { parts.append(String(format: "last 4 %.1f", form)) }
        parts.append("\(line.games) gm · Sleeper")
        return parts.joined(separator: " · ")
    }

    private func seasonText(_ season: SeasonLine) -> String {
        var parts = [String(format: "%.1f/gm", season.pointsPerGame)]
        if let form = season.formPointsPerGame { parts.append(String(format: "last 4 %.1f", form)) }
        if let floor = season.floor, let ceiling = season.ceiling {
            parts.append(String(format: "%.1f–%.1f", floor, ceiling))
        }
        parts.append("\(season.games) gm")
        return parts.joined(separator: " · ")
    }

    private var defenseColour: Color {
        guard let delta = row.defense?.vsLeagueAverage else { return .secondary }
        return delta >= 0 ? Palette.start : Palette.sit
    }
}

/// Both players in one slot, in full.
struct SlotDetailSheet: View {
    let pair: PairedSlot
    let mine: MatchupSide?
    let theirs: MatchupSide?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    player(pair.mine, manager: mine?.manager ?? "You", value: pair.myValue)
                    if theirs != nil {
                        player(pair.theirs, manager: theirs?.manager ?? "Opponent", value: pair.theirValue)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(pair.slot)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
    }

    private func player(_ row: MatchupRow?, manager: String, value: Double?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(manager.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.8)
                    .lineLimit(1)
                Spacer()
                if let points = row?.livePoints {
                    Text(String(format: "%.1f pts", points))
                        .font(.caption.weight(.semibold).monospacedDigit())
                }
            }
            if let row, !row.isEmptySlot {
                PlayerDetail(row: row)
            } else {
                Text("Empty — set this slot on Sleeper")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
            }
        }
        .card()
    }
}
