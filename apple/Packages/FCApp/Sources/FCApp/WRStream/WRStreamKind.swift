import Foundation
import FCCore
import FCData

extension WRCandidate: StreamCandidate {}

/// WR Stream's part of the shared stream screen: wide receivers, projected by
/// `WRStreamEngine` under the league's no-PPR, first-down-heavy scoring.
public enum WRStreamKind: StreamKind {
    public typealias Candidate = WRCandidate
    public typealias Projection = WRProjection
    public typealias Scoring = WRScoring
    public typealias Team = WRTeamContext
    public typealias TeamOverride = WRTeamOverride
    public typealias PlayerOverride = WRPlayerOverride
    public typealias GameLine = WRGameLine

    public static let storeFolder = "WRStream"
    public static let positions: [Position] = [.wr]
    public static let playerNoun = "receiver"
    public static let emptyScoring = WRScoring()

    public static func scoring(sleeperSettings: [String: Double]) -> WRScoring {
        WRScoring.from(sleeperSettings: sleeperSettings)
    }

    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        WRScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: WRTeamContext] {
        WRContextAutofill.build(schedule: context.schedule, week: context.currentWeek, defense: defense.sleeper)
    }

    public static func apply(_ overrides: [String: WRTeamOverride], to teams: [String: WRTeamContext]) -> [String: WRTeamContext] {
        WRContextAutofill.apply(overrides, to: teams)
    }

    public static func candidates(context: LeagueContext, teams: [String: WRTeamContext],
                                  players: [String: WRPlayerOverride], alwaysInclude: Set<String>) -> [WRCandidate] {
        var builder = WRCandidateBuilder(context: context, teams: teams, players: players)
        builder.alwaysInclude = alwaysInclude
        return builder.candidates()
    }

    public static func project(_ candidate: WRCandidate, scoring: WRScoring, risk: StreamRiskMode) -> WRProjection {
        WRStreamEngine.project(candidate, scoring: scoring, risk: risk)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [WRGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .sorted(by: >)
            .compactMap { week -> WRGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID] else { return nil }
                let s = line.stats
                return WRGameLine(
                    week: week,
                    opponent: line.opponent.flatMap { NFLTeams.nflverse($0) },
                    points: line.score(scoring: scoring).points,
                    targets: s["rec_tgt"] ?? 0,
                    receptions: s["rec"] ?? 0,
                    yards: s["rec_yd"] ?? 0,
                    firstDowns: s["rec_fd"] ?? 0,
                    touchdowns: s["rec_td"] ?? 0,
                    longCatches: (s["rec_30_39"] ?? 0) + (s["rec_40p"] ?? 0),
                    snapShare: line.offensiveSnapShare
                )
            }
            .prefix(limit)
            .map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { nil }

    public static func parseImport(_ data: Data) throws -> WRWeekOverrides {
        try WRContextImport.parse(data)
    }

    public static func sourceNotes(teams: [String: WRTeamContext]) -> [String] {
        var notes: [String] = []
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("WR matchup (points a defense allows to receivers) needs \(DefenseVsPosition.defaultMinimumGames) games per defense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Spread and total are recorded closing lines from the schedule file, not live odds. Coverage (shadow corners, injured secondaries, QB downgrades) is neutral unless edited.")
        notes.append("Roles are inferred from target share, aDOT and rushing usage; long-TD bonuses assume 30% of 40+ and 40% of 50+ catches score — both heuristic until backtested.")
        return notes
    }
}

public typealias WRStreamScreenModel = StreamScreenModel<WRStreamKind>
public typealias WRStreamSnapshot = StreamSnapshot<WRStreamKind>

/// One completed game, for the comparison's recent-form rows.
public struct WRGameLine: Hashable, Sendable {
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
    public let snapShare: Double?
}
