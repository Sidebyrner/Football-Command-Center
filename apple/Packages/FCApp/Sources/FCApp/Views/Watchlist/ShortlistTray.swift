import SwiftUI
import FCCore

/// The watchlist along the bottom of the Market tab, whichever screen is up:
/// tap a player to put him in or out of the comparison, then Compare.
struct ShortlistTray: View {
    let services: AppServices
    @ObservedObject var watchlist: WatchlistModel
    @ObservedObject var discovery: DiscoveryModel
    @State private var comparing = false
    @State private var editing = false
    @State private var card: PlayerCardModel?

    var body: some View {
        if !watchlist.entries.isEmpty {
            HStack(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(watchlist.entries) { entry in
                            chip(entry)
                        }
                    }
                    .padding(.vertical, 2)
                }
                Button {
                    comparing = true
                } label: {
                    Text(watchlist.comparingIDs.isEmpty ? "Compare" : "Compare \(watchlist.comparingIDs.count)")
                        .font(.footnote.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(watchlist.comparingIDs.isEmpty)
                .accessibilityIdentifier("shortlist.compare")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(.bar)
            .overlay(alignment: .top) { Divider() }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("shortlist.tray")
            .sheet(isPresented: $comparing) {
                NavigationStack {
                    PhoneCompareView(services: services, discovery: discovery, watchlist: watchlist)
                }
                .presentationDetents([.large])
            }
            .sheet(isPresented: $editing) {
                NavigationStack {
                    WatchlistListView(services: services, watchlist: watchlist)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) { Button("Done") { editing = false } }
                        }
                }
            }
            .sheet(item: $card) { PlayerCardSheet(model: $0) }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func chip(_ entry: WatchlistEntry) -> some View {
        let context = discovery.context
        let name = context?.playerName(entry.playerID) ?? entry.playerID
        let position = context?.position(entry.playerID)
        let index = watchlist.comparingIDs.firstIndex(of: entry.playerID)
        let rostered = context.map { $0.availability(ofSleeperID: entry.playerID) } ?? .freeAgent
        return Button {
            withAnimation(Motion.snappy) { watchlist.toggleCompare(entry.playerID) }
        } label: {
            HStack(spacing: 4) {
                PlayerAvatar(sleeperID: entry.playerID, name: name, position: position, size: 26)
                    .overlay(Circle().stroke(index.map(ChartPalette.color) ?? .clear, lineWidth: 2))
                    .overlay(alignment: .topTrailing) {
                        if case .rivalBench = rostered { claimedDot } else if case .rivalStarter = rostered { claimedDot }
                    }
                VStack(alignment: .leading, spacing: 0) {
                    Text(StreamFormat.shortName(name)).font(.caption2.weight(.semibold)).lineLimit(1)
                    if entry.isBaseline {
                        Text("YOURS").font(.system(size: 8).weight(.bold)).foregroundStyle(Color.accentColor)
                    } else if let position {
                        Text(position.rawValue).font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.leading, 3)
            .padding(.trailing, 8)
            .padding(.vertical, 3)
            .background(Capsule().fill(index != nil ? ChartPalette.color(index!).opacity(0.14) : Palette.surface))
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .contextMenu {
            if let context {
                Button {
                    card = services.playerCard(entry.playerID, context: context)
                } label: {
                    Label("Open Player Card", systemImage: "person.text.rectangle")
                }
            }
            if rostered == .mine {
                Button {
                    if entry.isBaseline { watchlist.clearBaseline() } else { watchlist.setBaseline(entry.playerID) }
                } label: {
                    Label(entry.isBaseline ? "Stop using as baseline" : "Use as baseline", systemImage: "ruler")
                }
            }
            Button {
                editing = true
            } label: {
                Label("Edit watchlist", systemImage: "list.star")
            }
            Button(role: .destructive) {
                withAnimation(Motion.snappy) { watchlist.remove(entry.playerID) }
            } label: {
                Label("Remove from watchlist", systemImage: "star.slash")
            }
        }
        .accessibilityLabel("\(name)\(index != nil ? ", comparing" : "")\(entry.isBaseline ? ", your baseline" : "")")
        .accessibilityIdentifier("shortlist.chip.\(entry.playerID)")
    }

    private var claimedDot: some View {
        Circle().fill(Palette.caution).frame(width: 8, height: 8)
            .overlay(Circle().stroke(Color.primary.opacity(0.2), lineWidth: 0.5))
            .accessibilityHidden(true)
    }
}

/// The whole watchlist: who's compared, who's the baseline, add by search,
/// swipe to remove.
struct WatchlistListView: View {
    let services: AppServices
    @ObservedObject var watchlist: WatchlistModel
    @State private var query = ""

    private var context: LeagueContext? { services.dashboard.context }

    var body: some View {
        List {
            if let context, !query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section("Add") {
                    let matches = PlayerLookup.matches(query, in: context, excluding: watchlist.ids, limit: 8)
                    if matches.isEmpty {
                        Text("No player matches “\(query)”.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(matches, id: \.id) { player in
                        Button {
                            watchlist.add(player.id)
                            query = ""
                        } label: {
                            row(player.id, context: context, trailing: Image(systemName: "plus.circle").foregroundStyle(Color.accentColor))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            Section {
                if watchlist.entries.isEmpty {
                    Text("Star players on the Waiver Board, in Discover or from a Player Card.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(watchlist.entries) { entry in
                    if let context {
                        Toggle(isOn: Binding(
                            get: { watchlist.isComparing(entry.playerID) },
                            set: { _ in watchlist.toggleCompare(entry.playerID) }
                        )) {
                            row(entry.playerID, context: context, trailing: EmptyView())
                        }
                        .disabled(!watchlist.isComparing(entry.playerID) && !watchlist.canCompareMore)
                        .accessibilityIdentifier("watchlist.row.\(entry.playerID)")
                    }
                }
                .onDelete { offsets in
                    offsets.map { watchlist.entries[$0].playerID }.forEach(watchlist.remove)
                }
            } header: {
                Text("Watchlist · \(watchlist.entries.count) of \(WatchlistModel.capacity)")
            } footer: {
                Text("Toggle up to \(WatchlistModel.compareLimit) into the comparison. Adding a thirteenth drops the oldest not being compared.")
            }
            if let context, let team = context.userTeam {
                Section {
                    Picker("Baseline", selection: Binding(
                        get: { watchlist.baselineID ?? "" },
                        set: { id in if id.isEmpty { watchlist.clearBaseline() } else { watchlist.setBaseline(id) } }
                    )) {
                        Text("None").tag("")
                        ForEach(baselineCandidates(team: team, context: context), id: \.self) { id in
                            Text(label(id, context: context)).tag(id)
                        }
                    }
                } header: {
                    Text("Your baseline")
                } footer: {
                    Text("One of your own players, shown first — the one you'd drop or bench — so each target is measured against him.")
                }
            }
        }
        .navigationTitle("Watchlist")
        .searchable(text: $query, prompt: "Add a player")
    }

    /// Your players at the positions being compared, else your whole roster.
    private func baselineCandidates(team: LeagueTeam, context: LeagueContext) -> [String] {
        let positions = Set(watchlist.comparingIDs.compactMap { context.position($0) })
        let roster = team.roster.filter { positions.isEmpty || positions.contains($0.position ?? .qb) || $0.id == watchlist.baselineID }
        return (roster.isEmpty ? team.roster : roster).map(\.id)
            .sorted { label($0, context: context) < label($1, context: context) }
    }

    private func label(_ id: String, context: LeagueContext) -> String {
        [context.playerName(id) ?? id, context.position(id)?.rawValue].compactMap { $0 }.joined(separator: " · ")
    }

    private func row<Trailing: View>(_ id: String, context: LeagueContext, trailing: Trailing) -> some View {
        let availability = context.availability(ofSleeperID: id)
        let entry = watchlist.entry(id)
        return HStack(spacing: 10) {
            PlayerAvatar(sleeperID: id, name: context.playerName(id), position: context.position(id), size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(context.playerName(id) ?? id).font(.subheadline.weight(.semibold))
                HStack(spacing: 4) {
                    Text([context.position(id)?.rawValue, context.nflTeam(of: id)].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption2).foregroundStyle(.secondary)
                    AvailabilityBadge(availability: availability, isBaseline: entry?.isBaseline == true,
                                      wasClaimed: watchlist.wasClaimed(id))
                }
            }
            Spacer(minLength: 4)
            trailing
        }
    }
}
