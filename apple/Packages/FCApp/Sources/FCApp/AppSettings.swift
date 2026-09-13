import Foundation

/// What the app remembers between launches: which league, and whose team.
///
/// Small, scalar and user-chosen, so `UserDefaults` is the right home — the
/// prohibition in §3.1 is about the 5 MB player payload, not about a league id.
public struct AppSettings: Codable, Hashable, Sendable {
    public var sleeperUsername: String?
    public var userID: String?
    public var leagueID: String?
    /// The roster the user actually manages, which is what "my team" means on
    /// every screen.
    public var rosterID: Int?
    /// Base URL for the optional relay. Absent means the enrichment features
    /// simply don't appear — no v1 feature depends on it (§0).
    public var relayBaseURL: URL?

    public init(
        sleeperUsername: String? = nil,
        userID: String? = nil,
        leagueID: String? = nil,
        rosterID: Int? = nil,
        relayBaseURL: URL? = nil
    ) {
        self.sleeperUsername = sleeperUsername
        self.userID = userID
        self.leagueID = leagueID
        self.rosterID = rosterID
        self.relayBaseURL = relayBaseURL
    }

    /// Whether there is enough here to load a league. Until this is true the
    /// app shows Settings and nothing else.
    public var isConfigured: Bool {
        leagueID != nil && rosterID != nil
    }
}

/// Persistence for `AppSettings`.
public protocol AppSettingsStore: Sendable {
    func load() -> AppSettings
    func save(_ settings: AppSettings)
}

/// `@unchecked` because `UserDefaults` is documented as thread-safe but is not
/// itself marked `Sendable`.
public struct UserDefaultsSettingsStore: AppSettingsStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String

    public init(defaults: UserDefaults = .standard, key: String = "fcc.settings.v1") {
        self.defaults = defaults
        self.key = key
    }

    public func load() -> AppSettings {
        guard let data = defaults.data(forKey: key),
              let settings = try? JSONDecoder().decode(AppSettings.self, from: data)
        else { return AppSettings() }
        return settings
    }

    public func save(_ settings: AppSettings) {
        guard let data = try? JSONEncoder().encode(settings) else { return }
        defaults.set(data, forKey: key)
    }
}

/// In-memory store, for tests and previews.
public final class InMemorySettingsStore: AppSettingsStore, @unchecked Sendable {
    private let lock = NSLock()
    private var settings: AppSettings

    public init(_ settings: AppSettings = AppSettings()) {
        self.settings = settings
    }

    public func load() -> AppSettings {
        lock.lock()
        defer { lock.unlock() }
        return settings
    }

    public func save(_ settings: AppSettings) {
        lock.lock()
        defer { lock.unlock() }
        self.settings = settings
    }
}
