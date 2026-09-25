import Foundation

/// One aggregated news item, as the relay's RSS parser emits it.
public struct NewsItem: Decodable, Hashable, Sendable {
    public let title: String
    public let body: String?
    public let url: String?
    public let publishedAt: String?
    public let sourceId: String?
}

/// `GET /api/news` response.
public struct NewsFeed: Decodable, Hashable, Sendable {
    public let feed: String?
    public let items: [NewsItem]
    /// Whether the relay served this from its own cache.
    public let cached: Bool?
}

/// The optional Fastify relay: news, live odds, AI briefs, plan storage.
///
/// **Everything here is enrichment and every call fails soft** (§0, §3.3). No
/// v1 feature may depend on the relay being reachable, so the read methods
/// return `nil` on any failure rather than throwing — the caller's job is to
/// render without it, not to handle an error. The one exception is
/// `probe()`, whose entire purpose is to report reachability.
public struct RelayClient: Sendable {
    public let baseURL: URL
    private let transport: HTTPTransport

    public init(baseURL: URL, transport: HTTPTransport = URLSessionTransport(timeout: 5)) {
        self.baseURL = baseURL
        self.transport = transport
    }

    /// Whether the relay is reachable. Used to decide whether to *offer*
    /// relay-backed features at all, so the UI can hide them rather than
    /// showing something that will fail when tapped.
    public func probe() async -> Bool {
        guard let response = try? await send("health") else { return false }
        return response.isOK
    }

    /// Aggregated RSS. `nil` means the relay could not be reached or answered
    /// with something unusable — in both cases the news section simply does not
    /// render.
    public func news(feed: String) async -> NewsFeed? {
        await softGet(NewsFeed.self, path: "api/news", query: [URLQueryItem(name: "feed", value: feed)])
    }

    /// Live odds. The relay needs a paid Odds API key, so a `nil` here is
    /// routine rather than exceptional — and the fallback is the **recorded**
    /// closing lines already in `schedule-{season}.json`, which must be
    /// labelled as recorded so they are never mistaken for live (§3.2).
    public func odds<Value: Decodable & Sendable>(_ type: Value.Type) async -> Value? {
        await softGet(type, path: "api/odds")
    }

    /// Player props for one event. Same fail-soft contract as `odds`.
    public func props<Value: Decodable & Sendable>(
        _ type: Value.Type,
        eventID: String
    ) async -> Value? {
        let escaped = eventID.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? eventID
        return await softGet(type, path: "api/odds/\(escaped)/props")
    }

    /// Escape hatch for the remaining relay routes (AI briefs, plan storage)
    /// whose payloads FCApp models when it builds those screens. Keeps the same
    /// fail-soft contract rather than letting a caller reintroduce a hard
    /// dependency by hand.
    public func get<Value: Decodable & Sendable>(
        _ type: Value.Type,
        path: String,
        query: [URLQueryItem] = []
    ) async -> Value? {
        await softGet(type, path: path, query: query)
    }

    private func softGet<Value: Decodable & Sendable>(
        _ type: Value.Type,
        path: String,
        query: [URLQueryItem] = []
    ) async -> Value? {
        guard let response = try? await send(path, query: query), response.isOK else { return nil }
        return try? JSONDecoder().decode(type, from: response.body)
    }

    private func send(
        _ path: String,
        query: [URLQueryItem] = [],
        method: String = "GET",
        body: Data? = nil,
        token: String? = nil
    ) async throws -> HTTPResponse {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw DataLayerError.badURL(path) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return try await transport.send(request)
    }

    // MARK: - AI

    public struct TradePitchRequest: Encodable, Sendable {
        /// The deal's facts, one per line. The model may only rephrase these.
        public let facts: [String]
        /// The template pitch, so the model polishes rather than starts over.
        public let draft: String

        public init(facts: [String], draft: String) {
            self.facts = facts
            self.draft = draft
        }
    }

    private struct TradePitchResponse: Decodable { let pitch: String }

    /// Why a pitch could not be polished — each needs a different fix.
    public enum PolishFailure: Error, Hashable, Sendable {
        /// The relay refused the token (401/403): fix it in Settings.
        case unauthorized
        /// No answer — offline, the relay is down, or the model timed out.
        case unreachable
        /// The relay answered with an error status.
        case server(status: Int)
        /// It answered, but with nothing usable.
        case emptyResponse
    }

    /// Rewrites a trade pitch on the relay's local model, saying why when it
    /// can't. The template pitch is always there to fall back on.
    public func polishTradePitchResult(_ request: TradePitchRequest, token: String?) async -> Result<String, PolishFailure> {
        guard let body = try? JSONEncoder().encode(request) else { return .failure(.emptyResponse) }
        let response: HTTPResponse
        do {
            response = try await send("api/ai/trade-pitch", method: "POST", body: body, token: token)
        } catch {
            return .failure(.unreachable)
        }
        if response.status == 401 || response.status == 403 { return .failure(.unauthorized) }
        guard response.isOK else { return .failure(.server(status: response.status)) }
        guard let decoded = try? JSONDecoder().decode(TradePitchResponse.self, from: response.body) else {
            return .failure(.emptyResponse)
        }
        let trimmed = decoded.pitch.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? .failure(.emptyResponse) : .success(trimmed)
    }

    /// Rewrites a trade pitch on the relay's local model. `nil` on any failure —
    /// the template pitch is always there to fall back on.
    public func polishTradePitch(_ request: TradePitchRequest, token: String?) async -> String? {
        try? await polishTradePitchResult(request, token: token).get()
    }
}
