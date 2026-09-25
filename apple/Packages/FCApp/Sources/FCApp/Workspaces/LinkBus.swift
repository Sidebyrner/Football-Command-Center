import Foundation

/// What a link group is following. A player, a team, a week — each set
/// independently, so clicking a team in Standings doesn't clear the player.
public struct LinkedSelection: Hashable, Sendable {
    public var playerID: String?
    public var rosterID: Int?
    public var week: Int?

    public init(playerID: String? = nil, rosterID: Int? = nil, week: Int? = nil) {
        self.playerID = playerID
        self.rosterID = rosterID
        self.week = week
    }
}

public enum LinkChange: Hashable, Sendable {
    case player(String)
    case team(Int)
    case week(Int)
    /// Adds a player to the group's compare list (at most `LinkBus.compareLimit`).
    case addCompare(String)
    case removeCompare(String)
    case clearCompare
}

/// Colour-group linking, as on a trading desk: a panel publishes a click to
/// its group, and every panel in that group that follows selections updates.
@MainActor
public final class LinkBus: ObservableObject {
    public static let compareLimit = 4

    @Published public private(set) var selections: [LinkGroup: LinkedSelection] = [:]
    /// The players each group is comparing, in the order they were added.
    @Published public private(set) var compare: [LinkGroup: [String]] = [:]

    public init() {}

    public func publish(_ change: LinkChange, to group: LinkGroup) {
        switch change {
        case .addCompare(let id):
            let list = compare[group] ?? []
            guard !list.contains(id), list.count < Self.compareLimit else { return }
            compare[group] = list + [id]
            return
        case .removeCompare(let id):
            guard let list = compare[group], list.contains(id) else { return }
            let remaining = list.filter { $0 != id }
            compare[group] = remaining.isEmpty ? nil : remaining
            return
        case .clearCompare:
            guard compare[group] != nil else { return }
            compare[group] = nil
            return
        case .player, .team, .week:
            break
        }
        var selection = selections[group] ?? LinkedSelection()
        switch change {
        case .player(let id): selection.playerID = id
        case .team(let rosterID): selection.rosterID = rosterID
        case .week(let week): selection.week = week
        case .addCompare, .removeCompare, .clearCompare: return
        }
        guard selections[group] != selection else { return }
        selections[group] = selection
    }

    public func compareList(for group: LinkGroup?) -> [String] {
        group.flatMap { compare[$0] } ?? []
    }

    public func isComparing(_ id: String, in group: LinkGroup?) -> Bool {
        compareList(for: group).contains(id)
    }

    public func canAddToCompare(in group: LinkGroup?) -> Bool {
        group != nil && compareList(for: group).count < Self.compareLimit
    }

    public func selection(for group: LinkGroup?) -> LinkedSelection? {
        group.flatMap { selections[$0] }
    }

    public func clear(_ group: LinkGroup) {
        selections[group] = nil
        compare[group] = nil
    }
}
