import Foundation

/// The columns the nflverse weekly file can carry.
///
/// Rows in the file are tuples positionally matched to its own `fields` header,
/// so decoding zips the header against the tuple — never a fixed index. The
/// field list has changed before and will again (§3.2), and a column reordering
/// upstream must not silently shift values here.
///
/// A field present in the file but missing from this enum is ignored, not an
/// error: tolerating a newer schema than we know is a requirement (§9).
public enum Stat: String, CaseIterable, Hashable, Sendable {
    case week
    case team
    case opponent = "opp"
    case completions = "cmp"
    case attempts = "att"
    case passYards = "pass_yd"
    case passTD = "pass_td"
    case interceptions = "int"
    case sacks = "sack"
    case passFirstDowns = "pass_fd"
    case pass2pt = "pass_2pt"
    case carries = "car"
    case rushYards = "rush_yd"
    case rushTD = "rush_td"
    case rushFirstDowns = "rush_fd"
    case rushFumblesLost = "rush_fl"
    case rush2pt = "rush_2pt"
    case receptions = "rec"
    case targets = "tgt"
    case recYards = "rec_yd"
    case recTD = "rec_td"
    case recFirstDowns = "rec_fd"
    case recFumblesLost = "rec_fl"
    case rec2pt = "rec_2pt"
    case sackFumblesLost = "sack_fl"
    case specialTeamsTD = "st_td"
    case fg0to19 = "fg0_19"
    case fg20to29 = "fg20_29"
    case fg30to39 = "fg30_39"
    case fg40to49 = "fg40_49"
    case fg50to59 = "fg50_59"
    case fg60plus = "fg60"
    case fgMissed = "fg_miss"
    case extraPointsMade = "xpm"
    case extraPointsAttempted = "xpa"
    case targetShare = "tgt_share"
    case airYardsShare = "ay_share"
    /// nflverse's own `fantasy_points_ppr` for this row. Present so the engine
    /// can be checked against it — never used as a score in the app.
    case pprReference = "fp_ppr_ref"
}

/// One decoded weekly stat line.
///
/// `value(_:)` returns `nil` for a column this row does not carry, which is a
/// different claim from zero — `pprReference` in particular must stay
/// distinguishable so the correctness gate can skip rows it cannot check.
public struct WeeklyRow: Hashable, Sendable {
    public let week: Int
    public let team: String?
    public let opponent: String?
    private let numbers: [Stat: Double]

    public init(week: Int, team: String?, opponent: String?, numbers: [Stat: Double]) {
        self.week = week
        self.team = team
        self.opponent = opponent
        self.numbers = numbers
    }

    /// The column's value, or `nil` when this row does not carry it.
    public func value(_ stat: Stat) -> Double? {
        guard let raw = numbers[stat], raw.isFinite else { return nil }
        return raw
    }

    /// The column's value with a missing column read as zero. Correct for
    /// scoring arithmetic — a stat line that omits `rush_yd` genuinely rushed
    /// for none — and wrong for anything that needs to know the column was
    /// absent, which uses `value(_:)` instead.
    public func number(_ stat: Stat) -> Double {
        finite(value(stat))
    }
}

/// Name and position as recorded in the weekly file's `meta` map.
public struct WeeklyPlayerMeta: Decodable, Hashable, Sendable {
    public let name: String
    public let positionCode: String

    public var position: Position? { Position(sleeper: positionCode) }

    enum CodingKeys: String, CodingKey {
        case name = "n"
        case positionCode = "p"
    }
}

/// A JSON scalar inside a stat tuple. Rows mix numbers with team codes and
/// nulls, so the tuple cannot decode as `[Double]`.
enum RawStatValue: Decodable, Hashable, Sendable {
    case number(Double)
    case text(String)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .text(value)
        } else if let value = try? container.decode(Bool.self) {
            self = .number(value ? 1 : 0)
        } else {
            self = .null
        }
    }
}

/// `public/data/weekly/{season}.json` — the most important file in the app.
///
/// Coverage gap you must not paper over: it holds **QB, RB, WR, TE and K only**.
/// There is no DEF and no IDP production data at all, which in this league is
/// three of eleven starting slots. Anything built on it silently excludes those
/// positions unless the caller says so out loud (§3.2).
public struct WeeklyFile: Decodable, Sendable {
    public let fields: [String]
    public let meta: [String: WeeklyPlayerMeta]
    public let fileMeta: FileMeta?
    private let players: [String: [[RawStatValue]]]

    enum CodingKeys: String, CodingKey {
        case fields, meta, players
        case fileMeta = "_meta"
    }

    public struct FileMeta: Decodable, Sendable {
        public let generated: String?
        public let season: Int?
        public let weeks: [Int]?
        public let complete: Bool?
        public let rowCount: Int?
        public let playerCount: Int?
        public let source: String?
    }

    /// gsis ids present in the file.
    public var playerIDs: [String] { Array(players.keys) }

    public var playerCount: Int { players.count }

    public var rowCount: Int { players.values.reduce(0) { $0 + $1.count } }

    public func playerMeta(for gsisID: String) -> WeeklyPlayerMeta? { meta[gsisID] }

    public func position(for gsisID: String) -> Position? { meta[gsisID]?.position }

    /// Every decoded week for one player, ascending. Empty when absent.
    public func rows(for gsisID: String) -> [WeeklyRow] {
        guard let tuples = players[gsisID] else { return [] }
        return tuples.compactMap { decode($0) }.sorted { $0.week < $1.week }
    }

    /// One player with their decoded season.
    public struct PlayerSeason: Sendable {
        public let gsisID: String
        public let meta: WeeklyPlayerMeta?
        public let rows: [WeeklyRow]

        public var position: Position? { meta?.position }
    }

    /// Every player in the file with their decoded rows, in a stable order so
    /// two runs over the same file produce the same output.
    public func allPlayers() -> [PlayerSeason] {
        players.keys.sorted().map {
            PlayerSeason(gsisID: $0, meta: meta[$0], rows: rows(for: $0))
        }
    }

    /// Zips this file's own `fields` header against one tuple.
    func decode(_ tuple: [RawStatValue]) -> WeeklyRow? {
        var numbers: [Stat: Double] = [:]
        var week: Int?
        var team: String?
        var opponent: String?

        for (index, field) in fields.enumerated() {
            guard index < tuple.count, let stat = Stat(rawValue: field) else { continue }
            switch tuple[index] {
            case .number(let value):
                switch stat {
                case .week: week = Int(value)
                default: numbers[stat] = value
                }
            case .text(let value):
                switch stat {
                case .team: team = value
                case .opponent: opponent = value
                case .week: week = Int(value)
                default: break
                }
            case .null:
                continue
            }
        }

        guard let week else { return nil }
        return WeeklyRow(week: week, team: team, opponent: opponent, numbers: numbers)
    }
}

/// `public/data/weekly/index.json` — which seasons are on disk and how fresh.
public struct WeeklyManifest: Decodable, Sendable {
    public let seasons: [SeasonEntry]
    public let fileMeta: FileMeta?

    enum CodingKeys: String, CodingKey {
        case seasons
        case fileMeta = "_meta"
    }

    public struct FileMeta: Decodable, Sendable {
        public let generated: String?
    }

    public struct SeasonEntry: Decodable, Sendable {
        public let season: Int
        public let file: String
        public let weeks: Int?
        public let latestWeek: Int?
        public let complete: Bool?
        public let bytes: Int?
    }
}
