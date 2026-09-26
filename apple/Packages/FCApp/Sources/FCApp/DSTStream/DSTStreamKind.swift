import Foundation
import FCCore
import FCData

extension DSTCandidate: StreamCandidate {}

/// One team defense's game this week.
public struct DSTTeamContext: StreamTeamContext {
    /// The defense.
    public var team: String
    /// The offense it faces.
    public var opponent: String
    public var home: Bool?
    /// Positive when this team is the underdog.
    public var spreadDef: Double
    public var total: Double
    /// Backup QB or O-line injuries: above 1 means more giveaways.
    public var oppQbAdj: Double
    /// Fantasy points the opposing offense gives up to D/STs, % vs average.
    public var dvpPct: Double?
    public var dvpGames: Int
    public var linesSource: StreamContextSource
    public var dvpSource: StreamContextSource
    public var qbSource: StreamContextSource
    /// Every offense's generosity to D/STs, and its points per game — the
    /// rest-of-season inputs.
    public var leagueGenerosity: [String: Double] = [:]
    public var leaguePointsPerGame: [String: Double] = [:]

    public var id: String { team }
    public var spread: Double { spreadDef }
    /// Points the opponent is expected to score.
    public var opponentImplied: Double { (total + spreadDef) / 2 }

    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

public struct DSTTeamOverride: StreamOverride {
    public var spreadDef: Double?
    public var total: Double?
    public var oppQbAdj: Double?
    public var dvpPct: Double?
    public var dvpGames: Int?
    public var source: StreamContextSource

    public init(spreadDef: Double? = nil, total: Double? = nil, oppQbAdj: Double? = nil, dvpPct: Double? = nil,
                dvpGames: Int? = nil, source: StreamContextSource = .manual) {
        self.spreadDef = spreadDef; self.total = total; self.oppQbAdj = oppQbAdj; self.dvpPct = dvpPct
        self.dvpGames = dvpGames; self.source = source
    }

    public var isEmpty: Bool { spreadDef == nil && total == nil && oppQbAdj == nil && dvpPct == nil && dvpGames == nil }
}

public struct DSTPlayerOverride: StreamOverride {
    public var notes: String?

    public init(notes: String? = nil) { self.notes = notes }

    public var isEmpty: Bool { (notes ?? "").isEmpty }
}

public typealias DSTWeekOverrides = StreamWeekOverrides<DSTTeamOverride, DSTPlayerOverride>

public struct DSTGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    public let points: Double
    public let sacks: Double
    public let takeaways: Double
    public let touchdowns: Double
    public let pointsAllowed: Double
}

/// D/ST Stream's part of the shared stream screen.
public enum DSTStreamKind: StreamKind {
    public typealias Candidate = DSTCandidate
    public typealias Projection = DSTProjection
    public typealias Scoring = DSTScoring
    public typealias Team = DSTTeamContext
    public typealias TeamOverride = DSTTeamOverride
    public typealias PlayerOverride = DSTPlayerOverride
    public typealias GameLine = DSTGameLine

    public static let storeFolder = "DSTStream"
    public static let positions: [Position] = [.def]
    public static let playerNoun = "defense"
    public static let emptyScoring = DSTScoring()
    public static let usesHorizon = true

