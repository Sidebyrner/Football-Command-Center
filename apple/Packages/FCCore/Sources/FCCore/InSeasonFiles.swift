import Foundation

// The four in-season files described in docs/IN_SEASON_DATA.md. Each is decoded
// by zipping its own `fields` header against tuple rows, never by fixed index,
// and a column the file lacks reads as absent rather than zero.

/// One line of a shared `_meta` block.
public struct InSeasonFileMeta: Decodable, Sendable {
    public let generated: String?
    public let season: Int?
    public let source: String?
    public let weeks: [Int]?
    public let asOf: String?

    /// `generated` as a date, for freshness labels.
    public var generatedAt: Date? {
        generated.flatMap { ISO8601DateFormatter.inSeason.date(from: $0) }
    }
}

extension ISO8601DateFormatter {
    static let inSeason: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

/// Reads a tuple row through its file's header.
struct TupleReader {
    private let index: [String: Int]
    private let row: [RawStatValue]

    init(fields: [String], row: [RawStatValue]) {
        var index: [String: Int] = [:]
        for (position, field) in fields.enumerated() { index[field] = position }
        self.index = index
        self.row = row
    }

    func number(_ field: String) -> Double? {
        guard let position = index[field], position < row.count,
              case .number(let value) = row[position], value.isFinite else { return nil }
        return value
    }

    func text(_ field: String) -> String? {
        guard let position = index[field], position < row.count else { return nil }
        switch row[position] {
        case .text(let value): return value.isEmpty ? nil : value
        case .number(let value): return String(Int(value))
        case .null: return nil
        }
    }

    func int(_ field: String) -> Int? {
        number(field).map { Int($0) }
    }
}

// MARK: - Injuries

/// A player's game designation on the official injury report.
public enum InjuryDesignation: String, Hashable, Sendable, Comparable {
    case out = "Out"
    case doubtful = "Doubtful"
    case questionable = "Questionable"

    /// Worse first.
    private var severity: Int {
        switch self {
        case .out: return 0
        case .doubtful: return 1
        case .questionable: return 2
        }
    }

    public static func < (lhs: InjuryDesignation, rhs: InjuryDesignation) -> Bool {
        lhs.severity < rhs.severity
    }
}

/// The latest practice participation nflverse has for the week.
public enum PracticeStatus: String, Hashable, Sendable {
    case didNotParticipate = "DNP"
    case limited = "LTD"
    case full = "FULL"

    public var label: String {
        switch self {
        case .didNotParticipate: return "Did not practice"
        case .limited: return "Limited"
        case .full: return "Full"
        }
    }

    /// The phrase for a headline: "Did not practice", "Limited practice".
    public var phrase: String {
        switch self {
        case .didNotParticipate: return "Did not practice"
        case .limited: return "Limited practice"
        case .full: return "Full practice"
        }
    }
}

/// One player's line on a week's official injury report.
public struct PracticeReport: Hashable, Sendable {
    public let gsisID: String
    public let team: String?
    public let position: Position?
    public let designation: InjuryDesignation?
    public let practice: PracticeStatus?
    /// The reported primary injury — "Knee", "Hamstring".
    public let injury: String?

    public init(gsisID: String, team: String?, position: Position?, designation: InjuryDesignation?, practice: PracticeStatus?, injury: String?) {
        self.gsisID = gsisID
        self.team = team
        self.position = position
        self.designation = designation
        self.practice = practice
        self.injury = injury
    }
}

/// `injuries-{season}.json`.
public struct InjuryReportFile: Decodable, Sendable {
    public let fileMeta: InSeasonFileMeta?
    public let fields: [String]
    private let byWeek: [String: [[RawStatValue]]]

    enum CodingKeys: String, CodingKey {
        case fields, byWeek
        case fileMeta = "_meta"
    }

    public var weeks: [Int] { byWeek.keys.compactMap(Int.init).sorted() }

    public func reports(week: Int) -> [PracticeReport] {
        (byWeek[String(week)] ?? []).compactMap { row in
            let reader = TupleReader(fields: fields, row: row)
            guard let gsis = reader.text("gsis") else { return nil }
            return PracticeReport(
                gsisID: gsis,
                team: reader.text("team"),
                position: Position(sleeper: reader.text("pos")),
                designation: reader.text("status").flatMap(InjuryDesignation.init(rawValue:)),
                practice: reader.text("practice").flatMap(PracticeStatus.init(rawValue:)),
                injury: reader.text("primary")
            )
        }
    }

    /// Reports keyed by gsis id for one week.
    public func reportsByPlayer(week: Int) -> [String: PracticeReport] {
        Dictionary(reports(week: week).map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
    }
}

// MARK: - Depth charts

/// `depth-{season}.json`: each team's latest official depth chart, by position
/// group, in depth order.
public struct DepthChartFile: Decodable, Sendable {
    public let fileMeta: InSeasonFileMeta?
    private let teams: [String: [String: [String]]]

    enum CodingKeys: String, CodingKey {
        case teams
        case fileMeta = "_meta"
    }

    public var teamCount: Int { teams.count }

    /// gsis ids at a position for a team, starters first. Empty when unknown.
    public func chart(team: String?, position: Position) -> [String] {
        guard let team, let groups = teams[NFLTeams.nflverse(team) ?? team] else { return [] }
        return groups[position.rawValue] ?? []
    }

    /// Zero-based depth of a player at his position, `nil` when not listed.
    public func rank(gsisID: String, team: String?, position: Position) -> Int? {
        chart(team: team, position: position).firstIndex(of: gsisID)
    }

