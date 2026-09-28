import Foundation
import FCCore
import FCData

/// One stat a Metric panel can show, by week.
public enum PlayerMetric: String, CaseIterable, Identifiable, Sendable {
    case fantasyPoints, snapShare, targets, targetShare, receptions, receivingYards, airYards,
         carries, rushingYards, redZoneTouches, expectedPoints, yardsAfterContact, tackles, sacks
    // Passing
    case passAttempts, passYards, passTouchdowns, interceptionsThrown, completionPct
    // Scoring and usage detail
    case rushTouchdowns, receivingTouchdowns, expectedRushPoints, expectedReceivingPoints, redZoneTargets,
         brokenTackles, drops
    // Kicking
    case fieldGoalsMade, fieldGoalAttempts, longFieldGoals
    // Team defense
    case defenseSacks, takeaways, pointsAllowed
    // IDP detail
    case soloTackles, tacklesForLoss, quarterbackHits, passesDefended

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .fantasyPoints: return "Fantasy points"
        case .snapShare: return "Snap share"
        case .targets: return "Targets"
        case .targetShare: return "Target share"
        case .receptions: return "Receptions"
        case .receivingYards: return "Receiving yards"
        case .airYards: return "Air yards"
        case .carries: return "Carries"
        case .rushingYards: return "Rushing yards"
        case .redZoneTouches: return "Red zone touches"
        case .expectedPoints: return "Expected points (xFP)"
        case .yardsAfterContact: return "Yards after contact"
        case .tackles: return "Tackles"
        case .sacks: return "Sacks"
        case .passAttempts: return "Pass attempts"
        case .passYards: return "Passing yards"
        case .passTouchdowns: return "Passing TDs"
        case .interceptionsThrown: return "Interceptions thrown"
        case .completionPct: return "Completion %"
        case .rushTouchdowns: return "Rushing TDs"
        case .receivingTouchdowns: return "Receiving TDs"
        case .expectedRushPoints: return "Expected rushing points"
        case .expectedReceivingPoints: return "Expected receiving points"
        case .redZoneTargets: return "Red zone targets"
        case .brokenTackles: return "Broken tackles"
        case .drops: return "Drops"
        case .fieldGoalsMade: return "Field goals made"
        case .fieldGoalAttempts: return "Field goal attempts"
        case .longFieldGoals: return "50+ yard field goals"
        case .defenseSacks: return "Team sacks"
        case .takeaways: return "Takeaways"
        case .pointsAllowed: return "Points allowed"
        case .soloTackles: return "Solo tackles"
        case .tacklesForLoss: return "Tackles for loss"
        case .quarterbackHits: return "QB hits"
        case .passesDefended: return "Passes defended"
        }
    }

    /// What follows the number: "pts", "tgt", "yds".
    public var unit: String {
        switch self {
        case .fantasyPoints, .expectedPoints: return "pts"
        case .snapShare, .targetShare: return ""
        case .targets: return "tgt"
        case .receptions: return "rec"
        case .receivingYards, .airYards, .rushingYards: return "yds"
        case .carries: return "car"
        case .redZoneTouches: return "RZ"
        case .yardsAfterContact: return "yds/att"
        case .tackles, .soloTackles: return "tkl"
        case .sacks, .defenseSacks: return "sk"
        case .passAttempts: return "att"
        case .passYards: return "yds"
        case .passTouchdowns, .rushTouchdowns, .receivingTouchdowns: return "TD"
        case .interceptionsThrown: return "INT"
        case .completionPct: return ""
        case .expectedRushPoints, .expectedReceivingPoints: return "xFP"
        case .redZoneTargets: return "RZ tgt"
        case .brokenTackles: return "BT"
        case .drops: return "drops"
        case .fieldGoalsMade, .longFieldGoals: return "FG"
        case .fieldGoalAttempts: return "FGA"
        case .takeaways: return "TO"
        case .pointsAllowed: return "pts"
        case .tacklesForLoss: return "TFL"
        case .quarterbackHits: return "hits"
        case .passesDefended: return "PD"
        }
    }

    public var systemImage: String {
        switch self {
        case .fantasyPoints: return "star"
        case .snapShare: return "stopwatch"
        case .targets, .targetShare: return "scope"
        case .receptions, .receivingYards, .airYards: return "hand.raised"
        case .carries, .rushingYards, .yardsAfterContact: return "figure.run"
        case .redZoneTouches: return "flag.checkered"
        case .expectedPoints: return "sparkles"
        case .tackles, .sacks, .soloTackles, .tacklesForLoss, .quarterbackHits, .passesDefended: return "shield.lefthalf.filled"
        case .passAttempts, .passYards, .completionPct: return "football"
        case .passTouchdowns, .rushTouchdowns, .receivingTouchdowns: return "flag.checkered"
        case .interceptionsThrown, .drops: return "exclamationmark.triangle"
        case .expectedRushPoints, .expectedReceivingPoints: return "sparkles"
        case .redZoneTargets: return "flag.checkered"
        case .brokenTackles: return "figure.run"
        case .fieldGoalsMade, .fieldGoalAttempts, .longFieldGoals: return "scope"
        case .defenseSacks, .takeaways, .pointsAllowed: return "shield.fill"
        }
    }

    public var isPercent: Bool { self == .snapShare || self == .targetShare || self == .completionPct }

    /// Fewer is better: turnovers, drops and points given up. Leaderboards
    /// rank these lowest first.
    public var higherIsBetter: Bool {
        switch self {
        case .interceptionsThrown, .drops, .pointsAllowed: return false
        default: return true
        }
    }

    /// Positions the metric means something for; `nil` is every position.
    public var positions: Set<Position>? {
        switch self {
        case .fantasyPoints, .snapShare: return nil
        case .targets, .targetShare, .receptions, .receivingYards, .airYards, .redZoneTouches: return [.rb, .wr, .te]
        case .carries, .rushingYards: return [.qb, .rb, .wr]
        case .expectedPoints: return [.qb, .rb, .wr, .te]
        case .yardsAfterContact: return [.rb]
        case .tackles, .sacks, .soloTackles, .tacklesForLoss, .quarterbackHits, .passesDefended: return Set(Position.idp)
        case .passAttempts, .passYards, .passTouchdowns, .interceptionsThrown, .completionPct: return [.qb]
        case .rushTouchdowns: return [.qb, .rb, .wr]
        case .receivingTouchdowns, .redZoneTargets, .drops: return [.rb, .wr, .te]
        case .expectedRushPoints: return [.qb, .rb]
        case .expectedReceivingPoints: return [.rb, .wr, .te]
        case .brokenTackles: return [.rb, .wr, .te]
        case .fieldGoalsMade, .fieldGoalAttempts, .longFieldGoals: return [.k]
        case .defenseSacks, .takeaways, .pointsAllowed: return [.def]
        }
    }

    public func applies(to position: Position?) -> Bool {
        guard let positions else { return true }
        return position.map(positions.contains) ?? false
    }

    public var source: String {
        switch self {
        case .expectedPoints, .expectedRushPoints, .expectedReceivingPoints: return "ffopportunity via nflverse"
        case .yardsAfterContact, .brokenTackles, .drops: return "PFR via nflverse"
        case .fantasyPoints: return "Sleeper's lines in your scoring"
        default: return "Sleeper's weekly lines"
        }
    }

    public func format(_ value: Double) -> String {
        if isPercent { return "\(Int((value * 100).rounded()))%" }
        switch self {
        case .receivingYards, .airYards, .rushingYards, .passYards: return "\(Int(value.rounded()))"
        default: return value.formatted(.number.precision(.fractionLength(value.magnitude < 10 ? 1 : 0)))
        }
    }

    /// Counting stats Sleeper leaves out when they're zero — a played game
    /// with no key is a real 0. Shares and model numbers stay `nil`.
    var zeroWhenAbsent: Bool {
        switch self {
        case .targets, .receptions, .receivingYards, .airYards, .carries, .rushingYards, .redZoneTouches, .tackles, .sacks,
             .passAttempts, .passYards, .passTouchdowns, .interceptionsThrown, .rushTouchdowns, .receivingTouchdowns,
             .redZoneTargets, .fieldGoalsMade, .fieldGoalAttempts, .longFieldGoals, .defenseSacks, .takeaways,
             .soloTackles, .tacklesForLoss, .quarterbackHits, .passesDefended:
            return true
        default:
            return false
        }
    }
}

