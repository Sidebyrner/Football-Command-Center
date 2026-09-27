import Foundation
import FCCore
import FCData

/// Every team's offense by week, and what each defense has faced, summed from
/// Sleeper's weekly lines — the team-level inputs the QB, D/ST and K streams
/// need and Sleeper doesn't publish directly.
struct SleeperTeamTotals {
    /// One team's offense in one game.
    struct Offense {
        var passAttempts = 0.0
        var completions = 0.0
        var sacksTaken = 0.0
        var interceptions = 0.0
        var pickSixes = 0.0
        var rushAttempts = 0.0
        var fumblesLost = 0.0
        var touchdowns = 0.0
        var fieldGoalAttempts = 0.0
        var dropbacks: Double { passAttempts + sacksTaken }
        var plays: Double { passAttempts + sacksTaken + rushAttempts }

        mutating func add(_ o: Offense) {
            passAttempts += o.passAttempts; completions += o.completions; sacksTaken += o.sacksTaken
            interceptions += o.interceptions; pickSixes += o.pickSixes; rushAttempts += o.rushAttempts
            fumblesLost += o.fumblesLost; touchdowns += o.touchdowns; fieldGoalAttempts += o.fieldGoalAttempts
        }
    }

    /// Completed weeks with lines, ascending.
    let weeks: [Int]
    /// team → week → offense.
    let offense: [String: [Int: Offense]]
    /// team → week → opponent.
    let opponents: [String: [Int: String]]
    /// team → week → the team defense's own line (sacks, INTs, points allowed…).
    let defenseLines: [String: [Int: SleeperWeekStat]]

    init(context: LeagueContext) {
        let weeks = context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
        var offense: [String: [Int: Offense]] = [:]
        var opponents: [String: [Int: String]] = [:]
        var defenseLines: [String: [Int: SleeperWeekStat]] = [:]
        for week in weeks {
            for line in (context.inSeason.weekStats[week] ?? [:]).values {
                guard let team = NFLTeams.nflverse(line.team) else { continue }
                if let opponent = NFLTeams.nflverse(line.opponent) { opponents[team, default: [:]][week] = opponent }
                if line.position == .def {
                    defenseLines[team, default: [:]][week] = line
                    continue
                }
                let s = line.stats
                var o = offense[team]?[week] ?? Offense()
                o.passAttempts += s["pass_att"] ?? 0
                o.completions += s["pass_cmp"] ?? 0
                o.sacksTaken += s["pass_sack"] ?? 0
                o.interceptions += s["pass_int"] ?? 0
                o.pickSixes += s["pass_int_td"] ?? 0
                o.rushAttempts += s["rush_att"] ?? 0
                o.fumblesLost += s["fum_lost"] ?? 0
                // Passing TDs cover the receiving ones; add rushing TDs.
                o.touchdowns += (s["pass_td"] ?? 0) + (s["rush_td"] ?? 0)
                o.fieldGoalAttempts += s["fga"] ?? 0
                offense[team, default: [:]][week] = o
            }
        }
        self.weeks = weeks
        self.offense = offense
        self.opponents = opponents
        self.defenseLines = defenseLines
    }

    /// A team's offense summed over its games, and how many games.
    func offenseTotal(_ team: String) -> (total: Offense, games: Int) {
        let games = offense[team] ?? [:]
        var total = Offense()
        for game in games.values { total.add(game) }
        return (total, games.count)
    }

    /// What a defense faced: its opponents' offenses in the games it played.
    func faced(by team: String) -> (total: Offense, games: Int) {
        var total = Offense()
        var games = 0
        for (week, opponent) in opponents[team] ?? [:] {
            guard let game = offense[opponent]?[week] else { continue }
            total.add(game)
            games += 1
        }
        return (total, games)
    }

    /// Points and yards an offense scored, read off the defenses it played.
    func scored(by team: String) -> (points: Double, yards: Double, games: Int) {
        var points = 0.0, yards = 0.0, games = 0
        for (week, opponent) in opponents[team] ?? [:] {
            guard let line = defenseLines[opponent]?[week] else { continue }
            points += line.stats["pts_allow"] ?? 0
            yards += line.stats["yds_allow"] ?? 0
            games += 1
        }
        return (points, yards, games)
    }

    /// League-wide completion, sack and INT rates.
    var leagueRates: (comp: Double, sack: Double, int: Double) {
        var all = Offense()
        for games in offense.values { for game in games.values { all.add(game) } }
        guard all.passAttempts > 0 else { return (0.655, 0.065, 0.022) }
        return (all.completions / all.passAttempts, all.sacksTaken / max(all.dropbacks, 1), all.interceptions / all.passAttempts)
    }

    /// Each team's opponent by week for the whole season, from the schedule.
    static func schedule(_ file: ScheduleFile, team: String) -> [Int: String] {
        var out: [Int: String] = [:]
        for week in file.weeksAscending {
            if let game = week.games.first(where: { $0.home == team || $0.away == team }),
               let opponent = game.opponent(of: team) {
                out[week.week] = opponent
            }
        }
        return out
    }

    /// Each team's home/away by week.
    static func homeMap(_ file: ScheduleFile, team: String) -> [Int: Bool] {
        var out: [Int: Bool] = [:]
        for week in file.weeksAscending {
            if let game = week.games.first(where: { $0.home == team || $0.away == team }) {
                out[week.week] = game.home == team
            }
        }
        return out
    }

    /// Every defense's generosity to a position, % vs average, from the
    /// Sleeper side of the defense-vs-position table.
    static func generosity(_ table: DefenseVsPositionTable, position: Position) -> (pct: [String: Double], games: [String: Int]) {
        var pct: [String: Double] = [:], games: [String: Int] = [:]
        guard let average = table.leagueAverage[position], average > 0 else { return (pct, games) }
        for team in table.byDefense.keys {
            if let cell = table.cell(defense: team, position: position), cell.rank != nil, let perGame = cell.perGame {
                pct[team] = (perGame / average - 1) * 100
                games[team] = cell.games
            }
        }
        return (pct, games)
    }
}
