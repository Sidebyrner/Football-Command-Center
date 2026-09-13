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
    private let baseURL: URL
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

    private func send(_ path: String, query: [URLQueryItem] = []) async throws -> HTTPResponse {
        var components = URLComponents(
            url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false
        )
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw DataLayerError.badURL(path) }
        return try await transport.send(URLRequest(url: url))
    }
}
