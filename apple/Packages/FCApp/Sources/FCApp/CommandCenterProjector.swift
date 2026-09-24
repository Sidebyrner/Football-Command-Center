import Foundation
import FCCore
import FCData

/// Assembles `CommandCenterInputs` for a rostered player from a league context
/// and runs the projection. Every input's source is the context's own: Sleeper
/// lines this season, the nflverse profile for last season, the usage file for
/// expected points, and the defense lookup for matchups.
public struct CommandCenterProjector: Sendable {
    public let context: LeagueContext
    public let defense: DefenseLookup

    private let profilesBySleeper: [String: SeasonProfile]
    private let gsisBySleeper: [String: String]
    private let thisWeekLines: [String: TeamGameLine]

    public init(context: LeagueContext, defense: DefenseLookup) {
        self.context = context
        self.defense = defense
        let byGSIS = Dictionary(context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
        profilesBySleeper = context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
            if let profile = byGSIS[pair.key] { out[pair.value] = profile }
        }
        gsisBySleeper = context.gsisIDsBySleeper
        thisWeekLines = GameLines.week(context.schedule, week: context.currentWeek)
    }

    /// The inputs, or `nil` when the player is unknown to the pool.
    public func inputs(for id: String) -> CommandCenterInputs? {
        guard let player = context.players[id] else { return nil }
        let position = player.position
        let team = context.nflTeam(of: id)
        let profile = profilesBySleeper[id]
        let played = context.inSeason.statLines(sleeperID: id).filter(\.played)

        // This season is Sleeper's lines; when the stats season *is* this
        // season and Sleeper has nothing, the nflverse profile is this season.
        let sleeperPPG = context.sleeperPointsPerGame(id)
        let thisSeason: (ppg: Double, games: Int)? = {
            if let sleeperPPG { return (sleeperPPG, played.count) }
            if context.statsSeason == context.scheduleSeason, let profile { return (profile.pointsPerGame, profile.games) }
            return nil
        }()
        let lastSeason: Double? = context.statsSeason < context.scheduleSeason ? profile?.pointsPerGame : nil

        var recentX: Double?
        var seasonX: Double?
        if let gsis = gsisBySleeper[id], let usage = context.inSeason.usage {
            let all = usage.weeks(for: gsis).compactMap(\.expectedPoints)
            if !all.isEmpty {
                seasonX = all.reduce(0, +) / Double(all.count)
                let recent = Array(all.suffix(4))
                recentX = recent.reduce(0, +) / Double(recent.count)
            }
        }

        let opponent = team.flatMap { thisWeekLines[$0]?.opponent }
        let cell = defense.cell(defense: opponent, position: position)
        let average = defense.leagueAverage(position: position)

        var remaining: [(allowed: Double, average: Double)] = []
        if let team, let average {
            for week in context.remainingWeeks where week > context.currentWeek {
                guard let game = context.schedule.games(week: week).first(where: { $0.home == team || $0.away == team }),
                      let opponent = game.opponent(of: team),
                      let allowed = defense.cell(defense: opponent, position: position)?.perGame else { continue }
                remaining.append((allowed, average))
            }
        }

        return CommandCenterInputs(
            position: position,
            thisSeasonPointsPerGame: thisSeason?.ppg,
            thisSeasonGames: thisSeason?.games ?? 0,
            lastSeasonPointsPerGame: lastSeason,
            replacementLine: position.flatMap { context.baselines[$0]?.replacementLine },
            expectedPointsRecent: recentX,
            expectedPointsSeason: seasonX,
            opponentAllowedPerGame: cell?.perGame,
            leagueAverageAllowed: cell?.perGame != nil ? average : nil,
            remainingOpponents: remaining
        )
    }

    public func project(_ id: String) -> CommandCenterProjection? {
        inputs(for: id).map(CommandCenterProjection.project)
    }
}
