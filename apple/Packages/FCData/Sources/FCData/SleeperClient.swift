import Foundation
import FCCore

/// Direct client for `api.sleeper.app`. Public, unofficial, no key, no auth.
///
/// One retry and a short timeout, carried over from the web client: this is a
/// personal tool polling during a live week, not a general-purpose client that
/// needs backoff tuning, and a hung request during a lineup decision is worse
/// than a failed one because at least a failure can be retried.
public struct SleeperClient: Sendable {
    public static let defaultBaseURL = URL(string: "https://api.sleeper.app/v1")!
    /// The undocumented projection, stats and news routes live one level up,
    /// with no `/v1`. Same host, same no-key access, no promise of stability —
    /// which is why every caller of these fails soft and labels the source.
    public static let defaultInsightsBaseURL = URL(string: "https://api.sleeper.app")!

    private let baseURL: URL
    private let insightsBaseURL: URL
    private let transport: HTTPTransport
    private let retries: Int

    public init(
        baseURL: URL = SleeperClient.defaultBaseURL,
        insightsBaseURL: URL? = nil,
        transport: HTTPTransport = URLSessionTransport(),
        retries: Int = 1
    ) {
        self.baseURL = baseURL
        // Tests point both at one stub host; the app leaves the default.
        self.insightsBaseURL = insightsBaseURL
            ?? (baseURL == SleeperClient.defaultBaseURL ? SleeperClient.defaultInsightsBaseURL : baseURL)
        self.transport = transport
        self.retries = retries
    }

    // MARK: - Endpoints

    /// The authoritative current week and season.
    public func nflState() async throws -> NFLState {
        try await get("/state/nfl")
    }

    public func user(username: String) async throws -> SleeperUser {
        try await get("/user/\(escaped(username))")
    }

    public func leagues(userID: String, season: Int) async throws -> [SleeperLeague] {
        try await get("/user/\(escaped(userID))/leagues/nfl/\(season)")
    }

    public func league(id: String) async throws -> SleeperLeague {
        try await get("/league/\(escaped(id))")
    }

    public func rosters(leagueID: String) async throws -> [SleeperRoster] {
        try await get("/league/\(escaped(leagueID))/rosters")
    }

    public func members(leagueID: String) async throws -> [SleeperLeagueMember] {
        try await get("/league/\(escaped(leagueID))/users")
    }

    public func matchups(leagueID: String, week: Int) async throws -> [SleeperMatchup] {
        try await get("/league/\(escaped(leagueID))/matchups/\(week)")
    }

    public func transactions(leagueID: String, week: Int) async throws -> [SleeperTransaction] {
        try await get("/league/\(escaped(leagueID))/transactions/\(week)")
    }

    public func drafts(leagueID: String) async throws -> [SleeperDraft] {
        try await get("/league/\(escaped(leagueID))/drafts")
    }

    public func draftPicks(draftID: String) async throws -> [SleeperDraftPick] {
        try await get("/draft/\(escaped(draftID))/picks")
    }

    public func trendingAdds(limit: Int = 25) async throws -> [TrendingPlayer] {
        try await get("/players/nfl/trending/add?limit=\(limit)")
    }

    public func trendingDrops(limit: Int = 25) async throws -> [TrendingPlayer] {
        try await get("/players/nfl/trending/drop?limit=\(limit)")
    }

    /// The ~5 MB player payload, returned already trimmed.
    ///
    /// Deliberately never hands back the raw bytes: the whole point of §3.1 is
    /// that the raw payload must not be stored, and the easiest way to make
    /// that true is to give callers no way to hold it.
    public func playerIndex(now: Date = Date()) async throws -> PlayerIndex {
        let response = try await send(path: "/players/nfl")
        return try PlayerIndex.build(fromSleeperPayload: response.body, now: now)
    }

    // MARK: - Insights (undocumented routes)

    /// Every position's projected stat lines for one week. Sleeper filters by
    /// repeated `position[]` parameters; asking for none returns nothing useful,
    /// so the default is every position the app rosters.
    public func projections(
        season: Int,
        week: Int,
        positions: [Position] = Position.allCases
    ) async throws -> [SleeperProjection] {
        try await getInsights(
            "/projections/nfl/\(season)/\(week)?season_type=regular\(positionQuery(positions))&order_by=pts_std"
        )
    }

    /// One player's projections for a season, keyed by week.
    public func playerProjections(playerID: String, season: Int) async throws -> [Int: SleeperProjection] {
        let keyed: [String: SleeperProjection?] = try await getInsights(
            "/projections/nfl/player/\(escaped(playerID))?season_type=regular&season=\(season)&grouping=week"
        )
        var out: [Int: SleeperProjection] = [:]
        for (key, value) in keyed {
            if let week = Int(key), let value { out[week] = value }
        }
        return out
    }

    /// Every position's actual stat lines for one week — including DEF and IDP,
    /// which the nflverse weekly file does not carry.
    public func weekStats(
        season: Int,
        week: Int,
        positions: [Position] = Position.allCases
    ) async throws -> [SleeperWeekStat] {
        try await getInsights(
            "/stats/nfl/\(season)/\(week)?season_type=regular\(positionQuery(positions))&order_by=pts_std"
        )
    }

    /// Recent news items for one player.
    public func playerNews(playerID: String, limit: Int = 5) async throws -> [SleeperPlayerNews] {
        try await getInsights("/players/nfl/\(escaped(playerID))/news?limit=\(limit)")
    }

    private func positionQuery(_ positions: [Position]) -> String {
        // Percent-encoded brackets: `URL(string:)` rejects a literal `[` on some
        // platforms, and Sleeper reads `position%5B%5D` identically.
        positions.map { "&position%5B%5D=\($0.rawValue)" }.joined()
    }

    private func getInsights<Value: Decodable>(_ path: String) async throws -> Value {
        let response = try await send(path: path, base: insightsBaseURL)
        do {
            return try JSONDecoder().decode(Value.self, from: response.body)
        } catch {
            throw DataLayerError.undecodable(path: path, underlying: String(describing: error))
        }
    }

    // MARK: - Plumbing

    private func escaped(_ component: String) -> String {
        component.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? component
    }

    private func get<Value: Decodable>(_ path: String) async throws -> Value {
        let response = try await send(path: path)
        do {
            return try JSONDecoder().decode(Value.self, from: response.body)
        } catch {
            throw DataLayerError.undecodable(path: path, underlying: String(describing: error))
        }
    }

    private func send(path: String, base: URL? = nil) async throws -> HTTPResponse {
        guard let url = URL(string: (base ?? baseURL).absoluteString + path) else {
            throw DataLayerError.badURL(path)
        }
        var lastError: Error = DataLayerError.badURL(path)
        for attempt in 0...max(0, retries) {
            do {
                let response = try await transport.send(URLRequest(url: url))
                guard response.isOK else {
                    throw DataLayerError.httpStatus(response.status, path: path)
                }
                return response
            } catch {
                lastError = error
                // A 404 on a username the user typed is an answer, not a blip.
                // Retrying it just doubles the wait before telling them.
                if case DataLayerError.httpStatus(let code, _) = error, (400..<500).contains(code) {
                    throw error
                }
                if attempt >= retries { throw error }
            }
        }
        throw lastError
    }
}
