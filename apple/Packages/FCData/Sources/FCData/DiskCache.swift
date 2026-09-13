import Foundation

/// A value read back from the cache, with enough provenance for the UI to say
/// how old it is.
public struct CachedValue<Value: Sendable>: Sendable {
    public let value: Value
    public let storedAt: Date
    public let expiresAt: Date

    /// Past its TTL. Still returned when the caller asks for stale data,
    /// because during a bye-week check on a plane, old data beats none — but
    /// the UI must label it rather than present it as current (§6).
    public var isStale: Bool { Date() > expiresAt }
    public var age: TimeInterval { Date().timeIntervalSince(storedAt) }
}

/// TTLs carried over from the web app, where they were arrived at by use.
public enum CacheTTL {
    /// Sleeper asks that the 5 MB player payload be fetched at most once daily.
    public static let players: TimeInterval = 24 * 60 * 60
    public static let trending: TimeInterval = 15 * 60
    public static let roster: TimeInterval = 5 * 60
    public static let odds: TimeInterval = 10 * 60
    /// The preprocessed nflverse files change at most weekly.
    public static let staticData: TimeInterval = 7 * 24 * 60 * 60
    /// A finished week's scores never change again, so history is cached long.
    public static let completedWeek: TimeInterval = 7 * 24 * 60 * 60
}

/// A TTL'd, file-backed cache in Application Support.
///
/// **Files, not `UserDefaults`.** `UserDefaults` is backed by a plist loaded
/// wholesale into memory and is the iOS equivalent of the `localStorage` quota
/// failure the web app lost real time to — a silent write failure that looks
/// exactly like a working cache while every load re-downloads megabytes (§3.1).
/// Writes here throw rather than return quietly for the same reason.
public actor DiskCache {
    private let directory: URL
    private let fileManager: FileManager
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// - Parameter directory: where to keep the cache. Defaults to
    ///   `Application Support/FantasyCommandCenter/Cache`, which is backed up
    ///   and not purged under storage pressure the way Caches is.
    public init(directory: URL? = nil, fileManager: FileManager = .default) {
        self.fileManager = fileManager
        if let directory {
            self.directory = directory
        } else {
            let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? fileManager.temporaryDirectory
            self.directory = base
                .appendingPathComponent("FantasyCommandCenter", isDirectory: true)
                .appendingPathComponent("Cache", isDirectory: true)
        }
    }

    private struct Envelope<Value: Codable>: Codable {
        let value: Value
        let storedAt: Date
        let expiresAt: Date
    }

    /// Keys become filenames, so anything that isn't safe in one is replaced.
    /// Sleeper league and player ids are alphanumeric, but a team-abbreviation
    /// DEF id or a future key shape should not be able to escape the directory.
    private func url(for key: String) -> URL {
        let safe = key.map { character -> Character in
            character.isLetter || character.isNumber || character == "-" || character == "_"
                ? character
                : "-"
        }
        return directory
            .appendingPathComponent(String(safe))
            .appendingPathExtension("json")
    }

    private func ensureDirectory() throws {
        guard !fileManager.fileExists(atPath: directory.path) else { return }
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// Writes a value with a TTL.
    ///
    /// Throws on failure by design — a caller that genuinely does not care can
    /// write `try?`, but it has to say so at the call site rather than inherit
    /// silence from here.
    public func store<Value: Codable & Sendable>(
        _ value: Value,
        key: String,
        ttl: TimeInterval,
        now: Date = Date()
    ) throws {
        try ensureDirectory()
        let envelope = Envelope(value: value, storedAt: now, expiresAt: now.addingTimeInterval(ttl))
        let data = try encoder.encode(envelope)
        try data.write(to: url(for: key), options: .atomic)
    }

    /// Reads a value back.
    ///
    /// - Parameter allowingStale: when `true`, an expired entry is returned
    ///   with `isStale` set instead of being discarded. That is what makes
    ///   offline launches useful (§8.1).
    public func load<Value: Codable & Sendable>(
        _ type: Value.Type,
        key: String,
        allowingStale: Bool = false
    ) -> CachedValue<Value>? {
        let location = url(for: key)
        guard let data = try? Data(contentsOf: location) else { return nil }
        guard let envelope = try? decoder.decode(Envelope<Value>.self, from: data) else {
            // A corrupt or schema-changed entry is not an error worth surfacing;
            // it is a miss. Remove it so it cannot rot.
            try? fileManager.removeItem(at: location)
            return nil
        }
        let cached = CachedValue(
            value: envelope.value, storedAt: envelope.storedAt, expiresAt: envelope.expiresAt
        )
        if cached.isStale && !allowingStale { return nil }
        return cached
    }

    public func remove(key: String) {
        try? fileManager.removeItem(at: url(for: key))
    }

    public func removeAll() {
        try? fileManager.removeItem(at: directory)
    }

    /// Whether an unexpired entry exists, without paying to decode it.
    public func contains(key: String) -> Bool {
        fileManager.fileExists(atPath: url(for: key).path)
    }
}
