import Foundation
import FCCore
import FCData

/// One NFL team's running-game environment this week, from its offense's side.
public struct RBTeamContext: StreamTeamContext {
    /// nflverse team code.
    public var team: String
    /// nflverse code of the defense this offense faces.
    public var opponent: String
    public var home: Bool?
    /// Positive when this team is the underdog (so it runs less).
    public var spreadOff: Double
    public var total: Double
    /// Points the opposing defense allows to RBs, % above (+) or below average.
    public var dvpPct: Double?
    public var dvpGames: Int
    /// O-line / box-count / front-seven-injury adjustment; 1.0 neutral.
    public var lineAdj: Double
    public var linesSource: StreamContextSource
    public var dvpSource: StreamContextSource
    public var lineSource: StreamContextSource

    public var id: String { team }
    public var spread: Double { spreadOff }
    /// Points this team is expected to score.
    public var implied: Double { (total - spreadOff) / 2 }

    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

/// A manual or imported change to one team's RB context. `nil` keeps the auto value.
public struct RBTeamOverride: StreamOverride {
    public var spreadOff: Double?
    public var total: Double?
    public var dvpPct: Double?
    public var dvpGames: Int?
    public var lineAdj: Double?
    public var source: StreamContextSource

    public init(spreadOff: Double? = nil, total: Double? = nil, dvpPct: Double? = nil, dvpGames: Int? = nil,
                lineAdj: Double? = nil, source: StreamContextSource = .manual) {
        self.spreadOff = spreadOff
        self.total = total
        self.dvpPct = dvpPct
        self.dvpGames = dvpGames
        self.lineAdj = lineAdj
        self.source = source
    }

    public var isEmpty: Bool {
        spreadOff == nil && total == nil && dvpPct == nil && dvpGames == nil && lineAdj == nil
    }
}

/// A manual change to one back's inputs, keyed by Sleeper id.
public struct RBPlayerOverride: StreamOverride {
    public var role: RBRole?
    public var practice: StreamPractice?
    public var roleConf: Double?
    public var redZoneShare: Double?
    public var carryShareEst: Double?
    public var notes: String?

    public init(role: RBRole? = nil, practice: StreamPractice? = nil, roleConf: Double? = nil,
                redZoneShare: Double? = nil, carryShareEst: Double? = nil, notes: String? = nil) {
        self.role = role
        self.practice = practice
        self.roleConf = roleConf
        self.redZoneShare = redZoneShare
        self.carryShareEst = carryShareEst
        self.notes = notes
    }

    public var isEmpty: Bool {
        role == nil && practice == nil && roleConf == nil && redZoneShare == nil && carryShareEst == nil
            && (notes ?? "").isEmpty
    }
}

public typealias RBWeekOverrides = StreamWeekOverrides<RBTeamOverride, RBPlayerOverride>

// MARK: - Autofill

public enum RBContextAutofill {
    static let neutralTotal = 45.0

    /// Every team playing `week`, from the schedule's recorded lines and the
    /// Sleeper side of the defense-vs-position table (points RBs scored against
    /// each defense), over the table's sample floor.
    public static func build(schedule: ScheduleFile, week: Int, defense: DefenseVsPositionTable) -> [String: RBTeamContext] {
        var out: [String: RBTeamContext] = [:]
        for (team, line) in GameLines.week(schedule, week: week) {
            var dvp: Double?
            var games = 0
            if let cell = defense.cell(defense: line.opponent, position: .rb), cell.rank != nil,
               let perGame = cell.perGame, let average = defense.leagueAverage[.rb], average > 0 {
                dvp = (perGame / average - 1) * 100
                games = cell.games
            }
            let hasLines = line.spread != nil && line.total != nil
            out[team] = RBTeamContext(
                team: team,
                opponent: line.opponent,
                home: line.isHome,
                // Negative when this team is favored — the engine's convention.
                spreadOff: line.spread ?? 0,
                total: line.total ?? neutralTotal,
                dvpPct: dvp,
                dvpGames: games,
                lineAdj: 1,
                linesSource: hasLines ? .schedule : .standard,
                dvpSource: dvp == nil ? .standard : .sleeperDvP,
                lineSource: .standard
            )
        }
        return out
    }

    public static func apply(_ overrides: [String: RBTeamOverride], to teams: [String: RBTeamContext]) -> [String: RBTeamContext] {
        var out = teams
        for (team, change) in overrides {
            guard var context = out[team], !change.isEmpty else { continue }
            if let spread = change.spreadOff { context.spreadOff = spread; context.linesSource = change.source }
            if let total = change.total { context.total = total; context.linesSource = change.source }
            if let dvp = change.dvpPct {
                context.dvpPct = dvp
                context.dvpGames = change.dvpGames ?? max(context.dvpGames, 1)
                context.dvpSource = change.source
            }
            if let line = change.lineAdj { context.lineAdj = line; context.lineSource = change.source }
            out[team] = context
        }
        return out
    }
}

// MARK: - Import

/// Reads an RB context file: teams keyed by code, each with `spreadOff` (or
/// the shared file's `spreadDef`), `total`, `dvpPct` (a number, or
/// `{ "RB": n }`), `dvpGames`, and `lineAdj` (or `rbLineAdj`); players keyed by
/// Sleeper id. Keys starting with `_` are comments.
public enum RBContextImport {
    public enum ImportError: Error, CustomStringConvertible {
        case notAnObject
        public var description: String { "That file is not an RB context file (expected a \"teams\" object)." }
    }

    public static func parse(_ data: Data) throws -> RBWeekOverrides {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let teams = root["teams"] as? [String: Any] else { throw ImportError.notAnObject }
        var out = RBWeekOverrides()
        for (key, value) in teams where !key.hasPrefix("_") {
            guard let row = value as? [String: Any], let team = NFLTeams.nflverse(key.uppercased()) else { continue }
            let dvp = number(row["dvpPct"]) ?? (row["dvpPct"] as? [String: Any]).flatMap { number($0["RB"]) }
            let change = RBTeamOverride(
                spreadOff: number(row["spreadOff"]) ?? number(row["spreadDef"]),
                total: number(row["total"]),
                dvpPct: dvp,
                dvpGames: dvp == nil ? nil : number(row["dvpGames"]).map { Int($0) },
                lineAdj: number(row["lineAdj"]) ?? number(row["rbLineAdj"]),
                source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        if let players = root["players"] as? [String: Any] {
            for (id, value) in players where !id.hasPrefix("_") {
                guard let row = value as? [String: Any] else { continue }
                let change = RBPlayerOverride(
                    role: (row["role"] as? String).flatMap(RBRole.init(rawValue:)),
                    practice: (row["practice"] as? String).flatMap(StreamPractice.init(rawValue:)),
                    roleConf: number(row["roleConf"]),
                    redZoneShare: number(row["rzShare"]),
                    carryShareEst: number(row["carryShareEst"]),
                    notes: row["notes"] as? String
                )
                if !change.isEmpty { out.players[id] = change }
            }
        }
        return out
    }

    private static func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }
}
