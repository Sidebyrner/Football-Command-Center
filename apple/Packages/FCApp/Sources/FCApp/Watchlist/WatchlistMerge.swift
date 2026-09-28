import Foundation

/// Two copies of a watchlist into one — this device's and iCloud's. Pure.
///
/// Entry by entry rather than whole-list last-writer-wins, which would drop a
/// player added on the phone while the Mac was offline. The newer copy of each
/// entry wins; a removal wins over anything older than it; then the rules are
/// enforced: one baseline, four compared, twelve on the list.
public enum WatchlistMerge {
    public static let capacity = 12
    public static let compareLimit = 4
    public static let tombstoneLifetime: TimeInterval = 30 * 24 * 60 * 60

    public static func merge(_ a: WatchlistSnapshot, _ b: WatchlistSnapshot, now: Date) -> WatchlistSnapshot {
        var tombstones = a.tombstones
        for (id, removed) in b.tombstones {
            tombstones[id] = max(tombstones[id] ?? removed, removed)
        }
        var byID: [String: WatchlistEntry] = [:]
        for entry in a.entries + b.entries {
            byID[entry.playerID] = byID[entry.playerID].map { newer($0, entry) } ?? entry
        }
        let live = byID.values.filter { entry in
            guard let removed = tombstones[entry.playerID] else { return true }
            return entry.updatedAt > removed
        }
        let merged = WatchlistSnapshot(
            version: max(a.version, b.version),
            entries: Array(live),
            tombstones: tombstones,
            modifiedAt: max(a.modifiedAt, b.modifiedAt)
        )
        return normalize(merged, now: now)
    }

    /// Enforces the rules on one copy. A copy that already follows them comes
    /// back unchanged, apart from expired tombstones.
    public static func normalize(_ snapshot: WatchlistSnapshot, now: Date) -> WatchlistSnapshot {
        var entries = snapshot.entries.sorted(by: addedOrder)
        var tombstones = snapshot.tombstones

        // One baseline: the most recently set.
        let baseline = entries.filter(\.isBaseline).max { ($0.updatedAt, $0.playerID) < ($1.updatedAt, $1.playerID) }?.playerID
        for index in entries.indices {
            entries[index].isBaseline = entries[index].playerID == baseline
            // The baseline always has a column.
            if entries[index].isBaseline { entries[index].isComparing = true }
        }

        // Four compared: the baseline, then the most recently compared.
        let keptComparing = Set(
            entries.filter(\.isComparing).sorted { lhs, rhs in
                if lhs.isBaseline != rhs.isBaseline { return lhs.isBaseline }
                let l = lhs.comparedAt ?? .distantPast, r = rhs.comparedAt ?? .distantPast
                return l != r ? l > r : lhs.playerID < rhs.playerID
            }
            .prefix(compareLimit)
            .map(\.playerID)
        )
        for index in entries.indices where entries[index].isComparing && !keptComparing.contains(entries[index].playerID) {
            entries[index].isComparing = false
        }

        // Twelve on the list: everyone compared, then the newest additions.
        if entries.count > capacity {
            let kept = Set(
                entries.sorted { lhs, rhs in
                    if lhs.isComparing != rhs.isComparing { return lhs.isComparing }
                    return lhs.addedAt != rhs.addedAt ? lhs.addedAt > rhs.addedAt : lhs.playerID < rhs.playerID
                }
                .prefix(capacity)
                .map(\.playerID)
            )
            for entry in entries where !kept.contains(entry.playerID) {
                // Tombstoned at its own last change, so the other device's
                // copy of it can't bring it back.
                tombstones[entry.playerID] = max(tombstones[entry.playerID] ?? entry.updatedAt, entry.updatedAt)
            }
            entries.removeAll { !kept.contains($0.playerID) }
        }

        tombstones = tombstones.filter { now.timeIntervalSince($0.value) < tombstoneLifetime }
        return WatchlistSnapshot(version: snapshot.version, entries: entries, tombstones: tombstones, modifiedAt: snapshot.modifiedAt)
    }

    /// The later of two copies of one entry. A tie on time falls to a fixed
    /// order of the fields, so both devices pick the same one.
    static func newer(_ a: WatchlistEntry, _ b: WatchlistEntry) -> WatchlistEntry {
        if a.updatedAt != b.updatedAt { return a.updatedAt > b.updatedAt ? a : b }
        return tieKey(a) >= tieKey(b) ? a : b
    }

    private static func tieKey(_ entry: WatchlistEntry) -> String {
        [entry.isComparing ? "1" : "0", entry.isBaseline ? "1" : "0",
         String(entry.comparedAt?.timeIntervalSince1970 ?? 0), String(entry.addedAt.timeIntervalSince1970),
         entry.availabilityWhenAdded ?? ""].joined(separator: "|")
    }

    private static func addedOrder(_ lhs: WatchlistEntry, _ rhs: WatchlistEntry) -> Bool {
        lhs.addedAt != rhs.addedAt ? lhs.addedAt < rhs.addedAt : lhs.playerID < rhs.playerID
    }
}
