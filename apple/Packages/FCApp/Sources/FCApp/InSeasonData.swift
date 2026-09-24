import Foundation
import FCCore
import FCData

/// League rules that time or price a move, read live from Sleeper every load
/// (§1). Nothing here is assumed; every field says when it is unknown.
public struct LeagueFacts: Hashable, Sendable {
    public enum WaiverSystem: Hashable, Sendable {
        case rolling
        case reverseStandings
        case faab(budget: Int)
        case unknown

        public var label: String {
            switch self {
            case .rolling: return "Rolling waivers"
            case .reverseStandings: return "Reverse-standings waivers"
            case .faab(let budget): return "FAAB, $\(budget) budget"
            case .unknown: return "Waiver system not reported"
            }
        }
    }

    public let waivers: WaiverSystem
    /// The user's place in the waiver order, one-based.
    public let waiverPosition: Int?
    /// FAAB spent so far by the user; meaningful only under `.faab`.
    public let faabUsed: Int?
    /// 0 = Sunday … 6 = Saturday.
    public let waiverDayOfWeek: Int?
    public let tradeDeadlineWeek: Int?
    public let playoffStartWeek: Int?
    public let playoffTeams: Int?
    public let irSlots: Int
    public let teamCount: Int

    public init(
        waivers: WaiverSystem, waiverPosition: Int?, faabUsed: Int?, waiverDayOfWeek: Int?,
        tradeDeadlineWeek: Int?, playoffStartWeek: Int?, playoffTeams: Int?, irSlots: Int, teamCount: Int
    ) {
        self.waivers = waivers
        self.waiverPosition = waiverPosition
        self.faabUsed = faabUsed
        self.waiverDayOfWeek = waiverDayOfWeek
        self.tradeDeadlineWeek = tradeDeadlineWeek
        self.playoffStartWeek = playoffStartWeek
        self.playoffTeams = playoffTeams
        self.irSlots = irSlots
        self.teamCount = teamCount
    }

    /// FAAB left, or `nil` when the league does not use FAAB.
    public var faabRemaining: Int? {
        guard case .faab(let budget) = waivers else { return nil }
        return budget - (faabUsed ?? 0)
    }

    /// Weeks 15–17 by default; the league's own playoff window when it says.
    public var playoffWeeks: [Int] {
        let start = playoffStartWeek ?? 15
        return Array(start...max(start, 17))
    }

    public static func from(league: SleeperLeague, userRoster: SleeperRoster.Settings?) -> LeagueFacts {
        let settings = league.settings
        let waivers: WaiverSystem
        switch settings?.waiverType {
        case 0: waivers = .rolling
        case 1: waivers = .reverseStandings
        case 2: waivers = .faab(budget: settings?.waiverBudget ?? 100)
        default: waivers = .unknown
        }
        return LeagueFacts(
            waivers: waivers,
            waiverPosition: userRoster?.waiverPosition,
            faabUsed: userRoster?.waiverBudgetUsed,
            waiverDayOfWeek: settings?.waiverDayOfWeek,
            tradeDeadlineWeek: settings?.effectiveTradeDeadline,
            playoffStartWeek: settings?.playoffWeekStart,
            playoffTeams: settings?.playoffTeams,
            irSlots: settings?.reserveSlots ?? 0,
            teamCount: league.totalRosters ?? 0
        )
    }

    /// Placeholder for a context built without a league — tests and previews.
    public static let unknown = LeagueFacts(
        waivers: .unknown, waiverPosition: nil, faabUsed: nil, waiverDayOfWeek: nil,
        tradeDeadlineWeek: nil, playoffStartWeek: nil, playoffTeams: nil, irSlots: 0, teamCount: 0
    )
}

/// What each starting position can be valued from.
public enum PositionCoverage: Hashable, Sendable {
    /// The nflverse weekly file: full-population distributions, usage shares.
    case nflverseWeekly
    /// Sleeper's own weekly stat lines: the only production data for DEF and IDP.
    case sleeperStats
    /// Neither — trending adds and the schedule are all there is.
    case none

    public var label: String {
        switch self {
        case .nflverseWeekly: return "nflverse weekly stats"
        case .sleeperStats: return "Sleeper weekly stats"
        case .none: return "no production data"
        }
    }
}

/// Everything forward-looking or current-season that the produced bases do not
/// carry, assembled once per context. Every member is optional and labelled
/// because each comes from a source that may be unreachable, and a screen must
/// render without any of them (§0).
public struct InSeasonData: Sendable {
    /// Rotowire's projected stat lines for the current week, by Sleeper id.
    public let projections: [String: SleeperProjection]
    /// Actual Sleeper stat lines for every week of the schedule season so far,
    /// by week then Sleeper id. Covers DEF and IDP.
    public let weekStats: [Int: [String: SleeperWeekStat]]
    /// The official injury report for the current week, by gsis id.
    public let practiceReports: [String: PracticeReport]
    public let depthCharts: DepthChartFile?
    public let usage: UsageFile?
    public let teamContext: TeamContextFile?
    /// The weakest provenance among the Sleeper insight reads that succeeded.
    public let sleeperProvenance: Provenance?
    /// The weakest provenance among the in-season static files that loaded.
    public let filesProvenance: Provenance?
    /// Sources that were asked for and could not be read, in words.
    public let unavailable: [String]
    /// What every projected number is labelled with.
    public let projectionSourceLabel: String?

    public static let empty = InSeasonData(
        projections: [:], weekStats: [:], practiceReports: [:], depthCharts: nil, usage: nil,
        teamContext: nil, sleeperProvenance: nil, filesProvenance: nil, unavailable: [],
        projectionSourceLabel: nil
    )

    public init(
        projections: [String: SleeperProjection],
        weekStats: [Int: [String: SleeperWeekStat]],
        practiceReports: [String: PracticeReport],
        depthCharts: DepthChartFile?,
        usage: UsageFile?,
        teamContext: TeamContextFile?,
        sleeperProvenance: Provenance?,
        filesProvenance: Provenance?,
        unavailable: [String],
        projectionSourceLabel: String?
    ) {
        self.projections = projections
        self.weekStats = weekStats
        self.practiceReports = practiceReports
        self.depthCharts = depthCharts
        self.usage = usage
        self.teamContext = teamContext
        self.sleeperProvenance = sleeperProvenance
        self.filesProvenance = filesProvenance
        self.unavailable = unavailable
        self.projectionSourceLabel = projectionSourceLabel
    }

    public var hasProjections: Bool { !projections.isEmpty }

    /// Weeks with Sleeper stat lines, ascending.
    public var statWeeks: [Int] { weekStats.keys.sorted() }

    /// A player's Sleeper stat lines so far this season, ascending by week.
    public func statLines(sleeperID: String) -> [SleeperWeekStat] {
        statWeeks.compactMap { weekStats[$0]?[sleeperID] }
    }

    /// A player's points per game this season under the league's rules, from
    /// Sleeper's lines — the only production number DEF and IDP have.
    /// `nil` when he has no line, never zero.
    public func sleeperPointsPerGame(sleeperID: String, scoring: [String: Double]) -> Double? {
        let played = statLines(sleeperID: sleeperID).filter(\.played)
        guard !played.isEmpty else { return nil }
        let total = played.reduce(0) { $0 + $1.score(scoring: scoring).points }
        return total / Double(played.count)
    }

    /// Projected points this week under the league's rules, `nil` when there is
    /// no projection for the player.
    public func projectedPoints(sleeperID: String, scoring: [String: Double]) -> Double? {
        projections[sleeperID].map { $0.score(scoring: scoring).points }
    }
}
