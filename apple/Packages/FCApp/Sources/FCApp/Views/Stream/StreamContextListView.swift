import SwiftUI
import UniformTypeIdentifiers
import FCCore

/// The game-context editor every stream shares the shape of: import a context
/// file, reset every edit, the teams playing this week (tap one to edit it),
/// and the per-player edits. Each stream supplies the row and the editor.
struct StreamContextListView<Kind: StreamKind, Row: View, Editor: View>: View {
    @ObservedObject var model: StreamScreenModel<Kind>
    let footer: String
    @ViewBuilder let row: (Kind.Team) -> Row
    @ViewBuilder let editor: (Kind.Team) -> Editor
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var importMessage: String?
    @State private var editing: Kind.Team?

    var body: some View {
        List {
            Section {
                Button {
                    importing = true
                } label: {
                    Label("Import context JSON…", systemImage: "square.and.arrow.down")
                }
                if let importMessage {
                    Text(importMessage).font(.caption).foregroundStyle(.secondary)
                }
                if !model.overrides.teams.isEmpty || !model.overrides.players.isEmpty {
                    Button(role: .destructive) {
                        Task { await model.resetAllOverrides() }
                    } label: {
                        Label("Reset every edit this week", systemImage: "arrow.uturn.backward")
                    }
                }
            } footer: {
                Text(footer)
            }

            Section("Teams playing") {
                ForEach(model.teams.values.sorted { $0.team < $1.team }) { team in
                    Button {
                        editing = team
                    } label: {
                        row(team).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            if !model.overrides.players.isEmpty {
                Section("Player edits") {
                    ForEach(model.overrides.players.keys.sorted(), id: \.self) { id in
                        HStack {
                            Text(model.context?.playerName(id) ?? id)
                            Spacer()
                            Button("Clear") { Task { await model.setPlayerOverride(nil, playerID: id) } }
                                .font(.caption)
                        }
                    }
                }
            }
        }
        .navigationTitle("Game context")
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            Task { await handleImport(result) }
        }
        .sheet(item: $editing) { team in
            NavigationStack { editor(team) }
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 420)
                #endif
        }
    }

    private func handleImport(_ result: Result<URL, Error>) async {
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let counts = try await model.importContext(Data(contentsOf: url))
            importMessage = "Imported \(counts.teams) teams and \(counts.players) player edits from \(url.lastPathComponent)."
        } catch {
            importMessage = "Import failed: \(error)"
        }
    }
}

/// "Auto", "No line" or who edited it — the badge on a context row.
struct StreamSourceBadge: View {
    let sources: [StreamContextSource]

    var body: some View {
        let edited = sources.first { $0 == .manual || $0 == .imported }
        let label = edited?.label ?? (sources.first == .standard ? "No line" : "Auto")
        Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(edited != nil ? Color.accentColor.opacity(0.2) : Palette.surface))
    }
}

/// The rest-of-season pills every horizon stream adds to its rows.
enum StreamROSPills {
    static func pills(_ ros: StreamROS) -> [StreamPill] {
        var out = [StreamPill(label: "rest of season /g", value: StreamFormat.one(ros.perGame))]
        out.append(StreamPill(label: "games left", value: "\(ros.games)"))
        if let bye = ros.byeWeek { out.append(StreamPill(label: "bye", value: "W\(bye)")) }
        if ros.playoffGames > 0 {
            out.append(StreamPill(label: "playoff matchups", value: StreamFormat.signed(ros.playoffAvgDvp, places: 0) + "%",
                                  tint: ros.playoffAvgDvp >= 5 ? Palette.start : ros.playoffAvgDvp <= -5 ? Palette.sit : .primary))
        }
        return out
    }

    static func compareSection<P: StreamROSProjection>(_ players: [P]) -> StreamCompareSection {
        StreamCompareSection(title: "Rest of season", rows: [
            .metric("Per game", players.map(\.ros.perGame)),
            .metric("Games left", players.map { Double($0.ros.games) }, format: StreamFormat.whole),
            .metric("Avg matchup %", players.map(\.ros.avgDvp), format: { StreamFormat.signed($0, places: 0) + "%" }),
            .metric("Playoff matchup %", players.map(\.ros.playoffAvgDvp), format: { StreamFormat.signed($0, places: 0) + "%" }),
            .text("Bye", players.map { $0.ros.byeWeek.map { "W\($0)" } ?? "–" }),
            .text("Softest ahead", players.map { $0.ros.easiest.prefix(2).joined(separator: ", ") }),
            .text("Toughest ahead", players.map { $0.ros.hardest.prefix(2).joined(separator: ", ") }),
        ])
    }
}
