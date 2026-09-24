import SwiftUI
import FCCore
import FCData

/// Injury Center — "who is hurt, who steps in, and who fills my hole".
///
/// Three sections, each a different source and each saying so: your roster's
/// injury signals (Sleeper tags plus the official practice report), the
/// depth-chart names behind every injured player in the league, and rivals'
/// tagged starters as trade leverage. Tapping one of your players opens the
/// Replacement Finder, ranked on one named basis at a time.
public struct InjuryCenterView: View {
    @ObservedObject var model: InjuryCenterModel
    @State private var finding: InjuredPlayer?

    public init(model: InjuryCenterModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Reading the injury report…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    rosterSection(context: context)
                    openingsSection
                    rivalsSection
                    VStack(alignment: .leading, spacing: 4) {
                        FreshnessBanner(provenance: context.provenance)
                        ForEach(model.sourceNotes, id: \.self) { CoverageNote(text: $0) }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("Injuries")
        .sheet(item: $finding) { injured in
            ReplacementFinderSheet(model: model, injured: injured)
        }
    }

    // MARK: - Your roster

    @ViewBuilder
    private func rosterSection(context: LeagueContext) -> some View {
        if model.roster.isEmpty {
            Label("No injury signals on your roster this week.", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.start)
                .card(fill: Palette.start.opacity(0.10))
                .appear()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(
                    title: "Your roster",
                    subtitle: "Sleeper's tag and the official practice report, worst first. Tap a player to find a fill.",
                    systemImage: "cross.case.fill"
                )
                ForEach(Array(model.roster.enumerated()), id: \.element.id) { offset, player in
                    Button {
                        finding = player
                    } label: {
                        InjuredPlayerRow(player: player, news: model.news[player.id]?.first, now: context.now())
                    }
                    .buttonStyle(.plain)
                    .playerCardMenu(player.id, context: context)
                    .appear(index: offset)
                    .scrollFade()
                }
            }
        }
    }

    // MARK: - Who benefits

    @ViewBuilder
    private var openingsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(
                title: "Who benefits",
                subtitle: "The next names on the official depth chart behind every injured player in the league, with last game's snap share and expected points.",
                systemImage: "arrow.up.right.circle"
            )
            if model.openings.isEmpty {
                Text(model.context?.inSeason.depthCharts == nil
                     ? "Depth charts are not available, so successors cannot be named."
                     : "No rostered player in the league carries a game designation.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .card()
            } else {
                ForEach(Array(model.openings.enumerated()), id: \.element.id) { offset, opening in
                    OpeningCard(opening: opening)
                        .appear(index: offset)
                        .scrollFade()
                }
            }
        }
    }

    // MARK: - Rivals

    @ViewBuilder
    private var rivalsSection: some View {
        if !model.rivalInjuries.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(
                    title: "Rivals' injured starters",
                    subtitle: "A rival with a hole is a rival who will talk. Marked when you hold a spare at that position.",
                    systemImage: "person.2.badge.gearshape"
                )
                ForEach(model.rivalInjuries) { rival in
                    HStack(alignment: .top, spacing: 10) {
                        PositionChip(position: rival.position)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(rival.playerName).font(.subheadline.weight(.semibold))
                            Text("\(rival.manager) · \(rival.headline)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer()
                        if rival.youHaveSurplus {
                            Label("You have a spare", systemImage: "arrow.left.arrow.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(Palette.start)
                                .labelStyle(.titleAndIcon)
                        }
                    }
                    .card()
                }
            }
        }
    }
}

// MARK: - Rows

