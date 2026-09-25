import Foundation
import FCCore
import FCData

/// A player's remaining games: the recorded closing line for each, and how
/// soft each opponent has been against his position. Pure — built from the
/// context and a defense table.
public struct PlayerSchedule: Hashable, Sendable {
    public enum LineSource: Hashable, Sendable {
        /// nfldata's recorded closing lines, carried in the schedule file.
        case recordedClosing
        /// A live feed laid over the recorded lines — the relay odds follow-up.
        case live
    }

    public struct Week: Hashable, Sendable, Identifiable {
        public let week: Int
        public let isBye: Bool
        public let opponent: String?
        public let isHome: Bool?
        /// From his team's side: negative means favored.
        public let spread: Double?
        public let total: Double?
        public let impliedTotal: Double?
        /// `nil` when no line is recorded for the game yet.
        public let lineSource: LineSource?
        /// The opponent's rank against his position, 1 = softest; `nil` below
        /// the sample floor.
        public let defenseRank: Int?
        public let defensePerGame: Double?
        public let defenseVsAverage: Double?

        public var id: Int { week }
        public var hasLine: Bool { spread != nil || total != nil }
    }

    public static let linesLabel = "Recorded closing lines"

    public let playerID: String
    public let team: String?
    public let position: Position?
    public let currentWeek: Int
    /// The rest of the regular season, current week first.
    public let weeks: [Week]
    /// Mean points his opponents allow to his position, over the league
    /// average: 1.0 is average, above 1 softer. `nil` without enough data.
    public let strengthOfSchedule: Double?
    /// Games that went into the strength of schedule.
    public let strengthOfScheduleGames: Int
    /// Weeks with a line, so the panel can say how far the lines reach.
    public let coveredWeeks: [Int]
    public let leagueAverage: Double?
    public let defenseSource: DefenseLookup.Source?

    public var byeWeek: Int? { weeks.first(where: \.isBye)?.week }

    /// - Parameter liveLines: lines by week and team that replace the
    ///   recorded ones when present — where live odds plug in later.
    public static func build(
        playerID: String,
        context: LeagueContext,
        defense: DefenseLookup,
        liveLines: [Int: [String: TeamGameLine]] = [:]
    ) -> PlayerSchedule {
        let team = context.nflTeam(of: playerID)
        let position = context.position(playerID)
        var weeks: [Week] = []
        for week in context.remainingWeeks {
            if context.byeCalendar.isOnBye(team: team, week: week) {
                weeks.append(Week(week: week, isBye: true, opponent: nil, isHome: nil, spread: nil, total: nil,
                                  impliedTotal: nil, lineSource: nil, defenseRank: nil, defensePerGame: nil,
                                  defenseVsAverage: nil))
                continue
            }
            let live = team.flatMap { liveLines[week]?[$0] }
            let recorded = team.flatMap { GameLines.week(context.schedule, week: week)[$0] }
            let line = live ?? recorded
            let game = team.flatMap { team in
                context.schedule.games(week: week).first { $0.home == team || $0.away == team }
            }
            let opponent = line?.opponent ?? team.flatMap { game?.opponent(of: $0) }
            let isHome: Bool? = line?.isHome ?? {
                guard let team, let game else { return nil }
                return game.home == team
            }()
            let cell = defense.cell(defense: opponent, position: position)
            let hasLine = line?.spread != nil || line?.total != nil
            weeks.append(Week(
                week: week, isBye: false, opponent: opponent, isHome: isHome,
                spread: line?.spread, total: line?.total, impliedTotal: line?.impliedTotal,
                lineSource: hasLine ? (live != nil ? .live : .recordedClosing) : nil,
                defenseRank: cell?.rank, defensePerGame: cell?.perGame, defenseVsAverage: cell?.vsLeagueAverage
            ))
        }

        let average = defense.leagueAverage(position: position)
        let allowed = weeks.compactMap(\.defensePerGame)
        let strength: Double? = {
            guard let average, average > 0, !allowed.isEmpty else { return nil }
            return (allowed.reduce(0, +) / Double(allowed.count)) / average
        }()

        return PlayerSchedule(
            playerID: playerID, team: team, position: position, currentWeek: context.currentWeek,
            weeks: weeks, strengthOfSchedule: strength, strengthOfScheduleGames: allowed.count,
            coveredWeeks: weeks.filter(\.hasLine).map(\.week), leagueAverage: average,
            defenseSource: defense.source(for: position)
        )
    }
}
