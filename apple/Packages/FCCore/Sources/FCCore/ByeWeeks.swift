import Foundation

/// Which teams are off in which week, derived from the schedule by absence.
///
/// Thirty-two teams, eighteen weeks, and a team that appears in no game that
/// week is on bye. That is exact and covers every position — unlike the `bye`
/// field on player objects, which arrives through a FantasyPros ADP name match
/// and reaches no IDP player at all (§5.4).
///
/// Team codes are in the schedule's own dialect (nflverse: `LA`, not `LAR`), so
/// run a Sleeper-sourced team through `NFLTeams.nflverse` before looking it up.
public struct ByeCalendar: Hashable, Sendable {
    /// Every team the schedule mentions, sorted.
    public let teams: [String]
    /// A team's first bye week.
    public let byTeam: [String: Int]
    /// Teams off in a given week, sorted. Weeks with no byes are absent.
    public let byWeek: [Int: [String]]

    public init(schedule: ScheduleFile) {
        var allTeams: Set<String> = []
        for (_, games) in schedule.byWeek {
            for game in games {
                if let home = game.home { allTeams.insert(home) }
                if let away = game.away { allTeams.insert(away) }
            }
        }

        var byTeam: [String: Int] = [:]
        var byWeek: [Int: [String]] = [:]

        // Ascending so `byTeam` records a team's *first* bye rather than
        // whichever week the dictionary happened to yield first.
        for entry in schedule.weeksAscending {
            let week = entry.week
            var playing: Set<String> = []
            for game in entry.games {
                if let home = game.home { playing.insert(home) }
                if let away = game.away { playing.insert(away) }
            }

            // A week with no games means the file does not cover it — not that
            // all thirty-two teams are on bye. Inventing 32 byes out of missing
            // data is the obvious bug here (§5.4).
            guard !playing.isEmpty else { continue }

            let off = allTeams.subtracting(playing).sorted()
            guard !off.isEmpty else { continue }
            byWeek[week] = off
            for team in off where byTeam[team] == nil {
                byTeam[team] = week
            }
        }

        self.teams = allTeams.sorted()
        self.byTeam = byTeam
        self.byWeek = byWeek
    }

    public func byeTeams(week: Int) -> Set<String> {
        Set(byWeek[week] ?? [])
    }

    /// Whether a team is on bye in a given week. Pass a team code already
    /// normalised with `NFLTeams.nflverse`.
    public func isOnBye(team: String?, week: Int) -> Bool {
        guard let team else { return false }
        return byWeek[week]?.contains(team) ?? false
    }
}
