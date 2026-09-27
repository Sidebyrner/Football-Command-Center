import Foundation
import FCCore
import FCData

/// The "this week" card: you against your opponent, at a glance.
public struct ThisWeekSummary: Hashable, Sendable {
    public let week: Int
    public let myManager: String
    public let myPoints: Double?
    public let myAverageTeamTotal: Double?
    /// `nil` in a week with no opponent.
    public let opponentManager: String?
    public let opponentPoints: Double?
    public let opponentAverageTeamTotal: Double?
    /// Starters yet to kick off, per side — a fact, not a projection.
    public var myLeftToPlay: Int = 0
    public var opponentLeftToPlay: Int? = nil

    /// Plain-words state of the game, for the card's subtitle.
    public var status: String {
        guard let opponentManager else { return "No opponent this week" }
        guard let mine = myPoints, let theirs = opponentPoints, mine + theirs > 0 else {
            return "vs \(opponentManager) — not started"
        }
        if abs(mine - theirs) < 0.05 { return "Tied with \(opponentManager)" }
        let margin = String(format: "%.1f", abs(mine - theirs))
        return mine > theirs ? "Leading \(opponentManager) by \(margin)" : "Trailing \(opponentManager) by \(margin)"
    }
}

/// A trending add worth a look from the Dashboard.
public struct WaiverTarget: Hashable, Sendable, Identifiable {
    public let playerID: String
    public let name: String
    public let position: Position
    public let team: String?
    public let adds: Int
    /// True when he plays this week at a position you can't currently fill.
    public let fillsNeedThisWeek: Bool

    public var id: String { playerID }
}

extension DashboardModel {
    /// Builds the card from this week's matchups. Deliberately light: the
    /// Matchup screen's full build scores every row of the season for defense
    /// ranks, which a summary card has no use for.
    nonisolated static func buildThisWeek(
        context: LeagueContext,
        matchups: [SleeperMatchup]
    ) -> ThisWeekSummary? {
        guard let userTeam = context.userTeam,
              let mine = matchups.first(where: { $0.rosterID == userTeam.rosterID })
        else { return nil }

        let lines = GameLines.week(context.schedule, week: context.currentWeek)
        func averageTeamTotal(_ starters: [String]?) -> Double? {
            let teams = (starters ?? []).filter { $0 != SleeperRoster.emptyStarterSlot }.map { id -> String? in
                let player = context.players[id]
                return player?.nflverseTeam ?? player?.team ?? (player?.position == .def ? id : nil)
            }
            let environment = GameLines.lineupEnvironment(teams: teams, lines: lines)
            let counted = environment.teamCount - environment.missing.count
            guard let total = environment.total, counted > 0 else { return nil }
            return total / Double(counted)
        }

        // Yet to kick off: not an empty slot, not on bye, not already locked.
        func leftToPlay(_ starters: [String]?) -> Int {
            (starters ?? []).filter { id in
                guard id != SleeperRoster.emptyStarterSlot else { return false }
                let team = context.nflTeam(of: id)
                return !context.byeCalendar.isOnBye(team: team, week: context.currentWeek) && !context.isLocked(id)
            }.count
        }

        let opponent = mine.matchupID.flatMap { id in
            matchups.first { $0.matchupID == id && $0.rosterID != userTeam.rosterID }
        }
        let opponentTeam = opponent.flatMap { match in context.teams.first { $0.rosterID == match.rosterID } }

        return ThisWeekSummary(
            week: context.currentWeek,
            myManager: userTeam.manager,
            myPoints: mine.points,
            myAverageTeamTotal: averageTeamTotal(mine.starters),
            opponentManager: opponentTeam?.manager,
            opponentPoints: opponent?.points,
            opponentAverageTeamTotal: opponent.flatMap { averageTeamTotal($0.starters) },
            myLeftToPlay: leftToPlay(mine.starters),
            opponentLeftToPlay: opponent.map { leftToPlay($0.starters) }
        )
    }

    /// Trending adds nobody in the league rosters, flagged when one fills a
    /// position you can't currently fill this week — ported from the web app's
    /// Waiver Targets panel. Popularity only, and labelled as such.
    nonisolated static func buildWaiverTargets(
        context: LeagueContext,
        trending: [TrendingPlayer],
        limit: Int = 6
    ) -> [WaiverTarget] {
        let needed: Set<Position> = {
            guard let team = context.userTeam else { return [] }
            return ByeCrunch.forWeek(
                roster: team.roster,
                template: context.template,
                byeTeams: context.byeCalendar.byeTeams(week: context.currentWeek)
            ).neededPositions
        }()

        let targets = trending.compactMap { entry -> WaiverTarget? in
            guard context.availability(ofSleeperID: entry.playerID) == .freeAgent,
                  let player = context.players[entry.playerID], player.active,
                  let position = player.position
            else { return nil }
            let team = player.nflverseTeam ?? player.team ?? (position == .def ? entry.playerID : nil)
            let plays = !context.byeCalendar.isOnBye(team: team, week: context.currentWeek)
            return WaiverTarget(
                playerID: entry.playerID,
                name: player.name,
                position: position,
                team: team,
                adds: entry.count,
                fillsNeedThisWeek: plays && needed.contains(position)
            )
        }
        // Needs first, then popularity — keeping Sleeper's order within each.
        let fills = targets.filter(\.fillsNeedThisWeek)
        let others = targets.filter { !$0.fillsNeedThisWeek }
        return Array((fills + others).prefix(limit))
    }
}
