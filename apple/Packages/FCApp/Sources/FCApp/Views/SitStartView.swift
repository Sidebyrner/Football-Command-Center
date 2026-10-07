import SwiftUI
import FCCore
import FCData

/// Sit/Start — "who do I actually play" (§7.3).
///
/// One basis at a time, always named. What to do comes first — who to start and
/// who to sit — then whether the other bases agree, then the full lineup, then
/// who the basis couldn't value and why.
public struct SitStartView: View {
    @ObservedObject var model: SitStartModel
    @Environment(\.appServices) private var services
    /// The slot being decided head to head.
    @State private var deciding: DecideSession?

    public init(model: SitStartModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            if let context = model.context {
                ScreenScaffold {
                    VStack(alignment: .leading, spacing: Space.m) {
                        if let error = model.errorMessage { InlineErrorBanner(message: error) }
                        hero(context: context)
                    }
                } content: {
                    ScreenSection(title: "Optimize by", systemImage: "slider.horizontal.3") { basisPicker }
                    if !(model.starts.isEmpty && model.moves.isEmpty) {
                        ScreenSection(title: "Changes", systemImage: "arrow.left.arrow.right",
                                      count: model.starts.count) {
                            recommendation
                            if !model.disagreeingBases.isEmpty { disagreement }
                        }
                    } else if !model.disagreeingBases.isEmpty {
                        disagreement
                    }
                    lineupSection
                    unrankedSection(context: context)
                } about: {
                    FreshnessBanner(provenance: context.provenance)
                    if let note = context.statsSeasonNote {
                        CoverageNote(text: note)
                    }
                    if model.basis == .projected, let label = model.projectionSourceLabel {
                        CoverageNote(text: "Projections: \(label), scored under your league's rules.")
                    } else if model.basis == .projected {
                        CoverageNote(text: "Projections are unavailable right now, so this basis values nobody.")
                    }
                    if model.basis == .commandCenter {
                        CoverageNote(text: "Command Center: this season regressed toward last season (4 games to even), times a usage trend from expected points, times the matchup from defense-vs-position. Its own number, never blended with Rotowire's.")
                    }
                    CoverageNote(text: SitStartModel.modelBasisNote)
                }
                .motion(Motion.snappy, value: model.basis)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if model.isLoading || model.errorMessage == nil {
                            LoadingPlaceholder(label: "Loading your roster…")
                        } else if let error = model.errorMessage {
                            VStack(alignment: .leading, spacing: 8) {
                                Label("Could not load your roster", systemImage: "exclamationmark.triangle")
                                    .font(.headline)
                                Text(error).font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .sensoryFeedback(.selection, trigger: model.basis)
        .navigationTitle("Sit/Start")
        .sheet(item: $deciding) { session in
            if let services { DecideSheet(services: services, session: session) }
        }
    }

    // MARK: - Hero

    /// The answer: set, or how many swaps and what they're worth.
    private func hero(context: LeagueContext) -> some View {
        let set = model.starts.isEmpty && model.moves.isEmpty
        let swaps = model.starts.count
        return ScreenHero(
            overline: "Lineup · Sit/Start",
            systemImage: "arrow.left.arrow.right",
            answer: set ? "Lineup set" : "\(swaps) swap\(swaps == 1 ? "" : "s")",
            detail: set
                ? "Already the best lineup by \(model.basis.label)."
                : "Worth \(model.gain.map { String(format: "%+.1f", $0) } ?? "–") points by \(model.basis.label).",
            tone: set ? .start : nil
        ) {
            if let next = model.nextLock {
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Label(LockCountdown.format(next.date.timeIntervalSince(context.now())), systemImage: "lock.open")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .accessibilityLabel("Next lock in \(LockCountdown.format(next.date.timeIntervalSince(context.now())))")
                }
            }
        }
    }

    // MARK: - Basis

    private var basisPicker: some View {
        VStack(alignment: .leading, spacing: Space.s) {
            ChipRow {
                ForEach(LineupBasis.allCases) { basis in
                    FilterChip(title: basis.label, isSelected: model.basis == basis) { model.basis = basis }
                }
            }
            .scrollClipDisabled()
            Text(model.basis.hint)
                .textStyle(.meta)
                .foregroundStyle(.secondary)
                .id(model.basis)
                .transition(.opacity)
        }
    }

    // MARK: - The answer

    @ViewBuilder
    private var recommendation: some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.starts.isEmpty && model.moves.isEmpty {
                Label {
                    Text("Your lineup is already the best one by **\(model.basis.label)**.")
                } icon: {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.start)
                }
                .font(.subheadline)
            } else {
                if !model.starts.isEmpty {
                    changeList(title: "Start", systemImage: "arrow.up.circle.fill", tint: Palette.start, changes: model.starts)
                }
                if !model.sits.isEmpty {
                    changeList(title: "Sit", systemImage: "arrow.down.circle.fill", tint: Palette.sit, changes: model.sits)
                }
                if let context = model.context, let url = SleeperLinks.team(for: context) {
                    Link(destination: url) {
                        Label("Make these changes in \(context.provider.label)", systemImage: "arrow.up.forward.app")
                            .font(.footnote.weight(.semibold))
                    }
                    .padding(.top, 2)
                }
                if !model.moves.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(model.moves) { move in
                            Text("\(move.name) moves \(move.from) → \(move.to)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                    }
                }
            }
        }
        .card()
    }

