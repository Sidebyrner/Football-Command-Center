import Foundation
import FCCore
import FCData

/// Two to four players side by side, from their Player Card models plus the
/// Waiver Board's usage columns. Pure given the models' current state.
public struct PlayerComparison: Sendable {
    public enum Metric: String, CaseIterable, Identifiable, Sendable {
        case pointsPerGame, expectedPointsLast4, snapShare, targetShare, redZoneTouches,
             projectedThisWeek, restOfSeason, gradeScore, opponentRank, impliedTeamTotal, strengthOfSchedule, depthRank,
             trendingAdds, playoffMatchups,
             commandCenterThisWeek, formLast4, floorThisWeek, ceilingThisWeek

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .pointsPerGame: return "Pts/gm this season"
            case .expectedPointsLast4: return "xFP, last 4"
            case .snapShare: return "Snap share, last 4"
            case .targetShare: return "Target share, last 4"
            case .redZoneTouches: return "Red zone touches, last 4"
            case .projectedThisWeek: return "Projected this week"
            case .restOfSeason: return "Rest of season /gm"
            case .gradeScore: return "Grade"
            case .opponentRank: return "Opponent vs position"
            case .impliedTeamTotal: return "Team implied total"
            case .strengthOfSchedule: return "Schedule ahead (SoS)"
            case .depthRank: return "Depth chart"
            case .trendingAdds: return "Sleeper adds (24h)"
            case .playoffMatchups: return "Playoff matchups"
            case .commandCenterThisWeek: return "Command Center this week"
            case .formLast4: return "Last 4 pts/gm"
            case .floorThisWeek: return "Floor (bad week)"
            case .ceilingThisWeek: return "Ceiling (big week)"
            }
        }

        public var isPercent: Bool { self == .snapShare || self == .targetShare }

        /// Opponent rank (1 is the softest defense) and depth chart rank
        /// (1 is the starter): lower is better. SoS above 1 is softer.
        public var higherIsBetter: Bool { self != .opponentRank && self != .depthRank }

        public func format(_ value: Double) -> String {
            switch self {
            case .snapShare, .targetShare: return "\(Int((value * 100).rounded()))%"
            case .gradeScore: return "\(Int(value.rounded()))"
            case .opponentRank, .depthRank: return "#\(Int(value))"
            case .strengthOfSchedule, .playoffMatchups: return value.formatted(.number.precision(.fractionLength(2))) + "×"
            case .trendingAdds: return value.formatted(.number.notation(.compactName))
            default: return value.formatted(.number.precision(.fractionLength(1)))
            }
        }
    }

    public struct Player: Identifiable, Hashable, Sendable {
        public let id: String
        public let name: String
        public let position: Position?
        public let team: String?
        public let opponent: String?
        /// 0…3 — the chart colour.
        public let seriesIndex: Int
        /// Played weeks, oldest first, the last N.
        public let log: [PlayerLogWeek]
        public var values: [Metric: Double]
        /// Worst and best game this season; the estimate is this week's
        /// projection, else his average.
        public let floor: Double?
        public let expected: Double?
        public let ceiling: Double?
        /// Percentiles against his own position, by dimension; a dimension
        /// his position has no measure for is absent.
        public var profile: [ProfileDimension: ProfileValue] = [:]
        public var usage: UsageMix?
        /// The next few weeks, byes included.
        public var schedule: [PlayerSchedule.Week] = []
        public var strengthOfSchedule: Double?
        public var status: PlayerStatus?
        public var chips: [SituationChip] = []
        /// Where he stands in the league: a claim, a trade, or already yours.
        public var availability: Availability?
        /// One of the user's own players, measured against rather than ranked.
        public var isBaseline = false
        /// The newest headline Sleeper carries for him.
        public var headline: Headline?
        public var byeWeek: Int?
        /// The league's playoff weeks, byes included.
        public var playoffSchedule: [PlayerSchedule.Week] = []
        /// The official designation, else Sleeper's tag — "Out", "IR", "Q".
        public var injuryDesignation: String?
        public var practice: PracticeStatus?
    }

    public struct Headline: Hashable, Sendable {
        public let title: String
        public let published: Date?
    }

    /// A shared axis for players at different positions: each maps to that
    /// position's own grade measures, so a WR's target share and an RB's
    /// touches meet on one 0–100 scale.
    public enum ProfileDimension: String, CaseIterable, Hashable, Sendable, Identifiable {
        case production, volume, role, efficiency, bigPlays, ballSecurity

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .production: return "Production"
            case .volume: return "Volume"
            case .role: return "Role"
            case .efficiency: return "Efficiency"
            case .bigPlays: return "Scoring & big plays"
            case .ballSecurity: return "Ball security"
            }
        }

        /// The grade measures behind this dimension at a position.
        public func metrics(for position: Position) -> [GradeMetric] {
            switch (self, position) {
            case (.production, _): return [.pointsPerGame]
            case (.volume, .qb): return [.rushAttemptsPerGame]
            case (.volume, .rb): return [.touchesPerGame, .rushAttemptsPerGame]
            case (.volume, .wr), (.volume, .te): return [.targetsPerGame]
            case (.volume, .k): return [.fieldGoalAttemptsPerGame]
            case (.volume, .lb), (.volume, .dl), (.volume, .db): return [.tacklesPerGame]
            case (.role, .qb), (.role, .rb): return [.snapShare]
            case (.role, .wr), (.role, .te): return [.snapShare, .targetShare]
            case (.role, .lb), (.role, .dl), (.role, .db): return [.defensiveSnapShare]
            case (.efficiency, .qb): return [.passerRating, .yardsPerAttempt, .completionPct]
            case (.efficiency, .rb): return [.yardsAfterContact, .brokenTacklesPerTouch, .yardsBeforeContact]
            case (.efficiency, .wr), (.efficiency, .te): return [.yardsPerTarget, .catchRate]
            case (.efficiency, .k): return [.fieldGoalPct]
            case (.efficiency, .def): return [.pointsAllowedPerGame]
            case (.bigPlays, .rb): return [.redZoneTouchesPerGame, .expectedPointsPerGame]
            case (.bigPlays, .wr), (.bigPlays, .te): return [.airYardsShare, .redZoneTouchesPerGame, .expectedPointsPerGame]
            case (.bigPlays, .def): return [.takeawaysPerGame, .defensiveSacksPerGame]
            case (.bigPlays, .lb), (.bigPlays, .dl), (.bigPlays, .db): return [.sacksPerGame, .passesDefendedPerGame]
            case (.ballSecurity, .qb): return [.interceptionRate, .sackRate]
            case (.ballSecurity, .wr): return [.dropRate]
            default: return []
            }
        }
    }

    public struct ProfileValue: Hashable, Sendable {
        /// 0…1, the mean of the factors' percentiles (already flipped where
        /// lower is better).
        public let percentile: Double
        public let factors: [GradeFactor]
    }

    /// Where his expected points come from over the window, against what he
    /// scored. Offensive players with usage data only.
    public struct UsageMix: Hashable, Sendable {
        public let games: Int
        /// ffopportunity splits out rushing and receiving only; the rest of
        /// a quarterback's total is from throwing. Zero for everyone else.
        public let expectedPassingPerGame: Double
        public let expectedRushPerGame: Double
        public let expectedReceivingPerGame: Double
        public let pointsPerGame: Double?
        public let snapShare: Double?
        public let targetsPerGame: Double?
        public let carriesPerGame: Double?

        public var expectedPerGame: Double { expectedPassingPerGame + expectedRushPerGame + expectedReceivingPerGame }
    }

    /// Weeks the schedule card shows.
    public static let scheduleWeeks = 5

    public let players: [Player]
    public let lastN: Int
    /// Every week any of them played in the window, ascending.
    public let weeks: [Int]

    public func values(_ metric: Metric) -> [Double?] {
        players.map { $0.values[metric] }
    }

    /// The column holding the best value on a row; `nil` when fewer than two
    /// players have a value or they're all equal. The baseline is never the
    /// best — he's the bar the targets are measured against.
    public func bestIndex(_ metric: Metric) -> Int? {
        let present = values(metric).enumerated().compactMap { index, value in
            players[index].isBaseline ? nil : value.map { (index, $0) }
        }
        guard present.count >= 2, Set(present.map(\.1)).count > 1 else { return nil }
        let best = metric.higherIsBetter ? present.max { $0.1 < $1.1 } : present.min { $0.1 < $1.1 }
        return best?.0
    }

    @MainActor
    public static func build(
        cards: [PlayerCardModel],
        rows: (String) -> WaiverRow?,
        defense: DefenseLookup,
        lastN: Int,
        baselineID: String? = nil,
        signals: ((String) -> [StartSignal: Double])? = nil
    ) -> PlayerComparison {
        var weeks: Set<Int> = []
        let players = cards.prefix(LinkBus.compareLimit).enumerated().map { index, card -> Player in
            let played = card.log.filter(\.played).sorted { $0.week < $1.week }
            let window = Array(played.suffix(max(lastN, 1)))
            weeks.formUnion(window.map(\.week))
            let row = rows(card.id)
            var values: [Metric: Double] = [:]
            values[.pointsPerGame] = card.context.sleeperPointsPerGame(card.id)
            values[.expectedPointsLast4] = row?.expectedPoints
            values[.snapShare] = row?.snapShare
            values[.targetShare] = row?.targetShare
            values[.redZoneTouches] = row?.redZoneTouches
            values[.projectedThisWeek] = card.rotowireThisWeek
            values[.restOfSeason] = card.commandCenter?.restOfSeasonPerGame
            values[.gradeScore] = card.grade?.score.map(Double.init)
            values[.opponentRank] = defense.cell(defense: card.status?.opponent, position: card.position)?.rank.map(Double.init)
            let schedule = PlayerSchedule.build(playerID: card.id, context: card.context, defense: defense)
            values[.impliedTeamTotal] = card.status?.impliedTotal
            values[.strengthOfSchedule] = schedule.strengthOfSchedule
            // The depth chart counts from zero; the starter reads as 1.
            values[.depthRank] = card.status?.depthRank.map { Double($0 + 1) }
            // Hook: prefer projection bounds once CommandCenterProjection carries them.
            let points = played.compactMap(\.points)
            var player = Player(
                id: card.id, name: card.name, position: card.position, team: card.team,
                opponent: card.status?.opponent, seriesIndex: index, log: window, values: values,
                floor: points.min(), expected: card.rotowireThisWeek ?? values[.pointsPerGame], ceiling: points.max()
            )
            player.profile = card.position.map { profile(grade: card.grade, position: $0) } ?? [:]
            player.usage = usageMix(card: card, window: window)
            player.schedule = Array(schedule.weeks.prefix(scheduleWeeks))
            player.strengthOfSchedule = schedule.strengthOfSchedule
            player.status = card.status
            player.chips = card.chips
            player.isBaseline = card.id == baselineID
            player.availability = card.status?.availability ?? card.context.availability(ofSleeperID: card.id)
            values[.trendingAdds] = row?.trendingAdds.map(Double.init)
            player.byeWeek = card.status?.byeWeek
            player.headline = card.news
                .filter { $0.title?.isEmpty == false }
                .max { ($0.published ?? 0) < ($1.published ?? 0) }
                .map { Headline(title: $0.title ?? "", published: $0.publishedAt) }
            let playoffs = PlayerSchedule.build(playerID: card.id, context: card.context, defense: defense,
                                                weeks: card.context.leagueFacts.playoffWeeks)
            player.playoffSchedule = playoffs.weeks
            values[.playoffMatchups] = playoffs.strengthOfSchedule
            // This week's numbers exactly as Sit/Start values them, so the
            // grid and the start call read the same figures.
            if let signals = signals?(card.id) {
                values[.projectedThisWeek] = signals[.projected] ?? values[.projectedThisWeek]
                values[.pointsPerGame] = signals[.thisSeason] ?? values[.pointsPerGame]
                values[.commandCenterThisWeek] = signals[.commandCenter]
                values[.formLast4] = signals[.form]
                values[.floorThisWeek] = signals[.floor]
                values[.ceilingThisWeek] = signals[.ceiling]
                values[.impliedTeamTotal] = signals[.environment] ?? values[.impliedTeamTotal]
            }
            player.injuryDesignation = card.status?.report?.designation?.rawValue ?? card.status?.sleeperTag
            player.practice = card.status?.report?.practice
            player.values = values
            return player
        }
        return PlayerComparison(players: players, lastN: lastN, weeks: weeks.sorted())
    }

    /// Each dimension's percentile from the grade's own factors.
    static func profile(grade: PlayerGrade?, position: Position) -> [ProfileDimension: ProfileValue] {
        guard let grade else { return [:] }
        let byMetric = Dictionary(grade.factors.map { ($0.metric, $0) }, uniquingKeysWith: { first, _ in first })
        var out: [ProfileDimension: ProfileValue] = [:]
        for dimension in ProfileDimension.allCases {
            let factors = dimension.metrics(for: position).compactMap { byMetric[$0] }
            guard !factors.isEmpty else { continue }
            let mean = factors.map(\.percentile).reduce(0, +) / Double(factors.count)
            out[dimension] = ProfileValue(percentile: mean, factors: factors)
        }
        return out
    }

    /// Averages over the window's played weeks; `nil` without the usage file's
    /// expected points for him.
    @MainActor
    static func usageMix(card: PlayerCardModel, window: [PlayerLogWeek]) -> UsageMix? {
        guard let position = card.position, [.qb, .rb, .wr, .te].contains(position),
              let gsis = card.context.gsisIDsBySleeper[card.id],
              let usage = card.context.inSeason.usage?.weeks(for: gsis) else { return nil }
        let windowWeeks = Set(window.map(\.week))
        let weeks = usage.filter { windowWeeks.contains($0.week) && ($0.expectedRushPoints != nil || $0.expectedReceivingPoints != nil) }
        guard !weeks.isEmpty else { return nil }
        func mean(_ values: [Double]) -> Double? { values.isEmpty ? nil : values.reduce(0, +) / Double(values.count) }
        let games = Double(weeks.count)
        let passing = weeks.map { week in
            max(0, (week.expectedPoints ?? 0) - (week.expectedRushPoints ?? 0) - (week.expectedReceivingPoints ?? 0))
        }
        return UsageMix(
            games: weeks.count,
            expectedPassingPerGame: position == .qb ? passing.reduce(0, +) / games : 0,
            expectedRushPerGame: weeks.compactMap(\.expectedRushPoints).reduce(0, +) / games,
            expectedReceivingPerGame: weeks.compactMap(\.expectedReceivingPoints).reduce(0, +) / games,
            pointsPerGame: mean(window.compactMap(\.points)),
            snapShare: mean(window.compactMap(\.snapShare)),
            targetsPerGame: mean(window.map { $0.targets ?? 0 }),
            carriesPerGame: mean(window.map { $0.rushAttempts ?? 0 })
        )
    }
}
