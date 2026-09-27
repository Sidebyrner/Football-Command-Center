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
    /// The accent colour picked in Settings.
    public var accentTheme: AccentTheme
    /// Which theme defaults the stored accent was chosen under. Version 1
    /// defaulted to amber; version 2 to indigo, freeing amber for caution.
    public var themeVersion: Int
    public static let currentThemeVersion = 2
    /// Whether the Planning explainer has been dismissed.
    public var hasSeenPlanningIntro: Bool
    /// The user's weights for the optional weighted grade on the Player Card,
    /// keyed by `WeightedGrade.gradeKey` and `SituationMetric` raw values.
    /// Absent keys use the defaults.
    public var gradeWeights: [String: Double]

    public init(
        sleeperUsername: String? = nil,
        userID: String? = nil,
        leagueID: String? = nil,
        rosterID: Int? = nil,
        relayBaseURL: URL? = nil,
        accentTheme: AccentTheme = .default,
        themeVersion: Int = AppSettings.currentThemeVersion,
        hasSeenPlanningIntro: Bool = false,
        gradeWeights: [String: Double] = [:]
    ) {
        self.sleeperUsername = sleeperUsername
        self.userID = userID
        self.leagueID = leagueID
        self.rosterID = rosterID
        self.relayBaseURL = relayBaseURL
        self.accentTheme = accentTheme
        self.themeVersion = themeVersion
        self.hasSeenPlanningIntro = hasSeenPlanningIntro
        self.gradeWeights = gradeWeights
    }

    enum CodingKeys: String, CodingKey {
        case sleeperUsername, userID, leagueID, rosterID, relayBaseURL
        case accentTheme, themeVersion, hasSeenPlanningIntro, gradeWeights
    }

    /// Settings saved by an older version lack the newer fields, and a theme
    /// saved by a newer version may not exist in this one. Both must decode to
    /// sensible defaults — a synthesised decoder would throw, and a thrown
    /// decode here silently resets the user's league selection.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sleeperUsername = try container.decodeIfPresent(String.self, forKey: .sleeperUsername)
        userID = try container.decodeIfPresent(String.self, forKey: .userID)
        leagueID = try container.decodeIfPresent(String.self, forKey: .leagueID)
        rosterID = try container.decodeIfPresent(Int.self, forKey: .rosterID)
        relayBaseURL = try container.decodeIfPresent(URL.self, forKey: .relayBaseURL)
        let storedTheme = AccentTheme(stored: try? container.decodeIfPresent(String.self, forKey: .accentTheme))
        let storedVersion = (try? container.decodeIfPresent(Int.self, forKey: .themeVersion)) ?? 1
        // Amber saved under version 1 was the old default, not a choice: move
        // it to the new one, once. Amber picked after that stays amber.
        accentTheme = storedVersion < 2 && storedTheme == .amber ? .default : storedTheme
        themeVersion = AppSettings.currentThemeVersion
        hasSeenPlanningIntro = (try? container.decodeIfPresent(Bool.self, forKey: .hasSeenPlanningIntro)) ?? false
        gradeWeights = (try? container.decodeIfPresent([String: Double].self, forKey: .gradeWeights)) ?? [:]
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
