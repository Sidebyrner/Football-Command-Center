import Foundation

/// A per-game measure the grade can rank a player on. Every one is computed
/// from real current-season data — Sleeper's stat lines and the usage file —
/// and a player with no value for a metric is simply not ranked on it. Nothing
/// is defaulted.
public enum GradeMetric: String, CaseIterable, Hashable, Sendable, Identifiable {
    // Everyone
    case pointsPerGame
    case snapShare
    case expectedPointsPerGame
    // Rushing / receiving
    case touchesPerGame
    case rushAttemptsPerGame
    case targetShare
    case targetsPerGame
    case airYardsShare
    case redZoneTouchesPerGame
    case yardsPerTarget
    case catchRate
    case dropRate
    case yardsBeforeContact
    case yardsAfterContact
    case brokenTacklesPerTouch
    // Passing
    case passerRating
    case completionPct
    case yardsPerAttempt
    case interceptionRate
    case sackRate
    // Kicking
    case fieldGoalPct
    case fieldGoalAttemptsPerGame
    // Team defense
    case pointsAllowedPerGame
    case takeawaysPerGame
    case defensiveSacksPerGame
    // IDP
    case tacklesPerGame
    case defensiveSnapShare
    case sacksPerGame
    case passesDefendedPerGame

    public var id: String { rawValue }

    /// Lower is better.
    public var isInverted: Bool {
        switch self {
        case .dropRate, .interceptionRate, .sackRate, .pointsAllowedPerGame: return true
        default: return false
        }
    }

    public var label: String {
        switch self {
        case .pointsPerGame: return "Points per game"
        case .snapShare: return "Snap share"
        case .expectedPointsPerGame: return "Expected points per game"
        case .touchesPerGame: return "Touches per game"
        case .rushAttemptsPerGame: return "Rush attempts per game"
        case .targetShare: return "Target share"
        case .targetsPerGame: return "Targets per game"
        case .airYardsShare: return "Air yards share"
        case .redZoneTouchesPerGame: return "Red zone touches per game"
        case .yardsPerTarget: return "Yards per target"
        case .catchRate: return "Catch rate"
        case .dropRate: return "Drop rate"
        case .yardsBeforeContact: return "Yards before contact"
        case .yardsAfterContact: return "Yards after contact"
        case .brokenTacklesPerTouch: return "Broken tackles per touch"
        case .passerRating: return "Passer rating"
        case .completionPct: return "Completion %"
        case .yardsPerAttempt: return "Yards per attempt"
        case .interceptionRate: return "Interception rate"
        case .sackRate: return "Sack rate"
        case .fieldGoalPct: return "Field goal %"
        case .fieldGoalAttemptsPerGame: return "FG attempts per game"
        case .pointsAllowedPerGame: return "Points allowed per game"
        case .takeawaysPerGame: return "Takeaways per game"
        case .defensiveSacksPerGame: return "Sacks per game"
        case .tacklesPerGame: return "Tackles per game"
        case .defensiveSnapShare: return "Defensive snap share"
        case .sacksPerGame: return "Sacks per game"
        case .passesDefendedPerGame: return "Passes defended per game"
        }
    }

    /// Where the number comes from.
    public var source: String {
        switch self {
        case .snapShare, .expectedPointsPerGame, .yardsBeforeContact, .yardsAfterContact, .brokenTacklesPerTouch, .dropRate:
            return "nflverse snap counts, pfr and ffopportunity"
        default:
            return "Sleeper stat lines"
        }
    }
}

/// The weights of the position models. Ported from the web app's weekly
/// tables and extended to the positions the current-season sources now cover;
/// every entry names a metric that real data can produce.
public enum GradeWeights {
    public static func weekly(for position: Position) -> [GradeMetric: Double] {
        switch position {
        case .qb:
            return [.passerRating: 12, .completionPct: 9, .yardsPerAttempt: 9, .interceptionRate: 8,
                    .sackRate: 6, .rushAttemptsPerGame: 7, .pointsPerGame: 6, .snapShare: 4]
        case .rb:
            return [.touchesPerGame: 12, .rushAttemptsPerGame: 10, .snapShare: 9, .expectedPointsPerGame: 9,
                    .redZoneTouchesPerGame: 8, .targetShare: 7, .yardsAfterContact: 7, .brokenTacklesPerTouch: 6,
                    .yardsBeforeContact: 5, .pointsPerGame: 5]
        case .wr:
            return [.targetShare: 11, .targetsPerGame: 9, .airYardsShare: 8, .expectedPointsPerGame: 8,
                    .redZoneTouchesPerGame: 7, .yardsPerTarget: 7, .snapShare: 6, .catchRate: 6,
                    .dropRate: 4, .pointsPerGame: 5]
        case .te:
            return [.targetShare: 12, .targetsPerGame: 9, .expectedPointsPerGame: 8, .redZoneTouchesPerGame: 7,
                    .catchRate: 7, .yardsPerTarget: 6, .airYardsShare: 5, .snapShare: 6, .pointsPerGame: 5]
        case .k:
            return [.fieldGoalPct: 10, .pointsPerGame: 10, .fieldGoalAttemptsPerGame: 6]
        case .def:
            return [.pointsPerGame: 10, .pointsAllowedPerGame: 8, .takeawaysPerGame: 7, .defensiveSacksPerGame: 6]
        case .lb, .dl, .db:
            return [.pointsPerGame: 10, .tacklesPerGame: 9, .defensiveSnapShare: 9, .sacksPerGame: 6, .passesDefendedPerGame: 5]
        }
    }

