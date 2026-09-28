import Foundation
import FCCore

/// The cache-through layer over `ESPNClient`, answering in Sleeper's shapes.
///
/// Same rule as `SleeperService`: fresh cache, then network, then an expired
/// entry labelled as such. Keys are namespaced `espn-` so signing out can
/// remove exactly this provider's data and nothing else.
///
/// Translating a roster needs the player pool and the id crosswalk, which
/// live behind other services; they are injected as closures so this actor
/// stays lazy and testable with fixtures.
public actor ESPNLeagueService: LeagueDataSource {
    public typealias SeasonProvider = @Sendable () async throws -> Int
    public typealias PlayerIndexProvider = @Sendable () async throws -> PlayerIndex?
    public typealias CrosswalkProvider = @Sendable () async throws -> PlayerIDCrosswalk?

    private let client: ESPNClient
    private let cache: DiskCache
    private let season: SeasonProvider
    private let playerIndex: PlayerIndexProvider
    private let crosswalk: CrosswalkProvider
    private let bundledCrosswalk: CrosswalkProvider
    private var mapper: ESPNPlayerIDMapper?

    public init(
        client: ESPNClient,
        cache: DiskCache = DiskCache(),
        season: @escaping SeasonProvider,
        playerIndex: @escaping PlayerIndexProvider,
        crosswalk: @escaping CrosswalkProvider,
        bundledCrosswalk: @escaping CrosswalkProvider = { nil }
    ) {
        self.client = client
        self.cache = cache
        self.season = season
        self.playerIndex = playerIndex
        self.crosswalk = crosswalk
        self.bundledCrosswalk = bundledCrosswalk
    }

    static let keyPrefix = "espn-"

    private enum Key {
        static func league(_ id: String) -> String { "\(keyPrefix)league-\(id)-v1" }
        static func rosters(_ id: String) -> String { "\(keyPrefix)rosters-\(id)-v1" }
        static func members(_ id: String) -> String { "\(keyPrefix)members-\(id)-v1" }
        static func matchups(_ id: String, _ week: Int) -> String { "\(keyPrefix)matchups-\(id)-\(week)-v1" }
    }

    /// Built once per service; the pool and crosswalk change daily at most and
    /// a signed-out service is rebuilt anyway.
    private func playerMapper() async -> ESPNPlayerIDMapper {
        if let mapper { return mapper }
        let crosswalk = try? await crosswalk()
        let players = try? await playerIndex()
        let bundled = try? await bundledCrosswalk()
        let built = ESPNPlayerIDMapper(crosswalk: crosswalk, players: players, bundledCrosswalk: bundled)
        // A mapper built while every source was unreachable would map nothing;
        // keep trying rather than caching the failure for the session.
        if crosswalk != nil || players != nil || bundled != nil { mapper = built }
        return built
    }

    // MARK: - LeagueDataSource

    public func league(id: String, force: Bool = false) async throws -> Fetched<SleeperLeague> {
        try await cache.through(key: Key.league(id), ttl: CacheTTL.roster, force: force) {
            let raw = try await client.league(id: id, season: try await season())
            return ESPNTranslator.league(raw, id: id)
        }
    }

    public func rosters(leagueID: String, force: Bool = false) async throws -> Fetched<[SleeperRoster]> {
        try await cache.through(key: Key.rosters(leagueID), ttl: CacheTTL.roster, force: force) {
            let raw = try await client.rosters(id: leagueID, season: try await season())
            return ESPNTranslator.rosters(raw, leagueID: leagueID, mapper: await playerMapper())
        }
    }

    public func members(leagueID: String, force: Bool = false) async throws -> Fetched<[SleeperLeagueMember]> {
        try await cache.through(key: Key.members(leagueID), ttl: CacheTTL.roster, force: force) {
            let raw = try await client.league(id: leagueID, season: try await season())
            return ESPNTranslator.members(raw)
        }
    }

    public func matchups(leagueID: String, week: Int, force: Bool = false) async throws -> Fetched<[SleeperMatchup]> {
        try await cache.through(key: Key.matchups(leagueID, week), ttl: CacheTTL.roster, force: force) {
            try await fetchMatchups(leagueID: leagueID, week: week)
        }
    }

    public func completedMatchups(leagueID: String, week: Int) async throws -> Fetched<[SleeperMatchup]> {
        try await cache.through(key: Key.matchups(leagueID, week), ttl: CacheTTL.completedWeek) {
            try await fetchMatchups(leagueID: leagueID, week: week)
        }
    }

    private func fetchMatchups(leagueID: String, week: Int) async throws -> [SleeperMatchup] {
        let raw = try await client.matchups(id: leagueID, season: try await season(), week: week)
        return ESPNTranslator.matchups(raw, week: week, mapper: await playerMapper())
    }

    // Not translated yet. Every caller treats an empty answer as "nothing to
    // show", which is true for now and better than a section of wrong data.

    public func transactions(leagueID: String, week: Int, force: Bool = false) async throws -> Fetched<[SleeperTransaction]> {
        Fetched(value: [], provenance: .live)
    }

    public func drafts(leagueID: String, force: Bool = false) async throws -> Fetched<[SleeperDraft]> {
        Fetched(value: [], provenance: .live)
    }

    public func draftPicks(draftID: String) async throws -> Fetched<[SleeperDraftPick]> {
        Fetched(value: [], provenance: .live)
    }

    // MARK: - Sign-out

    /// Removes every cached ESPN response. A private league's rosters are the
    /// user's to take with them when they sign out.
    public func purgeCache() async {
        await cache.removeAll(keyPrefix: ESPNLeagueService.keyPrefix)
    }
}
