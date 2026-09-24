import SwiftUI
import FCCore
import FCData

/// Waiver Board — every free agent with what he has been doing and what he is
/// projected to do, ranked on one named column at a time. The league's own
/// waiver rules sit at the top because they price every move on the list.
public struct WaiverBoardView: View {
    @ObservedObject var model: WaiverBoardModel
    @State private var adding: WaiverRow?

    public init(model: WaiverBoardModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Ranking the waiver wire…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    if let facts = model.facts { WaiverFactsStrip(facts: facts) }
                    controls
                    boardList(context: context)
                    dropSection
                    VStack(alignment: .leading, spacing: 4) {
                        FreshnessBanner(provenance: context.provenance)
                        ForEach(model.sourceNotes, id: \.self) { CoverageNote(text: $0) }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.sort)
            .motion(Motion.snappy, value: model.positionFilter)
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("Waivers")
        .searchable(text: $model.query, prompt: "Player or team")
        .sheet(item: $adding) { row in
            AddDropSheet(model: model, add: row)
        }
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Menu {
                    Picker("Rank by", selection: $model.sort) {
                        ForEach(WaiverSort.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Label(model.sort.label, systemImage: "arrow.up.arrow.down")
                        .font(.footnote.weight(.semibold))
                }
                .menuStyle(.button)
                .buttonStyle(.bordered)
                .controlSize(.small)
                Spacer()
                Toggle(isOn: $model.includeRivalBenches) {
                    Text("Rival benches").font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .fixedSize()
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    filterChip(label: "All", selected: model.positionFilter == nil) { model.positionFilter = nil }
                    ForEach(model.filterablePositions, id: \.self) { position in
                        filterChip(label: position.rawValue, selected: model.positionFilter == position) {
                            model.positionFilter = model.positionFilter == position ? nil : position
                        }
                    }
                    filterChip(label: "Plays this week", selected: model.playingThisWeekOnly) {
                        model.playingThisWeekOnly.toggle()
                    }
                }
            }
            Text(model.sort.source)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func filterChip(label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(selected ? .semibold : .regular))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Capsule().fill(selected ? Color.accentColor.opacity(0.2) : Palette.surface))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Board

    @ViewBuilder
    private func boardList(context: LeagueContext) -> some View {
        if model.rows.isEmpty {
            Text("Nobody matches. Loosen the filters, or the sources this board reads are unavailable — see the notes below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .card()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(model.rows.prefix(60).enumerated()), id: \.element.id) { offset, row in
                    Button {
                        adding = row
                    } label: {
                        WaiverRowView(row: row, sort: model.sort)
                    }
                    .buttonStyle(.plain)
                    .playerCardMenu(row.id, context: model.context)
                    .appear(index: min(offset, 12))
                }
                if model.rows.count > 60 {
                    Text("Showing 60 of \(model.rows.count). Filter by position or search to narrow it.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if model.unvaluedCount > 0 {
                    Text("\(model.unvaluedCount) listed without this measure, at the bottom — absent, not zero.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Drops

    @ViewBuilder
    private var dropSection: some View {
        if !model.dropCandidates.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    title: "Your bench, weakest first",
                    subtitle: "Ranked on this week's projection. IR-eligible players free a bench spot without a drop.",
                    systemImage: "tray.and.arrow.up"
                )
                ForEach(model.dropCandidates) { candidate in
                    HStack(spacing: 8) {
                        PositionChip(position: candidate.row.position)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(candidate.row.name).font(.subheadline.weight(.medium))
                            Text([candidate.row.team, candidate.row.injuryTag,
                                  candidate.irEligible ? "IR-eligible" : nil,
                                  candidate.maybeIRWithLeagueSetting ? "IR-eligible if your league allows Out" : nil,
                                  candidate.row.isLocked ? "locked" : nil]
                                    .compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2)
                                .foregroundStyle(candidate.irEligible ? Palette.start : Color.secondary)
                        }
                        Spacer()
                        if let projected = candidate.row.projected {
                            StatPill(label: "proj", value: projected.formatted(.number.precision(.fractionLength(1))))
                        } else {
                            Text("no proj").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .card()
        }
    }
}

// MARK: - Rows

struct WaiverRowView: View {
    let row: WaiverRow
    let sort: WaiverSort

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            PlayerAvatar(sleeperID: row.id, name: row.name, position: row.position, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    PositionChip(position: row.position)
                }
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(row.availability == .freeAgent ? Color.secondary : Palette.caution)
                    .lineLimit(1)
                if !row.coversWeeks.isEmpty {
                    WeekChips(weeks: row.coversWeeks, prefix: "covers")
                }
            }
            Spacer(minLength: 4)
            secondary
            VStack(alignment: .trailing, spacing: 1) {
                if let value = row.value(sort) {
                    Text(format(value, sort))
                        .font(.subheadline.weight(.semibold).monospacedDigit())
                        .contentTransition(.numericText())
                } else {
                    Text("—").font(.subheadline).foregroundStyle(.tertiary)
                }
                Text(sort.unit).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(minWidth: 52, alignment: .trailing)
        }
        .card(padding: 10)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        [row.team, row.opponent.map { "vs \($0)" }, row.playsThisWeek ? nil : "bye", row.injuryTag,
         row.availability == .freeAgent ? nil : row.availability.label,
         row.isLocked ? "locked" : nil]
            .compactMap { $0 }.joined(separator: " · ")
    }

    /// Two supporting numbers the current sort is not already showing.
    @ViewBuilder
    private var secondary: some View {
        let others: [WaiverSort] = [.projected, .snapShare, .expectedPoints].filter { $0 != sort }
        HStack(spacing: 8) {
            ForEach(others.prefix(2)) { other in
                if let value = row.value(other) {
                    StatPill(label: other.unit, value: format(value, other), tint: .secondary)
                }
            }
        }
    }

    private func format(_ value: Double, _ sort: WaiverSort) -> String {
        if sort.isPercent { return value.formatted(.percent.precision(.fractionLength(0))) }
        if sort == .trending { return value.formatted(.number.notation(.compactName)) }
        if sort == .projectedOverLine { return (value >= 0 ? "+" : "") + value.formatted(.number.precision(.fractionLength(1))) }
        return value.formatted(.number.precision(.fractionLength(1)))
    }
}

struct WaiverFactsStrip: View {
    let facts: WaiverFacts

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                StatPill(label: "system", value: systemShort)
                if let position = facts.waiverPosition {
                    StatPill(label: "your priority", value: "#\(position)")
                }
                if let faab = facts.faabRemaining {
                    StatPill(label: "FAAB left", value: "$\(faab)")
                }
                StatPill(label: "IR free", value: "\(facts.irFree) of \(facts.irSlots)")
                Spacer()
            }
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .card(fill: Color.accentColor.opacity(0.08))
    }

    private var systemShort: String {
        switch facts.system {
        case .rolling: return "Rolling"
        case .reverseStandings: return "Rev. standings"
        case .faab: return "FAAB"
        case .unknown: return "Unknown"
        }
    }

    private var detail: String {
        var parts = [facts.system.label]
        if let day = facts.processingDay { parts.append("claims process \(day)") }
        parts.append("read live from your league settings")
        return parts.joined(separator: " · ")
    }
}

// MARK: - Add / drop

struct AddDropSheet: View {
    @ObservedObject var model: WaiverBoardModel
    let add: WaiverRow
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Claim \(add.name)").font(.title3.weight(.bold))
                        Text("What each drop does to your best lineup this week, on the projection.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    WaiverRowView(row: add, sort: .projected)
                    if model.dropCandidates.isEmpty {
                        Text("No bench player to drop — you would need to move someone to IR first.")
                            .font(.footnote).foregroundStyle(.secondary).card()
                    }
                    ForEach(model.dropCandidates) { drop in
                        let effect = model.pairEffect(add: add, drop: drop)
                        HStack(spacing: 8) {
                            PositionChip(position: drop.row.position)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Drop \(drop.row.name)").font(.subheadline.weight(.medium))
                                if let note = effect.note {
                                    Text(note).font(.caption2).foregroundStyle(.secondary)
                                } else if let before = effect.before, let after = effect.after {
                                    Text("lineup \(before.formatted(.number.precision(.fractionLength(1)))) → \(after.formatted(.number.precision(.fractionLength(1))))")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                if drop.irEligible {
                                    Text("IR-eligible — park him instead of dropping").font(.caption2).foregroundStyle(Palette.start)
                                }
                            }
                            Spacer()
                            if let delta = effect.delta {
                                StatPill(
                                    label: "this week",
                                    value: (delta >= 0 ? "+" : "") + delta.formatted(.number.precision(.fractionLength(1))),
                                    tint: delta > 0 ? Palette.start : (delta < 0 ? Palette.sit : .secondary)
                                )
                            }
                        }
                        .card()
                    }
                    if let context = model.context, let url = SleeperLinks.team(leagueID: context.league.leagueID) {
                        Link(destination: url) {
                            Label("Make the claim in Sleeper", systemImage: "arrow.up.forward.app")
                                .font(.caption.weight(.semibold))
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle("Add / drop")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(iOS)
        .presentationDetents([.large])
        #else
        .frame(minWidth: 520, minHeight: 520)
        #endif
    }
}
