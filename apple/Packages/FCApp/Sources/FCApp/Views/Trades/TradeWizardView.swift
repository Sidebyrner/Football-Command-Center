import SwiftUI
import FCCore
import FCData

/// A request to open the desk, optionally already pointed at a need or rival.
public struct TradeWizardLaunch: Identifiable, Hashable {
    public let id = UUID()
    public var prefill: TradeWizardPrefill?

    public init(prefill: TradeWizardPrefill? = nil) {
        self.prefill = prefill
    }
}

/// The desk as a sheet, for entry points that keep their own screen on show.
/// Owns its model, built fresh from the league context each time it opens so
/// a deal never carries stale rosters.
struct TradeWizardSheet: View {
    @StateObject private var model: TradeWizardModel
    @Environment(\.dismiss) private var dismiss

    init(context: LeagueContext, relayBaseURL: URL?, prefill: TradeWizardPrefill?) {
        // Local inference on a home GPU takes seconds, not milliseconds.
        let relay = relayBaseURL.map { RelayClient(baseURL: $0, transport: URLSessionTransport(timeout: 90)) }
        _model = StateObject(wrappedValue: TradeWizardModel(context: context, relay: relay, prefill: prefill))
    }

    var body: some View {
        NavigationStack {
            TradeDeskView(model: model)
                .navigationTitle("Trade Desk")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .task { await model.prepare() }
        #if os(macOS)
        .frame(minWidth: 900, idealWidth: 1040, minHeight: 640, idealHeight: 760)
        #endif
    }
}

/// The Trade Desk as a screen in the app's navigation.
public struct TradeDeskScreen: View {
    @ObservedObject var screen: TradeDeskScreenModel

    public init(screen: TradeDeskScreenModel) {
        self.screen = screen
    }

    public var body: some View {
        Group {
            if let desk = screen.desk {
                TradeDeskView(model: desk)
                    .id(ObjectIdentifier(desk))
            } else if let error = screen.errorMessage {
                ContentUnavailableView("Could not load your league", systemImage: "exclamationmark.triangle",
                                       description: Text(error))
            } else {
                LoadingPlaceholder(label: "Reading every roster…")
            }
        }
        .navigationTitle("Trade Desk")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await screen.startOver() }
                } label: {
                    Label("Start over", systemImage: "arrow.counterclockwise")
                }
                .disabled(screen.desk == nil)
                .help("Clear the deal and start from your needs")
            }
        }
        .sensoryFeedback(.success, trigger: screen.refreshCount)
    }
}

// MARK: - The desk

struct TradeDeskView: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width >= 860 {
                WideDesk(model: model)
            } else {
                CompactDesk(model: model)
            }
        }
        .accessibilityIdentifier("trade-wizard")
    }
}

/// iPhone and narrow windows: one step per screen, pushed, so the system back
/// button and swipe-back work and nothing picked is lost on the way back.
private struct CompactDesk: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        StepScroll(model: model) { GoalStep(model: model) }
            .navigationDestination(isPresented: stepBinding(.partner)) {
                StepScroll(model: model) { PartnerStep(model: model) }
                    .navigationTitle("Who has it")
                    .navigationDestination(isPresented: stepBinding(.deal)) {
                        StepScroll(model: model) { DealStep(model: model) }
                            .navigationTitle("Build the deal")
                            .navigationDestination(isPresented: stepBinding(.approach)) {
                                StepScroll(model: model) { ApproachStep(model: model) }
                                    .navigationTitle("Approach")
                            }
                    }
            }
    }

    /// Presented while the desk is at or past `step`; popping goes back one.
    private func stepBinding(_ step: TradeStep) -> Binding<Bool> {
        Binding(
            get: { model.step.rawValue >= step.rawValue },
            set: { presented in
                if !presented, model.step.rawValue >= step.rawValue {
                    model.step = TradeStep(rawValue: step.rawValue - 1) ?? .goal
                }
            }
        )
    }
}

