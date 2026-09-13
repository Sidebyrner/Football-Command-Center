import SwiftUI
import FCCore
import FCData

/// Setup: username, then league, then which team is theirs.
public struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    /// Called once setup is complete, so the shell can move on.
    var onReady: () -> Void

    public init(model: SettingsModel, onReady: @escaping () -> Void = {}) {
        self.model = model
        self.onReady = onReady
    }

    public var body: some View {
        Form {
            usernameSection

            if !model.leagues.isEmpty {
                leagueSection
            }

            if model.stage == .pickingTeam && !model.teams.isEmpty {
                teamSection
            }

            if let error = model.errorMessage {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            if model.settings.isConfigured {
                Section {
                    Button("Switch league", role: .destructive) { model.changeLeague() }
                }
            }
        }
        .navigationTitle("Settings")
        .onChange(of: model.stage) { _, stage in
            if stage == .ready { onReady() }
        }
    }

    private var usernameSection: some View {
        Section {
            TextField("Sleeper username", text: $model.username)
                .textContentType(.username)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .onSubmit { Task { await model.lookUpUser() } }

            Button {
                Task { await model.lookUpUser() }
            } label: {
                if model.isWorking {
                    ProgressView()
                } else {
                    Text("Find my leagues")
                }
            }
            .disabled(model.username.trimmingCharacters(in: .whitespaces).isEmpty || model.isWorking)
        } header: {
            Text("Sleeper")
        } footer: {
            Text("Sleeper's API is public — no password, and nothing to authorise.")
        }
    }

    private var leagueSection: some View {
        Section("League") {
            ForEach(model.leagues, id: \.leagueID) { league in
                Button {
                    Task { await model.selectLeague(league) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(league.name ?? league.leagueID)
                                .foregroundStyle(.primary)
                            if let rosters = league.totalRosters {
                                Text("\(rosters) teams")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if model.settings.leagueID == league.leagueID {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.tint)
                        }
                    }
                }
            }
        }
    }

    private var teamSection: some View {
        Section("Which team is yours?") {
            ForEach(model.teams, id: \.rosterID) { team in
                Button {
                    model.selectTeam(rosterID: team.rosterID)
                } label: {
                    HStack {
                        Text(team.manager).foregroundStyle(.primary)
                        Spacer()
                        if model.settings.rosterID == team.rosterID {
                            Image(systemName: "checkmark").foregroundStyle(.tint)
                        }
                    }
                }
            }
        }
    }
}
