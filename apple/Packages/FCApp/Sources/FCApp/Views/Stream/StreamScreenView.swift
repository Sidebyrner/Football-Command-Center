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
            .motion(Motion.snappy, value: model.horizon)
        }
        .safeAreaInset(edge: .bottom) {
            if !model.compareIDs.isEmpty { compareTray }
        }
        .animation(Motion.snappy, value: model.compareIDs.isEmpty)
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
                StreamRangeBar(floor: inc.floorP25, expected: inc.expPts, ceiling: inc.ceilingP75,
                               scaleMax: scaleMax, tint: Palette.position(inc.platform))
                StreamPillGrid(pills: spec.starterPills(inc) + [
                    StreamPill(label: "P(plays)", value: StreamFormat.pct(inc.pPlay)),
                ], minimumWidth: 72)
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
            SlidingPicker(options: StreamRiskMode.allCases, selection: $model.risk) { mode in
                switch mode {
                case .floor: return "Floor"
                case .neutral: return "Neutral"
                case .ceiling: return "Ceiling"
                }
            }
            Text(riskHint)
                .font(.caption)
                .foregroundStyle(.secondary)
            if Kind.usesHorizon {
                SlidingPicker(options: StreamHorizon.allCases, selection: $model.horizon) { $0.label }
                    .accessibilityLabel("Horizon")
                Text(model.horizon.hint)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(model.rows.prefix(50).enumerated()), id: \.element.id) { offset, row in
                    StreamRowView(
                        row: row,
                        rank: offset + 1,
                        usage: spec.usage(row),
                        pills: spec.rowPills(row),
                        bid: model.bidLabel(row),
                        availability: row.playerID.flatMap { model.context?.availability(ofSleeperID: $0) },
                        injuryBadge: injuryBadge(row),
                        scaleMax: scaleMax,
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

    private var riskHint: String {
        switch model.risk {
        case .floor: return "Favours a safe floor — for when you're favoured to win."
        case .neutral: return "Ranks on expected points."
        case .ceiling: return "Favours upside — for when you're the underdog."
        }
    }

    /// One scale for every range bar on screen.
    private var scaleMax: Double {
        max(model.rows.prefix(50).map(\.ceilingP75).max() ?? 0, model.report?.incumbent?.ceilingP75 ?? 0) * 1.05
    }

    /// The league's injury read first (Sleeper tag, practice report, IR
    /// slot); the stream's own practice input when the player has no ID.
    private func injuryBadge(_ row: Kind.Projection) -> String? {
        if let id = row.playerID, let context = model.context,
           let badge = StartAvailability.of(id, context: context).badge {
            return badge
        }
        switch row.practice {
        case .Q: return "Q"
        case .D: return "Doubtful"
        case .OUT: return "Out"
        case .IR: return "IR"
        default: return nil
        }
    }

    // MARK: - Compare tray

    private var compareTray: some View {
        StreamCompareTray(
            players: model.compareIDs.compactMap { model.projection(for: $0) },
            limit: StreamScreenModel<Kind>.compareLimit,
            onClear: { withAnimation(Motion.snappy) { model.clearCompare() } },
            onCompare: { comparing = true }
        )
    }
}

/// Who is lined up to compare, with room for the names and a clear primary
/// action. Compare needs two; until then it says so.
struct StreamCompareTray<P: StreamProjection>: View {
    let players: [P]
    let limit: Int
    let onClear: () -> Void
    let onCompare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                HStack(spacing: -10) {
                    ForEach(players.prefix(4), id: \.id) { p in
                        PlayerAvatar(sleeperID: p.playerID, name: p.name, position: p.platform, size: 34)
                            .overlay(Circle().stroke(.background, lineWidth: 2))
                    }
                }
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(players.count) of \(limit) to compare")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(players.count < 2
                         ? "Add one more to see them side by side"
                         : players.map { StreamFormat.shortName($0.name) }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 10) {
                Button(role: .destructive, action: onClear) {
                    Text("Clear")
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule().fill(Palette.surfaceRaised))
                }
                .buttonStyle(PressableStyle(scale: 0.96))
                Button(action: onCompare) {
                    Label("Compare side by side", systemImage: "person.2.crop.square.stack")
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .foregroundStyle(.white)
                        .background(Capsule().fill(Color.accentColor))
                }
                .buttonStyle(PressableStyle(scale: 0.97))
                .disabled(players.count < 2)
                .opacity(players.count < 2 ? 0.5 : 1)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
        .padding(.horizontal)
        .padding(.bottom, 8)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

/// Dims and shrinks slightly while pressed, so a card or pill reads as
/// something you can tap.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.98

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

// MARK: - Row

/// One streamer. Collapsed, it answers "who, how healthy, how many points":
/// name, role, injury, and the floor-to-ceiling range on a scale shared with
/// every other row. Tapped, it opens into roomy stat tiles, the odds against
/// your starter, the model's reasoning and the actions.
struct StreamRowView<P: StreamProjection>: View {
    let row: P
    let rank: Int
    let usage: String
    let pills: [StreamPill]
    let bid: String?
    let availability: Availability?
    /// "Q", "Out", "Doubtful", "IR" — from the league's injury sources.
    var injuryBadge: String? = nil
    /// Top of the shared range scale, so bars compare down the list.
    var scaleMax: Double = 0
    let isExpanded: Bool
    let onToggle: () -> Void
    let onAdjust: () -> Void
    var isComparing = false
    var canCompare = true
    var onCompare: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onToggle) {
                summary.contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilitySummary)
            .accessibilityHint(isExpanded ? "Hides the stats" : "Shows the stats")
            footer.padding(.top, 12)

            if isExpanded {
                details
                    .padding(.top, 14)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .card(padding: 14)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(isComparing ? 0.6 : 0), lineWidth: 1.5)
        )
    }

    // MARK: Collapsed

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                ZStack(alignment: .bottomTrailing) {
                    PlayerAvatar(sleeperID: row.playerID, name: row.name, position: row.platform, size: 44)
                    Text("\(rank)")
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                        .frame(minWidth: 18, minHeight: 18)
                        .padding(.horizontal, 2)
                        .background(Capsule().fill(Color.secondary))
                        .offset(x: 4, y: 4)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(row.name)
                        .font(.headline)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    badges
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(StreamFormat.one(row.expPts))
                        .font(.title2.weight(.bold).monospacedDigit())
                        .contentTransition(.numericText())
                    Text("est pts")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let gain = row.expGain {
                        Text((gain >= 0 ? "+" : "") + StreamFormat.one(gain))
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(gain >= 0 ? Palette.start : Palette.sit)
                            .padding(.top, 2)
                        Text("vs starter")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .fixedSize()
            }
            StreamRangeBar(floor: row.floorP25, expected: row.expPts, ceiling: row.ceilingP75,
                           scaleMax: scaleMax, tint: Palette.position(row.platform))
        }
    }

    /// Two labelled controls, so neither the compare action nor the fact that
    /// the card opens is hidden behind an icon.
    private var footer: some View {
        HStack(spacing: 8) {
            Button(action: onCompare) {
                Label(isComparing ? "In compare" : "Compare",
                      systemImage: isComparing ? "checkmark.circle.fill" : "plus.circle")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .foregroundStyle(isComparing ? Color.white : Color.accentColor)
                    .background(Capsule().fill(isComparing ? Color.accentColor : Color.accentColor.opacity(0.12)))
                    .contentShape(Capsule())
            }
            .buttonStyle(PressableStyle(scale: 0.95))
            .disabled(!isComparing && !canCompare)
            .opacity(!isComparing && !canCompare ? 0.45 : 1)
            .sensoryFeedback(.selection, trigger: isComparing)
            .accessibilityLabel(isComparing ? "Remove \(row.name) from compare" : "Add \(row.name) to compare")
            .help(canCompare || isComparing ? "Side-by-side comparison, up to 4 players" : "Compare is full — remove someone first")
            Spacer(minLength: 8)
            Button(action: onToggle) {
                HStack(spacing: 4) {
                    Text(isExpanded ? "Less" : "Stats")
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                }
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Capsule().strokeBorder(Color.secondary.opacity(0.3)))
                .contentShape(Capsule())
            }
            .buttonStyle(PressableStyle(scale: 0.95))
            .accessibilityHidden(true) // the card itself carries this action
        }
    }

    /// Role, injury and roster status as chips, wrapping rather than squeezing.
    private var badges: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { badgeItems }
            VStack(alignment: .leading, spacing: 4) { badgeItems }
        }
    }

    @ViewBuilder
    private var badgeItems: some View {
        PositionChip(position: row.platform, label: row.roleLabel)
        if let injuryBadge { InjuryBadge(label: injuryBadge) }
        if let availability, availability != .freeAgent {
            Text(availability.label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Palette.caution)
                .lineLimit(1)
        }
    }

    // MARK: Expanded

    private var details: some View {
        VStack(alignment: .leading, spacing: 14) {
            Divider()
            if row.pBeatIncumbent != nil || bid != nil {
                HStack(spacing: 10) {
                    if let p = row.pBeatIncumbent {
                        StreamStatTile(value: StreamFormat.pct(p), label: "beats your starter",
                                       tint: p >= 0.6 ? Palette.start : p < 0.4 ? Palette.sit : .primary)
                    }
                    if let bid { StreamStatTile(value: bid, label: "suggested bid") }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("This week").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], alignment: .leading, spacing: 10) {
                    ForEach(tiles, id: \.self) { pill in
                        StreamStatTile(value: pill.value, label: pill.label, tint: pill.tint)
                    }
                }
            }
            if !row.notes.isEmpty || !row.explain.isEmpty || !row.flags.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Why").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    if !row.notes.isEmpty {
                        Text(row.notes).font(.footnote)
                    }
                    ForEach(row.explain, id: \.self) { line in
                        Label {
                            Text(line).fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "circle.fill").font(.system(size: 4))
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                    if !row.flags.isEmpty {
                        Label(row.flags.joined(separator: " · "), systemImage: "flag")
                            .font(.footnote)
                            .foregroundStyle(Palette.caution)
                    }
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { actions }
                VStack(alignment: .leading, spacing: 8) { actions }
            }
            if !row.sources.isEmpty {
                Text(row.sources.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var actions: some View {
        Button(action: onAdjust) {
            Label("Adjust inputs", systemImage: "slider.horizontal.3")
        }
        .buttonStyle(.bordered)
    }

    /// The stream's own numbers. Floor and ceiling already sit on the bar.
    private var tiles: [StreamPill] { pills }

    private var subtitle: String {
        var parts = ["\(row.team) \(row.opponent)", usage]
        // A practice line the injury badge doesn't already say.
        if injuryBadge == nil, row.practice != .none { parts.append(row.practice.label) }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var accessibilitySummary: String {
        var parts = ["\(rank). \(row.name)", row.roleLabel]
        if let injuryBadge { parts.append(injuryBadge == "Q" ? "Questionable" : injuryBadge) }
        parts.append("\(StreamFormat.one(row.expPts)) expected points, floor \(StreamFormat.one(row.floorP25)), ceiling \(StreamFormat.one(row.ceilingP75))")
        if let gain = row.expGain { parts.append("\(StreamFormat.signed(gain)) versus your starter") }
        return parts.joined(separator: ", ")
    }
}

/// Floor to ceiling with a dot at the estimate, labelled underneath. Rows
/// share `scaleMax`, so a wider or further-right bar really is a bigger range.
struct StreamRangeBar: View {
    let floor: Double
    let expected: Double
    let ceiling: Double
    var scaleMax: Double = 0
    var tint: Color = .accentColor

    var body: some View {
        let top = max(scaleMax, ceiling, 1)
        VStack(spacing: 4) {
            GeometryReader { bar in
                let w = bar.size.width
                let x = { (v: Double) in CGFloat(min(max(v / top, 0), 1)) * w }
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surfaceRaised).frame(height: 4)
                    Capsule()
                        .fill(tint.opacity(0.35))
                        .frame(width: max(x(ceiling) - x(floor), 6), height: 10)
                        .offset(x: x(floor))
                    Circle()
                        .fill(tint)
                        .overlay(Circle().stroke(.background, lineWidth: 2))
                        .frame(width: 14, height: 14)
                        .offset(x: min(max(x(expected) - 7, 0), w - 14))
                }
                .frame(maxHeight: .infinity)
            }
            .frame(height: 14)
            HStack {
                labelled(StreamFormat.one(floor), "floor")
                Spacer()
                labelled(StreamFormat.one(ceiling), "ceiling", trailing: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Floor \(StreamFormat.one(floor)), estimate \(StreamFormat.one(expected)), ceiling \(StreamFormat.one(ceiling))")
    }

    private func labelled(_ value: String, _ label: String, trailing: Bool = false) -> some View {
        HStack(spacing: 3) {
            Text(value).font(.caption.weight(.semibold).monospacedDigit())
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .lineLimit(1)
    }
}

/// A stat with room: the number large, its label under it, on a tile.
struct StreamStatTile: View {
    let value: String
    let label: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.background.opacity(0.7)))
        .accessibilityElement(children: .combine)
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