    private func changeList(title: String, systemImage: String, tint: Color, changes: [LineupChange]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(tint)
            ForEach(Array(changes.enumerated()), id: \.element.id) { offset, change in
                HStack(spacing: 8) {
                    Text(change.slot)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(width: 50, alignment: .leading)
                    Text(change.name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let injury = change.injury {
                        InjuryBadge(label: injury)
                    }
                    Spacer()
                    Text(change.value.map { String(format: "%.1f", $0) } ?? "—")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                }
                .transition(.move(edge: .leading).combined(with: .opacity))
                .appear(index: offset)
            }
        }
    }

    private var disagreement: some View {
        Label {
            Text("\(model.disagreeingBases.map(\.label).joined(separator: ", ")) pick\(model.disagreeingBases.count == 1 ? "s" : "") a different lineup — the measures disagree, so this is a judgement call, not a calculation.")
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "arrow.triangle.branch").foregroundStyle(Palette.caution)
        }
        .font(.caption)
        .callout(.caution, padding: Space.m)
    }

    // MARK: - Lineup

    /// Opens the slot head to head; a spacer where there's nothing to decide,
    /// so the values stay in a column.
    @ViewBuilder
    private func decideButton(_ slot: DecideSlot?) -> some View {
        if let slot {
            Button { open(slot) } label: {
                Image(systemName: "scalemass")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(slot.isCloseCall ? Palette.caution : slot.hasBenchOption ? Color.accentColor : Color.secondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Decide \(slot.token)")
            .accessibilityIdentifier("sitstart.decide.\(slot.index)")
        } else {
            Color.clear.frame(width: 28, height: 28)
        }
    }

    private func open(_ slot: DecideSlot) {
        guard let services else { return }
        deciding = services.decide.session(for: slot)
    }

    private var lineupSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(
                title: "Proposed lineup",
                subtitle: model.lockedStarters > 0
                    ? "\(model.lockedStarters) starter\(model.lockedStarters == 1 ? " has" : "s have") kicked off and can't be moved."
                    : nil,
                systemImage: "list.bullet.rectangle"
            )
            .padding(.bottom, 4)
            let decidable = Dictionary(uniqueKeysWithValues: (services?.decide.slots() ?? [])
                .filter(\.canDecide).map { ($0.index, $0) })
            ForEach(model.lineup) { slot in
                HStack(spacing: 8) {
                    Text(slot.slot)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .frame(width: 50, alignment: .leading)
                    PositionChip(position: slot.playerID.flatMap { model.context?.position($0) })
                    Text(slot.name ?? "Empty")
                        .font(.subheadline)
                        .fontWeight(slot.changed ? .semibold : .regular)
                        .foregroundStyle(slot.playerID == nil ? Palette.caution : Color.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let badge = slot.availability.badge {
                        InjuryBadge(label: badge)
                    }
                    Spacer(minLength: 4)
                    if slot.isLocked {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("Locked — game started")
                    } else if slot.keptBecauseUnvalued {
                        Text("kept")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Text(slot.value.map { String(format: "%.1f", $0) } ?? "—")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 40, alignment: .trailing)
                        .contentTransition(.numericText())
                    decideButton(decidable[slot.index])
                }
                .contextMenu {
                    if let decide = decidable[slot.index] {
                        Button { open(decide) } label: { Label("Decide \(slot.slot)", systemImage: "scalemass") }
                    }
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(slot.changed ? Palette.start.opacity(0.12) : Color.clear)
                )
                .motion(Motion.smooth, value: slot.changed)
            }
            if !model.lockedBench.isEmpty {
                Text("Already played from your bench, so they can't start: \(model.lockedBench.joined(separator: ", "))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            if !model.injuredWithoutCover.isEmpty {
                Label {
                    Text("Nobody on your bench can replace \(model.injuredWithoutCover.joined(separator: ", ")). Check the waiver wire before kickoff.")
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "cross.case.fill").foregroundStyle(Palette.sit)
                }
                .font(.caption)
                .padding(.top, 6)
            }
            if model.lineup.contains(where: { $0.availability == .questionable }) {
                Text("Q players are started on their full value. Most Questionable players play — check inactives about 90 minutes before kickoff.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
            if model.lineup.contains(where: \.keptBecauseUnvalued) {
                Text("\"Kept\" slots have no value on this basis, so your current starter stays.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 4)
            }
        }
        .card(padding: 10)
    }

    // MARK: - Unranked

    @ViewBuilder
    private func unrankedSection(context: LeagueContext) -> some View {
        let unranked = model.unranked
        if unranked.total > 0 {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Left out", subtitle: "Players this basis can't value — never counted as zero.",
                              systemImage: "questionmark.circle", count: unranked.total)
                group("Injured — never recommended to start", unranked.injured, tint: Palette.sit)
                group("On bye this week", unranked.onBye, tint: Palette.sit)
                group("No stats for DEF and IDP", unranked.noProductionData)
                group("No \(model.basis.label.lowercased()) value in \(context.statsSeason)", unranked.noSeasonLine)
                group("No recorded line for their game", unranked.noGameLine)
                group("No projection this week", unranked.noProjection)
                group("No Sleeper stat line this season, and nothing to project from", unranked.noSleeperLine)
            }
            .card()
        }
    }

    @ViewBuilder
    private func group(_ title: String, _ names: [String], tint: Color = .secondary) -> some View {
        if !names.isEmpty {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(tint)
                Text(names.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// "Q", "Out", "Doubtful", "IR" beside a player's name — caution for
/// Questionable, the sit colour for everything that should not start.
struct InjuryBadge: View {
    let label: String

    private var tint: Color { label == "Q" ? Palette.caution : Palette.sit }

    var body: some View {
        Text(label)
            .font(.caption2.weight(.bold))
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(Capsule().fill(tint.opacity(0.15)))
            .lineLimit(1)
            .fixedSize()
            .accessibilityLabel(label == "Q" ? "Questionable" : label)
    }
}
