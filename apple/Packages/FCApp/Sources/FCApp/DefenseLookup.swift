import Foundation
import FCCore
import FCData

/// Defense-vs-position from both sources, each used only for the positions it
/// covers: the nflverse weekly file for the offensive positions, and Sleeper's
/// own stat lines this season for the rest — the only path that ranks defenses
/// against IDP. Each cell says which source it came from.
public struct DefenseLookup: Sendable {
    public let nflverse: DefenseVsPositionTable
    public let sleeper: DefenseVsPositionTable
    /// The season the nflverse table scores; the Sleeper table is always the
    /// schedule season.
    public let nflverseSeason: Int
    public let sleeperSeason: Int

    public enum Source: Hashable, Sendable {
        case nflverse(season: Int)
        case sleeper(season: Int)

        public var label: String {
            switch self {
            case .nflverse(let season): return "nflverse \(season) weekly stats"
            case .sleeper(let season): return "Sleeper \(season) stat lines"
            }
        }
    }

    public init(nflverse: DefenseVsPositionTable, sleeper: DefenseVsPositionTable, nflverseSeason: Int, sleeperSeason: Int) {
        self.nflverse = nflverse
        self.sleeper = sleeper
        self.nflverseSeason = nflverseSeason
        self.sleeperSeason = sleeperSeason
    }

    public static let empty = DefenseLookup(nflverse: .empty, sleeper: .empty, nflverseSeason: 0, sleeperSeason: 0)

    /// Which table answers for a position: nflverse when it has anyone at the
    /// position, Sleeper otherwise, nothing when neither does.
    public func source(for position: Position?) -> Source? {
        guard let position else { return nil }
        if nflverse.covers(position) { return .nflverse(season: nflverseSeason) }
        if sleeper.covers(position) { return .sleeper(season: sleeperSeason) }
        return nil
    }

    public func cell(defense: String?, position: Position?) -> DefenseCell? {
        guard let position, let source = source(for: position) else { return nil }
        switch source {
        case .nflverse: return nflverse.cell(defense: defense, position: position)
        case .sleeper: return sleeper.cell(defense: defense, position: position)
        }
    }

    public func leagueAverage(position: Position?) -> Double? {
        guard let position, let source = source(for: position) else { return nil }
        switch source {
        case .nflverse: return nflverse.leagueAverage[position]
        case .sleeper: return sleeper.leagueAverage[position]
        }
    }

    /// Builds both tables. Scoring every row of a season is the expensive part
    /// of a screen build; callers run this off the main thread.
    public static func build(context: LeagueContext) -> DefenseLookup {
        let nflverse = DefenseVsPosition.compute(file: context.weekly, profile: context.scoring.profile)
        let scoring = context.league.scoringSettings ?? [:]
        var facing: [DefenseFacing] = []
        for (week, lines) in context.inSeason.weekStats {
            for line in lines.values {
                guard line.played, let position = line.position, position != .def,
                      let opponent = line.opponent, !opponent.isEmpty else { continue }
                facing.append(DefenseFacing(
                    week: week, position: position, defense: opponent,
                    points: line.score(scoring: scoring).points
                ))
            }
        }
        let sleeper = DefenseVsPosition.compute(
            facing: facing,
            positions: Set(Position.allCases).subtracting([.def])
        )
        return DefenseLookup(
            nflverse: nflverse, sleeper: sleeper,
            nflverseSeason: context.statsSeason, sleeperSeason: context.scheduleSeason
        )
    }
}
