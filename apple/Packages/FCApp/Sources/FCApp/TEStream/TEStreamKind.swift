import Foundation
import FCCore
import FCData

extension TECandidate: StreamCandidate {}

/// TE Stream's part of the shared stream screen: tight ends, projected by
/// `TEStreamEngine` under the league's own scoring, TE premium included.
public enum TEStreamKind: StreamKind {
    public typealias Candidate = TECandidate
    public typealias Projection = TEProjection
    public typealias Scoring = TEScoring
    public typealias Team = TETeamContext
    public typealias TeamOverride = TETeamOverride
    public typealias PlayerOverride = TEPlayerOverride
    public typealias GameLine = TEGameLine

    public static let storeFolder = "TEStream"
    public static let positions: [Position] = [.te]
    public static let playerNoun = "tight end"
    public static let emptyScoring = TEScoring()

    public static func scoring(sleeperSettings: [String: Double]) -> TEScoring {
        TEScoring.from(sleeperSettings: sleeperSettings)
    }

    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        TEScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: TETeamContext] {
        TEContextAutofill.build(schedule: context.schedule, week: context.currentWeek, defense: defense.sleeper)
    }

    public static func apply(_ overrides: [String: TETeamOverride], to teams: [String: TETeamContext]) -> [String: TETeamContext] {
        TEContextAutofill.apply(overrides, to: teams)
    }

    public static func candidates(context: LeagueContext, teams: [String: TETeamContext],
                                  players: [String: TEPlayerOverride], alwaysInclude: Set<String>) -> [TECandidate] {
        var builder = TECandidateBuilder(context: context, teams: teams, players: players)
        builder.alwaysInclude = alwaysInclude
        return builder.candidates()
    }

    public static func project(_ candidate: TECandidate, scoring: TEScoring, risk: StreamRiskMode) -> TEProjection {
        TEStreamEngine.project(candidate, scoring: scoring, risk: risk)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [TEGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .sorted(by: >)
            .compactMap { week -> TEGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID] else { return nil }
                let s = line.stats
                return TEGameLine(
                    week: week,
                    opponent: line.opponent.flatMap { NFLTeams.nflverse($0) },
                    points: line.score(scoring: scoring).points,
                    targets: s["rec_tgt"] ?? 0,
                    receptions: s["rec"] ?? 0,
                    yards: s["rec_yd"] ?? 0,
                    firstDowns: s["rec_fd"] ?? 0,
                    touchdowns: s["rec_td"] ?? 0,
                    longCatches: (s["rec_30_39"] ?? 0) + (s["rec_40p"] ?? 0),
                    redZoneTargets: s["rec_rz_tgt"] ?? 0,
                    snapShare: line.offensiveSnapShare
                )
            }
            .prefix(limit)
            .map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { nil }

    public static func parseImport(_ data: Data) throws -> TEWeekOverrides {
        try TEContextImport.parse(data)
    }

    public static func sourceNotes(teams: [String: TETeamContext]) -> [String] {
        var notes: [String] = []
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("TE matchup (points a defense allows to tight ends) needs \(DefenseVsPosition.defaultMinimumGames) games per defense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Spread and total are recorded closing lines from the schedule file, not live odds. Seam coverage (injured or weak linebackers and safeties) and vacated targets (a teammate out) are neutral unless edited.")
        notes.append("Routes are estimated from snap share by role (featured and seam TEs run a route on ~85% of snaps, inline TEs ~55%), and TD rates are regressed hard toward the role norm — both heuristic until backtested.")
        return notes
    }
}

public typealias TEStreamScreenModel = StreamScreenModel<TEStreamKind>
public typealias TEStreamSnapshot = StreamSnapshot<TEStreamKind>

/// One completed game, for the comparison's recent-form rows.
public struct TEGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    /// Scored in the league's own settings.
    public let points: Double
    public let targets: Double
    public let receptions: Double
    public let yards: Double
    public let firstDowns: Double
    public let touchdowns: Double
    /// Catches of 30+ yards.
    public let longCatches: Double
    public let redZoneTargets: Double
    public let snapShare: Double?
}
