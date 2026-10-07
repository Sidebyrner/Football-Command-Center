import Foundation

/// Whoever holds the players a compare view shows: the saved watchlist, or a
/// Decide session that lives only as long as the sheet.
@MainActor
public protocol CompareSource: ObservableObject {
    var compareIDs: [String] { get }
    /// The watchlist's yardstick player; Decide has none.
    var compareBaselineID: String? { get }
    /// Who holds the slot being decided; the watchlist has none.
    var incumbentID: String? { get }
    /// "FLEX", "WR2" — the slot being decided.
    var slotToken: String? { get }
    var supportsBaseline: Bool { get }
    func setCompareBaseline(_ id: String?)
    func canRemoveFromCompare(_ id: String) -> Bool
    func removeFromCompare(_ id: String)
    func compareWasClaimed(_ id: String) -> Bool
}

extension WatchlistModel: CompareSource {
    public var compareIDs: [String] { comparingIDs }
    public var compareBaselineID: String? { baselineID }
    public var incumbentID: String? { nil }
    public var slotToken: String? { nil }
    public var supportsBaseline: Bool { true }

    public func setCompareBaseline(_ id: String?) {
        if let id { _ = setBaseline(id) } else { clearBaseline() }
    }

    public func canRemoveFromCompare(_ id: String) -> Bool { true }
    public func removeFromCompare(_ id: String) { toggleCompare(id) }
    public func compareWasClaimed(_ id: String) -> Bool { wasClaimed(id) }
}