    /// The players listed behind one player at his position, in order.
    public func behind(gsisID: String, team: String?, position: Position) -> [String] {
        let chart = chart(team: team, position: position)
        guard let index = chart.firstIndex(of: gsisID) else { return [] }
        return Array(chart[(index + 1)...])
    }
}

// MARK: - Usage

/// One player-week of usage: snaps, expected points, and pfr's contact stats.
/// Every field is optional because each comes from a different source that may
/// have no row for the player that week; absent is not zero.
public struct UsageWeek: Hashable, Sendable {
    public let week: Int
    public let offensiveSnaps: Double?
    public let offensiveSnapShare: Double?
    public let defensiveSnaps: Double?
    public let defensiveSnapShare: Double?
    public let expectedPoints: Double?
    public let expectedRushPoints: Double?
    public let expectedReceivingPoints: Double?
    public let rushAttempts: Double?
    public let targets: Double?
    public let yardsBeforeContactPerAttempt: Double?
    public let yardsAfterContactPerAttempt: Double?
    public let brokenTackles: Double?
    public let drops: Double?
}

/// Name, position and team as the usage file's `meta` records them.
public struct UsagePlayerMeta: Decodable, Hashable, Sendable {
    public let name: String
    public let positionCode: String?
    public let team: String?

    public var position: Position? { Position(sleeper: positionCode) }

    enum CodingKeys: String, CodingKey {
        case name = "n"
        case positionCode = "p"
        case team = "t"
    }
}

/// `usage-{season}.json`.
public struct UsageFile: Decodable, Sendable {
    public let fileMeta: InSeasonFileMeta?
    public let fields: [String]
    public let meta: [String: UsagePlayerMeta]
    private let players: [String: [[RawStatValue]]]

    enum CodingKeys: String, CodingKey {
        case fields, meta, players
        case fileMeta = "_meta"
    }

    public var playerCount: Int { players.count }
    public var playerIDs: [String] { Array(players.keys) }

    /// Every usage week for a player, ascending. Empty when absent.
    public func weeks(for gsisID: String) -> [UsageWeek] {
        (players[gsisID] ?? []).compactMap { row in
            let reader = TupleReader(fields: fields, row: row)
            guard let week = reader.int("week") else { return nil }
            return UsageWeek(
                week: week,
                offensiveSnaps: reader.number("off_snp"),
                offensiveSnapShare: reader.number("off_pct"),
                defensiveSnaps: reader.number("def_snp"),
                defensiveSnapShare: reader.number("def_pct"),
                expectedPoints: reader.number("xfp"),
                expectedRushPoints: reader.number("xfp_rush"),
                expectedReceivingPoints: reader.number("xfp_rec"),
                rushAttempts: reader.number("rush_att"),
                targets: reader.number("tgt"),
                yardsBeforeContactPerAttempt: reader.number("ybc_avg"),
                yardsAfterContactPerAttempt: reader.number("yac_avg"),
                brokenTackles: reader.number("broken_tackles"),
                drops: reader.number("drops")
            )
        }.sorted { $0.week < $1.week }
    }

    /// The last `count` weeks with a row, most recent last.
    public func recentWeeks(for gsisID: String, count: Int) -> [UsageWeek] {
        Array(weeks(for: gsisID).suffix(count))
    }
}

// MARK: - Team context

/// One team-week of situational context: protection, quarterback play, target
/// concentration and pace.
public struct TeamContextWeek: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    public let plays: Double?
    public let passAttempts: Double?
    public let rushAttempts: Double?
    /// Share of dropbacks on which the primary passer was pressured.
    public let pressureRate: Double?
    public let sacksAllowed: Double?
    public let yardsBeforeContactPerAttempt: Double?
    /// ESPN Total QBR for the team's quarterback that week.
    public let qbr: Double?
    public let passerRating: Double?
    /// Share of the team's targets taken by its most-targeted player.
    public let topTargetShare: Double?
    public let topTwoTargetShare: Double?
}

/// `context-{season}.json`.
public struct TeamContextFile: Decodable, Sendable {
    public let fileMeta: InSeasonFileMeta?
    public let fields: [String]
    private let teams: [String: [[RawStatValue]]]

    enum CodingKeys: String, CodingKey {
        case fields, teams
        case fileMeta = "_meta"
    }

    public var teamCount: Int { teams.count }

    public func weeks(team: String?) -> [TeamContextWeek] {
        guard let team, let rows = teams[NFLTeams.nflverse(team) ?? team] else { return [] }
        return rows.compactMap { row in
            let reader = TupleReader(fields: fields, row: row)
            guard let week = reader.int("week") else { return nil }
            return TeamContextWeek(
                week: week,
                opponent: reader.text("opp"),
                plays: reader.number("plays"),
                passAttempts: reader.number("pass_att"),
                rushAttempts: reader.number("rush_att"),
                pressureRate: reader.number("pressure_pct"),
                sacksAllowed: reader.number("sacks"),
                yardsBeforeContactPerAttempt: reader.number("ybc_avg"),
                qbr: reader.number("qbr"),
                passerRating: reader.number("pass_rtg"),
                topTargetShare: reader.number("top_tgt_share"),
                topTwoTargetShare: reader.number("top2_tgt_share")
            )
        }.sorted { $0.week < $1.week }
    }

    /// Every team's weeks, for league-wide percentiles.
    public func allTeams() -> [String: [TeamContextWeek]] {
        Dictionary(uniqueKeysWithValues: teams.keys.map { ($0, weeks(team: $0)) })
    }
}
