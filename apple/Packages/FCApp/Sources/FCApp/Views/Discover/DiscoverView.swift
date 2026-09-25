import SwiftUI
import FCCore
import FCData

/// Player discovery on the go: every free agent (or anyone in the league),
/// searchable and sortable, and a page per player with his trends, schedule,
/// game log, profile and news. The deep, multi-panel version lives in the
/// desktop Discovery workspace; this is the same data in a phone's shape.
struct DiscoverView: View {
    @ObservedObject var model: DiscoveryModel
    let services: AppServices
    @EnvironmentObject private var linkBus: LinkBus
    @State private var scope: Scope = .freeAgents
    @State private var comparing = false

    enum Scope: String, CaseIterable, Hashable {
        case freeAgents = "Free agents"
        case everyone = "Everyone"
    }

    /// The phone's comparison uses the Blue link colour's list, so it's the
    /// same list the desktop panels see on this device.
    static let compareGroup: LinkGroup = .one

    var body: some View {
        Group {
            if model.context != nil {
                list
            } else if let error = model.errorMessage, !model.isLoading {
                InlineErrorBanner(message: error).padding()
            } else {
                LoadingPlaceholder(label: "Finding players…")
            }
        }
        .navigationTitle("Discover")
        .searchable(text: $model.query, prompt: scope == .freeAgents ? "Free agent or team" : "Any player")
        .toolbar { toolbar }
        .navigationDestination(for: DiscoverPlayer.self) { player in
            DiscoverPlayerView(playerID: player.id, services: services, discovery: model)
        }
        .sheet(isPresented: $comparing) { compareSheet }
        .refreshable { await services.loadIfConfigured(force: true) }
    }

    // MARK: - List

    private var list: some View {
        List {
            Section {
                SlidingPicker(options: Scope.allCases, selection: $scope) { $0.rawValue }
                    .listRowSeparator(.hidden)
                if scope == .freeAgents {
                    positionChips
                        .listRowSeparator(.hidden)
                }
            }
            if scope == .freeAgents {
                freeAgents
            } else {
                everyone
            }
        }
        .listStyle(.plain)
    }

