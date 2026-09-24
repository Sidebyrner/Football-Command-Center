import Foundation
import FCCore

// Payloads from Sleeper's undocumented projection, stats and news routes. They
// are read-only, keyless and unofficial, so every model decodes leniently and
// every caller labels the source. Nothing here is cached raw beyond its TTL.

/// The player block Sleeper embeds in a projection or stat line.
public struct SleeperLinePlayer: Codable, Hashable, Sendable {
    public let firstName: String?
    public let lastName: String?
    public let position: String?
    public let team: String?
    public let injuryStatus: String?
    public let injuryBodyPart: String?
    public let injuryNotes: String?
    /// Milliseconds since 1970, as Sleeper sends it.
    public let newsUpdated: Double?

    enum CodingKeys: String, CodingKey {
        case firstName = "first_name"
        case lastName = "last_name"
        case position, team
        case injuryStatus = "injury_status"
        case injuryBodyPart = "injury_body_part"
        case injuryNotes = "injury_notes"
        case newsUpdated = "news_updated"
    }

    public var name: String {
        [firstName, lastName].compactMap { $0 }.joined(separator: " ")
    }
}

/// One player's projected stat line for a week, from Rotowire via Sleeper.
public struct SleeperProjection: Codable, Hashable, Sendable, Identifiable {
    public let playerID: String
    public let week: Int?
    public let season: String?
    public let team: String?
    public let opponent: String?
    /// Sleeper's stat keys with fractional units — `rush_att: 19.7`.
    public let stats: [String: Double]
    public let player: SleeperLinePlayer?
    /// Who produced the numbers. Sleeper reports `rotowire` today; the label
    /// on screen comes from here rather than being assumed.
    public let company: String?
    /// Milliseconds since 1970.
    public let updatedAt: Double?
    public let gameDate: String?

    public var id: String { playerID }

    enum CodingKeys: String, CodingKey {
        case playerID = "player_id"
        case week, season, team, opponent, stats, player, company
        case updatedAt = "updated_at"
        case gameDate = "date"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        playerID = try container.decode(String.self, forKey: .playerID)
        week = try container.decodeIfPresent(Int.self, forKey: .week)
        season = try container.decodeIfPresent(String.self, forKey: .season)
        team = try container.decodeIfPresent(String.self, forKey: .team)
        opponent = try container.decodeIfPresent(String.self, forKey: .opponent)
        stats = (try? container.decodeIfPresent([String: Double?].self, forKey: .stats))?
            .compactMapValues { $0 } ?? [:]
        player = try? container.decodeIfPresent(SleeperLinePlayer.self, forKey: .player)
        company = try container.decodeIfPresent(String.self, forKey: .company)
        updatedAt = try container.decodeIfPresent(Double.self, forKey: .updatedAt)
        gameDate = try container.decodeIfPresent(String.self, forKey: .gameDate)
    }

    public init(playerID: String, week: Int?, season: String?, team: String?, opponent: String?, stats: [String: Double], player: SleeperLinePlayer?, company: String?, updatedAt: Double?, gameDate: String?) {
        self.playerID = playerID
        self.week = week
        self.season = season
        self.team = team
        self.opponent = opponent
        self.stats = stats
        self.player = player
        self.company = company
        self.updatedAt = updatedAt
        self.gameDate = gameDate
    }

    public var position: Position? { Position(sleeper: player?.position) }

    /// The label every projected number carries on screen.
    public var sourceLabel: String {
        switch company?.lowercased() {
        case "rotowire": return "Rotowire via Sleeper"
        case let other?: return "\(other.capitalized) via Sleeper"
        case nil: return "Sleeper"
        }
    }

    /// Points under a league's own scoring.
    public func score(scoring: [String: Double]) -> SleeperScoredLine {
        SleeperStatScoring.score(stats: stats, scoring: scoring)
    }
}

