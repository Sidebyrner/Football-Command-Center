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
}

/// Colour-group linking, as on a trading desk: a panel publishes a click to
/// its group, and every panel in that group that follows selections updates.
@MainActor
public final class LinkBus: ObservableObject {
    @Published public private(set) var selections: [LinkGroup: LinkedSelection] = [:]

    public init() {}

    public func publish(_ change: LinkChange, to group: LinkGroup) {
        var selection = selections[group] ?? LinkedSelection()
        switch change {
        case .player(let id): selection.playerID = id
        case .team(let rosterID): selection.rosterID = rosterID
        case .week(let week): selection.week = week
        }
        guard selections[group] != selection else { return }
        selections[group] = selection
    }

    public func selection(for group: LinkGroup?) -> LinkedSelection? {
        group.flatMap { selections[$0] }
    }

    public func clear(_ group: LinkGroup) {
        selections[group] = nil
    }
}
