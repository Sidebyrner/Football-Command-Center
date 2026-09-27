import Foundation

/// One team's side of one game, from the schedule's recorded lines.
public struct TeamGameLine: Hashable, Sendable {
    public let team: String
    public let opponent: String
    public let isHome: Bool
    public let kickoff: String?
    public let time: String?
    /// In the **Odds API sign convention**: negative means this team is favored.
    /// The schedule file uses the opposite convention; the flip happens once,
    /// here, rather than at every call site.
    public let spread: Double?
    public let total: Double?
    /// Points this team is expected to score. `nil` unless both lines exist.
    public let impliedTotal: Double?

    /// For a line from another source — a live odds feed. `spread` is in the
    /// Odds API convention (negative = this team favored).
    public init(team: String, opponent: String, isHome: Bool, kickoff: String?, time: String?,
                spread: Double?, total: Double?, impliedTotal: Double?) {
        self.team = team
        self.opponent = opponent
        self.isHome = isHome
        self.kickoff = kickoff
        self.time = time
        self.spread = spread
        self.total = total
        self.impliedTotal = impliedTotal
    }
}

/// Implied team totals from the schedule's **recorded** closing lines.
///
/// These are free and need no key, and they do not move during the week — so
/// anything built on them must be labelled as recorded, never presented as
/// live odds (§3.2).
public enum GameLines {
    /// Every team playing in a week, keyed by nflverse team code.
    ///
    /// nfldata's `spreadLine` is **positive when the home team is favored**, so
    /// home implied = total/2 + spread/2 and away implied = total/2 − spread/2.
    /// A team on bye simply has no entry.
    public static func week(_ schedule: ScheduleFile, week: Int) -> [String: TeamGameLine] {
        var out: [String: TeamGameLine] = [:]
        for game in schedule.games(week: week) {
            guard let home = game.home, let away = game.away else { continue }
            let total = game.totalLine
            let line = game.spreadLine
            let homeImplied = total.flatMap { t in line.map { t / 2 + $0 / 2 } }
            let awayImplied = total.flatMap { t in line.map { t / 2 - $0 / 2 } }

            out[home] = TeamGameLine(
                team: home, opponent: away, isHome: true,
                kickoff: game.kickoff, time: game.time,
                spread: line.map { -$0 }, total: total, impliedTotal: homeImplied
            )
            out[away] = TeamGameLine(
                team: away, opponent: home, isHome: false,
                kickoff: game.kickoff, time: game.time,
                spread: line, total: total, impliedTotal: awayImplied
            )
        }
        return out
    }

    /// The scoring environment for a lineup: the sum of implied totals across
    /// the **distinct** NFL teams represented among the starters.
    ///
    /// Two starters from the same team must not double-count that team's
    /// number — it is a team-level figure. Teams with no line (a bye, or no
    /// recorded line) are named in `missing` rather than counted as zero.
    public static func lineupEnvironment(
        teams: [String?],
        lines: [String: TeamGameLine]
    ) -> (total: Double?, teamCount: Int, missing: [String]) {
        let distinct = Set(teams.compactMap { $0.flatMap { NFLTeams.nflverse($0) ?? $0 } })
        var total: Double?
        var missing: [String] = []
        for team in distinct.sorted() {
            if let implied = lines[team]?.impliedTotal {
                total = (total ?? 0) + implied
            } else {
                missing.append(team)
            }
        }
        return (total, distinct.count, missing)
    }
}
