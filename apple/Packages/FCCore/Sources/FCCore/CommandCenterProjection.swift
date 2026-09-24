import Foundation

/// What the Command Center projection is built from. Every input is optional
/// and every one is a named, sourced fact; the projection reports which it
/// used and how much each moved the number, so it can be argued with.
public struct CommandCenterInputs: Hashable, Sendable {
    public let position: Position?
    /// Points per game this season, in the league's scoring, and the games
    /// behind it. From Sleeper's own stat lines.
    public let thisSeasonPointsPerGame: Double?
    public let thisSeasonGames: Int
    /// Last season's points per game, in the league's scoring. `nil` for a
    /// rookie or anyone without a line.
    public let lastSeasonPointsPerGame: Double?
    /// The league's replacement line at his position, the prior for someone
    /// with no last season.
    public let replacementLine: Double?
    /// Expected fantasy points from usage: the last four weeks, and the season.
    public let expectedPointsRecent: Double?
    public let expectedPointsSeason: Double?
    /// This week's opponent: points per game it allows to his position, and
    /// the league average for the position, both from one defense-vs-position
    /// table.
    public let opponentAllowedPerGame: Double?
    public let leagueAverageAllowed: Double?
    /// The same pair for every remaining week with a game, for the rest of
    /// the season.
    public let remainingOpponents: [(allowed: Double, average: Double)]

    public init(
        position: Position?,
        thisSeasonPointsPerGame: Double?,
        thisSeasonGames: Int,
        lastSeasonPointsPerGame: Double?,
        replacementLine: Double?,
        expectedPointsRecent: Double?,
        expectedPointsSeason: Double?,
        opponentAllowedPerGame: Double?,
        leagueAverageAllowed: Double?,
        remainingOpponents: [(allowed: Double, average: Double)] = []
    ) {
        self.position = position
        self.thisSeasonPointsPerGame = thisSeasonPointsPerGame
        self.thisSeasonGames = thisSeasonGames
        self.lastSeasonPointsPerGame = lastSeasonPointsPerGame
        self.replacementLine = replacementLine
        self.expectedPointsRecent = expectedPointsRecent
        self.expectedPointsSeason = expectedPointsSeason
        self.opponentAllowedPerGame = opponentAllowedPerGame
        self.leagueAverageAllowed = leagueAverageAllowed
        self.remainingOpponents = remainingOpponents
    }

    public static func == (lhs: CommandCenterInputs, rhs: CommandCenterInputs) -> Bool {
        lhs.position == rhs.position
            && lhs.thisSeasonPointsPerGame == rhs.thisSeasonPointsPerGame
            && lhs.thisSeasonGames == rhs.thisSeasonGames
            && lhs.lastSeasonPointsPerGame == rhs.lastSeasonPointsPerGame
            && lhs.replacementLine == rhs.replacementLine
            && lhs.expectedPointsRecent == rhs.expectedPointsRecent
            && lhs.expectedPointsSeason == rhs.expectedPointsSeason
            && lhs.opponentAllowedPerGame == rhs.opponentAllowedPerGame
            && lhs.leagueAverageAllowed == rhs.leagueAverageAllowed
            && lhs.remainingOpponents.map(\.allowed) == rhs.remainingOpponents.map(\.allowed)
            && lhs.remainingOpponents.map(\.average) == rhs.remainingOpponents.map(\.average)
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(position)
        hasher.combine(thisSeasonPointsPerGame)
        hasher.combine(thisSeasonGames)
        hasher.combine(lastSeasonPointsPerGame)
    }
}

/// One thing the projection did to the number, stated so the user can see it.
public struct ProjectionFactor: Hashable, Sendable, Identifiable {
    public let name: String
    /// A multiplier (`1.08`) or, for the pace, the points it starts from.
    public let value: Double
    public let detail: String

    public var id: String { name }
}

/// The Command Center's own projection: a rest-of-season points-per-game pace
/// and a version of it for this week.
///
/// The formula, in full, so it can be argued with:
///
///     pace     = w × thisSeason + (1 − w) × prior,  w = games / (games + 4)
///                prior = last season's pts/gm, or the replacement line
///     usage    = clamp(recent xFP / season xFP, 0.8 … 1.2)
///     schedule = clamp(1 + 0.5 × (allowed − average) / average, 0.75 … 1.25)
///     weekly   = pace × usage × schedule(this opponent)
///     ROS/gm   = pace × usage × mean(schedule(each remaining opponent))
///
/// It is a *separate, named* number. It never blends with Rotowire's and never
/// stands in for produced points; the calibration card is how the user judges
/// it (§6).
public struct CommandCenterProjection: Hashable, Sendable {
    public static let regressionGames = 4.0
    public static let usageBounds = 0.8...1.2
    public static let scheduleBounds = 0.75...1.25
    public static let scheduleWeight = 0.5
    public static let sourceLabel = "Command Center projection"