struct InjuredPlayerRow: View {
    let player: InjuredPlayer
    let news: SleeperPlayerNews?
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(player.name).font(.subheadline.weight(.semibold))
                        PositionChip(position: player.position)
                        if let slot = player.slotToken {
                            Text(slot).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                        } else {
                            Text("Bench").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Text(player.headline)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(tint)
                        .fixedSize(horizontal: false, vertical: true)
                    if let kickoff = player.kickoff {
                        if player.isLocked {
                            Label("Locked — kicked off \(LockCountdown.kickoffLabel(kickoff))", systemImage: "lock.fill")
                                .font(.caption2).foregroundStyle(.secondary)
                        } else {
                            Label("Locks in \(LockCountdown.format(kickoff.timeIntervalSince(now))) (\(LockCountdown.kickoffLabel(kickoff)))", systemImage: "lock.open")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
                Spacer(minLength: 0)
                if let points = player.projectedPoints {
                    StatPill(label: "proj", value: points.formatted(.number.precision(.fractionLength(1))))
                }
            }
            if let news, let title = news.title {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                    Text([news.sourceLabel, news.publishedAt.map { $0.formatted(.relative(presentation: .named)) }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            HStack {
                Text("Tag as of \(player.tagAsOf.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
                    .font(.caption2).foregroundStyle(.tertiary)
                Spacer()
                if !player.isLocked {
                    Label("Find a fill", systemImage: "arrow.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                }
            }
        }
        .card(fill: tint.opacity(0.08))
        .contentShape(Rectangle())
    }

    private var tint: Color {
        switch player.severity {
        case .out, .doubtful, .reserve: return Palette.sit
        case .questionableNoPractice, .questionable: return Palette.caution
        case .other: return .secondary
        }
    }
}

struct OpeningCard: View {
    let opening: InjuryOpening

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                PositionChip(position: opening.position)
                Text(opening.injuredName).font(.subheadline.weight(.semibold))
                Text(opening.team ?? "").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(opening.availability.label).font(.caption2).foregroundStyle(.secondary)
            }
            Text(opening.headline)
                .font(.caption)
                .foregroundStyle(opening.severity <= .doubtful ? Palette.sit : Palette.caution)
            ForEach(opening.beneficiaries) { player in
                HStack(spacing: 8) {
                    Text("\(player.depthBehind)")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 14)
                    PlayerAvatar(sleeperID: player.sleeperID, name: player.name, position: player.position, size: 24)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(player.name).font(.caption.weight(.semibold))
                        Text(player.availability.label).font(.caption2).foregroundStyle(
                            player.availability == .freeAgent ? Palette.start : Color.secondary
                        )
                    }
                    Spacer()
                    if let share = player.lastSnapShare {
                        StatPill(label: "snaps", value: share.formatted(.percent.precision(.fractionLength(0))))
                    }
                    if let xfp = player.lastExpectedPoints {
                        StatPill(label: "xFP", value: xfp.formatted(.number.precision(.fractionLength(1))))
                    }
                    if let proj = player.projectedPoints {
                        StatPill(label: "proj", value: proj.formatted(.number.precision(.fractionLength(1))))
                    }
                }
            }
        }
        .card()
    }
}

// MARK: - Replacement Finder

struct ReplacementFinderSheet: View {
    @ObservedObject var model: InjuryCenterModel
    let injured: InjuredPlayer
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Fill for \(injured.name)")
                            .font(.title3.weight(.bold))
                        Text(injured.slotToken.map { "His \($0) slot this week." } ?? "His position this week.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        SlidingPicker(options: ReplacementBasis.allCases, selection: $model.basis) { $0.label }
                        Text(model.basis.hint)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    let candidates = model.candidates(for: injured)
                    if candidates.isEmpty {
                        Text("Nobody this basis can value is available for that slot — try another basis.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .card()
                    } else {
                        ForEach(Array(candidates.enumerated()), id: \.element.id) { offset, candidate in
                            CandidateRow(candidate: candidate)
                                .appear(index: offset)
                                .playerCardMenu(candidate.id, context: model.context)
                        }
                    }
                    if let context = model.context, let url = SleeperLinks.team(leagueID: context.league.leagueID) {
                        Link(destination: url) {
                            Label("Make the move in Sleeper", systemImage: "arrow.up.forward.app")
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .motion(Motion.snappy, value: model.basis)
            }
            .navigationTitle("Replacement Finder")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(iOS)
        .presentationDetents([.large])
        #else
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }
}

struct CandidateRow: View {
    let candidate: ReplacementCandidate

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            PlayerAvatar(sleeperID: candidate.id, name: candidate.name, position: candidate.position, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(candidate.name).font(.subheadline.weight(.semibold))
                    PositionChip(position: candidate.position)
                }
                Text([candidate.team, candidate.opponent.map { "vs \($0)" }, candidate.availability.label, candidate.injuryTag]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(candidate.availability == .freeAgent ? Palette.start : Color.secondary)
            }
            Spacer()
            if let value = candidate.value {
                StatPill(label: "value", value: value.formatted(.number.precision(.fractionLength(1))))
            }
            if let gain = candidate.lineupGain {
                StatPill(
                    label: "lineup",
                    value: gain > 0 ? "+" + gain.formatted(.number.precision(.fractionLength(1))) : "—",
                    tint: gain > 0 ? Palette.start : .secondary
                )
            }
        }
        .card()
    }
}
