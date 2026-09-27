import Foundation
import FCCore
import FCData

extension IDPCandidate: StreamCandidate {}

/// IDP Stream's part of the shared stream screen: defenders at LB/DL/DB,
/// projected by `IDPStreamEngine`.
public enum IDPStreamKind: StreamKind {
    public typealias Candidate = IDPCandidate
    public typealias Projection = IDPProjection
    public typealias Scoring = IDPScoring
    public typealias Team = IDPTeamContext
    public typealias TeamOverride = IDPTeamOverride
    public typealias PlayerOverride = IDPPlayerOverride
    public typealias GameLine = IDPGameLine

    public static let storeFolder = "IDPStream"
    public static let positions: [Position] = [.lb, .dl, .db]
    public static let playerNoun = "defender"
    public static let emptyScoring = IDPScoring()

    public static func scoring(sleeperSettings: [String: Double]) -> IDPScoring {
        IDPScoring.from(sleeperSettings: sleeperSettings)
    }

    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        IDPScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: IDPTeamContext] {
        IDPContextAutofill.build(schedule: context.schedule, week: context.currentWeek, defense: defense.sleeper)
    }

    public static func apply(_ overrides: [String: IDPTeamOverride], to teams: [String: IDPTeamContext]) -> [String: IDPTeamContext] {
        IDPContextAutofill.apply(overrides, to: teams)
    }

    public static func candidates(context: LeagueContext, teams: [String: IDPTeamContext],
                                  players: [String: IDPPlayerOverride], alwaysInclude: Set<String>) -> [IDPCandidate] {
        var builder = IDPCandidateBuilder(context: context, teams: teams, players: players)
        builder.alwaysInclude = alwaysInclude
        return builder.candidates()
    }

    public static func project(_ candidate: IDPCandidate, scoring: IDPScoring, risk: StreamRiskMode) -> IDPProjection {
        IDPStreamEngine.project(candidate, scoring: scoring, risk: risk)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [IDPGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .sorted(by: >)
            .compactMap { week -> IDPGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID] else { return nil }
                let s = line.stats
                return IDPGameLine(
                    week: week,
                    opponent: line.opponent.flatMap { NFLTeams.nflverse($0) },
                    points: line.score(scoring: scoring).points,
                    snapShare: line.defensiveSnapShare,
                    tackles: s["idp_tkl"] ?? ((s["idp_tkl_solo"] ?? 0) + (s["idp_tkl_ast"] ?? 0)),
                    sacks: s["idp_sack"] ?? 0
                )
            }
            .prefix(limit)
            .map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? {
        IDPSubPosition.resolve(positionCode: player.positionCode, depthChartPosition: player.depthChartPosition)?.position.label
    }

    public static func parseImport(_ data: Data) throws -> IDPWeekOverrides {
        try IDPContextImport.parse(data)
    }

    public static func sourceNotes(teams: [String: IDPTeamContext]) -> [String] {
        var notes: [String] = []
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("IDP matchup (points an offense allows to LB/DL/DB) needs \(DefenseVsPosition.defaultMinimumGames) games per offense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Spread and total are recorded closing lines from the schedule file, not live odds. Opponent pass protection is neutral unless edited.")
        return notes
    }
}

public typealias IDPStreamScreenModel = StreamScreenModel<IDPStreamKind>
public typealias IDPStreamSnapshot = StreamSnapshot<IDPStreamKind>

/// One completed game, for the comparison's recent-form rows.
public struct IDPGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    /// Scored in the league's own settings.
    public let points: Double
    public let snapShare: Double?
    public let tackles: Double
    public let sacks: Double
}
