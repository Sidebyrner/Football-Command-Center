import Foundation
import FCCore
import FCData

/// Where one piece of an IDP game context came from, so the screen can say so.
public enum IDPContextSource: String, Codable, Hashable, Sendable {
    /// The schedule file's recorded closing lines.
    case schedule
    /// Points Sleeper's own lines show the opponent allowing at this position.
    case sleeperDvP
    /// A neutral default because nothing was known.
    case standard
    /// Typed in on the context editor.
    case manual
    /// From an imported context file.
    case imported

    public var label: String {
        switch self {
        case .schedule: return "Schedule lines"
        case .sleeperDvP: return "Sleeper DvP"
        case .standard: return "Default"
        case .manual: return "Edited"
        case .imported: return "Imported"
        }
    }
}

/// One NFL team's game environment this week, from its defense's side.
public struct IDPTeamContext: Codable, Hashable, Sendable, Identifiable {
    /// nflverse team code.
    public var team: String
    /// nflverse code of the offense this defense faces.
    public var opponent: String
    public var home: Bool?
    /// Positive when this team is the underdog.
    public var spreadDef: Double
    public var total: Double
    /// Opponent generosity to each IDP position, % above (+) or below the average.
    public var dvpPct: [Position: Double]
    public var dvpGames: Int
    /// Opponent pass-protection leakiness; 1.0 is average.
    public var oppSackEnv: Double
    public var linesSource: IDPContextSource
    public var dvpSource: IDPContextSource
    public var sackSource: IDPContextSource

    public var id: String { team }

    /// "@NYG" or "vs NYG".
    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

/// A manual or imported change to one team's context. `nil` keeps the auto value.
public struct IDPTeamOverride: Codable, Hashable, Sendable {
    public var spreadDef: Double?
    public var total: Double?
    public var dvpPct: [Position: Double]?
    public var dvpGames: Int?
    public var oppSackEnv: Double?
    public var source: IDPContextSource

    public init(spreadDef: Double? = nil, total: Double? = nil, dvpPct: [Position: Double]? = nil,
                dvpGames: Int? = nil, oppSackEnv: Double? = nil, source: IDPContextSource = .manual) {
        self.spreadDef = spreadDef
        self.total = total
        self.dvpPct = dvpPct
        self.dvpGames = dvpGames
        self.oppSackEnv = oppSackEnv
        self.source = source
    }

    public var isEmpty: Bool {
        spreadDef == nil && total == nil && dvpPct == nil && dvpGames == nil && oppSackEnv == nil
    }
}

/// A manual change to one player's inputs, keyed by Sleeper id.
public struct IDPPlayerOverride: Codable, Hashable, Sendable {
    public var position: IDPSubPosition?
    public var roleConf: Double?
    public var practice: IDPPractice?
    public var snapShareEst: Double?
    public var pressures: Double?
    public var notes: String?

    public init(position: IDPSubPosition? = nil, roleConf: Double? = nil, practice: IDPPractice? = nil,
                snapShareEst: Double? = nil, pressures: Double? = nil, notes: String? = nil) {
        self.position = position
        self.roleConf = roleConf
        self.practice = practice
        self.snapShareEst = snapShareEst
        self.pressures = pressures
        self.notes = notes
    }

    public var isEmpty: Bool {
        position == nil && roleConf == nil && practice == nil && snapShareEst == nil
            && pressures == nil && (notes ?? "").isEmpty
    }
}

/// Everything the user has changed for one week, persisted by `IDPStreamStore`.
public struct IDPWeekOverrides: Codable, Hashable, Sendable {
    public var teams: [String: IDPTeamOverride] = [:]
    public var players: [String: IDPPlayerOverride] = [:]
    /// The starter candidates are compared against; `nil` picks the weakest.
    public var incumbentID: String?

    public init(teams: [String: IDPTeamOverride] = [:], players: [String: IDPPlayerOverride] = [:],
                incumbentID: String? = nil) {
        self.teams = teams
        self.players = players
        self.incumbentID = incumbentID
    }

    public static let empty = IDPWeekOverrides()
}

// MARK: - Autofill

public enum IDPContextAutofill {
    /// Neutral values used when a game has no recorded line.
    static let neutralTotal = 45.0