/// One week of a metric.
public struct MetricPoint: Hashable, Sendable, Identifiable {
    public let week: Int
    public let value: Double
    public var id: Int { week }
}

/// The headline numbers for one player on one metric.
public struct MetricSummary: Hashable, Sendable {
    public let games: Int
    public let seasonAverage: Double
    public let lastGame: Double?
    public let lastWeek: Int?
    public let lastThreeAverage: Double?
    /// Last three over the season average; positive is trending up.
    public let trend: Double?
    /// 1 = best at his position among players with two or more games.
    public let rank: Int?
    public let rankOf: Int
    public let positionAverage: Double?
}

/// Every player's weekly metrics for one league context, with leaderboards
/// built on first use and kept.
@MainActor
public final class PlayerMetricsIndex {
    public let context: LeagueContext
    private let scoring: [String: Double]
    private let gsisBySleeper: [String: String]
    /// Targets thrown by each team in each week, from every Sleeper line.
    private let teamTargets: [Int: [String: Double]]
    private var usageCache: [String: [Int: UsageWeek]] = [:]
    private var seriesCache: [String: [MetricPoint]] = [:]
    private var leaderboards: [String: [(id: String, average: Double)]] = [:]

    public static let minimumGamesForRank = 2

    public init(context: LeagueContext) {
        self.context = context
        scoring = context.league.scoringSettings ?? [:]
        gsisBySleeper = context.gsisIDsBySleeper
        var targets: [Int: [String: Double]] = [:]
        for (week, lines) in context.inSeason.weekStats {
            var byTeam: [String: Double] = [:]
            for line in lines.values {
                guard let team = line.team, let tgt = line.targets else { continue }
                byTeam[NFLTeams.nflverse(team) ?? team, default: 0] += tgt
            }
            targets[week] = byTeam
        }
        teamTargets = targets
    }

