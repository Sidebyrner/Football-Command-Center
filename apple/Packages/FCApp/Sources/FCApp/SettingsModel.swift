import Foundation
import FCCore
import FCData

/// The username → league pick flow named in step 2 of the build order, and
/// its ESPN counterpart: sign in → league id → team.
///
/// Uncached on purpose at both steps: a user who mistyped their username and
/// retypes it expects a fresh answer, not their own typo played back from a
/// cache (see `SleeperService.user(username:)`).
@MainActor
public final class SettingsModel: ObservableObject {
    public enum Stage: Hashable, Sendable {
        case needsUsername
        case pickingLeague
        case pickingTeam
        case ready
        /// ESPN: no cookies saved, or ESPN rejected the saved ones.
        case needsESPNSignIn
        /// ESPN: signed in, waiting for a league id.
        case needsESPNLeague
    }

    @Published public private(set) var stage: Stage = .needsUsername
    @Published public var username: String = ""
    /// What the user pasted for their ESPN league: an id, or the league's URL.
    @Published public var espnLeagueText: String = ""
    @Published public private(set) var leagues: [SleeperLeague] = []
    @Published public private(set) var teams: [(rosterID: Int, manager: String)] = []
    @Published public private(set) var isWorking = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var relayError: String?
    @Published public private(set) var settings: AppSettings

    /// Whether a relay token is saved. The token itself never leaves the
    /// Keychain except in a request header to the relay.
    @Published public private(set) var hasRelayToken = false
    /// Whether ESPN cookies are saved. Like the relay token, they never leave
    /// the Keychain except in a request header — to ESPN only.
    @Published public private(set) var hasESPNCredentials = false
    /// "…ab12", for saying which account is signed in without showing the id.
    @Published public private(set) var espnAccountSuffix: String?

    private let sleeper: SleeperService
    private let store: AppSettingsStore
    private let secrets: SecretStore
    private let espnSecrets: SecretStore
    private let leagueSource: SwitchableLeagueSource?
    private let makeESPNSource: ((ESPNCredentials) -> ESPNLeagueService)?
    private var espnService: ESPNLeagueService?

    public init(
        sleeper: SleeperService,
        store: AppSettingsStore,
        secrets: SecretStore = KeychainSecretStore(),
        espnSecrets: SecretStore = KeychainSecretStore.espn,
        leagueSource: SwitchableLeagueSource? = nil,
        makeESPNSource: ((ESPNCredentials) -> ESPNLeagueService)? = nil
    ) {
        self.sleeper = sleeper
        self.store = store
        self.secrets = secrets
        self.espnSecrets = espnSecrets
        self.leagueSource = leagueSource
        self.makeESPNSource = makeESPNSource
        self.hasRelayToken = secrets.load() != nil
        let loaded = store.load()
        self.settings = loaded
        self.username = loaded.sleeperUsername ?? ""
        let credentials = ESPNCredentials.load(from: espnSecrets)
        self.hasESPNCredentials = credentials != nil
        self.espnAccountSuffix = credentials?.swidSuffix
        self.stage = Self.initialStage(settings: loaded, hasESPNCredentials: credentials != nil)
        applyLeagueSource()
    }

    static func initialStage(settings: AppSettings, hasESPNCredentials: Bool) -> Stage {
        switch settings.provider {
        case .sleeper:
            return settings.isConfigured ? .ready : .needsUsername
        case .espn:
            // Configured but signed out (a wiped Keychain, say) still needs a
            // sign-in; the screens keep working from cache until it happens.
            if !hasESPNCredentials { return .needsESPNSignIn }
            return settings.isConfigured ? .ready : .needsESPNLeague
        }
    }

    /// The league reads for setup, from whichever provider is current.
    private var source: any LeagueDataSource { leagueSource ?? sleeper }

    /// Points the shared league source at the right provider. Sleeper when
    /// ESPN is selected but not signed in — every read then fails plainly
    /// rather than with a cookie error.
    private func applyLeagueSource() {
        guard let leagueSource else { return }
        switch settings.provider {
        case .sleeper:
            espnService = nil
            leagueSource.use(sleeper)
        case .espn:
            if let credentials = ESPNCredentials.load(from: espnSecrets), let makeESPNSource {
                let service = makeESPNSource(credentials)
                espnService = service
                leagueSource.use(service)
            } else {
                espnService = nil
                leagueSource.use(sleeper)
            }
        }
    }

    // MARK: - Provider

    /// Switches platform. The league selection is cleared — an id from one
    /// platform means nothing on the other — but credentials for each are kept.
    public func setProvider(_ provider: LeagueProvider) {
        guard provider != settings.provider else { return }
        settings.provider = provider
        settings.leagueID = nil
        settings.rosterID = nil
        store.save(settings)
        leagues = []
        teams = []
        errorMessage = nil
        applyLeagueSource()
        stage = Self.initialStage(settings: settings, hasESPNCredentials: hasESPNCredentials)
    }

