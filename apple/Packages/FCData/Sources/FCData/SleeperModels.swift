import Foundation
import FCCore

// Sleeper's payloads, decoded only as far as this app actually uses them.
// Unknown fields are ignored rather than rejected: Sleeper adds fields without
// warning, and a decoder that insists on knowing everything turns their next
// release into our outage (§9).

/// `/state/nfl` — the authoritative current week. The app must never rely on a
/// hand-typed week, which is what the web app's Settings field was and which
/// went stale every season.
public struct NFLState: Codable, Hashable, Sendable {
    public let week: Int?
    public let season: String?
    public let seasonType: String?
    public let leg: Int?

    enum CodingKeys: String, CodingKey {
        case week, season, leg
        case seasonType = "season_type"
    }

    /// `season` arrives as a string; callers want a number.
    public var seasonYear: Int? { season.flatMap(Int.init) }
    public var isRegularSeason: Bool { seasonType == "regular" }
}

/// `/user/{username}` — the only thing the app needs is the id to look up leagues.
public struct SleeperUser: Codable, Hashable, Sendable {
    public let userID: String
    public let username: String?
    public let displayName: String?
    public let avatar: String?

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case displayName = "display_name"
        case avatar
    }
}

/// `/league/{leagueId}/users` — display names for the other managers.
public struct SleeperLeagueMember: Codable, Hashable, Sendable {
    public let userID: String
    public let displayName: String?
    public let avatar: String?
    /// `metadata.team_name` when the manager set one, which supersedes the
    /// display name in Sleeper's own UI.
    public let teamName: String?

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case displayName = "display_name"
        case avatar, metadata
        case teamName = "team_name"
    }

    enum MetadataKeys: String, CodingKey {
        case teamName = "team_name"
    }

    /// Accepts both shapes: Sleeper's, where the team name is nested under
    /// `metadata`, and our own flattened one written by the cache. Without the
    /// second, a member round-tripped through disk would come back with its
    /// team name silently dropped.
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        userID = try container.decode(String.self, forKey: .userID)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        avatar = try container.decodeIfPresent(String.self, forKey: .avatar)
        let metadata = try? container.nestedContainer(keyedBy: MetadataKeys.self, forKey: .metadata)
        let nested = try? metadata?.decodeIfPresent(String.self, forKey: .teamName)
        teamName = nested ?? (try? container.decodeIfPresent(String.self, forKey: .teamName)) ?? nil
    }

    /// Written flat, which the initialiser above reads back.
    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(userID, forKey: .userID)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encodeIfPresent(avatar, forKey: .avatar)
        try container.encodeIfPresent(teamName, forKey: .teamName)
    }

    /// What to actually put on screen for this manager.
    public var label: String {
        teamName ?? displayName ?? userID
    }
}

/// `/league/{leagueId}` — the league's own rules. Scoring and roster shape are
/// read live on every load so a mid-season settings change is picked up without
/// a new build; neither is ever hardcoded (§1, §12).
public struct SleeperLeague: Codable, Hashable, Sendable {
    public let leagueID: String
    public let name: String?
    public let season: String?
    public let status: String?
    public let totalRosters: Int?
    /// Positional slots in order, including `BN`, `IR` and `TAXI`.
    public let rosterPositions: [String]?
    /// Raw Sleeper scoring keys. Translate with `ScoringProfile.translate(sleeper:)`.
    public let scoringSettings: [String: Double]?
    public let previousLeagueID: String?

    enum CodingKeys: String, CodingKey {
        case leagueID = "league_id"
        case name, season, status
        case totalRosters = "total_rosters"
        case rosterPositions = "roster_positions"
        case scoringSettings = "scoring_settings"
        case previousLeagueID = "previous_league_id"
    }

    /// The slot template this league actually plays, parsed by FCCore.
    public var slotTemplate: SlotTemplate {
        RosterSlots.parse(rosterPositions)
    }
}