    public let weekly: Double?
    public let restOfSeasonPerGame: Double?
    public let pace: Double?
    public let factors: [ProjectionFactor]
    /// Why there is no number, when there is none.
    public let note: String?

    public var isValued: Bool { weekly != nil }

    public static func project(_ inputs: CommandCenterInputs) -> CommandCenterProjection {
        var factors: [ProjectionFactor] = []

        // Pace: this season regressed toward a prior.
        let prior = inputs.lastSeasonPointsPerGame ?? inputs.replacementLine
        let pace: Double?
        switch (inputs.thisSeasonPointsPerGame, prior) {
        case let (this?, prior?):
            let games = Double(max(0, inputs.thisSeasonGames))
            let weight = games / (games + regressionGames)
            pace = weight * this + (1 - weight) * prior
            factors.append(ProjectionFactor(
                name: "Pace",
                value: pace!,
                detail: String(format: "%.1f this season over %d game%@, regressed %.0f%% toward %.1f (%@)",
                               this, inputs.thisSeasonGames, inputs.thisSeasonGames == 1 ? "" : "s",
                               (1 - weight) * 100, prior,
                               inputs.lastSeasonPointsPerGame != nil ? "last season" : "the replacement line")
            ))
        case let (this?, nil):
            pace = this
            factors.append(ProjectionFactor(
                name: "Pace", value: this,
                detail: String(format: "%.1f this season over %d game%@, nothing to regress toward", this, inputs.thisSeasonGames, inputs.thisSeasonGames == 1 ? "" : "s")
            ))
        case let (nil, prior?):
            pace = prior
            factors.append(ProjectionFactor(
                name: "Pace", value: prior,
                detail: inputs.lastSeasonPointsPerGame != nil
                    ? String(format: "no games yet this season — last season's %.1f", prior)
                    : String(format: "no line either season — the replacement line, %.1f", prior)
            ))
        case (nil, nil):
            return CommandCenterProjection(
                weekly: nil, restOfSeasonPerGame: nil, pace: nil, factors: [],
                note: "No points per game this season or last, and no replacement line at his position."
            )
        }
        guard let pace else {
            return CommandCenterProjection(weekly: nil, restOfSeasonPerGame: nil, pace: nil, factors: [], note: "No pace.")
        }

        // Usage: is he being used more or less than his season average.
        var usage = 1.0
        if let recent = inputs.expectedPointsRecent, let season = inputs.expectedPointsSeason, season > 0 {
            usage = min(max(recent / season, usageBounds.lowerBound), usageBounds.upperBound)
            factors.append(ProjectionFactor(
                name: "Usage", value: usage,
                detail: String(format: "expected points last 4 (%.1f) against the season (%.1f)", recent, season)
            ))
        } else {
            factors.append(ProjectionFactor(name: "Usage", value: 1, detail: "no expected-points data — no adjustment"))
        }

        func schedule(allowed: Double, average: Double) -> Double {
            guard average > 0 else { return 1 }
            return min(max(1 + scheduleWeight * (allowed - average) / average, scheduleBounds.lowerBound), scheduleBounds.upperBound)
        }

        var thisWeek = 1.0
        if let allowed = inputs.opponentAllowedPerGame, let average = inputs.leagueAverageAllowed {
            thisWeek = schedule(allowed: allowed, average: average)
            factors.append(ProjectionFactor(
                name: "Matchup", value: thisWeek,
                detail: String(format: "opponent allows %.1f pts/gm to his position against a %.1f average", allowed, average)
            ))
        } else {
            factors.append(ProjectionFactor(name: "Matchup", value: 1, detail: "no defense-vs-position for this opponent — no adjustment"))
        }

        let remaining = inputs.remainingOpponents.map { schedule(allowed: $0.allowed, average: $0.average) }
        let restOfSeasonSchedule = remaining.isEmpty ? 1 : remaining.reduce(0, +) / Double(remaining.count)
        if !remaining.isEmpty {
            factors.append(ProjectionFactor(
                name: "Remaining schedule", value: restOfSeasonSchedule,
                detail: "mean matchup factor over \(remaining.count) remaining game\(remaining.count == 1 ? "" : "s")"
            ))
        }

        return CommandCenterProjection(
            weekly: roundHalfUp(pace * usage * thisWeek, places: 1),
            restOfSeasonPerGame: roundHalfUp(pace * usage * restOfSeasonSchedule, places: 1),
            pace: roundHalfUp(pace, places: 2),
            factors: factors,
            note: nil
        )
    }
}
