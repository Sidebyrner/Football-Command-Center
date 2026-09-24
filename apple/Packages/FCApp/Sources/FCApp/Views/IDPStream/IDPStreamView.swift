import SwiftUI
import FCCore
import FCData

/// IDP Stream — free-agent defenders ranked by this week's projected points in
/// your scoring, each compared with the IDP starter a stream would replace.
public struct IDPStreamView: View {
    @ObservedObject var model: IDPStreamScreenModel
    @State private var expanded: String?
    @State private var editingContext = false
    @State private var showingSnapshots = false
    @State private var editingPlayer: IDPProjection?
    @State private var pickingIncumbent = false
    @State private var comparing = false

    public init(model: IDPStreamScreenModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Projecting defenders…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    if !model.leagueHasIDP {
                        ContentUnavailableView(
                            "No IDP slots",
                            systemImage: "shield.slash",
                            description: Text("Your league doesn't start individual defensive players, so there is nothing to stream.")
                        )
                    } else {
                        header(context: context)
                        incumbentCard
                        controls
                        list
                        VStack(alignment: .leading, spacing: 4) {
                            FreshnessBanner(provenance: context.provenance)
                            ForEach(model.sourceNotes, id: \.self) { CoverageNote(text: $0) }
                        }
                    }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.positionFilter)
            .motion(Motion.snappy, value: model.risk)
        }
        .safeAreaInset(edge: .bottom) {
            if !model.compareIDs.isEmpty { compareTray }
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("IDP Stream")
        .searchable(text: $model.query, prompt: "Player or team")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    editingContext = true
                } label: {
                    Label("Game context", systemImage: "slider.horizontal.3")
                }
                .disabled(model.context == nil)
                Button {
                    comparing = true
                } label: {
                    Label("Compare", systemImage: "person.2.crop.square.stack")
                }
                .disabled(model.context == nil)
                Menu {
                    Button {
                        Task { await model.freezeSnapshot() }
                    } label: {
                        Label("Freeze snapshot now", systemImage: "snowflake")
                    }
                    Button {
                        showingSnapshots = true
                    } label: {
                        Label("Saved snapshots", systemImage: "clock.arrow.circlepath")
                    }
                } label: {
                    Label("Snapshots", systemImage: "camera.metering.center.weighted")
                }
                .disabled(model.report == nil)
            }
        }
        .sheet(isPresented: $editingContext) {
            NavigationStack { IDPContextEditorView(model: model) }
                #if os(macOS)
                .frame(minWidth: 560, minHeight: 560)
                #endif
        }
        .sheet(isPresented: $showingSnapshots) {
            NavigationStack { IDPSnapshotsView(model: model) }
                #if os(macOS)
                .frame(minWidth: 560, minHeight: 520)
                #endif
        }
        .sheet(isPresented: $pickingIncumbent) {
            NavigationStack { IDPPlayerPickerView(model: model, mode: .incumbent) }
                #if os(macOS)
                .frame(minWidth: 460, minHeight: 520)
                #endif
        }
        .sheet(isPresented: $comparing) {
            NavigationStack { IDPCompareView(model: model) }
                #if os(macOS)
                .frame(minWidth: 780, minHeight: 600)
                #endif
        }
        .sheet(item: $editingPlayer) { row in
            NavigationStack { IDPPlayerOverrideView(model: model, row: row) }
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 420)
                #endif
        }
    }

    // MARK: - Header

    private func header(context: LeagueContext) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(
                title: "Week \(context.currentWeek) streamers",
                subtitle: "Projected in your scoring: \(scoringSummary). Ranked by utility, which tilts expected points toward floor or ceiling.",
                systemImage: "shield.lefthalf.filled"
            )
            HStack(spacing: 12) {
                Label(context.leagueFacts.waivers.label, systemImage: "dollarsign.circle")
                if let remaining = context.leagueFacts.faabRemaining {
                    Text("$\(remaining) left")
                }
                if let at = model.lastSnapshotAt {
                    Label("Snapshot \(at.formatted(date: .omitted, time: .shortened))", systemImage: "snowflake")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var scoringSummary: String {
        let s = model.scoring
        let parts: [(String, Double)] = [
            ("solo", s.solo), ("ast", s.ast), ("sack", s.sack), ("TFL", s.tfl), ("PD", s.pd),
            ("INT", s.int), ("FF", s.ff), ("QB hit", s.qbHit),
        ]
        let paid = parts.filter { $0.1 != 0 }.map { "\($0.0) \($0.1.formatted(.number.precision(.fractionLength(0...1))))" }
        return paid.isEmpty ? "no IDP scoring set" : paid.joined(separator: " · ")
    }

    // MARK: - Starter

    @ViewBuilder
    private var incumbentCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Starter to beat").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if let inc = model.report?.incumbent, let id = inc.playerID {
                    Button {
                        if !model.isComparing(id) { model.toggleCompare(id) }
                        comparing = true
                    } label: {
                        Label("Compare with…", systemImage: "person.2")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                Menu {
                    Button("Weakest IDP starter (default)") { Task { await model.setIncumbent(nil) } }
                    Section("Your defenders") {
                        ForEach(model.myDefenders) { player in
                            Button(myDefenderLabel(player)) {
                                Task { await model.setIncumbent(player.id) }
                            }
                        }
                    }
                    Section {
                        Button {
                            pickingIncumbent = true
                        } label: {
                            Label("Choose any player…", systemImage: "magnifyingglass")
                        }
                    }
                } label: {
                    Label("Change", systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption)
                }
                .menuStyle(.button)
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            if let inc = model.report?.incumbent {
                HStack(spacing: 10) {
                    PlayerAvatar(sleeperID: inc.playerID, name: inc.name, position: inc.platform, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(inc.name).font(.headline)
                            PositionChip(position: inc.platform, label: inc.position.label)
                            if model.incumbentIsDefault {
                                Text("weakest starter").font(.caption2).foregroundStyle(.secondary)
                            } else if let owner = model.incumbentOwnerLabel {
                                Text(owner).font(.caption2).foregroundStyle(Palette.caution)
                            }
                        }
                        Text("\(inc.team) \(inc.opponent) · \(inc.practice.label)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    StatPill(label: "E[pts]", value: f1(inc.expPts))
                }
                HStack(spacing: 16) {
                    StatPill(label: "floor", value: f1(inc.floorP25))
                    StatPill(label: "ceiling", value: f1(inc.ceilingP75))
                    StatPill(label: "snaps", value: "\(Int(inc.expSnaps.rounded()))")
                    StatPill(label: "P(plays)", value: pct(inc.pPlay))
                }
            } else {
                Text("No starter chosen — rankings show projected points only. Pick anyone with Change.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .card()
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            SlidingPicker(options: IDPRiskMode.allCases, selection: $model.risk) { $0.label }
            HStack {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        chip("All", selected: model.positionFilter == nil) { model.positionFilter = nil }
                        ForEach([Position.lb, .dl, .db], id: \.self) { position in
                            chip(position.rawValue, selected: model.positionFilter == position) {
                                model.positionFilter = model.positionFilter == position ? nil : position
                            }
                        }
                    }
                }
                Toggle(isOn: $model.onlyAvailable) {
                    Text("Free agents only").font(.caption)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .fixedSize()
            }
        }
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

    // MARK: - List

    @ViewBuilder
    private var list: some View {
        if model.rows.isEmpty {
            Text(verbatim: "Nobody matches. Loosen the filters, or there are no \(model.context?.scheduleSeason ?? 0) Sleeper stat lines yet — see the notes below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .card()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(model.rows.prefix(50).enumerated()), id: \.element.id) { offset, row in
                    IDPStreamRowView(
                        row: row,
                        rank: offset + 1,
                        bid: model.bidLabel(row),
                        availability: row.playerID.flatMap { model.context?.availability(ofSleeperID: $0) },
                        isExpanded: expanded == row.id,
                        onToggle: { withAnimation(Motion.snappy) { expanded = expanded == row.id ? nil : row.id } },
                        onAdjust: { editingPlayer = row },
                        isComparing: row.playerID.map(model.isComparing) ?? false,
                        canCompare: model.canAddToCompare,
                        onCompare: { if let id = row.playerID { model.toggleCompare(id) } }
                    )
                    .playerCardMenu(row.playerID, context: model.context)
                    .contextMenu {
                        if let id = row.playerID {
                            Button(model.isComparing(id) ? "Remove from compare" : "Add to compare") { model.toggleCompare(id) }
                                .disabled(!model.isComparing(id) && !model.canAddToCompare)
                            Button("Set as starter to beat") { Task { await model.setIncumbent(id) } }
                        }
                    }
                    .appear(index: min(offset, 12))
                }
                if model.rows.count > 50 {
                    Text("Showing 50 of \(model.rows.count). Filter by position or search to narrow it.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func myDefenderLabel(_ player: IDPCandidate) -> String {
        let points = model.projection(for: player.id).map { " · " + f1($0.expPts) } ?? ""
        return "\(player.name) · \(player.position.label)\(points)"
    }

    // MARK: - Compare tray

    private var compareTray: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.2.crop.square.stack")
            Text("Comparing \(model.compareIDs.count)")
                .font(.subheadline.weight(.semibold))
            Text(model.compareIDs.compactMap { model.projection(for: $0)?.name.split(separator: " ").last.map(String.init) }.joined(separator: ", "))
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Spacer()
            Button("Clear") { model.clearCompare() }
                .buttonStyle(.borderless)
                .font(.caption)
            Button("Compare") { comparing = true }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal)
        .padding(.bottom, 8)
    }

    private func f1(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(1))) }
    private func pct(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }
}

// MARK: - Row

struct IDPStreamRowView: View {
    let row: IDPProjection
    let rank: Int
    let bid: String?
    let availability: Availability?
    let isExpanded: Bool
    let onToggle: () -> Void
    let onAdjust: () -> Void
    var isComparing = false
    var canCompare = true
    var onCompare: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: onToggle) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 10) {
                        Text("\(rank)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 20, alignment: .trailing)
                        PlayerAvatar(sleeperID: row.playerID, name: row.name, position: row.platform, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text(row.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                PositionChip(position: row.platform, label: row.position.label)
                            }
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(availability == .freeAgent ? Color.secondary : Palette.caution)
                                .lineLimit(1)
                        }
                        Spacer()
                        Button(action: onCompare) {
                            Image(systemName: isComparing ? "checkmark.circle.fill" : "plus.circle")
                                .foregroundStyle(isComparing ? Color.accentColor : Color.secondary)
                        }
                        .buttonStyle(.plain)
                        .disabled(!isComparing && !canCompare)
                        .help(isComparing ? "Remove from compare" : "Add to compare")
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(f1(row.expPts))
                                .font(.headline.monospacedDigit())
                                .contentTransition(.numericText())
                            if let gain = row.expGain {
                                Text((gain >= 0 ? "+" : "") + f1(gain))
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(gain >= 0 ? Palette.start : Palette.sit)
                            }
                        }
                    }
                    HStack(spacing: 14) {
                        StatPill(label: "floor", value: f1(row.floorP25))
                        StatPill(label: "ceil", value: f1(row.ceilingP75))
                        StatPill(label: "snaps", value: "\(Int(row.expSnaps.rounded()))")
                        StatPill(label: "tkl", value: f1(row.expTackles))
                        StatPill(label: "sk", value: row.eSack.formatted(.number.precision(.fractionLength(2))))
                        if let p = row.pBeatIncumbent {
                            StatPill(label: "P(>starter)", value: "\(Int((p * 100).rounded()))%",
                                     tint: p >= 0.6 ? Palette.start : .primary)
                        }
                        if let bid {
                            StatPill(label: "bid", value: bid)
                        }
                    }
                    .padding(.leading, 30)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(alignment: .leading, spacing: 4) {
                    if !row.notes.isEmpty {
                        Text(row.notes).font(.footnote)
                    }
                    ForEach(row.explain, id: \.self) { line in
                        Text("• \(line)").font(.caption).foregroundStyle(.secondary)
                    }
                    if !row.flags.isEmpty {
                        Label(row.flags.joined(separator: " · "), systemImage: "flag")
                            .font(.caption)
                            .foregroundStyle(Palette.caution)
                    }
                    HStack {
                        Text(row.sources.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.tertiary)
                        Spacer()
                        Button("Adjust inputs…", action: onAdjust)
                            .font(.caption)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
                .padding(.leading, 30)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .card(padding: 12)
    }

    private var subtitle: String {
        var parts = ["\(row.team) \(row.opponent)", "\(Int((row.snapShare * 100).rounded()))% snaps"]
        if row.practice != .none { parts.append(row.practice.label) }
        if let availability, availability != .freeAgent { parts.append(availability.label) }
        return parts.joined(separator: " · ")
    }

    private func f1(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(1))) }
}