    /// Nudges weights toward what the league actually pays for, as the web
    /// app's `applyProfile` does. Only metrics already in the table move.
    public static func applyProfile(_ weights: [GradeMetric: Double], profile: ScoringProfile) -> [GradeMetric: Double] {
        var out = weights
        func bump(_ metric: GradeMetric, _ by: Double) {
            guard let current = out[metric] else { return }
            out[metric] = max(0, current + by)
        }
        let ppr = profile.receptionPoints
        if ppr == 0 {
            bump(.targetsPerGame, -2)
            bump(.targetShare, -1)
            bump(.yardsPerTarget, +2)
        } else if ppr >= 1 {
            bump(.targetsPerGame, +2)
            bump(.catchRate, +1)
        }
        if profile.incompletion <= -1 {
            bump(.completionPct, +2)
            bump(.sackRate, +1)
        }
        if profile.interception <= -4 { bump(.interceptionRate, +2) }
        if profile.idpSack >= 3 { bump(.sacksPerGame, +3) }
        if profile.idpTackle <= 0 { bump(.tacklesPerGame, -4) }
        return out
    }
}

/// One metric's part in a grade.
public struct GradeFactor: Hashable, Sendable, Identifiable {
    public let metric: GradeMetric
    public let value: Double
    /// 0…1, already inverted for lower-is-better metrics.
    public let percentile: Double
    public let weight: Double
    public var contribution: Double { percentile * weight }
    public var id: String { metric.rawValue }
}

/// A 0–100 percentile grade against the position cohort this season.
///
/// Only metrics with both a real value and a real cohort contribute; the rest
/// are listed as missing and `coverage` says how much of the model's weight
/// had data behind it. A grade under half coverage is "thin" and the UI shows
/// it as such rather than as a confident number (the web app's rule).
public struct PlayerGrade: Hashable, Sendable {
    public static let thinCoverage = 0.5
    /// Cohorts smaller than this cannot support a percentile.
    public static let minimumCohort = 12

    public let score: Int?
    public let coverage: Double
    public let factors: [GradeFactor]
    public let missing: [GradeMetric]
    public let cohortSize: Int

    public var isThin: Bool { coverage < Self.thinCoverage }

    public var tier: String? {
        guard let score else { return nil }
        if score >= 82 { return "Tier 1 — Elite" }
        if score >= 68 { return "Tier 2 — Strong" }
        if score >= 54 { return "Tier 3 — Solid" }
        if score >= 40 { return "Tier 4 — Depth" }
        return "Tier 5 — Speculative"
    }

    /// Largest contributions first.
    public var topFactors: [GradeFactor] {
        factors.sorted { $0.contribution > $1.contribution }
    }

    public static func compute(
        metrics: [GradeMetric: Double],
        cohorts: [GradeMetric: [Double]],
        weights: [GradeMetric: Double]
    ) -> PlayerGrade {
        var total = 0.0
        var used = 0.0
        var all = 0.0
        var factors: [GradeFactor] = []
        var missing: [GradeMetric] = []
        var largestCohort = 0

        for (metric, weight) in weights.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            all += weight
            guard let value = metrics[metric], value.isFinite,
                  let cohort = cohorts[metric], cohort.count >= minimumCohort else {
                missing.append(metric)
                continue
            }
            largestCohort = max(largestCohort, cohort.count)
            var percentile = Percentile.rank(value, in: cohort)
            if metric.isInverted { percentile = 1 - percentile }
            percentile = min(max(percentile, 0), 1)
            factors.append(GradeFactor(metric: metric, value: value, percentile: percentile, weight: weight))
            total += percentile * weight
            used += weight
        }

        return PlayerGrade(
            score: used > 0 ? Int((total / used * 100).rounded()) : nil,
            coverage: all > 0 ? used / all : 0,
            factors: factors,
            missing: missing,
            cohortSize: largestCohort
        )
    }
}

