import Foundation
import FCCore
import FCData

extension RBCandidate: StreamCandidate {}

/// RB Stream's part of the shared stream screen: running backs, projected by
/// `RBStreamEngine` under the league's no-PPR, first-down-heavy scoring.
public enum RBStreamKind: StreamKind {
    public typealias Candidate = RBCandidate
    public typealias Projection = RBProjection
    public typealias Scoring = RBScoring
    public typealias Team = RBTeamContext
    public typealias TeamOverride = RBTeamOverride
    public typealias PlayerOverride = RBPlayerOverride
    public typealias GameLine = RBGameLine

    public static let storeFolder = "RBStream"
    public static let positions: [Position] = [.rb]
    public static let playerNoun = "running back"
    public static let emptyScoring = RBScoring()

    public static func scoring(sleeperSettings: [String: Double]) -> RBScoring {
        RBScoring.from(sleeperSettings: sleeperSettings)
    }

    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        RBScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: RBTeamContext] {
        RBContextAutofill.build(schedule: context.schedule, week: context.currentWeek, defense: defense.sleeper)
    }

    public static func apply(_ overrides: [String: RBTeamOverride], to teams: [String: RBTeamContext]) -> [String: RBTeamContext] {
        RBContextAutofill.apply(overrides, to: teams)
    }

    public static func candidates(context: LeagueContext, teams: [String: RBTeamContext],
                                  players: [String: RBPlayerOverride], alwaysInclude: Set<String>) -> [RBCandidate] {
        var builder = RBCandidateBuilder(context: context, teams: teams, players: players)
        builder.alwaysInclude = alwaysInclude
        return builder.candidates()
    }

    public static func project(_ candidate: RBCandidate, scoring: RBScoring, risk: StreamRiskMode) -> RBProjection {
        RBStreamEngine.project(candidate, scoring: scoring, risk: risk)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [RBGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .sorted(by: >)
            .compactMap { week -> RBGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID] else { return nil }
                let s = line.stats
                return RBGameLine(
                    week: week,
                    opponent: line.opponent.flatMap { NFLTeams.nflverse($0) },
                    points: line.score(scoring: scoring).points,
                    carries: s["rush_att"] ?? 0,
                    rushYards: s["rush_yd"] ?? 0,
                    firstDowns: (s["rush_fd"] ?? 0) + (s["rec_fd"] ?? 0),
                    targets: s["rec_tgt"] ?? 0,
                    touchdowns: (s["rush_td"] ?? 0) + (s["rec_td"] ?? 0),
                    longestRun: s["rush_lng"],
                    fumblesLost: s["fum_lost"] ?? 0
                )
            }
            .prefix(limit)
            .map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { nil }

    public static func parseImport(_ data: Data) throws -> RBWeekOverrides {
        try RBContextImport.parse(data)
    }

    public static func sourceNotes(teams: [String: RBTeamContext]) -> [String] {
        var notes: [String] = []
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("RB matchup (points a defense allows to backs) needs \(DefenseVsPosition.defaultMinimumGames) games per defense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Spread and total are recorded closing lines from the schedule file, not live odds; the implied team total drives touchdowns. The O-line / front-seven adjustment is neutral unless edited.")
        notes.append("Roles are inferred from carry, target and red-zone shares. Long runs are counted from each game's longest run, and long-TD bonuses assume 35% of 40+ and 45% of 50+ yard runs score — all heuristic until backtested.")
        return notes
    }
}

public typealias RBStreamScreenModel = StreamScreenModel<RBStreamKind>
public typealias RBStreamSnapshot = StreamSnapshot<RBStreamKind>

/// One completed game, for the comparison's recent-form rows.
public struct RBGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    /// Scored in the league's own settings.
    public let points: Double
    public let carries: Double
    public let rushYards: Double
    /// Rushing plus receiving.
    public let firstDowns: Double
    public let targets: Double
    public let touchdowns: Double
    public let longestRun: Double?
    public let fumblesLost: Double
}
