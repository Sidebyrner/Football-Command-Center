import SwiftUI
import FCCore
import FCData

/// A labelled number for a stream row, card or compare cell.
struct StreamPill: Hashable {
    let label: String
    let value: String
    var tint: Color = .primary
}

/// Stat pills that wrap as whole pills onto further rows instead of squeezing
/// into one: on a phone a row of seven would otherwise break every number and
/// label a letter at a time.
struct StreamPillGrid: View {
    let pills: [StreamPill]
    var minimumWidth: CGFloat = 56

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimumWidth), spacing: 10, alignment: .leading)],
                  alignment: .leading, spacing: 8) {
            ForEach(pills, id: \.self) { pill in
                StatPill(label: pill.label, value: pill.value, tint: pill.tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// What one stream shows that another does not: its title, how it summarises
/// scoring, the numbers on each row, the rows of its comparison, and its
/// editors. Everything else about the screen is shared.
struct StreamScreenSpec<Kind: StreamKind> {
    var title: String
    var systemImage: String
    /// Slot positions offered as filter chips; empty hides the chips.
    var filterPositions: [Position]
    var scoringSummary: (Kind.Scoring) -> String
    /// Usage shown under the name, e.g. "93% snaps" or "24% targets".
    var usage: (Kind.Projection) -> String
    var rowPills: (Kind.Projection) -> [StreamPill]
    var starterPills: (Kind.Projection) -> [StreamPill]
    var compare: StreamCompareSpec<Kind>
    var contextEditor: (StreamScreenModel<Kind>) -> AnyView
    var playerEditor: (StreamScreenModel<Kind>, Kind.Projection) -> AnyView
}

/// A weekly stream screen: players ranked by this week's projected points in
/// your scoring, each compared with the starter a stream would replace.
struct StreamScreenView<Kind: StreamKind>: View {
    @ObservedObject var model: StreamScreenModel<Kind>
    let spec: StreamScreenSpec<Kind>
    @State private var expanded: String?
    @State private var editingContext = false
    @State private var showingSnapshots = false
    @State private var editingPlayer: Kind.Projection?
    @State private var pickingIncumbent = false
    @State private var comparing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Projecting \(Kind.playerNoun)s…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    if !model.leagueStartsKind {
                        ContentUnavailableView(
                            "No \(Kind.positions.map(\.rawValue).joined(separator: "/")) slots",
                            systemImage: "rectangle.slash",
                            description: Text("Your league doesn't start any \(Kind.playerNoun)s, so there is nothing to stream.")
                        )
                    } else {
                        header(context: context)
                        starterCard
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
        .navigationTitle(spec.title)
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
            NavigationStack { spec.contextEditor(model) }
                #if os(macOS)
                .frame(minWidth: 560, minHeight: 560)
                #endif
        }
        .sheet(isPresented: $showingSnapshots) {
            NavigationStack { StreamSnapshotsView(model: model) }
                #if os(macOS)
                .frame(minWidth: 560, minHeight: 520)
                #endif
        }
        .sheet(isPresented: $pickingIncumbent) {
            NavigationStack { StreamPlayerPickerView(model: model, mode: .incumbent) }
                #if os(macOS)
                .frame(minWidth: 460, minHeight: 520)
                #endif
        }
        .sheet(isPresented: $comparing) {
            NavigationStack { StreamCompareView(model: model, spec: spec.compare) }
                #if os(macOS)
                .frame(minWidth: 780, minHeight: 600)
                #endif
        }
        .sheet(item: $editingPlayer) { row in
            NavigationStack { spec.playerEditor(model, row) }
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
                subtitle: "Projected in your scoring: \(spec.scoringSummary(model.scoring)). Ranked by utility, which tilts expected points toward floor or ceiling.",
                systemImage: spec.systemImage
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

    // MARK: - Starter

    private var starterCard: some View {
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
                    Button("Weakest starter (default)") { Task { await model.setIncumbent(nil) } }
                    Section("Your \(Kind.playerNoun)s") {
                        ForEach(model.myPlayers) { player in
                            Button(myPlayerLabel(player)) {
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
                            PositionChip(position: inc.platform, label: inc.roleLabel)
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
                    StatPill(label: "E[pts]", value: StreamFormat.one(inc.expPts))
                }
                StreamPillGrid(pills: [
                    StreamPill(label: "floor", value: StreamFormat.one(inc.floorP25)),
                    StreamPill(label: "ceiling", value: StreamFormat.one(inc.ceilingP75)),
                ] + spec.starterPills(inc) + [
                    StreamPill(label: "P(plays)", value: StreamFormat.pct(inc.pPlay)),
                ])
            } else {
                Text("No starter chosen — rankings show projected points only. Pick anyone with Change.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .card()
    }

    private func myPlayerLabel(_ player: Kind.Candidate) -> String {
        guard let p = model.projection(for: player.id) else { return player.name }
        return "\(player.name) · \(p.roleLabel) · \(StreamFormat.one(p.expPts))"
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            SlidingPicker(options: StreamRiskMode.allCases, selection: $model.risk) { $0.label }
            HStack {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        if spec.filterPositions.count > 1 {
                            chip("All", selected: model.positionFilter == nil) { model.positionFilter = nil }
                            ForEach(spec.filterPositions, id: \.self) { position in
                                chip(position.rawValue, selected: model.positionFilter == position) {
                                    model.positionFilter = model.positionFilter == position ? nil : position
                                }
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
                    StreamRowView(
                        row: row,
                        rank: offset + 1,
                        usage: spec.usage(row),
                        pills: spec.rowPills(row),
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
                    Text("Showing 50 of \(model.rows.count). Filter or search to narrow it.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Compare tray

    private var compareTray: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.2.crop.square.stack")
            Text("Comparing \(model.compareIDs.count)")
                .font(.subheadline.weight(.semibold))
            Text(model.compareIDs.compactMap { model.projection(for: $0).map { StreamFormat.shortName($0.name) } }.joined(separator: ", "))
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
}

// MARK: - Row

struct StreamRowView<P: StreamProjection>: View {
    let row: P
    let rank: Int
    let usage: String
    let pills: [StreamPill]
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
                                Text(row.name)
                                    .font(.subheadline.weight(.semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                                    .layoutPriority(1)
                                PositionChip(position: row.platform, label: row.roleLabel)
                            }
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(availability == .freeAgent ? Color.secondary : Palette.caution)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .layoutPriority(1)
                        Spacer(minLength: 4)
                        Button(action: onCompare) {
                            Image(systemName: isComparing ? "checkmark.circle.fill" : "plus.circle")
                                .foregroundStyle(isComparing ? Color.accentColor : Color.secondary)
                        }
                        .buttonStyle(.plain)
                        .disabled(!isComparing && !canCompare)
                        .help(isComparing ? "Remove from compare" : "Add to compare")
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(StreamFormat.one(row.expPts))
                                .font(.headline.monospacedDigit())
                                .contentTransition(.numericText())
                            if let gain = row.expGain {
                                Text((gain >= 0 ? "+" : "") + StreamFormat.one(gain))
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(gain >= 0 ? Palette.start : Palette.sit)
                            }
                        }
                        .fixedSize()
                    }
                    StreamPillGrid(pills: statPills)
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

    /// Floor and ceiling, the stream's own numbers, then the comparison with
    /// the starter and the bid.
    private var statPills: [StreamPill] {
        var out = [
            StreamPill(label: "floor", value: StreamFormat.one(row.floorP25)),
            StreamPill(label: "ceiling", value: StreamFormat.one(row.ceilingP75)),
        ] + pills
        if let p = row.pBeatIncumbent {
            out.append(StreamPill(label: "vs starter", value: StreamFormat.pct(p), tint: p >= 0.6 ? Palette.start : .primary))
        }
        if let bid { out.append(StreamPill(label: "bid", value: bid)) }
        return out
    }

    private var subtitle: String {
        var parts = ["\(row.team) \(row.opponent)", usage]
        if row.practice != .none { parts.append(row.practice.label) }
        if let availability, availability != .freeAgent { parts.append(availability.label) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

// MARK: - Formatting

enum StreamFormat {
    static func one(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(1))) }
    static func two(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(2))) }
    static func three(_ x: Double) -> String { x.formatted(.number.precision(.fractionLength(3))) }
    static func whole(_ x: Double) -> String { "\(Int(x.rounded()))" }
    static func pct(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }
    static func signed(_ x: Double, places: Int = 1) -> String {
        (x > 0 ? "+" : "") + x.formatted(.number.precision(.fractionLength(places)))
    }
    /// Last name, without a generational suffix.
    static func shortName(_ name: String) -> String {
        let parts = name.split(separator: " ").filter { !["Jr.", "Sr.", "II", "III", "IV"].contains($0) }
        return parts.last.map(String.init) ?? name
    }
}