    public static func scoring(sleeperSettings: [String: Double]) -> DSTScoring { .from(sleeperSettings: sleeperSettings) }
    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        DSTScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    /// Each offense's generosity to team defenses: the fantasy points the
    /// defenses it faced scored in this league, against the league average.
    static func generosity(_ totals: SleeperTeamTotals, scoring: [String: Double]) -> (pct: [String: Double], games: [String: Int]) {
        var byOffense: [String: [Double]] = [:]
        for (defense, lines) in totals.defenseLines {
            for (week, line) in lines {
                guard let offense = totals.opponents[defense]?[week] else { continue }
                byOffense[offense, default: []].append(line.score(scoring: scoring).points)
            }
        }
        let all = byOffense.values.flatMap { $0 }
        guard !all.isEmpty else { return ([:], [:]) }
        let average = all.reduce(0, +) / Double(all.count)
        guard average > 0 else { return ([:], [:]) }
        var pct: [String: Double] = [:], games: [String: Int] = [:]
        for (offense, points) in byOffense {
            pct[offense] = (points.reduce(0, +) / Double(points.count) / average - 1) * 100
            games[offense] = points.count
        }
        return (pct, games)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: DSTTeamContext] {
        let totals = SleeperTeamTotals(context: context)
        let scoring = context.league.scoringSettings ?? [:]
        let generosity = Self.generosity(totals, scoring: scoring)
        var ppg: [String: Double] = [:]
        for team in totals.offense.keys {
            let scored = totals.scored(by: team)
            if scored.games > 0 { ppg[team] = scored.points / Double(scored.games) }
        }
        var out: [String: DSTTeamContext] = [:]
        for (team, line) in GameLines.week(context.schedule, week: context.currentWeek) {
            let dvp = generosity.pct[line.opponent]
            out[team] = DSTTeamContext(
                team: team, opponent: line.opponent, home: line.isHome,
                spreadDef: line.spread ?? 0, total: line.total ?? 45, oppQbAdj: 1,
                dvpPct: dvp, dvpGames: generosity.games[line.opponent] ?? 0,
                linesSource: line.spread != nil && line.total != nil ? .schedule : .standard,
                dvpSource: dvp == nil ? .standard : .sleeperDvP, qbSource: .standard,
                leagueGenerosity: generosity.pct, leaguePointsPerGame: ppg
            )
        }
        return out
    }

    public static func apply(_ overrides: [String: DSTTeamOverride], to teams: [String: DSTTeamContext]) -> [String: DSTTeamContext] {
        var out = teams
        for (team, change) in overrides {
            guard var context = out[team], !change.isEmpty else { continue }
            if let v = change.spreadDef { context.spreadDef = v; context.linesSource = change.source }
            if let v = change.total { context.total = v; context.linesSource = change.source }
            if let v = change.oppQbAdj { context.oppQbAdj = v; context.qbSource = change.source }
            if let v = change.dvpPct {
                context.dvpPct = v
                context.dvpGames = change.dvpGames ?? max(context.dvpGames, 1)
                context.dvpSource = change.source
            }
            out[team] = context
        }
        return out
    }

    public static func candidates(context: LeagueContext, teams: [String: DSTTeamContext],
                                  players: [String: DSTPlayerOverride], alwaysInclude: Set<String>) -> [DSTCandidate] {
        let totals = SleeperTeamTotals(context: context)
        let generosity = teams.values.first?.leagueGenerosity ?? [:]
        let ppg = teams.values.first?.leaguePointsPerGame ?? [:]
        return context.players.players(at: .def).compactMap { player -> DSTCandidate? in
            guard let team = player.nflverseTeam ?? NFLTeams.nflverse(player.id) else { return nil }
            let game = teams[team]
            let lines = totals.defenseLines[team] ?? [:]
            func sum(_ key: String) -> Double { lines.values.reduce(0) { $0 + ($1.stats[key] ?? 0) } }
            let faced = totals.faced(by: team)
            var flags: [String] = []
            var opponentStats = (total: SleeperTeamTotals.Offense(), games: 0)
            var oppScored = (points: 0.0, yards: 0.0, games: 0)
            if let game {
                opponentStats = totals.offenseTotal(game.opponent)
                oppScored = totals.scored(by: game.opponent)
            } else {
                flags.append("bye week")
            }
            if game?.linesSource == .standard { flags.append("no recorded line — neutral spread and total") }
            return DSTCandidate(
                name: "\(team) D/ST", team: team, opp: game?.opponentLabel ?? "BYE", home: game?.home,
                spreadDef: game?.spreadDef ?? 0, total: game?.total ?? 45, games: lines.count,
                sacks: sum("sack"), ints: sum("int"), fr: sum("fum_rec"), ff: sum("ff"), defTd: sum("def_td"),
                retTd: sum("def_st_td") + sum("st_td"), safeties: sum("safe"), blocks: sum("blk_kick"),
                paTotal: sum("pts_allow"), yaTotal: sum("yds_allow"),
                dropbacksFaced: faced.total.dropbacks, playsFaced: faced.total.plays,
                oppGames: opponentStats.games, oppDropbacks: opponentStats.total.dropbacks,
                oppPlays: opponentStats.total.plays, oppSacksTaken: opponentStats.total.sacksTaken,
                oppIntsThrown: opponentStats.total.interceptions, oppFumLost: opponentStats.total.fumblesLost,
                oppPpg: oppScored.games > 0 ? oppScored.points / Double(oppScored.games) : 22.5,
                oppYpg: oppScored.games > 0 ? oppScored.yards / Double(oppScored.games) : 330,
                oppQbAdj: game?.oppQbAdj ?? 1,
                dvpPct: game?.dvpPct ?? 0, dvpGames: game?.dvpPct == nil ? 0 : (game?.dvpGames ?? 0),
                schedule: SleeperTeamTotals.schedule(context.schedule, team: team), oppDvp: generosity,
                oppPpgMap: ppg, currentWeek: context.currentWeek, practice: game == nil ? .OUT : .none,
                rosterPct: nil, available: context.availability(ofSleeperID: player.id) == .freeAgent,
                notes: players[player.id]?.notes ?? "", sources: ["Sleeper weekly stats", "schedule lines"],
                dataFlags: flags, playerID: player.id
            )
        }
        // All 32 defenses: every one is a candidate every week.
        .sorted { $0.name < $1.name }
    }

