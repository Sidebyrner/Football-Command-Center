import Foundation
import SwiftUI

extension Availability {
    /// A stable spelling for storage — the manager's name isn't part of it.
    public var kind: String {
        switch self {
        case .freeAgent: return "freeAgent"
        case .rivalBench: return "rivalBench"
        case .rivalStarter: return "rivalStarter"
        case .mine: return "mine"
        }
    }

    var isMine: Bool { self == .mine }
}

/// The players the user is weighing up — up to twelve, per league, kept
/// between launches and shared with their other devices through iCloud. Up to
/// four of them are compared side by side, one of which can be one of the
/// user's own players as the baseline.
///
/// A target a rival picks up stays on the list; the views mark him.
@MainActor
public final class WatchlistModel: ObservableObject {
    public nonisolated static let capacity = WatchlistMerge.capacity
    public nonisolated static let compareLimit = WatchlistMerge.compareLimit

    /// In the order they were added.
    @Published public private(set) var entries: [WatchlistEntry] = []

    public let store: WatchlistStore
    /// Where a player stands in the league now — the loaded context's
    /// answer. Used to record where a target was when added, and to allow
    /// only the user's own players as a baseline.
    public var availability: (String) -> Availability? = { _ in nil }
    /// The compare columns after every change, for the Blue link group.
    public var onCompareChange: (([String]) -> Void)? {
        didSet { onCompareChange?(comparingIDs) }
    }

    private let now: () -> Date
    private var snapshot = WatchlistSnapshot.empty
    private var leagueID: String?
    /// Every change is stamped strictly after the last one, so a re-add in
    /// the same instant as a removal still wins.
    private var lastStamp = Date.distantPast

    public init(store: WatchlistStore = InMemoryWatchlistStore(), now: @escaping () -> Date = { Date() }) {
        self.store = store
        self.now = now
        store.observeExternalChanges { [weak self] keys in
            Task { @MainActor in self?.externalChange(keys) }
        }
        reload()
    }

    public nonisolated static func key(leagueID: String?) -> String {
        "fcc.watchlist.v1.\(leagueID ?? "none")"
    }

    private var key: String { Self.key(leagueID: leagueID) }

    // MARK: - Reading

    public var ids: [String] { entries.map(\.playerID) }

    /// The comparison's columns: the baseline first, then in the order they
    /// went in.
    public var comparingIDs: [String] {
        entries.filter(\.isComparing).sorted { lhs, rhs in
            if lhs.isBaseline != rhs.isBaseline { return lhs.isBaseline }
            let l = lhs.comparedAt ?? .distantPast, r = rhs.comparedAt ?? .distantPast
            return l != r ? l < r : lhs.playerID < rhs.playerID
        }
        .map(\.playerID)
    }

    public var baselineID: String? { entries.first(where: \.isBaseline)?.playerID }

    public func entry(_ id: String) -> WatchlistEntry? { entries.first { $0.playerID == id } }
    public func isWatched(_ id: String) -> Bool { entry(id) != nil }
    public func isComparing(_ id: String) -> Bool { entry(id)?.isComparing == true }
    public var canCompareMore: Bool { comparingIDs.count < Self.compareLimit }

    /// Whether a watched target has left free agency since he was added.
    public func wasClaimed(_ id: String) -> Bool {
        guard let entry = entry(id), entry.availabilityWhenAdded == Availability.freeAgent.kind,
              let now = availability(id) else { return false }
        return now != .freeAgent
    }

    // MARK: - Changing

    /// Switches to a league's own list.
    public func setLeague(_ leagueID: String?) {
        guard leagueID != self.leagueID else { return }
        self.leagueID = leagueID
        reload()
    }

    /// Adds him, straight into the comparison while there's a free column.
    /// A full list makes room by dropping the oldest target not being
    /// compared.
    public func add(_ id: String, compare: Bool? = nil) {
        guard !isWatched(id) else {
            if compare == true, !isComparing(id) { toggleCompare(id) }
            return
        }
        mutate { snapshot, stamp in
            let comparing = (compare ?? true) && snapshot.entries.filter(\.isComparing).count < Self.compareLimit
            snapshot.tombstones[id] = nil
            snapshot.entries.append(WatchlistEntry(
                playerID: id, addedAt: stamp, isComparing: comparing, comparedAt: comparing ? stamp : nil,
                availabilityWhenAdded: availability(id)?.kind
            ))
            if snapshot.entries.count > Self.capacity,
               let oldest = snapshot.entries.filter({ !$0.isComparing && $0.playerID != id }).min(by: { $0.addedAt < $1.addedAt }) {
                snapshot.entries.removeAll { $0.playerID == oldest.playerID }
                snapshot.tombstones[oldest.playerID] = stamp
            }
        }
    }

    public func remove(_ id: String) {
        guard isWatched(id) else { return }
        mutate { snapshot, stamp in
            snapshot.entries.removeAll { $0.playerID == id }
            snapshot.tombstones[id] = stamp
        }
    }

