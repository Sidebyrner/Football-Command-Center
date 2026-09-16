import SwiftUI
import FCCore
import FCData
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// A request to open the wizard, optionally already pointed at a need or rival.
public struct TradeWizardLaunch: Identifiable, Hashable {
    public let id = UUID()
    public var prefill: TradeWizardPrefill?

    public init(prefill: TradeWizardPrefill? = nil) {
        self.prefill = prefill
    }
}

/// The wizard as a sheet. Owns its model, built fresh from the league context
/// each time it opens so a deal never carries stale rosters.
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
            TradeWizardView(model: model)
                .navigationTitle("Trade wizard")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

struct TradeWizardView: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                StepProgress(step: model.step)

                if let label = model.window.label {
                    Label(label, systemImage: model.window.isClosed ? "lock.fill" : "clock")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(model.window.isClosed ? Palette.sit : Color.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Group {
                    switch model.step {
                    case .goal: GoalStep(model: model)
                    case .partner: PartnerStep(model: model)
                    case .deal: DealStep(model: model)
                    case .approach: ApproachStep(model: model)
                    }
                }
                .id(model.step)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .move(edge: .trailing)),
                    removal: .opacity
                ))
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.step)
        }
        .sensoryFeedback(.selection, trigger: model.step)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("trade-wizard")
    }
}

// MARK: - Progress

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
            HStack(alignment: .firstTextBaseline) {
                Text(step.title)
                    .font(.title2.weight(.bold))
                Spacer()
                Text("Step \(step.rawValue + 1) of \(TradeStep.allCases.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct BackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Back", systemImage: "chevron.left")
                .font(.footnote.weight(.semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.accentColor)
    }
}

// MARK: - Step 1

private struct GoalStep: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.goals.isEmpty {
                Label("No short weeks and no starter below the start line.", systemImage: "checkmark.seal.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.start)
                    .card(fill: Palette.start.opacity(0.10))
            } else {
                SectionHeader(title: "From your roster", subtitle: "Weeks you can't fill, and starters below the league's start line.")
                ForEach(Array(model.goals.enumerated()), id: \.element.id) { offset, goal in
                    Button { model.choose(goal: goal) } label: {
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
                        .card()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("trade-goal-\(offset)")
                    .appear(index: offset)
                    .scrollFade()
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
                }
            }
        }
    }
}

// MARK: - Step 2

private struct PartnerStep: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            BackButton { model.back() }
            if let goal = model.goal {
                VStack(alignment: .leading, spacing: 2) {
                    Text(goal.title).font(.headline)
                    Text(goal.detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            if model.partners.isEmpty {
                Text("No rival has a spare player who fits. Try another need, or a free agent in Planning → Waivers.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .card()
            } else {
                Text(TradeWizardModel.partnerSortRule)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(model.partners.enumerated()), id: \.element.id) { offset, fit in
                    Button { model.choose(partner: fit) } label: {
                        PartnerCard(fit: fit)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("trade-partner-\(offset)")
                    .appear(index: offset)
                    .scrollFade()
                }
            }
        }
    }
}

private struct PartnerCard: View {
    let fit: PartnerFit

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(fit.rival.manager)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Spacer()
                Text(fit.kind == .mutual ? "Both ways" : "One way")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(fit.kind == .mutual ? Palette.start : Color.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(Capsule().fill((fit.kind == .mutual ? Palette.start : Color.secondary).opacity(0.14)))
            }
            HStack(spacing: -6) {
                ForEach(fit.theirOffer.prefix(4)) { player in
                    PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 30)
                        .overlay(Circle().stroke(Color(white: 0.5, opacity: 0.25), lineWidth: 1))
                }
                Text(fit.theirOffer.prefix(2).map(\.name).joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.leading, 12)
            }
            ForEach(fit.facts, id: \.self) { fact in
                Label(fact, systemImage: "checkmark")
                    .font(.caption)
                    .foregroundStyle(.primary)
                    .labelStyle(FactLabelStyle())
            }
        }
        .card()
        .contentShape(Rectangle())
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

private struct DealStep: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BackButton { model.back() }

            VStack(alignment: .leading, spacing: 6) {
                SlidingPicker(options: TradeBasis.allCases, selection: $model.basis) { $0.label }
                Text("Compared on \(model.basis.label.lowercased()): \(model.basis.hint).")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            DealTotals(model: model)

            if let partner = model.partner {
                PlayerPicker(
                    title: "You get",
                    identifier: "trade-get",
                    subtitle: "From \(partner.rival.manager). Spare players first.",
                    players: model.theirPlayers,
                    selected: model.receiving,
                    basis: model.basis,
                    toggle: model.toggleReceiving
                )
            }
            PlayerPicker(
                title: "You send",
                identifier: "trade-send",
                subtitle: "Your spare players first.",
                players: model.yourPlayers,
                selected: model.sending,
                basis: model.basis,
                toggle: model.toggleSending
            )

            EffectsCard(effects: model.effects, rival: model.partner?.rival.manager ?? "Them")

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
        }
    }
}

