import SwiftUI
import UniformTypeIdentifiers
import FCCore

/// Every team playing this week, with the passing-game context the WR model
/// uses. Values are auto-filled; editing one marks it as yours, and reset puts
/// it back.
struct WRContextEditorView: View {
    @ObservedObject var model: WRStreamScreenModel
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var importMessage: String?
    @State private var editing: WRTeamContext?

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
                Text("Spread is from each offense's side: positive means that team is the underdog, which means more passing.")
            }

            Section("Teams playing") {
                ForEach(model.teams.values.sorted { $0.team < $1.team }) { team in
                    Button {
                        editing = team
                    } label: {
                        teamRow(team)
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
            NavigationStack { WRTeamEditorView(model: model, team: team) }
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 420)
                #endif
        }
    }

    private func teamRow(_ team: WRTeamContext) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(team.team).font(.subheadline.weight(.semibold))
                Text(team.opponentLabel).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("spread \(StreamFormat.signed(team.spreadOff)) · O/U \(StreamFormat.one(team.total))")
                    .font(.caption.monospacedDigit())
            }
            HStack(spacing: 8) {
                Text("WR matchup \(team.dvpPct.map { StreamFormat.signed($0, places: 0) + "%" } ?? "–")")
                Text("coverage ×\(StreamFormat.two(team.coverageAdj))")
                Spacer()
                sourceBadge(team)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    private func sourceBadge(_ team: WRTeamContext) -> some View {
        let edited = [team.linesSource, team.dvpSource, team.coverageSource].first { $0 == .manual || $0 == .imported }
        let label = edited?.label ?? (team.linesSource == .standard ? "No line" : "Auto")
        return Text(label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(edited != nil ? Color.accentColor.opacity(0.2) : Palette.surface))
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

// MARK: - One team

struct WRTeamEditorView: View {
    @ObservedObject var model: WRStreamScreenModel
    let team: WRTeamContext
    @Environment(\.dismiss) private var dismiss
    @State private var spread: Double
    @State private var total: Double
    @State private var dvp: Double
    @State private var dvpGames: Int
    @State private var coverage: Double

    init(model: WRStreamScreenModel, team: WRTeamContext) {
        self.model = model
        self.team = team
        _spread = State(initialValue: team.spreadOff)
        _total = State(initialValue: team.total)
        _dvp = State(initialValue: team.dvpPct ?? 0)
        _dvpGames = State(initialValue: max(team.dvpGames, 1))
        _coverage = State(initialValue: team.coverageAdj)
    }

    var body: some View {
        Form {
            Section {
                Stepper("Spread \(StreamFormat.signed(spread))", value: $spread, in: -25...25, step: 0.5)
                Stepper("Total \(StreamFormat.one(total))", value: $total, in: 30...65, step: 0.5)
            } header: {
                Text("\(team.team) \(team.opponentLabel)")
            } footer: {
                Text("Auto: spread \(StreamFormat.signed(auto?.spreadOff ?? 0)), total \(StreamFormat.one(auto?.total ?? 45)) — \(auto?.linesSource.label ?? "none"). Underdogs throw more.")
            }
            Section {
                Stepper("WR points \(StreamFormat.signed(dvp, places: 0))%", value: $dvp, in: -60...100, step: 5)
                Stepper("Based on \(dvpGames) games", value: $dvpGames, in: 1...17)
            } header: {
                Text("What \(team.opponent) allows to receivers vs average")
            } footer: {
                Text("Weighted by games / (games + 6) and capped at ±15% on yards and first downs.")
            }
            Section {
                Stepper("×\(StreamFormat.two(coverage))", value: $coverage, in: 0.7...1.3, step: 0.05)
            } header: {
                Text("\(team.opponent) coverage")
            } footer: {
                Text("1.00 is neutral. Below 1 for a shadow corner, elite man coverage or a QB downgrade; above 1 for an injured secondary or a zone-heavy defense. Capped at ±30%.")
            }
            Section {
                Button("Reset to auto", role: .destructive) {
                    Task { await model.setTeamOverride(nil, team: team.team); dismiss() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(team.team)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save(); dismiss() } }
            }
        }
    }

    private var auto: WRTeamContext? { model.autoTeams[team.team] }

    /// Stores only what differs from the auto value, so a later auto refresh
    /// still flows through anything the user did not touch.
    private func save() async {
        let base = auto
        var change = WRTeamOverride(source: .manual)
        if spread != base?.spreadOff { change.spreadOff = spread }
        if total != base?.total { change.total = total }
        if dvp != (base?.dvpPct ?? 0) || dvpGames != base?.dvpGames { change.dvpPct = dvp; change.dvpGames = dvpGames }
        if coverage != base?.coverageAdj { change.coverageAdj = coverage }
        await model.setTeamOverride(change, team: team.team)
    }
}

// MARK: - One player

struct WRPlayerOverrideView: View {
    @ObservedObject var model: WRStreamScreenModel
    let row: WRProjection
    @Environment(\.dismiss) private var dismiss
    @State private var role: WRRole
    @State private var practice: StreamPractice
    @State private var roleConf: Double
    @State private var redZoneShare: Double
    @State private var notes: String

    init(model: WRStreamScreenModel, row: WRProjection) {
        self.model = model
        self.row = row
        _role = State(initialValue: row.role)
        _practice = State(initialValue: row.practice)
        _roleConf = State(initialValue: row.roleConf)
        _redZoneShare = State(initialValue: row.redZoneShare ?? WRStreamKnobs.neutralRedZoneShare)
        _notes = State(initialValue: row.notes)
    }

    var body: some View {
        Form {
            Section {
                Picker("Role", selection: $role) {
                    ForEach(WRRole.allCases, id: \.self) { Text("\($0.label) — \($0.summary)").tag($0) }
                }
                Picker("Status", selection: $practice) {
                    ForEach(StreamPractice.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } footer: {
                Text("Role sets the per-target priors: a deep threat catches less but gains far more per catch and hits the long-catch tiers. Status sets P(plays).")
            }
            Section {
                Slider(value: $roleConf, in: 0.2...1, step: 0.05) {
                    Text("Role confidence")
                } minimumValueLabel: { Text("0.2") } maximumValueLabel: { Text("1") }
                Text("Role confidence \(StreamFormat.two(roleConf)) — lower widens the range and pulls target share toward the role prior.")
                    .font(.caption).foregroundStyle(.secondary)
                Slider(value: $redZoneShare, in: 0...0.5, step: 0.01) {
                    Text("Red-zone share")
                } minimumValueLabel: { Text("0%") } maximumValueLabel: { Text("50%") }
                Text("Red-zone target share \(StreamFormat.pct(redZoneShare)) — 18% is neutral; it moves the TD rate up to ±60%.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Notes") {
                TextField("Why", text: $notes, axis: .vertical)
            }
            Section {
                Button("Clear edits", role: .destructive) {
                    Task { await model.setPlayerOverride(nil, playerID: row.id); dismiss() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(row.name)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    Task {
                        let existing = model.overrides.players[row.id]
                        let change = WRPlayerOverride(
                            role: role != row.role ? role : existing?.role,
                            practice: practice != row.practice ? practice : existing?.practice,
                            roleConf: roleConf != row.roleConf ? roleConf : existing?.roleConf,
                            redZoneShare: redZoneShare != (row.redZoneShare ?? WRStreamKnobs.neutralRedZoneShare)
                                ? redZoneShare : existing?.redZoneShare,
                            targetShareEst: existing?.targetShareEst,
                            rushAttemptsPerGame: existing?.rushAttemptsPerGame,
                            notes: notes.isEmpty ? nil : notes
                        )
                        await model.setPlayerOverride(change, playerID: row.id)
                        dismiss()
                    }
                }
            }
        }
    }
}