/// Mac, iPad and wide windows: need and partner on the left, the deal on the
/// right, both in view at once.
struct WideDesk: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    DeskHeader(model: model)
                    if model.goal == nil || model.step == .goal {
                        GoalStep(model: model)
                    } else {
                        Button {
                            model.step = .goal
                        } label: {
                            Label("Change what you need", systemImage: "chevron.left")
                                .font(.footnote.weight(.semibold))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(Color.accentColor)
                        PartnerStep(model: model)
                    }
                }
                .padding()
            }
            .frame(width: 400)
            .background(Palette.surface.opacity(0.5))

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if model.partner == nil {
                        ContentUnavailableView(
                            "Pick a partner",
                            systemImage: "arrow.left.arrow.right",
                            description: Text("Choose what you need on the left, or search for any player, then pick a team to build the deal here.")
                        )
                        .padding(.top, 80)
                    } else if model.step == .approach {
                        ApproachStep(model: model)
                    } else {
                        DealStep(model: model)
                    }
                }
                .padding()
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .motion(Motion.snappy, value: model.step)
        .task { await model.prepare() }
    }
}

/// One compact step's scroll view, with the shared header.
private struct StepScroll<Content: View>: View {
    @ObservedObject var model: TradeWizardModel
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                DeskHeader(model: model)
                content
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .sensoryFeedback(.selection, trigger: model.step)
        .task { await model.prepare() }
    }
}

// MARK: - Header

private struct DeskHeader: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StepProgress(step: model.step)
            if let label = model.window.label {
                Label(label, systemImage: model.window.isClosed ? "lock.fill" : "clock")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(model.window.isClosed ? Palette.sit : Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let note = model.prefillNote {
                Label(note, systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .card(padding: 10)
            }
            if model.primaryBasis == .production, let note = model.context.statsSeasonNote {
                CoverageNote(text: note)
            }
        }
    }
}

private struct StepProgress: View {
    let step: TradeStep

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(TradeStep.allCases) { item in
                    Capsule()
                        .fill(item.rawValue <= step.rawValue ? Color.accentColor : Palette.surfaceRaised)
                        .frame(height: 4)
                }
            }
            .accessibilityHidden(true)
            HStack(alignment: .firstTextBaseline) {
                Text(step.title)
                    .font(.title2.weight(.bold))
                Spacer()
                Text("Step \(step.rawValue + 1) of \(TradeStep.allCases.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(step.rawValue + 1) of \(TradeStep.allCases.count): \(step.title)")
    }
}

// MARK: - Step 1

struct GoalStep: View {
    @ObservedObject var model: TradeWizardModel
    @State private var query = ""
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PlayerSearch(model: model, query: $query)

            if query.isEmpty {
                if model.window.isClosed {
                    Label("Trades are closed for the season. You can still look around.", systemImage: "lock.fill")
                        .font(.subheadline)
                        .foregroundStyle(Palette.sit)
                        .card(fill: Palette.sit.opacity(0.08))
                }
                if model.goals.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("No short weeks and no starter below the start line.", systemImage: "checkmark.seal.fill")
                            .font(.subheadline)
                            .foregroundStyle(Palette.start)
                        Button("Browse the Waiver Board instead") { openScreen(.waivers) }
                            .font(.caption)
                    }
                    .card(fill: Palette.start.opacity(0.10))
                } else {
                    SectionHeader(title: "From your roster",
                                  subtitle: "Weeks you can't fill, and starters below the league's start line — superflex counted.")
                    ForEach(Array(model.goals.enumerated()), id: \.element.id) { offset, goal in
                        Button { model.choose(goal: goal) } label: {
                            GoalRow(goal: goal, selected: model.goal == goal)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("trade-goal-\(offset)")
                        .appear(index: offset)
                    }
                }

                SectionHeader(title: "Or pick a position", subtitle: "Shows every rival with a spare player there.")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 64), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(model.pickablePositions, id: \.self) { position in
                        Button { model.choose(position: position) } label: {
                            Text(position.rawValue)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.position(position))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(Palette.position(position).opacity(0.14)))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Any \(position.rawValue)")
                        .accessibilityHint("Shows every rival with a spare \(position.rawValue)")
                    }
                }
            }
        }
    }
}

