import Foundation
import FCCore
import FCData

/// One week of a player's log.
public struct PlayerLogWeek: Hashable, Sendable, Identifiable {
    public let week: Int
    public let opponent: String?
    public let played: Bool
    /// Points under the league's rules; `nil` when there is no line.
    public let points: Double?
    public let snapShare: Double?
    public let targets: Double?
    public let rushAttempts: Double?
    public let expectedPoints: Double?
    /// What Rotowire projected for him that week, in the league's scoring.
    public let projected: Double?

    public var id: Int { week }
}

/// One past week, the two projections made for it, and what happened.
public struct CalibrationWeek: Hashable, Sendable, Identifiable {
    public let week: Int
    public let actual: Double
    public let rotowire: Double?
    /// Reconstructed from data before that week, without the matchup term.
    public let commandCenter: Double?
    public var id: Int { week }
}

/// Mean absolute error of each projection over the weeks both exist.
public struct CalibrationSummary: Hashable, Sendable {
    public let weeks: Int
    public let rotowireError: Double?
    public let commandCenterError: Double?
}

/// Where the player stands on the depth chart and the injury report.
public struct PlayerStatus: Hashable, Sendable {
    public let availability: Availability
    public let byeWeek: Int?
    public let sleeperTag: String?
    public let bodyPart: String?
    public let report: PracticeReport?
    public let depthRank: Int?
    public let depthChartTeam: String?
    public let opponent: String?
    public let impliedTotal: Double?
}

/// The Player Card: everything the app knows about one player, each section
/// from a named source, and the two projections held side by side with how
/// each has done.
@MainActor
public final class PlayerCardModel: ObservableObject, Identifiable {
    public nonisolated let id: String
    @Published public private(set) var context: LeagueContext
    @Published public private(set) var status: PlayerStatus?
    @Published public private(set) var log: [PlayerLogWeek] = []
    @Published public private(set) var news: [SleeperPlayerNews] = []
    @Published public private(set) var newsUnavailable = false
    @Published public private(set) var rotowireThisWeek: Double?
    @Published public private(set) var commandCenter: CommandCenterProjection?
    @Published public private(set) var calibration: [CalibrationWeek] = []
    @Published public private(set) var calibrationSummary: CalibrationSummary?
    @Published public private(set) var grade: PlayerGrade?
    @Published public private(set) var chips: [SituationChip] = []
    @Published public private(set) var weighted: WeightedGrade?
    @Published public var weights: [String: Double] {
        didSet {
            weighted = WeightedGrade.compute(grade: grade, chips: chips, weights: weights)
            onWeightsChange(weights)
        }
    }
    @Published public var showWeighted = false

    public let name: String
    public let position: Position?
    public let team: String?

    private let sleeper: SleeperService?
    private let onWeightsChange: @MainActor ([String: Double]) -> Void
    private var projectionsByWeek: [Int: SleeperProjection] = [:]

    public init(
        playerID: String,
        context: LeagueContext,
        sleeper: SleeperService?,
        weights: [String: Double] = [:],
        onWeightsChange: @escaping @MainActor ([String: Double]) -> Void = { _ in }
    ) {
        self.id = playerID
        self.context = context
        self.sleeper = sleeper
        self.weights = weights
        self.onWeightsChange = onWeightsChange
        self.name = context.playerName(playerID) ?? playerID
        self.position = context.position(playerID)
        self.team = context.nflTeam(of: playerID)
        buildSynchronousParts()
    }

    /// The network parts: news and a season of per-player projections. Both
    /// fail soft.
    public func load() async {
        guard let sleeper else { return }
        async let newsRead = try? sleeper.playerNews(playerID: id)
        async let projectionsRead = try? sleeper.playerProjections(playerID: id, season: context.scheduleSeason)
        let fetchedNews = await newsRead
        news = fetchedNews?.value ?? []
        newsUnavailable = fetchedNews == nil
        if let projections = await projectionsRead {
            projectionsByWeek = projections.value
            buildLog()
            buildCalibration()
        }
    }

    // MARK: - Building

    private var scoring: [String: Double] { context.league.scoringSettings ?? [:] }

    private func buildSynchronousParts() {
        let player = context.players[id]
        let lines = GameLines.week(context.schedule, week: context.currentWeek)
        let gsis = context.gsisIDsBySleeper[id]
        let depthRank: Int? = {
            guard let gsis, let position else { return nil }
            return context.inSeason.depthCharts?.rank(gsisID: gsis, team: team, position: position)
        }()
        status = PlayerStatus(
            availability: context.availability(ofSleeperID: id),
            byeWeek: context.seasonWeeks.first { context.byeCalendar.isOnBye(team: team, week: $0) },
            sleeperTag: player?.hasInjuryDesignation == true ? player?.injuryStatus : nil,
            bodyPart: player?.injuryBodyPart,
            report: context.practiceReport(sleeperID: id),
            depthRank: depthRank,
            depthChartTeam: team,
            opponent: team.flatMap { lines[$0]?.opponent },
            impliedTotal: team.flatMap { lines[$0]?.impliedTotal }
        )

        rotowireThisWeek = context.projectedPoints(id)
        let defense = DefenseLookup.build(context: context)
        commandCenter = CommandCenterProjector(context: context, defense: defense).project(id)

        let grades = GradeContext.build(context: context)
        grade = grades.grade(id)
        chips = grades.chips(id)
        weighted = WeightedGrade.compute(grade: grade, chips: chips, weights: weights)

        buildLog()
        buildCalibration()
    }