/// `/league/{leagueId}/rosters`.
///
/// `players` and `starters` are **player ids as strings**, and a team defense's
/// id is its team abbreviation (`"PHI"`), never a number — anything that assumes
/// numeric ids breaks on DEF (§3.1).
public struct SleeperRoster: Codable, Hashable, Sendable {
    public let rosterID: Int
    public let ownerID: String?
    public let leagueID: String?
    /// Everyone rostered, starters included.
    public let players: [String]?
    /// **Positionally aligned** to the league's starting slots, in
    /// `roster_positions` order with bench/IR/taxi removed. Index carries
    /// meaning, and `"0"` means the slot was left unset (§3.1).
    public let starters: [String]?
    public let reserve: [String]?
    public let taxi: [String]?
    public let settings: Settings?

    public struct Settings: Codable, Hashable, Sendable {
        public let wins: Int?
        public let losses: Int?
        public let ties: Int?
        public let fpts: Double?
        public let fptsDecimal: Double?
        public let fptsAgainst: Double?
        public let fptsAgainstDecimal: Double?

        enum CodingKeys: String, CodingKey {
            case wins, losses, ties, fpts
            case fptsDecimal = "fpts_decimal"
            case fptsAgainst = "fpts_against"
            case fptsAgainstDecimal = "fpts_against_decimal"
        }

        /// Sleeper splits points either side of the decimal point.
        public var pointsFor: Double? {
            guard let fpts else { return nil }
            return fpts + (fptsDecimal ?? 0) / 100
        }

        public var pointsAgainst: Double? {
            guard let fptsAgainst else { return nil }
            return fptsAgainst + (fptsAgainstDecimal ?? 0) / 100
        }
    }

    enum CodingKeys: String, CodingKey {
        case rosterID = "roster_id"
        case ownerID = "owner_id"
        case leagueID = "league_id"
        case players, starters, reserve, taxi, settings
    }

    /// The starter ids with unset slots removed, still in slot order.
    ///
    /// Use this only when the slot each id belongs to no longer matters —
    /// otherwise keep the raw array, because dropping `"0"` destroys the
    /// positional alignment that gives the rest of it meaning.
    public var filledStarters: [String] {
        (starters ?? []).filter { $0 != SleeperRoster.emptyStarterSlot }
    }

    /// Rostered players who are not in a starting slot.
    public var bench: [String] {
        let starting = Set(filledStarters)
        return (players ?? []).filter { !starting.contains($0) }
    }

    /// Sleeper's sentinel for "this starting slot is empty".
    public static let emptyStarterSlot = "0"
}

/// `/league/{leagueId}/matchups/{week}`.
public struct SleeperMatchup: Codable, Hashable, Sendable {
    public let rosterID: Int
    /// Rosters sharing a `matchupID` are playing each other. Nil in weeks with
    /// no scheduled matchup.
    public let matchupID: Int?
    public let points: Double?
    public let starters: [String]?
    public let players: [String]?
    /// Per-player points, keyed by player id.
    public let playersPoints: [String: Double]?
    public let startersPoints: [Double]?

    enum CodingKeys: String, CodingKey {
        case rosterID = "roster_id"
        case matchupID = "matchup_id"
        case points, starters, players
        case playersPoints = "players_points"
        case startersPoints = "starters_points"
    }
}

/// `/league/{leagueId}/transactions/{week}`.
public struct SleeperTransaction: Codable, Hashable, Sendable {
    public let transactionID: String
    public let type: String?
    public let status: String?
    public let created: Double?
    public let rosterIDs: [Int]?
    /// Player id → roster that acquired them.
    public let adds: [String: Int]?
    /// Player id → roster that gave them up.
    public let drops: [String: Int]?

    enum CodingKeys: String, CodingKey {
        case transactionID = "transaction_id"
        case type, status, created, adds, drops
        case rosterIDs = "roster_ids"
    }

    public var isComplete: Bool { status == "complete" }

    /// When the transaction happened. Sleeper sends epoch **milliseconds**.
    public var date: Date? {
        created.map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}

/// `/players/nfl/trending/{add,drop}`.
///
/// This is the **only** signal the app has for DEF and IDP, because the weekly
/// production file covers none of them. Anything built on it must be labelled
/// as popularity rather than production (§3.2).
public struct TrendingPlayer: Codable, Hashable, Sendable {
    public let playerID: String
    public let count: Int

    enum CodingKeys: String, CodingKey {
        case playerID = "player_id"
        case count
    }
}