private struct GoalRow: View {
    let goal: TradeGoal
    let selected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: goal.weeks.isEmpty ? "arrow.up.circle.fill" : "calendar.badge.exclamationmark")
                .font(.title3)
                .foregroundStyle(goal.weeks.isEmpty ? Color.accentColor : Palette.caution)
            VStack(alignment: .leading, spacing: 4) {
                Text(goal.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Text(goal.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .card(fill: selected ? Color.accentColor.opacity(0.12) : Palette.surface)
        .contentShape(Rectangle())
    }
}

/// Find any player on any rival's roster and go straight to a deal for him.
private struct PlayerSearch: View {
    @ObservedObject var model: TradeWizardModel
    @Binding var query: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Find a player on any team", text: $query)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("trade-search")
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.surfaceRaised))

            if !query.isEmpty {
                let results = model.search(query)
                if results.isEmpty {
                    Text("Nobody on a rival's roster matches “\(query)”.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(results) { result in
                    Button {
                        model.target(result)
                        query = ""
                    } label: {
                        HStack(spacing: 10) {
                            PlayerAvatar(sleeperID: result.player.id, name: result.player.name, position: result.player.position, size: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 4) {
                                    Text(result.player.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                    if let badge = result.player.injuryBadge { InjuryBadge(label: badge) }
                                }
                                Text("\(result.player.position?.rawValue ?? "?") · \(result.player.team ?? "FA") · \(result.rival.manager)")
                                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            if let value = result.player.value(model.primaryBasis) {
                                Text(TradeWizardModel.oneDecimal(value))
                                    .font(.subheadline.monospacedDigit())
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Starts a deal with \(result.rival.manager) for \(result.player.name)")
                }
            }
        }
    }
}

// MARK: - Step 2

struct PartnerStep: View {
    @ObservedObject var model: TradeWizardModel
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let goal = model.goal {
                VStack(alignment: .leading, spacing: 2) {
                    Text(goal.title).font(.headline)
                    Text(goal.detail).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if model.partners.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No rival has a spare player who fits. Try another need, search for a player, or check waivers.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("Open the Waiver Board") { openScreen(.waivers) }
                        .font(.caption)
                }
                .card()
            } else {
                Text(TradeWizardModel.partnerSortRule)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(model.partners.enumerated()), id: \.element.id) { offset, fit in
                    Button { model.choose(partner: fit) } label: {
                        PartnerCard(fit: fit, selected: model.partner?.rival.rosterID == fit.rival.rosterID)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("trade-partner-\(offset)")
                    .appear(index: offset)
                }
            }
        }
    }
}

private struct PartnerCard: View {
    let fit: PartnerFit
    let selected: Bool

    private var kindLabel: (String, Color) {
        switch fit.kind {
        case .mutual: return ("Both ways", Palette.start)
        case .oneWay: return ("One way", .secondary)
        case .chosen: return ("Your pick", Color.accentColor)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(fit.rival.manager)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .layoutPriority(1)
                if let grade = fit.grade, let letter = grade.letter {
                    GradeChip(letter: letter)
                        .accessibilityLabel("Team grade \(letter)")
                }
                Spacer(minLength: 4)
                Text(kindLabel.0)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(kindLabel.1)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(kindLabel.1.opacity(0.14)))
                    .fixedSize()
            }
            HStack(spacing: -6) {
                ForEach(fit.theirOffer.prefix(3)) { player in
                    PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 30)
                        .overlay(Circle().stroke(Color(white: 0.5, opacity: 0.25), lineWidth: 1))
                }
            }
            .accessibilityHidden(true)
            Text(fit.theirOffer.prefix(3).map(\.name).joined(separator: ", ")
                 + (fit.theirOffer.count > 3 ? " +\(fit.theirOffer.count - 3) more" : ""))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            ForEach(fit.facts, id: \.self) { fact in
                Label(fact, systemImage: "checkmark")
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .labelStyle(FactLabelStyle())
            }
        }
        .card(fill: selected ? Color.accentColor.opacity(0.12) : Palette.surface)
        .contentShape(Rectangle())
    }
}

/// A league-relative letter grade, coloured by band.
struct GradeChip: View {
    let letter: String

    private var tint: Color {
        switch letter.first {
        case "A": return Palette.start
        case "B": return Color(hex: 0x818CF8)
        case "C": return Palette.caution
        default: return Palette.sit
        }
    }

    var body: some View {
        Text(letter)
            .font(.caption2.weight(.heavy))
            .foregroundStyle(tint)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Capsule().fill(tint.opacity(0.16)))
            .fixedSize()
    }
}

private struct FactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            configuration.icon
                .font(.caption2.weight(.bold))
                .foregroundStyle(Color.accentColor)
            configuration.title
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Step 3

