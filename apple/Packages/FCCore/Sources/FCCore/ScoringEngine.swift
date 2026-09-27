import Foundation

/// One rule's contribution to a week's score, kept so the UI can show *why* a
/// number is what it is. That is a core product value, not a debugging aid.
public struct ScoreComponent: Hashable, Sendable {
    public let rule: ScoringRule
    public let label: String
    /// How many of the thing happened — 244 yards, 4 touchdowns, one bonus.
    public let units: Double
    public let points: Double
}

/// The result of scoring one stat line.
///
/// `points == nil` means the engine could not score this row at all, and
/// `reason` says why. That is deliberately not zero: a position with no data is
/// *unsupported*, which is a different claim (§3.2).
public struct WeekScore: Hashable, Sendable {
    public let points: Double?
    public let reason: String?
    public let breakdown: [ScoreComponent]
    /// Rules this league pays for that this data set cannot produce, filtered
    /// to the ones that could actually fire for this position.
    public let unsupported: [ScoringRule]

    public var isScored: Bool { points != nil }
}

/// A scored week with the context needed to show it in a list.
public struct ScoredWeek: Hashable, Sendable {
    public let week: Int
    public let team: String?
    public let opponent: String?
    public let points: Double
    public let breakdown: [ScoreComponent]
}

/// A season's worth of scored weeks.
public struct SeasonScore: Hashable, Sendable {
    public let weeks: [ScoredWeek]
    public let total: Double
    public let games: Int
    /// `nil` rather than zero when no week could be scored.
    public let pointsPerGame: Double?
    public let unsupported: [ScoringRule]

    public static let empty = SeasonScore(
        weeks: [], total: 0, games: 0, pointsPerGame: nil, unsupported: []
    )
}

/// Scores nflverse weekly stat lines into fantasy points under a league's own
/// profile.
///
/// Everything this engine cannot express is returned in `unsupported` and never
/// zero-filled. A missing stat is stated, not scored as zero.
public enum ScoringEngine {
    /// Profile rules no amount of *weekly player* data can produce. Team-defense
    /// and IDP scoring live in feeds this app does not ingest, and pick-sixes
    /// are not broken out of `passing_interceptions`.
    public static let unsupportedByWeeklyData: [ScoringRule] = [
        .pickSix,
        .defSack, .defInterception, .defFumbleRecovery, .defTD, .defSafety,
        .defPointsAllowed0, .defPointsAllowed1to6, .defPointsAllowed7to13,
        .defPointsAllowed14to20, .defPointsAllowed21to27, .defPointsAllowed28to34,
        .defPointsAllowedOver35,
        .idpTackle, .idpSack, .idpInterception, .idpFumbleRecovery, .idpTD,
        .idpPassDefended,
    ]

    /// Which unsupported rules could actually fire for a player at this
    /// position. A pick-six is charged to the passer, so it is a quarterback's
    /// only real exposure; team-defense and IDP scoring never touches an
    /// offensive skill player.
    ///
    /// Telling a QB his league has sixteen missing rules — fifteen of them ones
    /// he can never trigger — overstates the gap and trains the reader to ignore
    /// the warning.
    public static func unsupportedRules(for position: Position?) -> [ScoringRule] {
        // An unknown position could be anything, including a team defense, so
        // it inherits the full list rather than a reassuring empty one.
        guard let position else { return unsupportedByWeeklyData }
        switch position {
        case .qb: return [.pickSix]
        case .def: return unsupportedByWeeklyData
        default: return []
        }
    }

    /// Yardage divide. A profile field of zero means "this league does not score
    /// yards", **not** "divide by zero" — an infinity here would poison every
    /// downstream average and chart axis (§4).
    static func perPoint(_ yards: Double, yardsPerPoint: Double) -> Double {
        let ypp = finite(yardsPerPoint)
        guard ypp > 0 else { return 0 }
        return finite(yards) / ypp
    }