    /// The weeks he played, oldest first, with the metric's value each week.
    public func series(_ metric: PlayerMetric, playerID: String) -> [MetricPoint] {
        let key = "\(metric.rawValue)|\(playerID)"
        if let cached = seriesCache[key] { return cached }
        var points: [MetricPoint] = []
        for week in context.inSeason.weekStats.keys.sorted() {
            guard let line = context.inSeason.weekStats[week]?[playerID], line.played else { continue }
            if let value = value(metric, line: line, week: week, playerID: playerID) {
                points.append(MetricPoint(week: week, value: value))
            }
        }
        seriesCache[key] = points
        return points
    }

    public func summary(_ metric: PlayerMetric, playerID: String) -> MetricSummary? {
        let points = series(metric, playerID: playerID)
        guard !points.isEmpty else { return nil }
        let values = points.map(\.value)
        let average = values.reduce(0, +) / Double(values.count)
        let lastThree = values.suffix(3)
        let lastThreeAverage = lastThree.isEmpty ? nil : lastThree.reduce(0, +) / Double(lastThree.count)
        let position = context.position(playerID)
        let board = position.map { leaderboard(metric, position: $0) } ?? []
        let rank = board.firstIndex { $0.id == playerID }.map { $0 + 1 }
        let positionAverage = board.isEmpty ? nil : board.map(\.average).reduce(0, +) / Double(board.count)
        return MetricSummary(
            games: points.count, seasonAverage: average, lastGame: points.last?.value, lastWeek: points.last?.week,
            lastThreeAverage: lastThreeAverage,
            trend: points.count >= 4 ? lastThreeAverage.map { $0 - average } : nil,
            rank: rank, rankOf: board.count, positionAverage: positionAverage
        )
    }

    /// Players at a position with enough games, best season average first.
    public func leaderboard(_ metric: PlayerMetric, position: Position) -> [(id: String, average: Double)] {
        let key = "\(metric.rawValue)|\(position.rawValue)"
        if let cached = leaderboards[key] { return cached }
        var ids: Set<String> = []
        for lines in context.inSeason.weekStats.values {
            for (id, line) in lines where line.played && line.position == position { ids.insert(id) }
        }
        let board = ids.compactMap { id -> (id: String, average: Double)? in
            let points = series(metric, playerID: id)
            guard points.count >= Self.minimumGamesForRank else { return nil }
            return (id, points.map(\.value).reduce(0, +) / Double(points.count))
        }
        .sorted { a, b in
            guard a.average != b.average else { return a.id < b.id }
            return metric.higherIsBetter ? a.average > b.average : a.average < b.average
        }
        leaderboards[key] = board
        return board
    }

    /// Your players the metric applies to, best season average first.
    public func rosterPlayers(_ metric: PlayerMetric, limit: Int = 6) -> [String] {
        guard let team = context.userTeam else { return [] }
        return team.roster.map(\.id)
            .filter { metric.applies(to: context.position($0)) && !team.reserveIDs.contains($0) }
            .compactMap { id in summary(metric, playerID: id).map { (id, $0.seasonAverage) } }
            .sorted { $0.1 > $1.1 }
            .prefix(limit)
            .map(\.0)
    }