struct DealStep: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BasisPicker(model: model)
            DealComparison(model: model)

            if let partner = model.partner {
                PlayerPicker(
                    title: "You get",
                    identifier: "trade-get",
                    subtitle: "From \(partner.rival.manager). Spare players first, IR last.",
                    players: model.theirPlayers,
                    selected: model.receiving,
                    model: model,
                    toggle: model.toggleReceiving
                )
            }
            PlayerPicker(
                title: "You send",
                identifier: "trade-send",
                subtitle: "Your spare players first, IR last.",
                players: model.yourPlayers,
                selected: model.sending,
                model: model,
                toggle: model.toggleSending
            )

            EffectsCard(model: model)

            Button {
                model.advanceToApproach()
            } label: {
                Text(model.window.isClosed ? "Trades are closed" : "Write the pitch")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canApproach)
            .accessibilityIdentifier("trade-continue")
            if !model.window.isClosed, !model.canApproach {
                Text("Pick at least one player on each side.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

private struct BasisPicker: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Compare on").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Menu {
                    Picker("Basis", selection: $model.basis) {
                        ForEach(model.availableBases) { basis in
                            Text(model.label(basis)).tag(basis)
                        }
                    }
                } label: {
                    Label(model.label(model.basis), systemImage: "arrow.up.arrow.down")
                        .font(.footnote.weight(.semibold))
                }
                .menuStyle(.button)
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityIdentifier("trade-basis")
                Spacer()
            }
            Text(model.hint(model.basis).prefix(1).uppercased() + model.hint(model.basis).dropFirst() + ".")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Both teams side by side: what each gets, what happens to each best
