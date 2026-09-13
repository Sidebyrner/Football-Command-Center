import Foundation
import FCCore

/// One of the preprocessed nflverse-derived files (§3.2).
public struct StaticResource: Hashable, Sendable {
    /// Filename as shipped in the app bundle.
    public let bundledName: String
    /// Path under the remote base URL.
    public let remotePath: String
    /// Cache key, also used in error messages, so a failure names the file.
    public let identifier: String

    public init(bundledName: String, remotePath: String, identifier: String) {
        self.bundledName = bundledName
        self.remotePath = remotePath
        self.identifier = identifier
    }

    public static func weekly(season: Int) -> StaticResource {
        StaticResource(
            bundledName: "weekly-\(season)",
            remotePath: "weekly/\(season).json",
            identifier: "weekly-\(season)"
        )
    }

    public static func schedule(season: Int) -> StaticResource {
        StaticResource(
            bundledName: "schedule-\(season)",
            remotePath: "schedule-\(season).json",
            identifier: "schedule-\(season)"
        )
    }

    public static let weeklyIndex = StaticResource(
        bundledName: "weekly-index", remotePath: "weekly/index.json", identifier: "weekly-index"
    )

    public static let playerIDs = StaticResource(
        bundledName: "player-ids", remotePath: "player-ids.json", identifier: "player-ids"
    )

    public static let adp = StaticResource(
        bundledName: "adp", remotePath: "adp.json", identifier: "adp"
    )

    public static let cohorts = StaticResource(
        bundledName: "cohorts", remotePath: "cohorts.json", identifier: "cohorts"
    )
}

/// Loads the static nflverse files: bundled copy at build time, refreshed over
/// HTTP on a 7-day TTL with `ETag`/`If-None-Match`.
///
/// The bundled copy is what makes a first launch work offline; the HTTP refresh
/// is what keeps the data current during a season without shipping a build.
/// Neither alone is sufficient, which is why both are here (§9).
public actor StaticDataStore {
    private let bundle: Bundle
    private let bundleSubdirectory: String?
    private let cache: DiskCache
    private let transport: HTTPTransport
    private let baseURL: URL?

    /// - Parameter baseURL: where refreshed copies live. `nil` disables the
    ///   network path entirely and runs bundle-only, which is a legitimate
    ///   configuration and the one the tests use.
    /// - Parameter bundleSubdirectory: folder inside the bundle holding the
    ///   JSON, when they are not at its root.
    public init(
        bundle: Bundle = .main,
        bundleSubdirectory: String? = nil,
        cache: DiskCache = DiskCache(),
        transport: HTTPTransport = URLSessionTransport(),
        baseURL: URL? = nil
    ) {
        self.bundle = bundle
        self.bundleSubdirectory = bundleSubdirectory
        self.cache = cache
        self.transport = transport
        self.baseURL = baseURL
    }

    /// Cached bytes plus the ETag they arrived with, so the next refresh can
    /// ask conditionally and usually get a 304 for free.
    private struct StoredPayload: Codable, Sendable {
        let data: Data
        let etag: String?
    }

    private func cacheKey(_ resource: StaticResource) -> String {
        "static-\(resource.identifier)"
    }

    /// Fetches and decodes a static file.
    ///
    /// Order: fresh cache → conditional HTTP → stale cache → bundled copy.
    /// The bundled copy is last rather than first because during a season it is
    /// the most likely of the four to be out of date.
    public func load<Value: Decodable & Sendable>(
        _ type: Value.Type,
        resource: StaticResource,
        force: Bool = false
    ) async throws -> Fetched<Value> {
        let key = cacheKey(resource)

        if !force, let hit = await cache.load(StoredPayload.self, key: key) {
            return Fetched(
                value: try decode(type, from: hit.value.data, resource: resource),
                provenance: .cached(age: hit.age)
            )
        }

        let stale = await cache.load(StoredPayload.self, key: key, allowingStale: true)

        if let baseURL {
            do {
                let refreshed = try await refresh(
                    resource: resource, baseURL: baseURL, knownETag: stale?.value.etag
                )
                switch refreshed {
                case .updated(let payload):
                    try? await cache.store(payload, key: key, ttl: CacheTTL.staticData)
                    return Fetched(
                        value: try decode(type, from: payload.data, resource: resource),
                        provenance: .live
                    )
                case .notModified:
                    // The server confirmed what we hold is current, so re-stamp
                    // the TTL rather than re-downloading in seven days' time.
                    if let stale {
                        try? await cache.store(stale.value, key: key, ttl: CacheTTL.staticData)
                        return Fetched(
                            value: try decode(type, from: stale.value.data, resource: resource),
                            provenance: .cached(age: stale.age)
                        )
                    }
                }
            } catch {
                if let stale {
                    return Fetched(
                        value: try decode(type, from: stale.value.data, resource: resource),
                        provenance: .staleCache(age: stale.age, failure: String(describing: error))
                    )
                }
                // Fall through to the bundled copy — a refresh failure is not a
                // reason to have no data at all.
            }
        } else if let stale {
            return Fetched(
                value: try decode(type, from: stale.value.data, resource: resource),
                provenance: .cached(age: stale.age)
            )
        }

        guard let bundled = bundledData(for: resource) else {
            throw DataLayerError.noFallbackAvailable(resource: resource.identifier)
        }
        return Fetched(
            value: try decode(type, from: bundled, resource: resource), provenance: .bundled
        )
    }

    private enum RefreshResult {
        case updated(StoredPayload)
        case notModified
    }

    private func refresh(
        resource: StaticResource,
        baseURL: URL,
        knownETag: String?
    ) async throws -> RefreshResult {
        let url = baseURL.appendingPathComponent(resource.remotePath)
        var request = URLRequest(url: url)
        if let knownETag {
            request.setValue(knownETag, forHTTPHeaderField: "If-None-Match")
        }
        let response = try await transport.send(request)
        if response.isNotModified { return .notModified }
        guard response.isOK else {
            throw DataLayerError.httpStatus(response.status, path: resource.remotePath)
        }
        return .updated(StoredPayload(data: response.body, etag: response.etag))
    }

    private func bundledData(for resource: StaticResource) -> Data? {
        let url = bundle.url(
            forResource: resource.bundledName,
            withExtension: "json",
            subdirectory: bundleSubdirectory
        ) ?? bundle.url(forResource: resource.bundledName, withExtension: "json")
        guard let url else { return nil }
        return try? Data(contentsOf: url)
    }

    private func decode<Value: Decodable>(
        _ type: Value.Type,
        from data: Data,
        resource: StaticResource
    ) throws -> Value {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw DataLayerError.undecodable(
                path: resource.identifier, underlying: String(describing: error)
            )
        }
    }

    // MARK: - Typed conveniences

    public func weeklyFile(season: Int, force: Bool = false) async throws -> Fetched<WeeklyFile> {
        try await load(WeeklyFile.self, resource: .weekly(season: season), force: force)
    }

    public func schedule(season: Int, force: Bool = false) async throws -> Fetched<ScheduleFile> {
        try await load(ScheduleFile.self, resource: .schedule(season: season), force: force)
    }

    public func playerCrosswalk(force: Bool = false) async throws -> Fetched<PlayerIDCrosswalk> {
        try await load(PlayerIDCrosswalk.self, resource: .playerIDs, force: force)
    }
}
