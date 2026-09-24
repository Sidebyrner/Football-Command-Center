import SwiftUI
import UniformTypeIdentifiers
import FCCore

/// Every team playing this week, with the game context the model uses. Values
/// are auto-filled; editing one marks it as yours, and reset puts it back.
struct IDPContextEditorView: View {
    @ObservedObject var model: IDPStreamScreenModel
    @Environment(\.dismiss) private var dismiss
    @State private var importing = false
    @State private var importMessage: String?
    @State private var editing: IDPTeamContext?

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
                Text("Spread is from each defense's side: positive means that team is the underdog, which means more plays to defend.")
            }

            Section("Teams playing") {
                ForEach(sortedTeams) { team in
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
            NavigationStack { IDPTeamEditorView(model: model, team: team) }
                #if os(macOS)
                .frame(minWidth: 420, minHeight: 460)
                #endif
        }
    }

    private var sortedTeams: [IDPTeamContext] {
        model.teams.values.sorted { $0.team < $1.team }
    }

    private func teamRow(_ team: IDPTeamContext) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(team.team).font(.subheadline.weight(.semibold))
                Text(team.opponentLabel).font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text("spread \(signed(team.spreadDef)) · O/U \(num(team.total))")
                    .font(.caption.monospacedDigit())
            }
            HStack(spacing: 8) {
                ForEach([Position.lb, .dl, .db], id: \.self) { position in
                    Text("\(position.rawValue) \(team.dvpPct[position].map { signed($0, places: 0) + "%" } ?? "–")")
                }
                Text("pass-pro ×\(num(team.oppSackEnv, places: 2))")
                Spacer()
                sourceBadge(team)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    private func sourceBadge(_ team: IDPTeamContext) -> some View {
        let edited = [team.linesSource, team.dvpSource, team.sackSource].first { $0 == .manual || $0 == .imported }
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

struct IDPTeamEditorView: View {
    @ObservedObject var model: IDPStreamScreenModel
    let team: IDPTeamContext
    @Environment(\.dismiss) private var dismiss
    @State private var spread: Double
    @State private var total: Double
    @State private var sackEnv: Double
    @State private var dvp: [Position: Double]
    @State private var dvpGames: Int

    init(model: IDPStreamScreenModel, team: IDPTeamContext) {
        self.model = model
        self.team = team
        _spread = State(initialValue: team.spreadDef)
        _total = State(initialValue: team.total)
        _sackEnv = State(initialValue: team.oppSackEnv)
        _dvp = State(initialValue: team.dvpPct)
        _dvpGames = State(initialValue: max(team.dvpGames, 1))
    }

    var body: some View {
        Form {
            Section {
                Stepper("Spread \(signed(spread))", value: $spread, in: -25...25, step: 0.5)
                Stepper("Total \(num(total))", value: $total, in: 30...65, step: 0.5)
            } header: {
                Text("\(team.team) \(team.opponentLabel)")
            } footer: {
                Text("Auto: spread \(signed(auto?.spreadDef ?? 0)), total \(num(auto?.total ?? 45)) — \(auto?.linesSource.label ?? "none").")
            }
            Section {
                ForEach([Position.lb, .dl, .db], id: \.self) { position in
                    Stepper("\(position.rawValue) \(signed(dvp[position] ?? 0, places: 0))%",
                            value: Binding(get: { dvp[position] ?? 0 }, set: { dvp[position] = $0 }),
                            in: -80...150, step: 5)
                }
                Stepper("Based on \(dvpGames) games", value: $dvpGames, in: 1...17)
            } header: {
                Text("Points \(team.opponent) allows vs average")
            } footer: {
                Text("Weighted by games / (games + 6) and capped at ±12% on tackles, so a two-game sample barely moves anything.")
            }
            Section {
                Stepper("×\(num(sackEnv, places: 2))", value: $sackEnv, in: 0.6...1.4, step: 0.05)
            } header: {
                Text("\(team.opponent) pass protection")
            } footer: {
                Text("1.00 is average. Above 1 means a leaky offensive line — more sacks. Capped at ±35%.")
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

    private var auto: IDPTeamContext? { model.autoTeams[team.team] }

    /// Stores only what differs from the auto value, so a later auto refresh
    /// still flows through anything the user did not touch.
    private func save() async {
        let base = auto
        var change = IDPTeamOverride(source: .manual)
        if spread != base?.spreadDef { change.spreadDef = spread }
        if total != base?.total { change.total = total }
        if dvp != base?.dvpPct || dvpGames != base?.dvpGames { change.dvpPct = dvp; change.dvpGames = dvpGames }
        if sackEnv != base?.oppSackEnv { change.oppSackEnv = sackEnv }
        await model.setTeamOverride(change, team: team.team)
    }
}

// MARK: - One player

struct IDPPlayerOverrideView: View {
    @ObservedObject var model: IDPStreamScreenModel
    let row: IDPProjection
    @Environment(\.dismiss) private var dismiss
    @State private var position: IDPSubPosition
    @State private var practice: IDPPractice
    @State private var roleConf: Double
    @State private var notes: String

    init(model: IDPStreamScreenModel, row: IDPProjection) {
        self.model = model
        self.row = row
        _position = State(initialValue: row.position)
        _practice = State(initialValue: row.practice)
        _roleConf = State(initialValue: row.roleConf)
        _notes = State(initialValue: row.notes)
    }

    var body: some View {
        Form {
            Section {
                Picker("Alignment", selection: $position) {
                    ForEach(IDPSubPosition.allCases.filter { $0.platform == row.platform }, id: \.self) {
                        Text($0.label).tag($0)
                    }
                }
                Picker("Status", selection: $practice) {
                    ForEach(IDPPractice.allCases, id: \.self) { Text($0.label).tag($0) }
                }
            } footer: {
                Text("Alignment sets the per-snap priors: a box safety tackles far more than a free safety. Status sets P(plays).")
            }
            Section {
                Slider(value: $roleConf, in: 0.2...1, step: 0.05) {
                    Text("Role confidence")
                } minimumValueLabel: { Text("0.2") } maximumValueLabel: { Text("1") }
                Text("Role confidence \(num(roleConf, places: 2)) — lower widens the range and pulls snap share toward a role prior.")
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
                        let change = IDPPlayerOverride(
                            position: position != row.position ? position : model.overrides.players[row.id]?.position,
                            roleConf: roleConf != row.roleConf ? roleConf : model.overrides.players[row.id]?.roleConf,
                            practice: practice != row.practice ? practice : model.overrides.players[row.id]?.practice,
                            snapShareEst: model.overrides.players[row.id]?.snapShareEst,
                            pressures: model.overrides.players[row.id]?.pressures,
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

// MARK: - Formatting

private func num(_ x: Double, places: Int = 1) -> String {
    x.formatted(.number.precision(.fractionLength(places)))
}

private func signed(_ x: Double, places: Int = 1) -> String {
    (x > 0 ? "+" : "") + num(x, places: places)
}
