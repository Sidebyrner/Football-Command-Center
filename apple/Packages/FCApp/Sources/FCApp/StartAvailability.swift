import Foundation
import FCCore
import FCData

/// Whether a player's injury status lets him be recommended as a starter.
///
/// Three sources, the most severe wins: Sleeper's injury tag, the official
/// practice report's game designation, and whether he sits in one of the
/// user's IR slots (Sleeper will not start him from there). Out, IR,
/// Doubtful and the like are never recommended; Questionable is recommended
/// on his value but flagged, because most Questionable players play.
public enum StartAvailability: Hashable, Sendable {
    /// No injury designation.
    case clear
    /// Tagged Questionable — may play; check inactives before kickoff.
    case questionable
    /// Doubtful, Out, IR and similar — do not start. The label says which.
    case unavailable(String)

    /// Sleeper tags that mean a player is very unlikely to play. Shared with
    /// the lineup readiness ring so the two never disagree.
    static let unavailableTags: [String: String] = [
        "OUT": "Out", "DOUBTFUL": "Doubtful", "IR": "IR", "PUP": "PUP", "PUP-R": "PUP", "PUP-P": "PUP",
        "NFI": "NFI", "NFI-R": "NFI", "NFI-A": "NFI", "SUS": "Suspended", "NA": "Not active", "COV": "Illness list",
        "DNR": "Did not report",
    ]

    public var blocksStart: Bool {
        if case .unavailable = self { return true }
        return false
    }

    /// A short tag for the lineup: "Q", "Out", "Doubtful", "IR".
    public var badge: String? {
        switch self {
        case .clear: return nil
        case .questionable: return "Q"
        case .unavailable(let label): return label
        }
    }

    /// Pure, so the rules are tested without a league.
    public static func evaluate(sleeperTag: String?, designation: InjuryDesignation?, onReserve: Bool,
                                reserveLabel: String = "On your IR") -> StartAvailability {
        if onReserve { return .unavailable(reserveLabel) }
        switch designation {
        case .out: return .unavailable("Out")
        case .doubtful: return .unavailable("Doubtful")
        default: break
        }
        if let tag = sleeperTag?.trimmingCharacters(in: .whitespaces).uppercased(), !tag.isEmpty {
            if let label = unavailableTags[tag] { return .unavailable(label) }
            if tag == "QUESTIONABLE" { return .questionable }
        }
        return designation == .questionable ? .questionable : .clear
    }

    /// Checks every roster's IR slots, not only the user's: a rival's player
    /// parked on IR can't start for anyone this week either.
    public static func of(_ id: String, context: LeagueContext) -> StartAvailability {
        let onMyReserve = context.userTeam?.reserveIDs.contains(id) ?? false
        let onAnyReserve = onMyReserve || context.teams.contains { $0.reserveIDs.contains(id) }
        return evaluate(
            sleeperTag: context.injuryStatus(id),
            designation: context.practiceReport(sleeperID: id)?.designation,
            onReserve: onAnyReserve,
            reserveLabel: onMyReserve ? "On your IR" : "On IR"
        )
    }
}