    public static func project(_ candidate: DSTCandidate, scoring: DSTScoring, risk: StreamRiskMode) -> DSTProjection {
        DSTStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: .week)
    }

    public static func project(_ candidate: DSTCandidate, scoring: DSTScoring, risk: StreamRiskMode,
                               horizon: StreamHorizon) -> DSTProjection {
        DSTStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: horizon)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [DSTGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted(by: >)
            .compactMap { week -> DSTGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID] else { return nil }
                let s = line.stats
                return DSTGameLine(week: week, opponent: NFLTeams.nflverse(line.opponent),
                                   points: line.score(scoring: scoring).points, sacks: s["sack"] ?? 0,
                                   takeaways: (s["int"] ?? 0) + (s["fum_rec"] ?? 0),
                                   touchdowns: (s["def_td"] ?? 0) + (s["def_st_td"] ?? 0),
                                   pointsAllowed: s["pts_allow"] ?? 0)
            }
            .prefix(limit).map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { "D/ST" }

    public static func parseImport(_ data: Data) throws -> DSTWeekOverrides {
        let root = try StreamImport.root(data)
        var out = DSTWeekOverrides()
        for (team, row) in StreamImport.teams(root) {
            let dvp = StreamImport.number(row["dvpPct"]) ?? (row["dvpPct"] as? [String: Any]).flatMap { StreamImport.number($0["DST"]) }
            let change = DSTTeamOverride(
                spreadDef: StreamImport.number(row["spreadDef"]) ?? StreamImport.number(row["spreadOff"]),
                total: StreamImport.number(row["total"]), oppQbAdj: StreamImport.number(row["oppQbAdj"]),
                dvpPct: dvp, dvpGames: dvp == nil ? nil : StreamImport.number(row["dvpGames"]).map { Int($0) },
                source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        for (id, row) in StreamImport.players(root) {
            let change = DSTPlayerOverride(notes: row["notes"] as? String)
            if !change.isEmpty { out.players[id] = change }
        }
        return out
    }

    public static func sourceNotes(teams: [String: DSTTeamContext]) -> [String] {
        [
            "Sacks, interceptions and fumbles blend each defense's rate with the opposing offense's giveaway rate, from Sleeper's lines. Points allowed are scored as an expected value around the opponent's implied total from the recorded closing line.",
            "An offense's generosity to D/STs is the points defenses have scored against it in your scoring. Rest of season adds how many points the remaining offenses score. All heuristic until backtested.",
        ]
    }
}

public typealias DSTStreamScreenModel = StreamScreenModel<DSTStreamKind>