    public func toggleWatched(_ id: String) {
        isWatched(id) ? remove(id) : add(id)
    }

    /// In or out of the comparison. Out of it, the baseline stops being one.
    public func toggleCompare(_ id: String) {
        guard let current = entry(id) else { return add(id, compare: true) }
        guard current.isComparing || canCompareMore else { return }
        mutate { snapshot, stamp in
            guard let index = snapshot.entries.firstIndex(where: { $0.playerID == id }) else { return }
            let on = !snapshot.entries[index].isComparing
            snapshot.entries[index].isComparing = on
            snapshot.entries[index].comparedAt = on ? stamp : nil
            if !on { snapshot.entries[index].isBaseline = false }
            snapshot.entries[index].updatedAt = stamp
        }
    }

    /// Makes one of the user's own players the baseline — the first column,
    /// the one every target is measured against. Anyone else is refused.
    /// Adds him if needed, and frees a column if all four are taken.
    @discardableResult
    public func setBaseline(_ id: String) -> Bool {
        guard availability(id)?.isMine == true else { return false }
        if !isWatched(id) { add(id, compare: false) }
        mutate { snapshot, stamp in
            for index in snapshot.entries.indices where snapshot.entries[index].isBaseline {
                snapshot.entries[index].isBaseline = false
                snapshot.entries[index].updatedAt = stamp
            }
            guard let index = snapshot.entries.firstIndex(where: { $0.playerID == id }) else { return }
            if !snapshot.entries[index].isComparing,
               snapshot.entries.filter(\.isComparing).count >= Self.compareLimit,
               let oldest = snapshot.entries.indices
                   .filter({ snapshot.entries[$0].isComparing })
                   .min(by: { (snapshot.entries[$0].comparedAt ?? .distantPast) < (snapshot.entries[$1].comparedAt ?? .distantPast) }) {
                snapshot.entries[oldest].isComparing = false
                snapshot.entries[oldest].comparedAt = nil
                snapshot.entries[oldest].updatedAt = stamp
            }
            snapshot.entries[index].isBaseline = true
            snapshot.entries[index].isComparing = true
            snapshot.entries[index].comparedAt = snapshot.entries[index].comparedAt ?? stamp
            snapshot.entries[index].updatedAt = stamp
        }
        return true
    }

    public func clearBaseline() {
        guard let id = baselineID else { return }
        mutate { snapshot, stamp in
            guard let index = snapshot.entries.firstIndex(where: { $0.playerID == id }) else { return }
            snapshot.entries[index].isBaseline = false
            snapshot.entries[index].updatedAt = stamp
        }
    }

    /// Empties the comparison; the list stays.
    public func clearCompare() {
        guard !comparingIDs.isEmpty else { return }
        mutate { snapshot, stamp in
            for index in snapshot.entries.indices where snapshot.entries[index].isComparing {
                snapshot.entries[index].isComparing = false
                snapshot.entries[index].isBaseline = false
                snapshot.entries[index].comparedAt = nil
                snapshot.entries[index].updatedAt = stamp
            }
        }
    }

    /// Pulls from iCloud now — on returning to the foreground.
    public func synchronize() {
        store.synchronize()
        externalChange([key])
    }

    // MARK: - Plumbing

    private func stamp() -> Date {
        let next = max(now(), lastStamp.addingTimeInterval(0.001))
        lastStamp = next
        return next
    }

    private func mutate(_ change: (inout WatchlistSnapshot, Date) -> Void) {
        let stamp = stamp()
        var next = snapshot
        change(&next, stamp)
        next.modifiedAt = stamp
        let stored = store.load(key: key) ?? .empty
        let merged = WatchlistMerge.merge(next, stored, now: stamp)
        store.save(merged, key: key)
        apply(merged)
    }

    private func reload() {
        let loaded = store.load(key: key).map { WatchlistMerge.normalize($0, now: now()) } ?? .empty
        apply(loaded)
    }

    private func externalChange(_ keys: Set<String>) {
        guard keys.isEmpty || keys.contains(key), let remote = store.load(key: key) else { return }
        let merged = WatchlistMerge.merge(snapshot, remote, now: now())
        guard merged != snapshot else { return }
        apply(merged)
    }

    private func apply(_ next: WatchlistSnapshot) {
        let before = comparingIDs
        snapshot = next
        let latest = ([next.modifiedAt] + next.entries.map(\.updatedAt) + Array(next.tombstones.values)).max() ?? .distantPast
        lastStamp = max(lastStamp, latest)
        if entries != next.entries { entries = next.entries }
        let after = comparingIDs
        if before != after { onCompareChange?(after) }
    }
}

private struct WatchlistKey: EnvironmentKey {
    static let defaultValue: WatchlistModel? = nil
}

extension EnvironmentValues {
    /// The watchlist, as a plain reference — reading it observes nothing.
    /// Views that show its state observe it themselves.
    var watchlist: WatchlistModel? {
        get { self[WatchlistKey.self] }
        set { self[WatchlistKey.self] = newValue }
    }
}