/// lineup, grade, roster room and playoff weeks. The lineup change is the
/// fairness signal; the raw totals are context.
private struct DealComparison: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        let effects = model.effects
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    side("You", side: effects.you, gets: model.receiving)
                    Divider()
                    side(model.partner?.rival.manager ?? "Them", side: effects.them, gets: model.sending)
                }
                VStack(alignment: .leading, spacing: 12) {
                    side("You", side: effects.you, gets: model.receiving)
                    Divider()
                    side(model.partner?.rival.manager ?? "Them", side: effects.them, gets: model.sending)
                }
            }
            BalanceBar(you: effects.you.lineupDelta, them: effects.them.lineupDelta)
            Text("Best lineup this week on \(model.label(model.basis).lowercased()), healthy players with a value only.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .card(fill: Color.accentColor.opacity(0.06))
    }

    private func side(_ title: String, side: DealSide, gets ids: Set<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(title).font(.subheadline.weight(.bold)).lineLimit(1)
                if let before = side.gradeBefore?.letter {
                    GradeChip(letter: before)
                    if let after = side.gradeAfter?.letter, after != before {
                        Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
                        GradeChip(letter: after)
                    }
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(side.lineupDelta.map { ($0 >= 0 ? "+" : "") + TradeWizardModel.oneDecimal($0) } ?? "—")
                    .font(.title3.weight(.bold).monospacedDigit())
                    .foregroundStyle(Palette.delta(side.lineupDelta))
                    .contentTransition(.numericText())
                Text("lineup").font(.caption).foregroundStyle(.secondary)
            }
            if let before = side.lineupBefore {
                Text("\(TradeWizardModel.oneDecimal(before)) → \(side.lineupAfter.map(TradeWizardModel.oneDecimal) ?? "—")")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            if let total = model.total(ids) {
                Text("Gets \(TradeWizardModel.oneDecimal(total.value)) in value\(total.counted < total.of ? " (\(total.counted) of \(total.of) valued)" : "")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Text(side.mustDrop > 0 ? "Must drop \(side.mustDrop)" : "Roster \(side.rosterAfter)/\(side.rosterLimit)")
                .font(.caption2)
                .foregroundStyle(side.mustDrop > 0 ? Palette.caution : Color.secondary)
            if side.playoffShortBefore > 0 || side.playoffShortAfter > 0 {
                Text("Playoff weeks short: \(side.playoffShortBefore) → \(side.playoffShortAfter)")
                    .font(.caption2)
                    .foregroundStyle(side.playoffShortAfter > side.playoffShortBefore ? Palette.sit
                        : side.playoffShortAfter < side.playoffShortBefore ? Palette.start : Color.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Who the deal favours this week, from the two lineup changes.
private struct BalanceBar: View {
    let you: Double?
    let them: Double?

    var body: some View {
        if let you, let them {
            let difference = you - them
            let scale = max(abs(you), abs(them), 1)
            let lean = max(-1, min(1, difference / (2 * scale)))
            VStack(alignment: .leading, spacing: 4) {
                GeometryReader { bar in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.surfaceRaised).frame(height: 6)
                        Rectangle().fill(Color.secondary.opacity(0.4)).frame(width: 2, height: 12)
                            .offset(x: bar.size.width / 2 - 1)
                        Circle()
                            .fill(abs(difference) < 1 ? Color.accentColor : difference > 0 ? Palette.start : Palette.caution)
                            .frame(width: 14, height: 14)
                            .offset(x: bar.size.width / 2 + CGFloat(lean) * bar.size.width / 2 - 7)
                    }
                    .frame(height: 14)
                }
                .frame(height: 14)
                Text(abs(difference) < 1 ? "Even this week"
                     : difference > 0 ? "Favours you by \(TradeWizardModel.oneDecimal(difference)) this week"
                     : "Favours them by \(TradeWizardModel.oneDecimal(-difference)) this week — an easier yes for them")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(abs(difference) < 1 ? Color.primary : difference > 0 ? Palette.start : Palette.caution)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(abs(difference) < 1 ? "Even this week"
                                : difference > 0 ? "Favours you by \(TradeWizardModel.oneDecimal(difference)) points this week"
                                : "Favours them by \(TradeWizardModel.oneDecimal(-difference)) points this week")
        }
    }
}

private struct PlayerPicker: View {
    let title: String
    let identifier: String
    let subtitle: String
    let players: [TradePlayer]
    let selected: Set<String>
    @ObservedObject var model: TradeWizardModel
    let toggle: (String) -> Void
    @State private var position: Position?
    @State private var showAll = false

    private var positions: [Position] {
        var seen: Set<Position> = []
        return players.compactMap(\.position).filter { seen.insert($0).inserted }
    }

    private var shown: [TradePlayer] {
        let filtered = players.filter { position == nil || $0.position == position || selected.contains($0.id) }
        return showAll || position != nil ? filtered : Array(filtered.prefix(12))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: title, subtitle: subtitle)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    chip("All", selected: position == nil) { position = nil }
                    ForEach(positions, id: \.self) { p in
                        chip(p.rawValue, selected: position == p) { position = position == p ? nil : p }
                    }
                }
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, player in
                Button { toggle(player.id) } label: {
                    PickerRow(player: player, isSelected: selected.contains(player.id),
                              value: player.value(model.basis), basis: model.basis)
                }
                .buttonStyle(.plain)
                .playerCardMenu(player.id, context: model.context)
                .accessibilityIdentifier("\(identifier)-\(index)")
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(accessibilityLabel(player))
                .accessibilityAddTraits(selected.contains(player.id) ? [.isButton, .isSelected] : .isButton)
                .sensoryFeedback(.selection, trigger: selected.contains(player.id))
            }
            if position == nil, !showAll, players.count > 12 {
                Button("Show all \(players.count)") { showAll = true }
                    .font(.caption)
            }
        }
        .card()
    }

    private func accessibilityLabel(_ player: TradePlayer) -> String {
        var parts = [player.name, player.position?.rawValue ?? ""]
        if let badge = player.injuryBadge { parts.append(badge) }
        if let value = player.value(model.basis) { parts.append("\(TradeWizardModel.oneDecimal(value)) \(model.label(model.basis))") }
        parts.append(player.isReserve ? "on IR" : player.isSurplus ? "spare" : player.isStarter ? "starter" : "bench")
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(selected ? Color.accentColor.opacity(0.2) : Palette.surface))
        }
        .buttonStyle(.plain)
    }
}

private struct PickerRow: View {
    let player: TradePlayer
    let isSelected: Bool
    let value: Double?
    let basis: TradeBasis

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                .font(.title3)
            PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(player.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .layoutPriority(1)
                    if let badge = player.injuryBadge { InjuryBadge(label: badge) }
                }
                HStack(spacing: 4) {
                    PositionChip(position: player.position)
                    if let team = player.team {
                        Text(team).font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(player.isReserve ? "IR slot" : player.isSurplus ? "spare" : player.isStarter ? "starter" : "bench")
                        .font(.caption2)
                        .foregroundStyle(player.isSurplus ? Palette.start : Color.secondary)
                }
            }
            Spacer(minLength: 4)
            if let value {
                Text(String(format: basis == .overStartLine ? "%+.1f" : "%.1f", value))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(basis == .overStartLine ? Palette.delta(value) : .primary)
                    .fixedSize()
            } else {
                Text("—")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

private struct EffectsCard: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        let effects = model.effects
        let rival = model.partner?.rival.manager ?? "Them"
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "What it does", subtitle: "Computed on both rosters as they'd be after the trade. IR slots don't count as depth.")