    private var positionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("All", selected: model.positionFilter == nil) { model.positionFilter = nil }
                ForEach(model.filterablePositions, id: \.self) { position in
                    chip(position.rawValue, selected: model.positionFilter == position) {
                        model.positionFilter = model.positionFilter == position ? nil : position
                    }
                }
            }
        }
    }

    private func chip(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.caption.weight(selected ? .bold : .medium))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(selected ? Color.white : .primary)
                .background(Capsule().fill(selected ? Color.accentColor : Palette.surface))
        }
        .buttonStyle(.plain)
    }

    private var freeAgents: some View {
        let rows = Array(model.visible.prefix(100))
        return Section {
            if rows.isEmpty {
                Text(model.query.isEmpty ? "No free agents at the positions your league starts." : "Nobody matches “\(model.query)”.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(rows) { row in
                NavigationLink(value: DiscoverPlayer(id: row.id)) {
                    DiscoverRow(playerID: row.id, name: row.name, position: row.position,
                                detail: [row.team, row.opponent].compactMap { $0 }.joined(separator: " · "),
                                badge: row.injuryTag.flatMap(WaiverTargetsPanel.badge),
                                value: value(row), unit: model.sort.unit,
                                comparing: linkBus.isComparing(row.id, in: Self.compareGroup))
                }
                .accessibilityIdentifier("discover.row")
                .swipeActions(edge: .trailing) { compareAction(row.id) }
                .contextMenu { compareButton(row.id) }
            }
        } footer: {
            Text("\(min(100, model.visible.count)) of \(model.visible.count) · sorted by \(model.sort.label.lowercased()). Swipe left to compare.")
        }
    }

    @ViewBuilder
    private var everyone: some View {
        if let context = model.context {
            let matches = PlayerLookup.matches(model.query, in: context, limit: 40)
            Section {
                if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("Search any player in the league — rostered or not.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if matches.isEmpty {
                    Text("Nobody matches “\(model.query)”.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(matches, id: \.id) { player in
                    NavigationLink(value: DiscoverPlayer(id: player.id)) {
                        DiscoverRow(playerID: player.id, name: player.name, position: player.position,
                                    detail: [player.team, context.availability(ofSleeperID: player.id).label]
                                        .compactMap { $0 }.joined(separator: " · "),
                                    badge: StartAvailability.of(player.id, context: context).badge,
                                    value: context.sleeperPointsPerGame(player.id).map(PanelFormat.points),
                                    unit: "pts/gm",
                                    comparing: linkBus.isComparing(player.id, in: Self.compareGroup))
                    }
                    .accessibilityIdentifier("discover.row")
                    .swipeActions(edge: .trailing) { compareAction(player.id) }
                    .contextMenu { compareButton(player.id) }
                }
            }
        }
    }

    private func value(_ row: WaiverRow) -> String? {
        guard case .column(let column) = model.sort, let value = row.value(column) else { return nil }
        if column.isPercent { return "\(Int((value * 100).rounded()))%" }
        if column == .trending { return "\(Int(value))" }
        if column == .projectedOverLine { return PanelFormat.signed(value) }
        return PanelFormat.points(value)
    }

    // MARK: - Compare

    private func compareAction(_ id: String) -> some View {
        let comparing = linkBus.isComparing(id, in: Self.compareGroup)
        return Button {
            toggleCompare(id)
        } label: {
            Label(comparing ? "Remove" : "Compare", systemImage: comparing ? "person.2.slash" : "person.2")
        }
        .tint(comparing ? .gray : .accentColor)
    }

    private func compareButton(_ id: String) -> some View {
        let comparing = linkBus.isComparing(id, in: Self.compareGroup)
        return Button {
            toggleCompare(id)
        } label: {
            Label(comparing ? "Remove from compare" : "Add to compare", systemImage: "person.2")
        }
        .disabled(!comparing && !linkBus.canAddToCompare(in: Self.compareGroup))
    }

    private func toggleCompare(_ id: String) {
        let group = Self.compareGroup
        linkBus.publish(linkBus.isComparing(id, in: group) ? .removeCompare(id) : .addCompare(id), to: group)
    }

    private var compareSheet: some View {
        NavigationStack {
            ComparePanel(services: services, discovery: model, rows: 6)
                .environment(\.panelLinkGroup, Self.compareGroup)
                .environment(\.linkPublish, LinkPublishAction(group: Self.compareGroup) { [linkBus] change in
                    linkBus.publish(change, to: Self.compareGroup)
                })
                .navigationTitle("Compare")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { comparing = false } }
                }
        }
        .presentationDetents([.large])
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Menu {
                Picker("Sort", selection: $model.sort) {
                    ForEach(DiscoverySort.all) { Text($0.label).tag($0) }
                }
                Toggle("Rival benches", isOn: $model.includeRivalBenches)
            } label: {
                Label("Sort", systemImage: "arrow.up.arrow.down")
            }
            .disabled(scope == .everyone)
            Button {
                comparing = true
            } label: {
                let count = linkBus.compareList(for: Self.compareGroup).count
                Label(count == 0 ? "Compare" : "Compare \(count)", systemImage: "person.2.crop.square.stack")
            }
            .accessibilityIdentifier("discover.compare")
        }
    }
}

/// A player to open, as a navigation value.
struct DiscoverPlayer: Hashable {
    let id: String
}

private struct DiscoverRow: View {
    let playerID: String
    let name: String
    let position: Position?
    let detail: String
    let badge: String?
    let value: String?
    let unit: String?
    let comparing: Bool

