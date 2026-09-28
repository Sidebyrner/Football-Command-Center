import Foundation

/// Direct client for ESPN's fantasy football API. Unofficial, undocumented,
/// read-only — and the one place in the app that ever holds ESPN cookies.
///
/// The cookies go out as a `Cookie` header on each request to the fantasy host
/// and nowhere else: the transport's session is ephemeral, so nothing is
/// persisted or replayed to another host by `URLSession`. Every response is
/// decoded leniently, because ESPN changes this payload without notice and a
/// missing field must degrade one number, not the whole league.
public struct ESPNClient: Sendable {
    public static let defaultBaseURL = URL(string: "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl")!

    private let baseURL: URL
    private let transport: HTTPTransport
    private let credentials: ESPNCredentials?
    private let retries: Int

    public init(
        credentials: ESPNCredentials?,
        baseURL: URL = ESPNClient.defaultBaseURL,
        transport: HTTPTransport = URLSessionTransport(),
        retries: Int = 1
    ) {
        self.credentials = credentials
        self.baseURL = baseURL
        self.transport = transport
        self.retries = retries
    }

    public var isSignedIn: Bool { credentials != nil }

    // MARK: - Endpoints

    /// Settings, members and teams — enough for the league's rules, its
    /// managers and their records. Also the cheapest way to learn whether the
    /// saved cookies still work.
    public func league(id: String, season: Int) async throws -> ESPNLeague {
        try await get(id: id, season: season, query: "view=mSettings&view=mTeam")
    }

    /// Every team with its full roster.
    public func rosters(id: String, season: Int) async throws -> ESPNLeague {
        try await get(id: id, season: season, query: "view=mRoster&view=mTeam")
    }

    /// One week's matchups with each side's lineup and per-player points.
    public func matchups(id: String, season: Int, week: Int) async throws -> ESPNLeague {
        try await get(
            id: id, season: season,
            query: "view=mMatchupScore&view=mBoxscore&view=mTeam&scoringPeriodId=\(week)"
        )
    }

    // MARK: - Plumbing

    private func get(id: String, season: Int, query: String) async throws -> ESPNLeague {
        let escaped = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        let path = "/seasons/\(season)/segments/0/leagues/\(escaped)?\(query)"
        let response = try await send(path: path)
        do {
            return try JSONDecoder().decode(ESPNLeague.self, from: response.body)
        } catch {
            throw DataLayerError.undecodable(path: path, underlying: String(describing: error))
        }
    }

    private func send(path: String) async throws -> HTTPResponse {
        guard let url = URL(string: baseURL.absoluteString + path) else {
            throw DataLayerError.badURL(path)
        }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let credentials {
            request.setValue(credentials.cookieHeader, forHTTPHeaderField: "Cookie")
        }

        var lastError: Error = DataLayerError.badURL(path)
        for attempt in 0...max(0, retries) {
            do {
                let response = try await transport.send(request)
                if response.status == 401 || response.status == 403 {
                    // Report the path only — never the request, whose Cookie
                    // header is the secret.
                    throw DataLayerError.unauthorized(path: url.path)
                }
                guard response.isOK else {
                    throw DataLayerError.httpStatus(response.status, path: url.path)
                }
                return response
            } catch {
                lastError = error
                if case DataLayerError.unauthorized = error { throw error }
                if case DataLayerError.httpStatus(let code, _) = error, (400..<500).contains(code) {
                    throw error
                }
                if attempt >= retries { throw error }
            }
        }
        throw lastError
    }
}