            if effects.yourWeeks.isEmpty && effects.theirWeeks.isEmpty {
                Text("Neither team has a short week before or after.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !effects.yourWeeks.isEmpty {
                ShortfallRows(title: "Your short weeks", changes: effects.yourWeeks)
            }
            if !effects.theirWeeks.isEmpty {
                ShortfallRows(title: "\(rival)'s short weeks", changes: effects.theirWeeks)
            }
            if !effects.yourGains.isEmpty {
                gains("For you", effects.yourGains)
            }
            if !effects.theirGains.isEmpty {
                gains("For \(rival)", effects.theirGains)
            }
            ForEach(effects.warnings, id: \.self) { warning in
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption)
                    .foregroundStyle(Palette.caution)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .card()
    }

    private func gains(_ title: String, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption.weight(.semibold))
            ForEach(items, id: \.self) { gain in
                Label(gain, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Palette.start)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct ShortfallRows: View {
    let title: String
    let changes: [ShortfallChange]

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(changes) { change in
                        VStack(spacing: 2) {
                            Text("W\(change.week)")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                            HStack(spacing: 2) {
                                Text("\(change.before)")
                                    .foregroundStyle(.secondary)
                                Image(systemName: "arrow.right").font(.system(size: 7, weight: .bold))
                                Text("\(change.after)")
                                    .foregroundStyle(change.after < change.before ? Palette.start
                                        : change.after > change.before ? Palette.sit : Color.primary)
                                    .fontWeight(.bold)
                            }
                            .font(.caption.monospacedDigit())
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Week \(change.week): \(change.before) short before, \(change.after) after")
                    }
                }
            }
        }
    }
}

// MARK: - Step 4

struct ApproachStep: View {
    @ObservedObject var model: TradeWizardModel
    @State private var copied = 0
    @State private var showOriginal = false

    private var shown: String {
        if let polished = model.polishedPitch, !showOriginal { return polished }
        return model.pitch
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(model.polishedPitch != nil && !showOriginal ? "Rewritten by your local model" : "Your pitch")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(model.polishedPitch != nil && !showOriginal ? Color.accentColor : Color.secondary)
                    Spacer()
                    if model.polishedPitch != nil {
                        Button(showOriginal ? "Show rewrite" : "Show original") { showOriginal.toggle() }
                            .font(.caption)
                    }
                }
                Text(shown)
                    .font(.body)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("trade-pitch")
                    .id(shown)
                    .transition(.opacity)
                if model.polishedPitch != nil && !showOriginal {
                    Text("Built only from the facts below. Read it before you send it.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .card(fill: Color.accentColor.opacity(0.08))
            .motion(Motion.smooth, value: shown)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { copyButton; polishButton }
                VStack(spacing: 8) { copyButton; polishButton }
            }
            if let error = model.polishError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Palette.caution)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let url = model.sleeperLink {
                Link(destination: url) {
                    Label("Open in Sleeper", systemImage: "arrow.up.forward.app")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            }
            Text("Sleeper doesn't let other apps send offers. Propose the trade there, then paste this message into the trade.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "The facts it uses", subtitle: "Only what helps them say yes — your own reasons stay with you.")
                ForEach(model.pitchFacts, id: \.self) { fact in
                    Label(fact, systemImage: "checkmark")
                        .font(.caption)
                        .labelStyle(FactLabelStyle())
                }
            }
            .card()
        }
    }

    private var copyButton: some View {
        Button {
            Clipboard.copy(shown)
            copied += 1
        } label: {
            Label(copied > 0 ? "Copied" : "Copy", systemImage: copied > 0 ? "checkmark" : "doc.on.doc")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .sensoryFeedback(.success, trigger: copied)
    }

    @ViewBuilder
    private var polishButton: some View {
        if model.hasRelay {
            Button {
                Task { await model.polishPitch() }
            } label: {
                if model.isPolishing {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Label("Polish with my AI", systemImage: "sparkles")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(model.isPolishing)
        }
    }
}
