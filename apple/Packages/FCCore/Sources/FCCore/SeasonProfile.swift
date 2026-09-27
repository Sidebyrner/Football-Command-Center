import Foundation

/// One player's season as the acquisition board and the baselines see it.
///
/// Every field here is something that **already happened**. There is no
/// forecast in this type and no blended composite score — those hide which
/// claim you are betting on, and a blended weekly evaluator was built in the web
/// app and deliberately reverted for overclaiming (§6).
public struct SeasonProfile: Hashable, Sendable {
    public let gsisID: String
    public let name: String
    public let position: Position
    /// Most recent team from the weekly rows, in the nflverse dialect.
    public let team: String?
    public let games: Int
    public let pointsPerGame: Double
    /// Points per game over the last `formWeeks` games played.
    public let formPointsPerGame: Double?
    /// Floor and ceiling the player actually produced (p20/p80), never a model.
    public let floor: Double?
    public let ceiling: Double?
    public let median: Double?
    public let targetShare: Double?
    public let recentTargetShare: Double?
    public let airYardsShare: Double?
    public let weeks: [ScoredWeek]

    public init(
        gsisID: String, name: String, position: Position, team: String?, games: Int,
        pointsPerGame: Double, formPointsPerGame: Double?, floor: Double?, ceiling: Double?,
        median: Double?, targetShare: Double?, recentTargetShare: Double?,
        airYardsShare: Double?, weeks: [ScoredWeek]
    ) {
        self.gsisID = gsisID
        self.name = name
        self.position = position
        self.team = team
        self.games = games
        self.pointsPerGame = pointsPerGame
        self.formPointsPerGame = formPointsPerGame
        self.floor = floor
        self.ceiling = ceiling
        self.median = median
        self.targetShare = targetShare
        self.recentTargetShare = recentTargetShare
        self.airYardsShare = airYardsShare
        self.weeks = weeks
    }
}

public enum SeasonScan {
    /// How many recent games count as "form".
    public static let formWeeks = 4

    /// Scores every player in a weekly file under one profile.
    ///
    /// The result covers QB/RB/WR/TE/K only, because that is all the file holds.
    /// DEF and IDP are absent entirely and must be reported as *unsupported*
    /// rather than scored as zero (§3.2).
    public static func run(
        file: WeeklyFile,
        profile: ScoringProfile,
        formWeeks: Int = SeasonScan.formWeeks
    ) -> [SeasonProfile] {
        var out: [SeasonProfile] = []

        for player in file.allPlayers() {
            let rows = player.rows
            guard let position = player.position, !rows.isEmpty else { continue }

            let season = ScoringEngine.score(weeks: rows, profile: profile, position: position)
            guard season.games > 0, let pointsPerGame = season.pointsPerGame else { continue }

            let recentRows = Array(rows.suffix(formWeeks))
            let form = ScoringEngine.score(
                weeks: recentRows, profile: profile, position: position
            )
            let distribution = Distribution(weeks: season.weeks)

            out.append(
                SeasonProfile(
                    gsisID: player.gsisID,
                    name: player.meta?.name ?? player.gsisID,
                    position: position,
                    team: rows.last?.team,
                    games: season.games,
                    pointsPerGame: pointsPerGame,
                    formPointsPerGame: form.pointsPerGame,
                    floor: distribution.floor,
                    ceiling: distribution.ceiling,
                    median: distribution.median,
                    targetShare: mean(rows.map { $0.value(.targetShare) }),
                    recentTargetShare: mean(recentRows.map { $0.value(.targetShare) }),
                    airYardsShare: mean(rows.map { $0.value(.airYardsShare) }),
                    weeks: season.weeks
                )
            )
        }

        return out
    }

    /// Mean over the values that exist. A column the row does not carry is
    /// absent from the average, not a zero dragging it down.
    static func mean(_ values: [Double?]) -> Double? {
        let present = values.compactMap { $0 }.filter { $0.isFinite }
        guard !present.isEmpty else { return nil }
        return present.reduce(0, +) / Double(present.count)
    }
}
