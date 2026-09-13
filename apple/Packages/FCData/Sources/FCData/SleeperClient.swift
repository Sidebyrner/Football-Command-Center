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

    private let baseURL: URL
    private let transport: HTTPTransport
    private let retries: Int

    public init(
        baseURL: URL = SleeperClient.defaultBaseURL,
        transport: HTTPTransport = URLSessionTransport(),
        retries: Int = 1
    ) {
        self.baseURL = baseURL
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

    private func send(path: String) async throws -> HTTPResponse {
        guard let url = URL(string: baseURL.absoluteString + path) else {
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
