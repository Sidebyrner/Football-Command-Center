import Foundation
import FCCore
import FCData

/// One NFL team's passing-game environment this week, from its offense's side,
/// as it bears on its tight ends.
public struct TETeamContext: StreamTeamContext {
    /// nflverse team code.
    public var team: String
    /// nflverse code of the defense this offense faces.
    public var opponent: String
    public var home: Bool?
    /// Positive when this team is the underdog (so it throws more).
    public var spreadOff: Double
    public var total: Double
    /// Points the opposing defense allows to TEs, % above (+) or below average.
    public var dvpPct: Double?
    public var dvpGames: Int
    /// 1.0 neutral; above when the opponent's linebackers or safeties are hurt
    /// or weak in coverage, below against a strong coverage linebacker or safety.
    public var seamCoverageAdj: Double
    public var linesSource: StreamContextSource
    public var dvpSource: StreamContextSource
    public var seamCoverageSource: StreamContextSource

    public var id: String { team }
    public var spread: Double { spreadOff }

    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

/// A manual or imported change to one team's TE context. `nil` keeps the auto value.
public struct TETeamOverride: StreamOverride {
    public var spreadOff: Double?
    public var total: Double?
    public var dvpPct: Double?
    public var dvpGames: Int?
    public var seamCoverageAdj: Double?
    public var source: StreamContextSource

    public init(spreadOff: Double? = nil, total: Double? = nil, dvpPct: Double? = nil, dvpGames: Int? = nil,
                seamCoverageAdj: Double? = nil, source: StreamContextSource = .manual) {
        self.spreadOff = spreadOff
        self.total = total
        self.dvpPct = dvpPct
        self.dvpGames = dvpGames
        self.seamCoverageAdj = seamCoverageAdj
        self.source = source
    }

    public var isEmpty: Bool {
        spreadOff == nil && total == nil && dvpPct == nil && dvpGames == nil && seamCoverageAdj == nil
    }
}

/// A manual change to one tight end's inputs, keyed by Sleeper id.
public struct TEPlayerOverride: StreamOverride {
    public var role: TERole?
    public var practice: StreamPractice?
    public var roleConf: Double?
    public var redZoneShare: Double?
    public var targetShareEst: Double?
    /// Share of targets freed up by an injured teammate (WR1, the other TE); capped at 0.10.
    public var vacatedTargetBoost: Double?
    public var notes: String?

    public init(role: TERole? = nil, practice: StreamPractice? = nil, roleConf: Double? = nil,
                redZoneShare: Double? = nil, targetShareEst: Double? = nil, vacatedTargetBoost: Double? = nil,
                notes: String? = nil) {
        self.role = role
        self.practice = practice
        self.roleConf = roleConf
        self.redZoneShare = redZoneShare
        self.targetShareEst = targetShareEst
        self.vacatedTargetBoost = vacatedTargetBoost
        self.notes = notes
    }

    public var isEmpty: Bool {
        role == nil && practice == nil && roleConf == nil && redZoneShare == nil && targetShareEst == nil
            && vacatedTargetBoost == nil && (notes ?? "").isEmpty
    }
}

public typealias TEWeekOverrides = StreamWeekOverrides<TETeamOverride, TEPlayerOverride>

// MARK: - Autofill

public enum TEContextAutofill {
    static let neutralTotal = 45.0

    /// Every team playing `week`, filled from the schedule's recorded lines and
    /// the Sleeper side of the defense-vs-position table (points TEs scored
    /// against each defense), over the table's sample floor. Seam coverage
    /// starts neutral.
    public static func build(schedule: ScheduleFile, week: Int, defense: DefenseVsPositionTable) -> [String: TETeamContext] {
        var out: [String: TETeamContext] = [:]
        for (team, line) in GameLines.week(schedule, week: week) {
            var dvp: Double?
            var games = 0
            if let cell = defense.cell(defense: line.opponent, position: .te), cell.rank != nil,
               let perGame = cell.perGame, let average = defense.leagueAverage[.te], average > 0 {
                dvp = (perGame / average - 1) * 100
                games = cell.games
            }
            let hasLines = line.spread != nil && line.total != nil
            out[team] = TETeamContext(
                team: team,
                opponent: line.opponent,
                home: line.isHome,
                // TeamGameLine.spread is negative when this team is favored,
                // which is the engine's spreadOff convention (+ = underdog).
                spreadOff: line.spread ?? 0,
                total: line.total ?? neutralTotal,
                dvpPct: dvp,
                dvpGames: games,
                seamCoverageAdj: 1,
                linesSource: hasLines ? .schedule : .standard,
                dvpSource: dvp == nil ? .standard : .sleeperDvP,
                seamCoverageSource: .standard
            )
        }
        return out
    }

    public static func apply(_ overrides: [String: TETeamOverride], to teams: [String: TETeamContext]) -> [String: TETeamContext] {
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
            if let coverage = change.seamCoverageAdj { context.seamCoverageAdj = coverage; context.seamCoverageSource = change.source }
            out[team] = context
        }
        return out
    }
}

// MARK: - Import

/// Reads a TE context file in the IDP tool's shape: teams keyed by code, each
/// with `spreadOff` (or `spreadDef`), `total`, `dvpPct` (a number, or `{ "TE": n }`),
/// `dvpGames`, `seamCoverageAdj` (or the shared file's `teCoverageAdj`); players keyed by Sleeper id. Keys starting with
/// `_` are comments.
public enum TEContextImport {
    public enum ImportError: Error, CustomStringConvertible {
        case notAnObject
        public var description: String { "That file is not a TE context file (expected a \"teams\" object)." }
    }

    public static func parse(_ data: Data) throws -> TEWeekOverrides {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let teams = root["teams"] as? [String: Any] else { throw ImportError.notAnObject }
        var out = TEWeekOverrides()
        for (key, value) in teams where !key.hasPrefix("_") {
            guard let row = value as? [String: Any], let team = NFLTeams.nflverse(key.uppercased()) else { continue }
            let dvp = number(row["dvpPct"]) ?? (row["dvpPct"] as? [String: Any]).flatMap { number($0["TE"]) }
            let change = TETeamOverride(
                spreadOff: number(row["spreadOff"]) ?? number(row["spreadDef"]),
                total: number(row["total"]), dvpPct: dvp,
                dvpGames: number(row["dvpGames"]).map { Int($0) },
                seamCoverageAdj: number(row["seamCoverageAdj"]) ?? number(row["teCoverageAdj"]),
                source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        if let players = root["players"] as? [String: Any] {
            for (id, value) in players where !id.hasPrefix("_") {
                guard let row = value as? [String: Any] else { continue }
                let change = TEPlayerOverride(
                    role: (row["role"] as? String).flatMap(TERole.init(rawValue:)),
                    practice: (row["practice"] as? String).flatMap(StreamPractice.init(rawValue:)),
                    roleConf: number(row["roleConf"]),
                    redZoneShare: number(row["rzShare"]),
                    targetShareEst: number(row["tgtShareEst"]),
                    vacatedTargetBoost: number(row["vacatedTargetBoost"]),
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