/// The situation around a player: his line, his quarterback, his competition
/// for targets, his team's pace, his matchup. Each is shown as its own labelled
/// percentile beside the grade, never folded into it by default.
public enum SituationMetric: String, CaseIterable, Hashable, Sendable, Identifiable {
    case passProtection
    case runBlocking
    case quarterbackPlay
    case targetCompetition
    case teamPace
    case gameEnvironment
    case snapTrend
    case depthChartRank
    case airYardsShare
    case redZoneShare

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .passProtection: return "OL pass protection"
        case .runBlocking: return "OL run blocking"
        case .quarterbackPlay: return "QB play"
        case .targetCompetition: return "Target competition"
        case .teamPace: return "Team pace"
        case .gameEnvironment: return "Game environment"
        case .snapTrend: return "Snap trend"
        case .depthChartRank: return "Depth chart"
        case .airYardsShare: return "Air yards share"
        case .redZoneShare: return "Red zone share"
        }
    }

    public var source: String {
        switch self {
        case .passProtection: return "pfr pressure rate and sacks allowed, this season"
        case .runBlocking: return "pfr yards before contact, this season"
        case .quarterbackPlay: return "ESPN Total QBR and passer rating, this season"
        case .targetCompetition: return "share of team targets to the top two, Sleeper lines"
        case .teamPace: return "offensive plays per game, nflverse"
        case .gameEnvironment: return "implied team total this week, recorded closing lines"
        case .snapTrend: return "last 3 games' snap share against the season, nflverse snap counts"
        case .depthChartRank: return "official depth chart, nflverse"
        case .airYardsShare: return "share of team air yards, Sleeper lines"
        case .redZoneShare: return "share of team red zone touches, Sleeper lines"
        }
    }

    /// Default weights for the optional composite, from the Moneyball notes
    /// where a metric maps to one they named; the rest are modest.
    public var defaultWeight: Double {
        switch self {
        case .passProtection: return 5
        case .runBlocking: return 6
        case .quarterbackPlay: return 8
        case .targetCompetition: return 4
        case .teamPace: return 3
        case .gameEnvironment: return 5
        case .snapTrend: return 6
        case .depthChartRank: return 4
        case .airYardsShare: return 8
        case .redZoneShare: return 7
        }
    }
}

/// One situation chip, with its percentile where a comparison set exists.
public struct SituationChip: Hashable, Sendable, Identifiable {
    public let metric: SituationMetric
    public let value: Double
    /// 0…1 against the comparison set named in `comparedTo`; `nil` when there
    /// is no set to compare against, in which case only the value is shown.
    public let percentile: Double?
    public let detail: String
    public let comparedTo: String

    public var id: String { metric.rawValue }

    public init(metric: SituationMetric, value: Double, percentile: Double?, detail: String, comparedTo: String) {
        self.metric = metric
        self.value = value
        self.percentile = percentile
        self.detail = detail
        self.comparedTo = comparedTo
    }
}

/// The opt-in composite: the cohort grade and the situation chips folded
/// together under visible weights. Reports what share of its weight had a
/// number behind it, so a composite built from two chips reads as thin.
public struct WeightedGrade: Hashable, Sendable {
    public struct Part: Hashable, Sendable, Identifiable {
        public let name: String
        public let percentile: Double
        public let weight: Double
        public var contribution: Double { percentile * weight }
        public var id: String { name }
    }

    public static let gradeKey = "cohortGrade"
    public static let defaultGradeWeight = 40.0

    public let score: Int?
    public let coverage: Double
    public let parts: [Part]
    public let missing: [String]

    public static func compute(
        grade: PlayerGrade?,
        chips: [SituationChip],
        weights: [String: Double]
    ) -> WeightedGrade {
        var total = 0.0, used = 0.0, all = 0.0
        var parts: [Part] = []
        var missing: [String] = []

        let gradeWeight = weights[gradeKey] ?? defaultGradeWeight
        if gradeWeight > 0 {
            all += gradeWeight
            if let score = grade?.score {
                let percentile = Double(score) / 100
                parts.append(Part(name: "Cohort grade", percentile: percentile, weight: gradeWeight))
                total += percentile * gradeWeight
                used += gradeWeight
            } else {
                missing.append("Cohort grade")
            }
        }

        for metric in SituationMetric.allCases {
            let weight = weights[metric.rawValue] ?? metric.defaultWeight
            guard weight > 0 else { continue }
            all += weight
            if let chip = chips.first(where: { $0.metric == metric }), let percentile = chip.percentile {
                parts.append(Part(name: metric.label, percentile: percentile, weight: weight))
                total += percentile * weight
                used += weight
            } else {
                missing.append(metric.label)
            }
        }

        return WeightedGrade(
            score: used > 0 ? Int((total / used * 100).rounded()) : nil,
            coverage: all > 0 ? used / all : 0,
            parts: parts.sorted { $0.contribution > $1.contribution },
            missing: missing
        )
    }
}
