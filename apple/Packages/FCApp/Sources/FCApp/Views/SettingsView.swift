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

    @State private var showESPNSignIn = false

    public var body: some View {
        Form {
            providerSection

            switch model.settings.provider {
            case .sleeper:
                usernameSection
                if !model.leagues.isEmpty {
                    leagueSection
                }
            case .espn:
                espnSection
            }

            if model.stage == .pickingTeam && !model.teams.isEmpty {
                teamSection
            }

            if let error = model.errorMessage {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Palette.sit)
                }
            }

            appearanceSection
            relaySection

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
        .sheet(isPresented: $showESPNSignIn) {
            ESPNSignInView { credentials in
                model.saveESPNCredentials(credentials)
            }
        }
    }

    // MARK: - Provider

    private var providerSection: some View {
        Section {
            Picker("League platform", selection: Binding(
                get: { model.settings.provider },
                set: { model.setProvider($0) }
            )) {
                ForEach(LeagueProvider.allCases, id: \.self) { provider in
                    Text(provider.label).tag(provider)
                }
            }
            .pickerStyle(.segmented)
        } header: {
            Text("League platform")
        } footer: {
            Text("Player data, projections and live scores come from public sources whichever platform hosts your league.")
        }
    }

    // MARK: - ESPN

    private var espnSection: some View {
        Section {
            if model.hasESPNCredentials {
                HStack {
                    Label("Signed in to ESPN", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(Palette.start)
                    Spacer()
                    if let suffix = model.espnAccountSuffix {
                        Text("account …\(suffix)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                TextField("League id or espn.com league address", text: $model.espnLeagueText)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .onSubmit { Task { await model.connectESPNLeague() } }
                Button {
                    Task { await model.connectESPNLeague() }
                } label: {
                    if model.isWorking {
                        ProgressView()
                    } else {
                        Text("Connect league")
                    }
                }
                .disabled(model.espnLeagueText.trimmingCharacters(in: .whitespaces).isEmpty || model.isWorking)
                Button("Sign out of ESPN", role: .destructive) { model.signOutESPN() }
            } else {
                Button {
                    showESPNSignIn = true
                } label: {
                    Label("Sign in to ESPN", systemImage: "person.crop.circle.badge.checkmark")
                }
            }
        } header: {
            Text("ESPN")
        } footer: {
            if model.hasESPNCredentials {
                Text("Your league id is the number after leagueId= in any espn.com league address. Private leagues work — you're signed in.")
            } else {
                Text("You sign in on ESPN's own page. The app never sees your password; it keeps only the two session cookies ESPN issues, in your Keychain on this device, and sends them only to ESPN.")
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        Section {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 14)], spacing: 14) {
                ForEach(AccentTheme.allCases) { theme in
                    let selected = model.settings.accentTheme == theme
                    Button {
                        model.setAccentTheme(theme)
                    } label: {
                        Circle()
                            .fill(theme.color)
                            .frame(width: 34, height: 34)
                            .overlay {
                                if selected {
                                    Image(systemName: "checkmark")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(.white)
                                        .transition(.scale.combined(with: .opacity))
                                }
                            }
                            .padding(4)
                            .overlay(Circle().strokeBorder(theme.color, lineWidth: selected ? 2 : 0))
                            .scaleEffect(selected ? 1.06 : 1)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(theme.label)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .padding(.vertical, 4)
            .motion(Motion.snappy, value: model.settings.accentTheme)
            .sensoryFeedback(.selection, trigger: model.settings.accentTheme)
        } header: {
            Text("Accent color")
        } footer: {
            let theme = model.settings.accentTheme
            if let status = theme.sharedStatus {
                Text("\(theme.label) — shares a color with \(status), so buttons can look like verdicts.")
            } else {
                Text("\(theme.label) — for buttons and links. Each tab keeps its own hue.")
            }
        }
    }

    // MARK: - Relay

    @State private var relayText = ""
    @State private var relayToken = ""

    private func saveToken() {
        guard !relayToken.isEmpty else { return }
        model.setRelayToken(relayToken)
        relayToken = ""
    }

    private var relaySection: some View {
        Section {
            TextField("relay.example.com", text: $relayText)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                #endif
                .onSubmit { model.setRelayURL(text: relayText) }
                .onAppear {
                    relayText = model.settings.relayBaseURL?.absoluteString ?? ""
                    model.checkSavedRelay()
                }
            if let error = model.relayError {
                Text(error).font(.footnote).foregroundStyle(Palette.sit)
            }
            HStack {
                SecureField(model.hasRelayToken ? "Token saved — enter a new one to replace it" : "Relay token", text: $relayToken)
                    .textContentType(.password)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .onSubmit(saveToken)
                if !relayToken.isEmpty {
                    Button("Save", action: saveToken)
                } else if model.hasRelayToken {
                    Button("Remove", role: .destructive) { model.setRelayToken("") }
                }
            }
        } header: {
            Text("Relay (optional)")
        } footer: {
            Text("Your own relay server adds news about your players and polishes trade pitches on your own AI. The token is the RELAY_TOKEN set on the server, kept in your Keychain. Everything else works without it.")
        }
    }

    // MARK: - Sleeper

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