    var body: some View {
        HStack(spacing: 10) {
            PlayerAvatar(sleeperID: playerID, name: name, position: position, size: 36)
                .overlay(alignment: .bottomTrailing) {
                    if comparing {
                        Image(systemName: "person.2.circle.fill")
                            .font(.caption)
                            .foregroundStyle(Color.accentColor)
                            .background(Circle().fill(.background))
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    PositionChip(position: position)
                    if let badge { InjuryBadge(label: badge) }
                }
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 0) {
                Text(value ?? "—")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(value == nil ? .tertiary : .primary)
                if let unit, !unit.isEmpty { Text(unit).font(.caption2).foregroundStyle(.tertiary) }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Player page

/// Everything about one player, stacked for a phone: trends first, then his
/// schedule, game log, profile and news.
struct DiscoverPlayerView: View {
    let playerID: String
    let services: AppServices
    @ObservedObject var discovery: DiscoveryModel

    var body: some View {
        if let context = discovery.context {
            DiscoverPlayerPage(card: services.playerCard(playerID, context: context), context: context, discovery: discovery)
        } else {
            LoadingPlaceholder(label: "Loading…")
        }
    }
}

private struct DiscoverPlayerPage: View {
    @ObservedObject var card: PlayerCardModel
    let context: LeagueContext
    @ObservedObject var discovery: DiscoveryModel
    @EnvironmentObject private var linkBus: LinkBus
    @State private var metric: PlayerMetric = .fantasyPoints

    private var metrics: [PlayerMetric] { PlayerMetric.allCases.filter { $0.applies(to: card.position) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                section("Trends", systemImage: "chart.xyaxis.line") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(metrics) { option in
                                Button {
                                    withAnimation(Motion.snappy) { metric = option }
                                } label: {
                                    Text(option.label)
                                        .font(.caption.weight(option == metric ? .bold : .medium))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .foregroundStyle(option == metric ? Color.white : .primary)
                                        .background(Capsule().fill(option == metric ? Color.accentColor : Palette.surface))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    if let index = discovery.metrics {
                        MetricSummaryView(index: index, playerID: card.id, metric: metric, lastN: 8)
                    }
                }
                section("Schedule & strength of schedule", systemImage: "calendar") {
                    SchedulePanel(card: card, context: context, discovery: discovery)
                }
                section("Game log", systemImage: "list.bullet.rectangle") {
                    GameLogPanel(card: card, rows: 8)
                }
                section("Profile", systemImage: "person.crop.rectangle") {
                    PlayerProfilePanel(card: card)
                }
                section("News", systemImage: "newspaper") {
                    PlayerNewsPanel(card: card, rows: 5)
                }
            }
            .padding()
        }
        .accessibilityIdentifier("discover.page")
        .environment(\.panelInline, true)
        .navigationTitle(card.name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                let comparing = linkBus.isComparing(card.id, in: DiscoverView.compareGroup)
                Button {
                    linkBus.publish(comparing ? .removeCompare(card.id) : .addCompare(card.id), to: DiscoverView.compareGroup)
                } label: {
                    Label(comparing ? "In compare" : "Compare", systemImage: comparing ? "checkmark.circle.fill" : "plus.circle")
                }
                .disabled(!comparing && !linkBus.canAddToCompare(in: DiscoverView.compareGroup))
                .sensoryFeedback(.selection, trigger: comparing)
            }
        }
        .task(id: card.id) {
            await card.load()
            if !metric.applies(to: card.position) { metric = .fantasyPoints }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            PlayerAvatar(sleeperID: card.id, name: card.name, position: card.position, size: 56)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(card.name).font(.title3.weight(.bold)).lineLimit(1).minimumScaleFactor(0.8)
                    PositionChip(position: card.position)
                    if let badge = StartAvailability.of(card.id, context: context).badge { InjuryBadge(label: badge) }
                }
                Text([card.team, card.status?.opponent.map { "vs \($0) this week" }, card.status?.availability.label]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                HStack(spacing: 14) {
                    if let ppg = context.sleeperPointsPerGame(card.id) {
                        StatPill(label: "pts/gm", value: PanelFormat.points(ppg))
                    }
                    if let projected = card.rotowireThisWeek {
                        StatPill(label: "proj this week", value: PanelFormat.points(projected))
                    }
                    if let ros = card.commandCenter?.restOfSeasonPerGame {
                        StatPill(label: "rest of season", value: PanelFormat.points(ros))
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    private func section<Content: View>(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: title, systemImage: systemImage)
            content()
        }
        .card()
    }
}