    // MARK: - One week's value

    private func value(_ metric: PlayerMetric, line: SleeperWeekStat, week: Int, playerID: String) -> Double? {
        let position = line.position ?? context.position(playerID)
        guard metric.applies(to: position) else { return nil }
        let raw: Double?
        switch metric {
        case .fantasyPoints:
            raw = line.score(scoring: scoring).points
        case .snapShare:
            raw = position.map { Position.idp.contains($0) } == true ? line.defensiveSnapShare : line.offensiveSnapShare
        case .targets:
            raw = line.targets
        case .targetShare:
            guard let team = line.team,
                  let total = teamTargets[week]?[NFLTeams.nflverse(team) ?? team], total > 0 else { return nil }
            return (line.targets ?? 0) / total
        case .receptions:
            raw = line.stats["rec"]
        case .receivingYards:
            raw = line.stats["rec_yd"]
        case .airYards:
            raw = line.airYards
        case .carries:
            raw = line.stats["rush_att"]
        case .rushingYards:
            raw = line.stats["rush_yd"]
        case .redZoneTouches:
            let targets = line.redZoneTargets, carries = line.redZoneCarries
            raw = (targets == nil && carries == nil) ? nil : (targets ?? 0) + (carries ?? 0)
        case .expectedPoints:
            raw = usage(playerID)[week]?.expectedPoints
        case .yardsAfterContact:
            raw = usage(playerID)[week]?.yardsAfterContactPerAttempt
        case .tackles:
            let solo = line.stats["idp_tkl_solo"], assists = line.stats["idp_tkl_ast"]
            raw = (solo == nil && assists == nil) ? nil : (solo ?? 0) + (assists ?? 0)
        case .sacks:
            raw = line.stats["idp_sack"]
        case .passAttempts:
            raw = line.stats["pass_att"]
        case .passYards:
            raw = line.stats["pass_yd"]
        case .passTouchdowns:
            raw = line.stats["pass_td"]
        case .interceptionsThrown:
            raw = line.stats["pass_int"]
        case .completionPct:
            guard let attempts = line.stats["pass_att"], attempts > 0 else { return nil }
            return (line.stats["pass_cmp"] ?? 0) / attempts
        case .rushTouchdowns:
            raw = line.stats["rush_td"]
        case .receivingTouchdowns:
            raw = line.stats["rec_td"]
        case .expectedRushPoints:
            raw = usage(playerID)[week]?.expectedRushPoints
        case .expectedReceivingPoints:
            raw = usage(playerID)[week]?.expectedReceivingPoints
        case .redZoneTargets:
            raw = line.redZoneTargets
        case .brokenTackles:
            raw = usage(playerID)[week]?.brokenTackles
        case .drops:
            raw = usage(playerID)[week]?.drops ?? line.stats["rec_drop"]
        case .fieldGoalsMade:
            raw = line.stats["fgm"]
        case .fieldGoalAttempts:
            raw = line.stats["fga"]
        case .longFieldGoals:
            let fifties = line.stats["fgm_50_59"], sixties = line.stats["fgm_60p"]
            raw = (fifties == nil && sixties == nil) ? nil : (fifties ?? 0) + (sixties ?? 0)
        case .defenseSacks:
            raw = line.stats["sack"]
        case .takeaways:
            let picks = line.stats["int"], recoveries = line.stats["fum_rec"]
            raw = (picks == nil && recoveries == nil) ? nil : (picks ?? 0) + (recoveries ?? 0)
        case .pointsAllowed:
            raw = line.stats["pts_allow"]
        case .soloTackles:
            raw = line.stats["idp_tkl_solo"]
        case .tacklesForLoss:
            raw = line.stats["idp_tkl_loss"]
        case .quarterbackHits:
            raw = line.stats["idp_qb_hit"]
        case .passesDefended:
            raw = line.stats["idp_pass_def"]
        }
        if let raw { return raw }
        return metric.zeroWhenAbsent ? 0 : nil
    }

    private func usage(_ playerID: String) -> [Int: UsageWeek] {
        if let cached = usageCache[playerID] { return cached }
        let weeks = gsisBySleeper[playerID].flatMap { context.inSeason.usage?.weeks(for: $0) } ?? []
        let byWeek = Dictionary(weeks.map { ($0.week, $0) }, uniquingKeysWith: { first, _ in first })
        usageCache[playerID] = byWeek
        return byWeek
    }
}