    /// Scores one decoded weekly row.
    public static func score(
        _ row: WeeklyRow?,
        profile: ScoringProfile = .leagueDefault,
        position: Position? = nil
    ) -> WeekScore {
        guard let row else {
            return WeekScore(points: nil, reason: "No stat line", breakdown: [], unsupported: [])
        }

        // Team defenses are scored from team-level game results this data set
        // does not carry. Returning nil keeps a blank cell honest.
        if position == .def {
            return WeekScore(
                points: nil,
                reason: "Team defense is not in the nflverse player stats file",
                breakdown: [],
                unsupported: unsupportedByWeeklyData
            )
        }

        var components: [ScoreComponent] = []
        func add(_ rule: ScoringRule, units: Double, points: Double) {
            guard points != 0 else { return }
            components.append(
                ScoreComponent(rule: rule, label: rule.label, units: units, points: points)
            )
        }

        // ── Passing ──────────────────────────────────────────────────────────
        let passYards = row.number(.passYards)
        add(.passingYardsPerPoint, units: passYards,
            points: perPoint(passYards, yardsPerPoint: profile.passingYardsPerPoint))
        add(.passingTD, units: row.number(.passTD),
            points: row.number(.passTD) * profile.passingTD)
        add(.passingFirstDown, units: row.number(.passFirstDowns),
            points: row.number(.passFirstDowns) * profile.passingFirstDown)
        add(.interception, units: row.number(.interceptions),
            points: row.number(.interceptions) * profile.interception)
        add(.sackTaken, units: row.number(.sacks),
            points: row.number(.sacks) * profile.sackTaken)
        // Incompletions are not a column, but attempts minus completions is
        // exactly that.
        let incompletions = max(0, row.number(.attempts) - row.number(.completions))
        add(.incompletion, units: incompletions, points: incompletions * profile.incompletion)
        add(.passing2pt, units: row.number(.pass2pt),
            points: row.number(.pass2pt) * profile.passing2pt)

        // Yardage and completion bonuses STACK. Sleeper models
        // `bonus_pass_yd_300` and `bonus_pass_yd_400` as independent rules, so a
        // 410-yard game pays both — it is not a tier where 400 replaces 300.
        if passYards >= 300 { add(.passing300Bonus, units: 1, points: profile.passing300Bonus) }
        if passYards >= 400 { add(.passing400Bonus, units: 1, points: profile.passing400Bonus) }
        if row.number(.completions) >= 25 {
            add(.completions25Bonus, units: 1, points: profile.completions25Bonus)
        }

        // ── Rushing ──────────────────────────────────────────────────────────
        let rushYards = row.number(.rushYards)
        add(.rushingYardsPerPoint, units: rushYards,
            points: perPoint(rushYards, yardsPerPoint: profile.rushingYardsPerPoint))
        add(.rushingTD, units: row.number(.rushTD),
            points: row.number(.rushTD) * profile.rushingTD)
        add(.rushingFirstDown, units: row.number(.rushFirstDowns),
            points: row.number(.rushFirstDowns) * profile.rushingFirstDown)
        add(.rushing2pt, units: row.number(.rush2pt),
            points: row.number(.rush2pt) * profile.rushing2pt)
        if rushYards >= 100 { add(.rushing100Bonus, units: 1, points: profile.rushing100Bonus) }
        if rushYards >= 200 { add(.rushing200Bonus, units: 1, points: profile.rushing200Bonus) }

        // ── Receiving ────────────────────────────────────────────────────────
        let recYards = row.number(.recYards)
        add(.receptionPoints, units: row.number(.receptions),
            points: row.number(.receptions) * profile.receptionPoints)
        add(.receivingYardsPerPoint, units: recYards,
            points: perPoint(recYards, yardsPerPoint: profile.receivingYardsPerPoint))
        add(.receivingTD, units: row.number(.recTD),
            points: row.number(.recTD) * profile.receivingTD)
        add(.receivingFirstDown, units: row.number(.recFirstDowns),
            points: row.number(.recFirstDowns) * profile.receivingFirstDown)
        add(.receiving2pt, units: row.number(.rec2pt),
            points: row.number(.rec2pt) * profile.receiving2pt)
        if recYards >= 100 { add(.receiving100Bonus, units: 1, points: profile.receiving100Bonus) }
        if recYards >= 200 { add(.receiving200Bonus, units: 1, points: profile.receiving200Bonus) }

        // ── Turnovers and special teams ──────────────────────────────────────
        let fumblesLost = row.number(.rushFumblesLost)
            + row.number(.recFumblesLost)
            + row.number(.sackFumblesLost)
        add(.fumbleLost, units: fumblesLost, points: fumblesLost * profile.fumbleLost)
        add(.specialTeamsTD, units: row.number(.specialTeamsTD),
            points: row.number(.specialTeamsTD) * profile.specialTeamsTD)

        // ── Kicking ──────────────────────────────────────────────────────────
        // The profile has four distance tiers; nflverse has six ten-yard
        // buckets. The 0-39 tier is the sum of three buckets, which is exact.
        // Going the other way — collapsing Sleeper's own buckets into these four
        // — is lossy for leagues that pay differently inside a tier, and that
        // loss is surfaced rather than hidden.
        let shortFieldGoals = row.number(.fg0to19) + row.number(.fg20to29) + row.number(.fg30to39)
        add(.fg0to39, units: shortFieldGoals, points: shortFieldGoals * profile.fg0to39)
        add(.fg40to49, units: row.number(.fg40to49),
            points: row.number(.fg40to49) * profile.fg40to49)
        add(.fg50to59, units: row.number(.fg50to59),
            points: row.number(.fg50to59) * profile.fg50to59)
        add(.fg60plus, units: row.number(.fg60plus),
            points: row.number(.fg60plus) * profile.fg60plus)
        add(.xp, units: row.number(.extraPointsMade),
            points: row.number(.extraPointsMade) * profile.xp)
        add(.missedFG, units: row.number(.fgMissed),
            points: row.number(.fgMissed) * profile.missedFG)

        let points = components.reduce(0) { $0 + $1.points }

        // A rule is only a real gap when the league pays for it AND it could
        // apply to this player.
        let unsupported = unsupportedRules(for: position).filter { profile[$0] != 0 }

        return WeekScore(
            points: roundHalfUp(points, places: 2),
            reason: nil,
            breakdown: components.sorted { abs($0.points) > abs($1.points) },
            unsupported: unsupported
        )
    }

    /// Scores a whole season of decoded rows.
    public static func score(
        weeks rows: [WeeklyRow],
        profile: ScoringProfile = .leagueDefault,
        position: Position? = nil
    ) -> SeasonScore {
        var scored: [ScoredWeek] = []
        var unsupported: [ScoringRule] = []

        for row in rows {
            let result = score(row, profile: profile, position: position)
            guard let points = result.points else { continue }
            unsupported = result.unsupported
            scored.append(
                ScoredWeek(
                    week: row.week,
                    team: row.team,
                    opponent: row.opponent,
                    points: points,
                    breakdown: result.breakdown
                )
            )
        }

        scored.sort { $0.week < $1.week }
        let total = scored.reduce(0) { $0 + $1.points }
        return SeasonScore(
            weeks: scored,
            total: roundHalfUp(total, places: 2),
            games: scored.count,
            pointsPerGame: scored.isEmpty
                ? nil
                : roundHalfUp(total / Double(scored.count), places: 2),
            unsupported: unsupported
        )
    }
}
