import Foundation
import FCCore
import FCData

/// The two altitudes of the My Team hub.
public enum MyTeamZoom: String, CaseIterable, Hashable, Sendable {
    /// Five feet: this week's lineup, matchup and what to fix.
    case thisWeek = "This Week"
    /// Ten thousand feet: the season and the league around you.
    case season = "Season"
}

/// The state of every starting slot this week, as counts of facts.
///
/// Deliberately not a score (§6): each slot lands in exactly one bucket for a
/// stated reason, and the ring shows the counts. It is built from the same rules
/// as the Dashboard alerts, so the two can never disagree.
public struct LineupReadiness: Hashable, Sendable {
    public let slots: Int
    /// Filled, playing, no injury tag.
    public let ready: Int
    /// Tagged Questionable — may play.
    public let caution: Int
    /// Empty, on bye, or tagged Out/Doubtful/IR and similar.
    public let problems: Int
    /// Already kicked off, so nothing more can be done either way.
    public let settled: Int

    public var isAllClear: Bool { caution == 0 && problems == 0 }

    /// Injury tags that mean a player is very unlikely to play.
    static let problemTags: Set<String> = ["OUT", "DOUBTFUL", "IR", "PUP", "SUS", "NA", "COV"]

    public static func build(context: LeagueContext) -> LineupReadiness? {
        guard let team = context.userTeam else { return nil }
        let slotCount = context.template.starters.count
        var ready = 0, caution = 0, problems = 0, settled = 0

        for index in 0..<slotCount {
            let id = index < team.rawStarters.count ? team.rawStarters[index] : SleeperRoster.emptyStarterSlot
            guard id != SleeperRoster.emptyStarterSlot, !id.isEmpty else {
                problems += 1
                continue
            }
            if context.isLocked(id) {
                settled += 1
            } else if context.byeCalendar.isOnBye(team: context.nflTeam(of: id), week: context.currentWeek) {
                problems += 1
            } else if let status = context.injuryStatus(id) {
                if problemTags.contains(status.uppercased()) { problems += 1 } else { caution += 1 }
            } else {
                ready += 1
            }
        }
        return LineupReadiness(slots: slotCount, ready: ready, caution: caution, problems: problems, settled: settled)
    }
}

/// One completed week, from your side.
public struct WeekResult: Hashable, Sendable, Identifiable {
    public enum Outcome: String, Hashable, Sendable { case win = "W", loss = "L", tie = "T" }

    public let week: Int
    public let myPoints: Double
    public let opponentPoints: Double
    public let opponentManager: String
    public let outcome: Outcome

    public var id: Int { week }
}

/// A future opponent, and whether either side has a bye problem that week.
public struct UpcomingOpponent: Hashable, Sendable, Identifiable {
    public let week: Int
    public let rosterID: Int
    public let manager: String
    public let record: String?
    /// Starting slots you can't fill that week.
    public let yourShortfall: Int
    /// Starting slots they can't fill that week.
    public let theirShortfall: Int

    public var id: Int { week }
}

/// One remaining week on the season bye strip.
public struct ByeStripWeek: Hashable, Sendable, Identifiable {
    public let week: Int
    public let yourShortfall: Int
    public let teamsShort: Int
    public let teamCount: Int

    public var id: Int { week }
}

extension DashboardModel {
    // MARK: - Results and streak

    nonisolated static func buildResults(context: LeagueContext, history: SeasonHistory) -> [WeekResult] {
        let managers = Dictionary(context.teams.map { ($0.rosterID, $0.manager) }, uniquingKeysWith: { first, _ in first })
        return history.weeks(forRoster: context.userRosterID).compactMap { mine -> WeekResult? in
            guard let matchupID = mine.matchupID, let myPoints = mine.points else { return nil }
            let opponent = history.byRoster
                .filter { $0.key != context.userRosterID }
                .compactMap { $0.value.first { $0.week == mine.week && $0.matchupID == matchupID } }
                .first
            guard let opponent, let theirPoints = opponent.points else { return nil }
            let outcome: WeekResult.Outcome = abs(myPoints - theirPoints) < 0.005 ? .tie : (myPoints > theirPoints ? .win : .loss)
            return WeekResult(
                week: mine.week,
                myPoints: myPoints,
                opponentPoints: theirPoints,
                opponentManager: managers[opponent.rosterID] ?? "Roster \(opponent.rosterID)",
                outcome: outcome
            )
        }
    }

    /// "W3" — the current run of identical results, most recent first.
    nonisolated static func streak(_ results: [WeekResult]) -> String? {
        guard let last = results.max(by: { $0.week < $1.week }) else { return nil }
        let run = results.sorted { $0.week > $1.week }.prefix { $0.outcome == last.outcome }.count
        return "\(last.outcome.rawValue)\(run)"
    }

    // MARK: - Standings place

    nonisolated static func place(standings: [StandingsRow]) -> (rank: Int, of: Int)? {
        guard let index = standings.firstIndex(where: \.isUser) else { return nil }
        return (index + 1, standings.count)
    }

    // MARK: - Upcoming opponents

    nonisolated static func buildUpcoming(
        context: LeagueContext,
        matchupsByWeek: [Int: [SleeperMatchup]]
    ) -> [UpcomingOpponent] {
        guard let userTeam = context.userTeam else { return [] }
        func shortfall(_ team: LeagueTeam, week: Int) -> Int {
            ByeCrunch.forWeek(
                roster: team.roster, template: context.template,
                byeTeams: context.byeCalendar.byeTeams(week: week)
            ).totalShortfall
        }
        return matchupsByWeek.keys.sorted().compactMap { week -> UpcomingOpponent? in
            let matchups = matchupsByWeek[week] ?? []
            guard let mine = matchups.first(where: { $0.rosterID == userTeam.rosterID }),
                  let matchupID = mine.matchupID,
                  let theirs = matchups.first(where: { $0.matchupID == matchupID && $0.rosterID != userTeam.rosterID }),
                  let rival = context.teams.first(where: { $0.rosterID == theirs.rosterID })
            else { return nil }
            let record = rival.settings.map { settings -> String in
                let ties = settings.ties ?? 0
                return ties > 0 ? "\(settings.wins ?? 0)-\(settings.losses ?? 0)-\(ties)" : "\(settings.wins ?? 0)-\(settings.losses ?? 0)"
            }
            return UpcomingOpponent(
                week: week, rosterID: rival.rosterID, manager: rival.manager, record: record,
                yourShortfall: shortfall(userTeam, week: week),
                theirShortfall: shortfall(rival, week: week)
            )
        }
    }

    // MARK: - Season bye strip

    static func buildByeStrip(context: LeagueContext) -> [ByeStripWeek] {
        let grid = PlanningModel.buildGrid(context)
        return context.remainingWeeks.map { week in
            let cells = grid.filter { $0.week == week }
            return ByeStripWeek(
                week: week,
                yourShortfall: cells.first { $0.rosterID == context.userRosterID }?.shortfall ?? 0,
                teamsShort: cells.filter(\.isShort).count,
                teamCount: context.teams.count
            )
        }
    }
}
