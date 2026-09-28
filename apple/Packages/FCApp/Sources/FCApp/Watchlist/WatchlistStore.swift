import Foundation

/// One player on the watchlist: when he went on, whether he's in the
/// side-by-side comparison, and whether he's the user's own baseline.
public struct WatchlistEntry: Codable, Hashable, Sendable, Identifiable {
    public let playerID: String
    public var addedAt: Date
    /// Any change to the entry — the merge keeps the newer copy.
    public var updatedAt: Date
    public var isComparing: Bool
    /// When he went into the comparison; orders the columns and decides who
    /// stays when two devices both filled the four slots.
    public var comparedAt: Date?
    /// One of the user's own players, pinned first to measure targets against.
    public var isBaseline: Bool
    /// Where he stood when added, so a target a rival has since claimed can
    /// say so. `Availability.kind` spelling.
    public var availabilityWhenAdded: String?

    public var id: String { playerID }

    public init(
        playerID: String, addedAt: Date, updatedAt: Date? = nil, isComparing: Bool = false,
        comparedAt: Date? = nil, isBaseline: Bool = false, availabilityWhenAdded: String? = nil
    ) {
        self.playerID = playerID
        self.addedAt = addedAt
        self.updatedAt = updatedAt ?? addedAt
        self.isComparing = isComparing
        self.comparedAt = comparedAt
        self.isBaseline = isBaseline
        self.availabilityWhenAdded = availabilityWhenAdded
    }
}

/// Everything one league's watchlist stores: the entries, and a tombstone for
/// each removal so a removal on one device isn't undone by the other's copy.
public struct WatchlistSnapshot: Codable, Hashable, Sendable {
    public var version: Int
    public var entries: [WatchlistEntry]
    /// Player id → when he was removed.
    public var tombstones: [String: Date]
    public var modifiedAt: Date

    public init(version: Int = 1, entries: [WatchlistEntry] = [], tombstones: [String: Date] = [:], modifiedAt: Date = .distantPast) {
        self.version = version
        self.entries = entries
        self.tombstones = tombstones
        self.modifiedAt = modifiedAt
    }

    public static let empty = WatchlistSnapshot()
}

/// Where the watchlist lives. The store only reads and writes whole
/// snapshots; merging is `WatchlistMerge`'s job.
public protocol WatchlistStore: AnyObject, Sendable {
    func load(key: String) -> WatchlistSnapshot?
    func save(_ snapshot: WatchlistSnapshot, key: String)
    /// Called with the keys another device changed. Called on any thread.
    func observeExternalChanges(_ handler: @escaping @Sendable (Set<String>) -> Void)
    /// Asks the store to pull and push now — on returning to the foreground.
    func synchronize()
}

public extension WatchlistStore {
    func observeExternalChanges(_ handler: @escaping @Sendable (Set<String>) -> Void) {}
    func synchronize() {}
}

enum WatchlistCoding {
    static func encode(_ snapshot: WatchlistSnapshot) -> Data? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .millisecondsSince1970
        return try? encoder.encode(snapshot)
    }

    static func decode(_ data: Data?) -> WatchlistSnapshot? {
        guard let data else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try? decoder.decode(WatchlistSnapshot.self, from: data)
    }
}

/// In-memory store, for tests, previews and the demo league.
public final class InMemoryWatchlistStore: WatchlistStore, @unchecked Sendable {
    private let lock = NSLock()
    private var snapshots: [String: WatchlistSnapshot]
    private var handlers: [@Sendable (Set<String>) -> Void] = []

    public init(_ snapshots: [String: WatchlistSnapshot] = [:]) {
        self.snapshots = snapshots
    }

    public func load(key: String) -> WatchlistSnapshot? {
        lock.lock()
        defer { lock.unlock() }
        return snapshots[key]
    }

    public func save(_ snapshot: WatchlistSnapshot, key: String) {
        lock.lock()
        defer { lock.unlock() }
        snapshots[key] = snapshot
    }

    public func observeExternalChanges(_ handler: @escaping @Sendable (Set<String>) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        handlers.append(handler)
    }

    /// Stands in for another device writing: replaces the stored copy and
    /// tells observers, as iCloud would.
    public func simulateRemote(_ snapshot: WatchlistSnapshot, key: String) {
        lock.lock()
        snapshots[key] = snapshot
        let handlers = self.handlers
        lock.unlock()
        handlers.forEach { $0([key]) }
    }
}

/// This device only.
public final class UserDefaultsWatchlistStore: WatchlistStore, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load(key: String) -> WatchlistSnapshot? {
        WatchlistCoding.decode(defaults.data(forKey: key))
    }

    public func save(_ snapshot: WatchlistSnapshot, key: String) {
        guard let data = WatchlistCoding.encode(snapshot) else { return }
        defaults.set(data, forKey: key)
    }
}

/// iCloud key-value storage, so the phone and the Mac share one watchlist.
/// Every save is mirrored to this device's defaults, and a load merges the
/// two — so a first launch offline, or signing out of iCloud, loses nothing.
public final class UbiquitousWatchlistStore: WatchlistStore, @unchecked Sendable {
    private let cloud: NSUbiquitousKeyValueStore
    private let local: UserDefaultsWatchlistStore
    private let lock = NSLock()
    private var handlers: [@Sendable (Set<String>) -> Void] = []
    private var observer: NSObjectProtocol?

    public init(cloud: NSUbiquitousKeyValueStore = .default, local: UserDefaultsWatchlistStore = UserDefaultsWatchlistStore()) {
        self.cloud = cloud
        self.local = local
        observer = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification, object: cloud, queue: nil
        ) { [weak self] note in
            self?.didChangeExternally(note)
        }
        cloud.synchronize()
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    public func load(key: String) -> WatchlistSnapshot? {
        let fromCloud = WatchlistCoding.decode(cloud.data(forKey: key))
        let fromDisk = local.load(key: key)
        switch (fromCloud, fromDisk) {
        case let (cloud?, disk?): return WatchlistMerge.merge(cloud, disk, now: Date())
        case let (cloud?, nil): return cloud
        case let (nil, disk?): return disk
        case (nil, nil): return nil
        }
    }

    public func save(_ snapshot: WatchlistSnapshot, key: String) {
        local.save(snapshot, key: key)
        guard let data = WatchlistCoding.encode(snapshot) else { return }
        cloud.set(data, forKey: key)
    }

    public func observeExternalChanges(_ handler: @escaping @Sendable (Set<String>) -> Void) {
        lock.lock()
        defer { lock.unlock() }
        handlers.append(handler)
    }

    public func synchronize() {
        cloud.synchronize()
    }

    private func didChangeExternally(_ note: Notification) {
        let reason = note.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int
        // Over quota the cloud copy is stale; the local mirror still has
        // everything, so there's nothing to pull.
        guard reason != NSUbiquitousKeyValueStoreQuotaViolationChange else { return }
        let keys = Set(note.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? [])
        lock.lock()
        let handlers = self.handlers
        lock.unlock()
        handlers.forEach { $0(keys) }
    }
}

public enum WatchlistStoreFactory {
    /// iCloud when the device is signed in, else this device's defaults.
    public static func make() -> WatchlistStore {
        if FileManager.default.ubiquityIdentityToken != nil {
            return UbiquitousWatchlistStore()
        }
        return UserDefaultsWatchlistStore()
    }
}