private struct DealTotals: View {
    @ObservedObject var model: TradeWizardModel

    var body: some View {
        HStack(spacing: 0) {
            side("You send", model.total(model.sending), count: model.sending.count)
            Image(systemName: "arrow.left.arrow.right")
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
            side("You get", model.total(model.receiving), count: model.receiving.count)
        }
        .card(fill: Color.accentColor.opacity(0.08))
    }

    private func side(_ title: String, _ total: (value: Double, counted: Int, of: Int)?, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            if let total {
                Text(String(format: "%.1f", total.value))
                    .font(.title3.weight(.bold).monospacedDigit())
                    .contentTransition(.numericText())
                if total.counted < total.of {
                    Text("\(total.counted) of \(total.of) have stats")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text(count == 0 ? "—" : "no stats")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct PlayerPicker: View {
    let title: String
    let identifier: String
    let subtitle: String
    let players: [TradePlayer]
    let selected: Set<String>
    let basis: TradeBasis
    let toggle: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(title: title, subtitle: subtitle)
            ForEach(Array(players.enumerated()), id: \.element.id) { index, player in
                Button { toggle(player.id) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: selected.contains(player.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected.contains(player.id) ? Color.accentColor : Color.secondary)
                            .font(.title3)
                        PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(player.name)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.85)
                                if let status = player.injuryStatus {
                                    Text(status)
                                        .font(.caption2.weight(.bold))
                                        .foregroundStyle(Palette.caution)
                                }
                            }
                            HStack(spacing: 4) {
                                PositionChip(position: player.position)
                                if let team = player.team {
                                    Text(team).font(.caption2).foregroundStyle(.secondary)
                                }
                                Text(player.isSurplus ? "spare" : player.isStarter ? "starter" : "bench")
                                    .font(.caption2)
                                    .foregroundStyle(player.isSurplus ? Palette.start : Color.secondary)
                            }
                        }
                        Spacer(minLength: 0)
                        if let value = player.value(basis) {
                            Text(String(format: basis == .overStartLine ? "%+.1f" : "%.1f", value))
                                .font(.subheadline.weight(.semibold).monospacedDigit())
                                .foregroundStyle(basis == .overStartLine ? Palette.delta(value) : .primary)
                        } else {
                            Text(player.position?.hasWeeklyProductionData == false ? "no data" : "no stats")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 3)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("\(identifier)-\(index)")
                .accessibilityAddTraits(selected.contains(player.id) ? .isSelected : [])
                .sensoryFeedback(.selection, trigger: selected.contains(player.id))
            }
        }
        .card()
    }
}

private struct EffectsCard: View {
    let effects: DealEffects
    let rival: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "What it does", subtitle: "Computed on both rosters as they'd be after the trade.")

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

            if let before = effects.lineupBefore {
                HStack {
                    Text("Your best lineup this week")
                        .font(.caption)
                    Spacer()
                    Text(String(format: "%.1f", before))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                    Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
                    Text(effects.lineupAfter.map { String(format: "%.1f", $0) } ?? "—")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Palette.delta(effects.lineupAfter.map { $0 - before }))
                }
                Text("Season pts/gm, starters with stats only.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            ForEach(effects.yourGains + effects.theirGains, id: \.self) { gain in
                Label(gain, systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(Palette.start)
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
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Step 4

private struct ApproachStep: View {
    @ObservedObject var model: TradeWizardModel
    @State private var copied = 0
    @State private var showOriginal = false

    private var shown: String {
        if let polished = model.polishedPitch, !showOriginal { return polished }
        return model.pitch
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            BackButton { model.back() }

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

            HStack(spacing: 10) {
                Button {
                    copy(shown)
                    copied += 1
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .sensoryFeedback(.success, trigger: copied)

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
            if let error = model.polishError {
                Text(error).font(.caption).foregroundStyle(Palette.caution)
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
                SectionHeader(title: "The facts it uses")
                ForEach(model.pitchFacts, id: \.self) { fact in
                    Label(fact, systemImage: "checkmark")
                        .font(.caption)
                        .labelStyle(FactLabelStyle())
                }
            }
            .card()
        }
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