/// One player's actual stat line for a week, from Sleeper.
///
/// Unlike the nflverse weekly file this covers DEF and IDP, and carries snap
/// counts (`off_snp`, `tm_off_snp`, `def_snp`), red-zone targets and air yards.
public struct SleeperWeekStat: Codable, Hashable, Sendable, Identifiable {
    public let playerID: String
    public let week: Int?
    public let season: String?
    public let team: String?
    public let opponent: String?
    public let stats: [String: Double]
    public let player: SleeperLinePlayer?
    public let updatedAt: Double?
    public let gameDate: String?

    public var id: String { playerID }

    enum CodingKeys: String, CodingKey {
        case playerID = "player_id"
        case week, season, team, opponent, stats, player
        case updatedAt = "updated_at"
        case gameDate = "date"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        playerID = try container.decode(String.self, forKey: .playerID)
        week = try container.decodeIfPresent(Int.self, forKey: .week)
        season = try container.decodeIfPresent(String.self, forKey: .season)
        team = try container.decodeIfPresent(String.self, forKey: .team)
        opponent = try container.decodeIfPresent(String.self, forKey: .opponent)
        stats = (try? container.decodeIfPresent([String: Double?].self, forKey: .stats))?
            .compactMapValues { $0 } ?? [:]
        player = try? container.decodeIfPresent(SleeperLinePlayer.self, forKey: .player)
        updatedAt = try container.decodeIfPresent(Double.self, forKey: .updatedAt)
        gameDate = try container.decodeIfPresent(String.self, forKey: .gameDate)
    }

    public init(playerID: String, week: Int?, season: String?, team: String?, opponent: String?, stats: [String: Double], player: SleeperLinePlayer?, updatedAt: Double?, gameDate: String?) {
        self.playerID = playerID
        self.week = week
        self.season = season
        self.team = team
        self.opponent = opponent
        self.stats = stats
        self.player = player
        self.updatedAt = updatedAt
        self.gameDate = gameDate
    }

    public var position: Position? { Position(sleeper: player?.position) }

    /// Did the player take the field. Sleeper reports `gp` for a game played.
    public var played: Bool { (stats["gp"] ?? 0) > 0 }

    /// Offensive snap share, `nil` when Sleeper has no snap count.
    public var offensiveSnapShare: Double? {
        guard let snaps = stats["off_snp"], let team = stats["tm_off_snp"], team > 0 else { return nil }
        return snaps / team
    }

    /// Defensive snap share for IDP.
    public var defensiveSnapShare: Double? {
        guard let snaps = stats["def_snp"], let team = stats["tm_def_snp"], team > 0 else { return nil }
        return snaps / team
    }

    public var targets: Double? { stats["rec_tgt"] }
    public var redZoneTargets: Double? { stats["rec_rz_tgt"] }
    public var redZoneCarries: Double? { stats["rush_rz_att"] }
    public var airYards: Double? { stats["rec_air_yd"] }

    /// Points under a league's own scoring.
    public func score(scoring: [String: Double]) -> SleeperScoredLine {
        SleeperStatScoring.score(stats: stats, scoring: scoring)
    }
}

/// One news item Sleeper relays for a player (FantasyPros or Rotowire).
public struct SleeperPlayerNews: Codable, Hashable, Sendable, Identifiable {
    public struct Metadata: Codable, Hashable, Sendable {
        public let title: String?
        public let description: String?
        public let analysis: String?
        public let url: String?
    }

    public let playerID: String?
    public let source: String?
    public let sourceKey: String?
    /// Milliseconds since 1970.
    public let published: Double?
    public let metadata: Metadata?

    public var id: String { sourceKey ?? "\(playerID ?? "")-\(published ?? 0)" }

    enum CodingKeys: String, CodingKey {
        case playerID = "player_id"
        case source
        case sourceKey = "source_key"
        case published, metadata
    }

    public var title: String? { metadata?.title }
    public var publishedAt: Date? { published.map { Date(timeIntervalSince1970: $0 / 1_000) } }

    public var sourceLabel: String {
        switch source?.lowercased() {
        case "fantasy_pros", "fantasypros": return "FantasyPros via Sleeper"
        case "rotowire": return "Rotowire via Sleeper"
        case let other?: return "\(other.capitalized) via Sleeper"
        case nil: return "Sleeper"
        }
    }
}