    private func buildLog() {
        let gsis = context.gsisIDsBySleeper[id]
        let usage = gsis.flatMap { context.inSeason.usage?.weeks(for: $0) } ?? []
        let usageByWeek = Dictionary(usage.map { ($0.week, $0) }, uniquingKeysWith: { first, _ in first })
        // Weeks come from the dictionary keys the context fetched under, never
        // from a line's own `week` field — the key is what was actually asked
        // for and is authoritative even if a source's own field disagrees.
        let weeks = Set(context.inSeason.weekStats.keys).union(projectionsByWeek.keys.filter { $0 <= context.currentWeek })
        log = weeks.sorted(by: >).map { week in
            let line = context.inSeason.weekStats[week]?[id]
            let isIDP = position.map { Position.idp.contains($0) } ?? false
            return PlayerLogWeek(
                week: week,
                opponent: line?.opponent ?? projectionsByWeek[week]?.opponent,
                played: line?.played ?? false,
                points: line.map { $0.score(scoring: scoring).points },
                snapShare: isIDP ? line?.defensiveSnapShare : line?.offensiveSnapShare,
                targets: line?.targets,
                rushAttempts: line?.stats["rush_att"],
                expectedPoints: usageByWeek[week]?.expectedPoints,
                projected: projectionsByWeek[week].map { $0.score(scoring: scoring).points }
            )
        }
    }

    /// Each completed week he played: Rotowire's projection for it, the
    /// Command Center number rebuilt from only the weeks before it, and what
    /// he scored. The matchup term is left out of the rebuild because the
    /// defense table would otherwise see the week it is predicting.
    private func buildCalibration() {
        // Weeks the context actually asked Sleeper for and got a line back for
        // this player, keyed by the request — not by the line's own `week`
        // field, which a stubbed or malformed source could disagree with.
        let playedWeeks = context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .filter { context.inSeason.weekStats[$0]?[id]?.played == true }
            .sorted()
        let gsis = context.gsisIDsBySleeper[id]
        let usage = gsis.flatMap { context.inSeason.usage?.weeks(for: $0) } ?? []
        let lastSeason: Double? = {
            guard context.statsSeason < context.scheduleSeason, let gsis else { return nil }
            return context.seasonProfiles.first { $0.gsisID == gsis }?.pointsPerGame
        }()

        var out: [CalibrationWeek] = []
        for week in playedWeeks {
            guard let line = context.inSeason.weekStats[week]?[id] else { continue }
            let actual = line.score(scoring: scoring).points
            let beforeWeeks = playedWeeks.filter { $0 < week }
            let beforeLines = beforeWeeks.compactMap { context.inSeason.weekStats[$0]?[id] }
            let priorPPG = beforeLines.isEmpty ? nil : beforeLines.reduce(0) { $0 + $1.score(scoring: scoring).points } / Double(beforeLines.count)
            let usageBefore = usage.filter { $0.week < week }.compactMap(\.expectedPoints)
            let inputs = CommandCenterInputs(
                position: position,
                thisSeasonPointsPerGame: priorPPG,
                thisSeasonGames: beforeWeeks.count,
                lastSeasonPointsPerGame: lastSeason,
                replacementLine: position.flatMap { context.baselines[$0]?.replacementLine },
                expectedPointsRecent: usageBefore.isEmpty ? nil : usageBefore.suffix(4).reduce(0, +) / Double(usageBefore.suffix(4).count),
                expectedPointsSeason: usageBefore.isEmpty ? nil : usageBefore.reduce(0, +) / Double(usageBefore.count),
                opponentAllowedPerGame: nil,
                leagueAverageAllowed: nil
            )
            out.append(CalibrationWeek(
                week: week,
                actual: actual,
                rotowire: projectionsByWeek[week].map { $0.score(scoring: scoring).points },
                commandCenter: CommandCenterProjection.project(inputs).weekly
            ))
        }
        calibration = out.sorted { $0.week > $1.week }

        func mae(_ pairs: [(Double, Double)]) -> Double? {
            pairs.isEmpty ? nil : pairs.reduce(0) { $0 + abs($1.0 - $1.1) } / Double(pairs.count)
        }
        let rotowire = out.compactMap { week in week.rotowire.map { ($0, week.actual) } }
        let command = out.compactMap { week in week.commandCenter.map { ($0, week.actual) } }
        calibrationSummary = out.isEmpty ? nil : CalibrationSummary(
            weeks: out.count, rotowireError: mae(rotowire), commandCenterError: mae(command)
        )
    }

    public func resetWeights() {
        weights = [:]
    }

    public func weight(for key: String) -> Double {
        if let value = weights[key] { return value }
        if key == WeightedGrade.gradeKey { return WeightedGrade.defaultGradeWeight }
        return SituationMetric(rawValue: key)?.defaultWeight ?? 0
    }
}
