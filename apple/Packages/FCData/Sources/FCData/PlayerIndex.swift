import Foundation
import FCCore

/// One player, reduced to the fields the app actually uses.
///
/// This is the **trimmed projection** the brief insists on (§3.1). Sleeper's
/// `/players/nfl` is roughly 5 MB of mostly-unused fields; keeping the raw
/// payload is what blew the web app's storage quota, and the failure looked
/// exactly like a working cache while it re-downloaded megabytes on every load.
public struct IndexedPlayer: Codable, Hashable, Sendable {
    /// Sleeper's player id. A **string**, and for a team defense it is the team
    /// abbreviation (`"PHI"`) rather than a number (§3.1).
    public let id: String
    public let name: String
    public let positionCode: String?
    public let team: String?
    public let injuryStatus: String?
    /// Sleeper's own active flag. Filtering on it is not optional — forgetting
    /// it silently fills the pool with retired players (§3.1).
    public let active: Bool

    public init(
        id: String,
        name: String,
        positionCode: String?,
        team: String?,
        injuryStatus: String?,
        active: Bool
    ) {
        self.id = id
        self.name = name
        self.positionCode = positionCode
        self.team = team
        self.injuryStatus = injuryStatus
        self.active = active
    }

    public var position: Position? { Position(sleeper: positionCode) }

    /// A team defense, whose id is a team abbreviation rather than a number.
    public var isTeamDefense: Bool { position == .def }

    /// The team abbreviation in nflverse's spelling, which is what every join
    /// against the static files needs (`LAR` → `LA`, §5.6).
    public var nflverseTeam: String? { NFLTeams.nflverse(team) }

    /// Non-nil only when Sleeper is actually reporting something.
    public var hasInjuryDesignation: Bool {
        guard let injuryStatus, !injuryStatus.isEmpty else { return false }
        return injuryStatus.caseInsensitiveCompare("Healthy") != .orderedSame
    }
}

/// The searchable player pool, built once from `/players/nfl` and cached to disk.
public struct PlayerIndex: Codable, Hashable, Sendable {
    public let players: [String: IndexedPlayer]
    /// When this index was built, so a caller can say how old the pool is
    /// rather than implying it is live.
    public let builtAt: Date

    public init(players: [String: IndexedPlayer], builtAt: Date = Date()) {
        self.players = players
        self.builtAt = builtAt
    }

    public subscript(id: String) -> IndexedPlayer? { players[id] }

    public var count: Int { players.count }

    /// Active players only — the pool anything user-facing should draw from.
    public func activePlayers() -> [IndexedPlayer] {
        players.values.filter(\.active)
    }

    public func players(at position: Position) -> [IndexedPlayer] {
        players.values.filter { $0.active && $0.position == position }
    }

    /// Case- and punctuation-insensitive name search, for the player pickers.
    public func search(_ query: String, limit: Int = 25) -> [IndexedPlayer] {
        let needle = PlayerIndex.normalise(query)
        guard !needle.isEmpty else { return [] }
        return players.values
            .filter { $0.active && PlayerIndex.normalise($0.name).contains(needle) }
            .sorted { $0.name < $1.name }
            .prefix(limit)
            .map { $0 }
    }

    static func normalise(_ text: String) -> String {
        text.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    /// Builds the trimmed index from Sleeper's raw payload.
    ///
    /// Decoded leniently on purpose: one malformed player must not cost the
    /// whole pool, and Sleeper's payload is large enough that a single odd
    /// record is a question of when, not if.
    public static func build(fromSleeperPayload data: Data, now: Date = Date()) throws -> PlayerIndex {
        let raw: [String: RawSleeperPlayer]
        do {
            raw = try JSONDecoder().decode([String: RawSleeperPlayer].self, from: data)
        } catch {
            throw DataLayerError.undecodable(
                path: "/players/nfl", underlying: String(describing: error)
            )
        }

        var trimmed: [String: IndexedPlayer] = [:]
        trimmed.reserveCapacity(raw.count)
        for (id, player) in raw {
            guard let name = player.bestName(id: id) else { continue }
            trimmed[id] = IndexedPlayer(
                id: id,
                name: name,
                positionCode: player.position,
                team: player.team,
                injuryStatus: player.injuryStatus,
                // Sleeper omits `active` on some records; absent is treated as
                // inactive so an unknown player never silently joins the pool.
                active: player.active ?? false
            )
        }
        return PlayerIndex(players: trimmed, builtAt: now)
    }
}

/// Sleeper's player record, decoded only as far as the projection needs.
struct RawSleeperPlayer: Decodable {
    let fullName: String?
    let firstName: String?
    let lastName: String?
    let position: String?
    let team: String?
    let injuryStatus: String?
    let active: Bool?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case firstName = "first_name"
        case lastName = "last_name"
        case position, team, active
        case injuryStatus = "injury_status"
    }

    /// Team defenses have no `full_name` and often no first/last name either —
    /// their id *is* the team, so fall back to it rather than dropping them.
    func bestName(id: String) -> String? {
        if let fullName, !fullName.isEmpty { return fullName }
        let joined = [firstName, lastName].compactMap { $0 }.joined(separator: " ")
        if !joined.trimmingCharacters(in: .whitespaces).isEmpty { return joined }
        if position == "DEF" || Position(sleeper: position) == .def {
            return NFLTeams.name(abbreviation: id) ?? id
        }
        return nil
    }
}