    /// Every team playing `week`, filled from the schedule's recorded lines and
    /// the Sleeper side of the defense-vs-position table.
    ///
    /// The IDP half of that table is keyed by the *offense* a defender faced —
    /// it is built from IDP lines with `defense: line.opponent` — which is
    /// exactly "how many IDP points does this offense give up", the matchup
    /// number wanted here.
    public static func build(schedule: ScheduleFile, week: Int, defense: DefenseVsPositionTable) -> [String: IDPTeamContext] {
        var out: [String: IDPTeamContext] = [:]
        for (team, line) in GameLines.week(schedule, week: week) {
            var dvp: [Position: Double] = [:]
            var games = 0
            for position in [Position.lb, .dl, .db] {
                // Only defenses over the table's sample floor are ranked and
                // averaged; below it there is no matchup claim to make.
                guard let cell = defense.cell(defense: line.opponent, position: position),
                      cell.rank != nil, let perGame = cell.perGame,
                      let average = defense.leagueAverage[position], average > 0 else { continue }
                dvp[position] = (perGame / average - 1) * 100
                games = max(games, cell.games)
            }
            let hasLines = line.spread != nil && line.total != nil
            out[team] = IDPTeamContext(
                team: team,
                opponent: line.opponent,
                home: line.isHome,
                // TeamGameLine.spread is negative when this team is favored,
                // which is the engine's convention (+ = underdog) as-is.
                spreadDef: line.spread ?? 0,
                total: line.total ?? neutralTotal,
                dvpPct: dvp,
                dvpGames: dvp.isEmpty ? 0 : games,
                oppSackEnv: 1,
                linesSource: hasLines ? .schedule : .standard,
                dvpSource: dvp.isEmpty ? .standard : .sleeperDvP,
                sackSource: .standard
            )
        }
        return out
    }

    /// Applies the user's overrides on top of the auto values.
    public static func apply(_ overrides: [String: IDPTeamOverride], to teams: [String: IDPTeamContext]) -> [String: IDPTeamContext] {
        var out = teams
        for (team, change) in overrides {
            guard var context = out[team], !change.isEmpty else { continue }
            if let spread = change.spreadDef { context.spreadDef = spread; context.linesSource = change.source }
            if let total = change.total { context.total = total; context.linesSource = change.source }
            if let dvp = change.dvpPct {
                context.dvpPct = dvp
                context.dvpGames = change.dvpGames ?? context.dvpGames
                context.dvpSource = change.source
            }
            if let sack = change.oppSackEnv { context.oppSackEnv = sack; context.sackSource = change.source }
            out[team] = context
        }
        return out
    }
}

// MARK: - Import

/// Reads the reference tool's `WeekContext` JSON — teams keyed by code, each
/// with `spreadDef`, `total`, `dvpPct` {LB, DL, DB}, `dvpGames`, `oppSackEnv`;
/// players keyed by Sleeper id. Keys starting with `_` are comments.
public enum IDPContextImport {
    public enum ImportError: Error, CustomStringConvertible {
        case notAnObject
        public var description: String { "That file is not an IDP context file (expected a \"teams\" object)." }
    }

    public static func parse(_ data: Data) throws -> IDPWeekOverrides {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let teams = root["teams"] as? [String: Any] else { throw ImportError.notAnObject }
        var out = IDPWeekOverrides()
        for (key, value) in teams where !key.hasPrefix("_") {
            guard let row = value as? [String: Any], let team = NFLTeams.nflverse(key.uppercased()) else { continue }
            var dvp: [Position: Double]?
            if let raw = row["dvpPct"] as? [String: Any] {
                dvp = [:]
                for (code, pct) in raw {
                    if let position = Position(rawValue: code.uppercased()), let pct = number(pct) { dvp?[position] = pct }
                }
            }
            let change = IDPTeamOverride(
                spreadDef: number(row["spreadDef"]), total: number(row["total"]), dvpPct: dvp,
                dvpGames: number(row["dvpGames"]).map { Int($0) }, oppSackEnv: number(row["oppSackEnv"]),
                source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        if let players = root["players"] as? [String: Any] {
            for (id, value) in players where !id.hasPrefix("_") {
                guard let row = value as? [String: Any] else { continue }
                let change = IDPPlayerOverride(
                    position: (row["pos"] as? String).flatMap(IDPSubPosition.init(rawValue:)),
                    roleConf: number(row["roleConf"]),
                    practice: (row["practice"] as? String).flatMap(IDPPractice.init(rawValue:)),
                    snapShareEst: number(row["snapShareEst"]),
                    pressures: number(row["pressures"]),
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

    /// Merges an import over what is already stored: imported values win, and
    /// nothing the import does not mention is touched.
    public static func merge(_ incoming: IDPWeekOverrides, into existing: IDPWeekOverrides) -> IDPWeekOverrides {
        var out = existing
        for (team, change) in incoming.teams { out.teams[team] = change }
        for (id, change) in incoming.players { out.players[id] = change }
        return out
    }
}