    // MARK: - Sleeper

    /// Looks up the user, then their leagues for the current season.
    public func lookUpUser() async {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter your Sleeper username."
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            let user = try await sleeper.user(username: trimmed)
            let season = try await currentSeason()
            let found = try await sleeper.leagues(userID: user.userID, season: season)

            settings.sleeperUsername = trimmed
            settings.userID = user.userID
            store.save(settings)

            leagues = found
            if found.isEmpty {
                // A real answer, not a failure — say which season was searched
                // rather than leaving them guessing.
                errorMessage = "No leagues found for \(trimmed) in \(season)."
                stage = .needsUsername
            } else {
                stage = .pickingLeague
            }
        } catch {
            errorMessage = Self.message(for: error, username: trimmed)
            stage = .needsUsername
        }
    }

    /// Picks a league and loads its rosters so the user can say which team is
    /// theirs. Sleeper's own user id usually identifies it, so the matching
    /// roster is offered first rather than making them hunt.
    public func selectLeague(_ league: SleeperLeague) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        settings.leagueID = league.leagueID
        store.save(settings)

        do {
            try await loadTeams(leagueID: league.leagueID)
        } catch {
            errorMessage = String(describing: error)
            stage = .pickingLeague
        }
    }

    /// Loads a league's rosters and managers, picks the user's team when the
    /// owner id says which it is, and otherwise asks.
    private func loadTeams(leagueID: String) async throws {
        let rosters = try await source.rosters(leagueID: leagueID, force: true)
        let members = try await source.members(leagueID: leagueID, force: true)
        let names = Dictionary(
            members.value.map { ($0.userID, $0.label) }, uniquingKeysWith: { first, _ in first }
        )

        teams = rosters.value
            .map { roster in
                (
                    rosterID: roster.rosterID,
                    manager: roster.ownerID.flatMap { names[$0] } ?? "Roster \(roster.rosterID)"
                )
            }
            .sorted { $0.rosterID < $1.rosterID }

        // If we can tell which roster is theirs, take it and skip a step.
        if let mine = rosters.value.first(where: { isUsersOwn(ownerID: $0.ownerID) }) {
            selectTeam(rosterID: mine.rosterID)
        } else {
            stage = .pickingTeam
        }
    }

    /// Sleeper rosters carry the user id; ESPN teams carry the SWID, which
    /// ESPN itself compares case-insensitively.
    private func isUsersOwn(ownerID: String?) -> Bool {
        guard let ownerID else { return false }
        switch settings.provider {
        case .sleeper:
            return ownerID == settings.userID
        case .espn:
            guard let swid = ESPNCredentials.load(from: espnSecrets)?.swid else { return false }
            return ownerID.caseInsensitiveCompare(swid) == .orderedSame
        }
    }

    public func selectTeam(rosterID: Int) {
        settings.rosterID = rosterID
        store.save(settings)
        stage = .ready
    }

    /// Clears the league selection but keeps the username — or the ESPN
    /// sign-in — which is what "switch league" means in practice.
    public func changeLeague() {
        settings.leagueID = nil
        settings.rosterID = nil
        store.save(settings)
        leagues = []
        teams = []
        stage = Self.initialStage(settings: settings, hasESPNCredentials: hasESPNCredentials)
    }

    // MARK: - ESPN

    /// Saves the cookies the sign-in sheet captured and moves on to the league.
    public func saveESPNCredentials(_ credentials: ESPNCredentials) {
        credentials.save(to: espnSecrets)
        hasESPNCredentials = true
        espnAccountSuffix = credentials.swidSuffix
        errorMessage = nil
        applyLeagueSource()
        stage = settings.isConfigured ? .ready : .needsESPNLeague
    }

    /// Forgets the cookies and every cached ESPN response. The league
    /// selection goes too: it cannot be loaded without them.
    public func signOutESPN() {
        ESPNCredentials.clear(from: espnSecrets)
        hasESPNCredentials = false
        espnAccountSuffix = nil
        let service = espnService
        Task { await service?.purgeCache() }
        settings.leagueID = nil
        settings.rosterID = nil
        store.save(settings)
        teams = []
        errorMessage = nil
        applyLeagueSource()
        stage = .needsESPNSignIn
    }

    /// Connects the league the user pasted — its id, or its URL on espn.com.
    public func connectESPNLeague() async {
        guard let leagueID = Self.parseESPNLeagueID(espnLeagueText) else {
            errorMessage = "Paste your league's id, or its address from espn.com."
            return
        }
        guard hasESPNCredentials else {
            stage = .needsESPNSignIn
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            // The league read doubles as the cookie check.
            _ = try await source.league(id: leagueID, force: true)
            settings.leagueID = leagueID
            store.save(settings)
            try await loadTeams(leagueID: leagueID)
        } catch DataLayerError.unauthorized {
            // Expired cookies, or a league this account isn't in. Either way
            // the fix starts with signing in again.
            errorMessage = "ESPN wouldn't show that league to this account. Sign in again, and check the league id."
            settings.leagueID = nil
            store.save(settings)
            stage = .needsESPNSignIn
        } catch {
            errorMessage = Self.espnMessage(for: error)
            settings.leagueID = nil
            store.save(settings)
            stage = .needsESPNLeague
        }
    }

    /// Accepts `123456`, or any espn.com address carrying `leagueId=123456`.
    static func parseESPNLeagueID(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.allSatisfy(\.isNumber) { return trimmed }
        guard let components = URLComponents(string: trimmed.contains("://") ? trimmed : "https://" + trimmed),
              let item = components.queryItems?.first(where: { $0.name.lowercased() == "leagueid" }),
              let value = item.value?.trimmingCharacters(in: .whitespaces), !value.isEmpty,
              value.allSatisfy(\.isNumber)
        else { return nil }
        return value
    }

    static func espnMessage(for error: Error) -> String {
        if case DataLayerError.httpStatus(let code, _) = error, code == 404 {
            return "ESPN has no league with that id this season."
        }
        return String(describing: error)
    }

    // MARK: - Relay

    /// Saves the relay token to the Keychain; an empty value removes it.
    public func setRelayToken(_ token: String) {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        secrets.save(trimmed.isEmpty ? nil : trimmed)
        hasRelayToken = secrets.load() != nil
    }

    public func setRelayURL(_ url: URL?) {
        settings.relayBaseURL = url
        store.save(settings)
    }

    /// Accepts what a person types — trims it, adds `https://` when no scheme
    /// was given — and rejects anything that isn't an http(s) address rather
    /// than saving a URL every request would fail against.
    @discardableResult
    public func setRelayURL(text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            setRelayURL(nil)
            relayError = nil
            return true
        }
        let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard let url = URL(string: candidate),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty
        else {
            relayError = "That isn't a web address the relay could be reached at."
            return false
        }
        if let problem = Self.relayHostProblem(host: host, scheme: scheme) {
            relayError = problem
            return false
        }
        relayError = nil
        setRelayURL(url)
        return true
    }

    /// The saved relay address, or `nil` when it can't be reached as written.
    static func usableRelay(_ url: URL) -> URL? {
        guard let host = url.host, let scheme = url.scheme?.lowercased() else { return nil }
        return relayHostProblem(host: host, scheme: scheme) == nil ? url : nil
    }

    /// Flags a saved relay address that can't work, for Settings to show.
    public func checkSavedRelay() {
        guard let url = settings.relayBaseURL, let host = url.host, let scheme = url.scheme?.lowercased() else { return }
        relayError = Self.relayHostProblem(host: host, scheme: scheme)
    }

    /// Why a relay host can't work, or `nil`. A numeric host must be a whole
    /// IPv4 address — "100.77.38" is a Tailscale address missing a number,
    /// which the system reads as a hostname and never reaches. Plain http is
    /// only allowed to IP addresses, `.local` names and bare hostnames; App
    /// Transport Security blocks it to anything else.
    static func relayHostProblem(host: String, scheme: String) -> String? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        let numeric = host.allSatisfy { $0.isNumber || $0 == "." }
        if numeric {
            let valid = parts.count == 4 && parts.allSatisfy { Int($0).map { (0...255).contains($0) } ?? false }
            return valid ? nil : "\(host) isn't a complete IP address — it needs four numbers, like 100.77.38.12."
        }
        if scheme == "http", !host.hasSuffix(".local"), host.contains("."), !host.contains(":") {
            return "Plain http only works to an IP address or a .local name. Use https:// for \(host) (Tailscale can serve https with `tailscale serve`)."
        }
        return nil
    }

    // MARK: - Other settings

    public func setAccentTheme(_ theme: AccentTheme) {
        settings.accentTheme = theme
        store.save(settings)
    }

    public func markPlanningIntroSeen() {
        settings.hasSeenPlanningIntro = true
        store.save(settings)
    }

    private func currentSeason() async throws -> Int {
        if let season = try? await sleeper.nflState().value.seasonYear { return season }
        return Calendar.current.component(.year, from: Date())
    }

    /// A 404 here means the username does not exist, which is worth saying
    /// plainly — it is by far the most common thing to go wrong in setup.
    static func message(for error: Error, username: String) -> String {
        if case DataLayerError.httpStatus(let code, _) = error, code == 404 {
            return "Sleeper has no user called \"\(username)\"."
        }
        return String(describing: error)
    }
}
