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
    @Namespace private var basisHighlight

    public init(model: SitStartModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Loading your roster…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your roster", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    basisPicker
                    if let next = model.nextLock {
                        lockLine(next, context: context)
                    }
                    recommendation
                    if !model.disagreeingBases.isEmpty {
                        disagreement
                    }
                    lineupSection
                    unrankedSection(context: context)
                    VStack(alignment: .leading, spacing: 4) {
                        FreshnessBanner(provenance: context.provenance)
                        if let note = context.statsSeasonNote {
                            CoverageNote(text: note)
                        }
                        CoverageNote(text: SitStartModel.modelBasisNote)
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.basis)
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .sensoryFeedback(.selection, trigger: model.basis)
        .navigationTitle("Sit/Start")
    }

    // MARK: - Locks

    private func lockLine(_ next: NextLock, context: LeagueContext) -> some View {
        TimelineView(.periodic(from: .now, by: 30)) { _ in
            let remaining = next.date.timeIntervalSince(context.now())
            Label {
                Text("Next lock in **\(LockCountdown.format(remaining))** · \(next.starters) starter\(next.starters == 1 ? "" : "s") at \(LockCountdown.kickoffLabel(next.date))")
            } icon: {
                Image(systemName: "lock.open")
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }

    // MARK: - Basis

    private var basisPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("OPTIMIZE BY")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .kerning(1)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(LineupBasis.allCases) { basis in
                        let selected = model.basis == basis
                        Button {
                            model.basis = basis
                        } label: {
                            Text(basis.label)
                                .font(.footnote.weight(selected ? .semibold : .regular))
                                .foregroundStyle(selected ? Color.accentColor : Color.primary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background {
                                    if selected {
                                        Capsule()
                                            .fill(Color.accentColor.opacity(0.18))
                                            .matchedGeometryEffect(id: "basis", in: basisHighlight)
                                    } else {
                                        Capsule().fill(Palette.surface)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }
            .scrollClipDisabled()
            Text(model.basis.hint)
                .font(.caption)
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
                HStack(alignment: .firstTextBaseline) {
                    Text("By **\(model.basis.label)**")
                        .font(.subheadline)
                    Spacer()
                    if let gain = model.gain {
                        Text(String(format: "%+.1f", gain))
                            .font(.title2.weight(.bold).monospacedDigit())
                            .foregroundStyle(Palette.delta(gain))
                            .contentTransition(.numericText(value: gain))
                    }
                }

                if !model.starts.isEmpty {
                    changeList(title: "Start", systemImage: "arrow.up.circle.fill", tint: Palette.start, changes: model.starts)
                }
                if !model.sits.isEmpty {
                    changeList(title: "Sit", systemImage: "arrow.down.circle.fill", tint: Palette.sit, changes: model.sits)
                }
                if let url = model.context.flatMap({ SleeperLinks.team(leagueID: $0.league.leagueID) }) {
                    Link(destination: url) {
                        Label("Make these changes in Sleeper", systemImage: "arrow.up.forward.app")
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
        .card(padding: 12, fill: Palette.caution.opacity(0.10))
    }

    // MARK: - Lineup

    private var lineupSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(
                title: "Proposed lineup",
                subtitle: model.lockedStarters > 0
                    ? "\(model.lockedStarters) starter\(model.lockedStarters == 1 ? " has" : "s have") kicked off and can't be moved."
                    : nil
            )
            .padding(.bottom, 4)
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
                }
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(slot.changed ? Color.accentColor.opacity(0.14) : Color.clear)
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
                SectionHeader(title: "Left out", subtitle: "Players this basis can't value — never counted as zero.")
                group("On bye this week", unranked.onBye, tint: Palette.sit)
                group("No stats for DEF and IDP", unranked.noProductionData)
                group("No \(model.basis.label.lowercased()) value in \(context.statsSeason)", unranked.noSeasonLine)
                group("No recorded line for their game", unranked.noGameLine)
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
