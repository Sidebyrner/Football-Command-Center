import Foundation
import FCCore

/// The cache-through layer over `SleeperClient`.
///
/// Every read follows the same rule: a fresh cache entry wins, then the
/// network, and if the network fails an **expired** entry is served rather than
/// an error — labelled, via `Fetched.Provenance`, so the UI can say it is old.
/// That ordering is what makes the app usable on a phone with no signal (§8.1).
public actor SleeperService {
    private let client: SleeperClient
    private let cache: DiskCache

    public init(client: SleeperClient = SleeperClient(), cache: DiskCache = DiskCache()) {
        self.client = client
        self.cache = cache
    }

    // MARK: - Cache keys

    private enum Key {
        static let nflState = "sleeper-nfl-state-v1"
        static let players = "sleeper-players-v1"
        static let trendingAdds = "sleeper-trending-adds-v1"
        static let trendingDrops = "sleeper-trending-drops-v1"
        static func league(_ id: String) -> String { "sleeper-league-\(id)" }
        static func rosters(_ id: String) -> String { "sleeper-rosters-\(id)" }
        static func members(_ id: String) -> String { "sleeper-users-\(id)" }
        static func matchups(_ id: String, _ week: Int) -> String { "sleeper-matchups-\(id)-\(week)" }
        static func transactions(_ id: String, _ week: Int) -> String {
            "sleeper-transactions-\(id)-\(week)"
        }
        static func drafts(_ id: String) -> String { "sleeper-drafts-\(id)" }
        static func draftPicks(_ id: String) -> String { "sleeper-picks-\(id)" }
    }

    /// The one read path. Everything public below is this with a key and a TTL.
    private func through<Value: Codable & Sendable>(
        key: String,
        ttl: TimeInterval,
        force: Bool = false,
        fetch: () async throws -> Value
    ) async throws -> Fetched<Value> {
        if !force, let hit = await cache.load(Value.self, key: key) {
            return Fetched(value: hit.value, provenance: .cached(age: hit.age))
        }
        do {
            let fresh = try await fetch()
            // A cache write failure must not fail the fetch — we have the data.
            // It is still worth not pretending it succeeded, hence `try?` here
            // rather than silence inside DiskCache.
            try? await cache.store(fresh, key: key, ttl: ttl)
            return Fetched(value: fresh, provenance: .live)
        } catch {
            if let stale = await cache.load(Value.self, key: key, allowingStale: true) {
                return Fetched(
                    value: stale.value,
                    provenance: .staleCache(age: stale.age, failure: String(describing: error))
                )
            }
            throw error
        }
    }

    // MARK: - League context

    /// The authoritative current week. Cached briefly so a screen refresh
    /// doesn't re-ask, but never long enough to miss a week rollover.
    public func nflState(force: Bool = false) async throws -> Fetched<NFLState> {
        try await through(key: Key.nflState, ttl: CacheTTL.trending, force: force) {
            try await client.nflState()
        }
    }

    /// Not cached: this runs once during setup, and a user retyping their
    /// username after a typo expects a fresh answer.
    public func user(username: String) async throws -> SleeperUser {
        try await client.user(username: username)
    }

    /// Also uncached, for the same reason — it is a setup-time list.
    public func leagues(userID: String, season: Int) async throws -> [SleeperLeague] {
        try await client.leagues(userID: userID, season: season)
    }

    public func league(id: String, force: Bool = false) async throws -> Fetched<SleeperLeague> {
        try await through(key: Key.league(id), ttl: CacheTTL.roster, force: force) {
            try await client.league(id: id)
        }
    }

    /// The league's scoring as an FCCore profile, read live rather than
    /// hardcoded so a mid-season settings change is picked up (§1, §12).
    ///
    /// Returns the whole translation, not just the profile, because
    /// `unmapped` is a real answer the UI owes the user: rules Sleeper sent
    /// that this app does not model must be visible, not silently dropped.
    public func scoringTranslation(
        leagueID: String,
        force: Bool = false
    ) async throws -> Fetched<SleeperScoringTranslation> {
        let league = try await league(id: leagueID, force: force)
        return league.map { league in
            ScoringProfile.fromSleeper(
                scoringSettings: league.scoringSettings ?? [:],
                leagueName: league.name ?? "League"
            )
        }
    }

    /// The league's starting-slot template, parsed from its own
    /// `roster_positions` rather than assumed (§12).
    public func slotTemplate(
        leagueID: String,
        force: Bool = false
    ) async throws -> Fetched<SlotTemplate> {
        try await league(id: leagueID, force: force).map(\.slotTemplate)
    }

    public func rosters(leagueID: String, force: Bool = false) async throws -> Fetched<[SleeperRoster]> {
        try await through(key: Key.rosters(leagueID), ttl: CacheTTL.roster, force: force) {
            try await client.rosters(leagueID: leagueID)
        }
    }

    public func members(
        leagueID: String,
        force: Bool = false
    ) async throws -> Fetched<[SleeperLeagueMember]> {
        try await through(key: Key.members(leagueID), ttl: CacheTTL.roster, force: force) {
            try await client.members(leagueID: leagueID)
        }
    }

    /// The live variant, on the short roster TTL.
    public func matchups(
        leagueID: String,
        week: Int,
        force: Bool = false
    ) async throws -> Fetched<[SleeperMatchup]> {
        try await through(key: Key.matchups(leagueID, week), ttl: CacheTTL.roster, force: force) {
            try await client.matchups(leagueID: leagueID, week: week)
        }
    }

    /// A finished week's scores never change again, so the 5-minute TTL is
    /// simply wrong for them — season aggregates would re-fetch every past week
    /// every five minutes. Same key as the live variant, so a week already
    /// fetched live is reused rather than re-requested.
    public func completedMatchups(
        leagueID: String,
        week: Int
    ) async throws -> Fetched<[SleeperMatchup]> {
        try await through(key: Key.matchups(leagueID, week), ttl: CacheTTL.completedWeek) {
            try await client.matchups(leagueID: leagueID, week: week)
        }
    }

    public func transactions(
        leagueID: String,
        week: Int,
        force: Bool = false
    ) async throws -> Fetched<[SleeperTransaction]> {
        try await through(key: Key.transactions(leagueID, week), ttl: CacheTTL.roster, force: force) {
            try await client.transactions(leagueID: leagueID, week: week)
        }
    }

    // MARK: - Drafts

    /// A completed draft never changes, so both of these are cached long. The
    /// live-draft polling the web app does is out of scope for v1.
    public func drafts(leagueID: String, force: Bool = false) async throws -> Fetched<[SleeperDraft]> {
        try await through(key: Key.drafts(leagueID), ttl: CacheTTL.roster, force: force) {
            try await client.drafts(leagueID: leagueID)
        }
    }

    public func draftPicks(draftID: String) async throws -> Fetched<[SleeperDraftPick]> {
        try await through(key: Key.draftPicks(draftID), ttl: CacheTTL.completedWeek) {
            try await client.draftPicks(draftID: draftID)
        }
    }

    // MARK: - Player pool

    /// The trimmed player index. 24-hour TTL because Sleeper asks that the
    /// 5 MB source be fetched at most once daily (§3.1).
    ///
    /// - Parameter maxAge: re-download once the cached copy is older than this,
    ///   even inside its TTL. Injury tags live in this file, so on game days the
    ///   caller asks for a younger copy. FCData knows nothing about schedules —
    ///   the decision of when is the caller's.
    public func playerIndex(force: Bool = false, maxAge: TimeInterval = CacheTTL.players) async throws -> Fetched<PlayerIndex> {
        let tooOld: Bool
        if force {
            tooOld = true
        } else if let hit = await cache.load(PlayerIndex.self, key: Key.players) {
            tooOld = hit.age >= maxAge
        } else {
            tooOld = false
        }
        return try await through(key: Key.players, ttl: CacheTTL.players, force: tooOld) {
            try await client.playerIndex()
        }
    }

    // MARK: - Trending

    /// League-wide add counts. This is the **only** signal covering DEF and
    /// IDP, and anything built on it must be labelled popularity rather than
    /// production (§3.2).
    public func trendingAdds(force: Bool = false) async throws -> Fetched<[TrendingPlayer]> {
        try await through(key: Key.trendingAdds, ttl: CacheTTL.trending, force: force) {
            try await client.trendingAdds()
        }
    }

    public func trendingDrops(force: Bool = false) async throws -> Fetched<[TrendingPlayer]> {
        try await through(key: Key.trendingDrops, ttl: CacheTTL.trending, force: force) {
            try await client.trendingDrops()
        }
    }
}
