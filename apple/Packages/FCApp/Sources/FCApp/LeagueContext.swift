import Foundation
import FCCore
import FCData

/// Where a player sits relative to the user, which is what turns a name on the
/// acquisition board into an action.
public enum Availability: Hashable, Sendable {
    /// Not on any roster in the league — a waiver claim.
    case freeAgent
    /// On a rival's bench — a trade, and the easiest kind to ask for.
    case rivalBench(rosterID: Int, manager: String)
    /// In a rival's starting lineup — a trade, and a much harder ask.
    case rivalStarter(rosterID: Int, manager: String)
    /// Already the user's.
    case mine

    public var isAcquirable: Bool {
        switch self {
        case .freeAgent, .rivalBench, .rivalStarter: return true
        case .mine: return false
        }
    }

    /// The phrasing the board uses. Naming the *kind* of move matters more than
    /// the player's rank — a claim and a trade are not the same action.
    public var label: String {
        switch self {
        case .freeAgent: return "Free agent"
        case .rivalBench(_, let manager): return "\(manager)'s bench"
        case .rivalStarter(_, let manager): return "\(manager)'s starter"
        case .mine: return "Yours"
        }
    }
}

/// One team in the league, resolved down to what the algorithms need.
public struct LeagueTeam: Hashable, Sendable, Identifiable {
    public let rosterID: Int
    /// Sleeper's user id for the manager, which is how draft picks are
    /// attributed — a pick belongs to whoever made it, not to whichever roster
    /// later ended up with the player.
    public let ownerID: String?
    public let manager: String
    public let isUser: Bool
    /// Every rostered player, with the position and team the crunch needs.
    public let roster: [RosterEntry]
    /// Starters with unset slots removed.
    public let starterIDs: [String]
    /// Starters exactly as Sleeper sent them, `"0"` included. Kept alongside
    /// the filtered list because the count of `"0"` entries is the only way to
    /// know how many slots are still unset (§3.1).
    public let rawStarters: [String]
    /// Record and points, which Sleeper returns with the roster itself.
    public let settings: SleeperRoster.Settings?

    public var id: Int { rosterID }
}

/// Everything the screens read from, assembled once.
///
/// This is the join point for the three feeds, and therefore where every
/// dialect has already been translated: Sleeper ids on the rosters, gsis ids on
/// the production data, nflverse team spellings throughout.
public struct LeagueContext: Sendable {
    public let league: SleeperLeague
    public let template: SlotTemplate
    public let scoring: SleeperScoringTranslation
    public let teams: [LeagueTeam]
    public let userRosterID: Int
    public let byeCalendar: ByeCalendar
    public let currentWeek: Int
    public let seasonWeeks: [Int]
    /// Season production for every player the weekly file covers, already
    /// scored under this league's own rules.
    public let seasonProfiles: [SeasonProfile]
    public let baselines: [Position: PositionBaseline]
    /// gsis id → Sleeper id, for putting a production row back on a roster.
    public let sleeperIDsByGSIS: [String: String]
    /// Where each rostered Sleeper id sits.
    public let availabilityBySleeperID: [String: Availability]
    /// Positions in this league's starting lineup that the weekly file has no
    /// data for — DEF and IDP. Stated, never papered over (§3.2).
    public let unsupportedPositions: [Position]
    /// The trimmed player pool, kept so screens can name a player and read an
    /// injury tag without another lookup layer.
    public let players: PlayerIndex
    /// The weakest provenance of everything that went into this.
    public let provenance: Provenance

    /// A player's display name, or `nil` when the pool has never heard of them.
    public func playerName(_ id: String) -> String? {
        players[id]?.name
    }

    public func position(_ id: String) -> Position? {
        players[id]?.position
    }

    /// Sleeper's injury tag, only when there is actually one to report.
    public func injuryStatus(_ id: String) -> String? {
        guard let player = players[id], player.hasInjuryDesignation else { return nil }
        return player.injuryStatus
    }

    public var userTeam: LeagueTeam? {
        teams.first { $0.rosterID == userRosterID }
    }

    public var rivals: [LeagueTeam] {
        teams.filter { $0.rosterID != userRosterID }
    }

    /// Weeks from the current one to the end of the regular season — the range
    /// the planning grid covers, because past byes are not a plan.
    public var remainingWeeks: [Int] {
        seasonWeeks.filter { $0 >= currentWeek }
    }

    public func availability(ofSleeperID id: String) -> Availability {
        availabilityBySleeperID[id] ?? .freeAgent
    }

    /// Where a production row's player sits, going back through the crosswalk.
    public func availability(ofGSIS gsisID: String) -> Availability {
        guard let sleeperID = sleeperIDsByGSIS[gsisID] else { return .freeAgent }
        return availability(ofSleeperID: sleeperID)
    }
}
