import Foundation
import FCCore

/// The one-line call on a comparison: who to go after first, and whether he's
/// worth the move — a waiver claim under priority, a bid under FAAB. Pure,
/// and deliberately simple rules with the reasons shown, so the call can be
/// argued with.
public struct CompareVerdict: Hashable, Sendable {
    public struct Input: Hashable, Sendable {
        public var id: String
        public var name: String
        public var availability: Availability
        public var isBaseline = false
        public var restOfSeason: Double?
        public var projectedThisWeek: Double?
        public var expectedPointsLast4: Double?
        public var pointsPerGame: Double?
        public var trendingAdds: Double?
        public var playoffMatchups: Double?
        public var injuryDesignation: String?

        public init(id: String, name: String, availability: Availability, isBaseline: Bool = false,
                    restOfSeason: Double? = nil, projectedThisWeek: Double? = nil, expectedPointsLast4: Double? = nil,
                    pointsPerGame: Double? = nil, trendingAdds: Double? = nil, playoffMatchups: Double? = nil,
                    injuryDesignation: String? = nil) {
            self.id = id
            self.name = name
            self.availability = availability
            self.isBaseline = isBaseline
            self.restOfSeason = restOfSeason
            self.projectedThisWeek = projectedThisWeek
            self.expectedPointsLast4 = expectedPointsLast4
            self.pointsPerGame = pointsPerGame
            self.trendingAdds = trendingAdds
            self.playoffMatchups = playoffMatchups
            self.injuryDesignation = injuryDesignation
        }

        /// Rest of season per game, falling back to what he's scored.
        var outlook: Double? { restOfSeason ?? pointsPerGame }
    }

    public struct League: Hashable, Sendable {
        public var waivers: LeagueFacts.WaiverSystem
        public var waiverPosition: Int?
        public var teamCount: Int
        public var faabRemaining: Int?
        public var currentWeek: Int
        public var playoffStartWeek: Int

        public init(waivers: LeagueFacts.WaiverSystem, waiverPosition: Int? = nil, teamCount: Int = 0,
                    faabRemaining: Int? = nil, currentWeek: Int = 1, playoffStartWeek: Int = 15) {
            self.waivers = waivers
            self.waiverPosition = waiverPosition
            self.teamCount = teamCount
            self.faabRemaining = faabRemaining
            self.currentWeek = currentWeek
            self.playoffStartWeek = playoffStartWeek
        }

        public init(facts: LeagueFacts, currentWeek: Int) {
            self.init(waivers: facts.waivers, waiverPosition: facts.waiverPosition, teamCount: facts.teamCount,
                      faabRemaining: facts.faabRemaining, currentWeek: currentWeek,
                      playoffStartWeek: facts.playoffWeeks.first ?? 15)
        }
    }

    public struct Ranked: Hashable, Sendable, Identifiable {
        public let id: String
        public let name: String
        /// 0…1, each measure as a share of the best target's, before the
        /// injury and availability adjustments.
        public let score: Double
        public let reasons: [String]
        /// Some measures were missing and counted as middling.
        public let thinData: Bool
    }

    public enum Priority: Hashable, Sendable {
        /// Worth the claim or a real bid.
        case spend(String)
        /// Probably not worth it; wait.
        case hold(String)
        /// The top target is on a roster — a trade, not a claim.
        case notAClaim(String)
        /// Nothing in the comparison can be acquired.
        case nothing(String)

        public var text: String {
            switch self {
            case .spend(let text), .hold(let text), .notAClaim(let text), .nothing(let text): return text
            }
        }
    }

    public struct FAABBid: Hashable, Sendable {
        public let low: Int
        public let high: Int
        public let note: String
    }

    public enum Thresholds {
        /// Rest-of-season points per game over the baseline that make a claim
        /// worth it.
        public static let overBaseline = 2.0
        /// Over the next free agent in the comparison, without a baseline.
        public static let overNext = 1.5
        /// Sleeper adds in a day that mean the rest of the league wants him.
        public static let contestedAdds = 5_000.0
    }

    /// Acquirable targets, best first. The baseline and the user's own
    /// players aren't ranked.
    public let ranked: [Ranked]
    public let headline: String
    public let priority: Priority
    /// Only in FAAB leagues.
    public let faab: FAABBid?

    // MARK: - Computing

    private static let weights: [(KeyPath<Input, Double?>, Double)] = [
        (\.restOfSeason, 0.40), (\.expectedPointsLast4, 0.20), (\.projectedThisWeek, 0.15),
        (\.trendingAdds, 0.10), (\.playoffMatchups, 0.15),
    ]

    public static func compute(_ inputs: [Input], league: League) -> CompareVerdict {
        let targets = inputs.filter { !$0.isBaseline && $0.availability.isAcquirable }
        let baseline = inputs.first(where: \.isBaseline)
        guard !targets.isEmpty else {
            return CompareVerdict(ranked: [], headline: "Nobody here to go after",
                                  priority: .nothing("Everyone in the comparison is already yours."), faab: nil)
        }

        // Each measure as a share of the best target's, 0…1 — so 11.5 against
        // 12 is close, not last. Adds on a log scale so one viral name
        // doesn't flatten the rest.
        func scaled(_ path: KeyPath<Input, Double?>, _ input: Input) -> Double? {
            let transform: (Double) -> Double = path == \Input.trendingAdds ? { log1p(max($0, 0)) } : { max($0, 0) }
            guard let value = input[keyPath: path].map(transform) else { return nil }
            let best = targets.compactMap { $0[keyPath: path] }.map(transform).max() ?? 0
            return best > 0 ? min(value / best, 1) : 1
        }

        let ranked = targets.map { input -> (Ranked, Double) in
            var score = 0.0
            var missing = 0
            for (path, weight) in weights {
                if let value = scaled(path, input) { score += value * weight } else { score += 0.5 * weight; missing += 1 }
            }
            let adjusted = score * availabilityFactor(input.availability) - injuryPenalty(input.injuryDesignation)
            return (Ranked(id: input.id, name: input.name, score: score, reasons: reasons(input, among: targets, baseline: baseline),
                           thinData: missing >= 2), adjusted)
        }
        .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0.name < $1.0.name }
        .map(\.0)

        let byID = Dictionary(uniqueKeysWithValues: targets.map { ($0.id, $0) })
        let top = byID[ranked[0].id]!
        let priority = priority(top: top, ranked: ranked, byID: byID, baseline: baseline, league: league)
        return CompareVerdict(
            ranked: ranked,
            headline: headline(ranked: ranked, byID: byID),
            priority: priority,
            faab: faabBid(top: top, priority: priority, league: league)
        )
    }

    /// The adapter from a built comparison.
    public static func inputs(from comparison: PlayerComparison) -> [Input] {
        comparison.players.map { player in
            Input(
                id: player.id, name: player.name, availability: player.availability ?? .freeAgent,
                isBaseline: player.isBaseline,
                restOfSeason: player.values[.restOfSeason], projectedThisWeek: player.values[.projectedThisWeek],
                expectedPointsLast4: player.values[.expectedPointsLast4], pointsPerGame: player.values[.pointsPerGame],
                trendingAdds: player.values[.trendingAdds], playoffMatchups: player.values[.playoffMatchups],
                injuryDesignation: player.injuryDesignation
            )
        }
    }

    // MARK: - Rules

    static func availabilityFactor(_ availability: Availability) -> Double {
        switch availability {
        case .freeAgent: return 1.0
        case .rivalBench: return 0.85
        case .rivalStarter: return 0.7
        case .mine: return 0
        }
    }

    static func injuryPenalty(_ designation: String?) -> Double {
        switch designation?.lowercased() {
        case "out", "ir", "pup", "doubtful", "sus", "na": return 0.25
        case "questionable", "q": return 0.10
        default: return 0
        }
    }

    private static func headline(ranked: [Ranked], byID: [String: Input]) -> String {
        let top = ranked[0]
        let topInput = byID[top.id]!
        let first: String
        switch topInput.availability {
        case .freeAgent: first = "Best add: \(top.name)"
        case .rivalBench(_, let manager), .rivalStarter(_, let manager):
            first = "Best target: \(top.name) (trade — \(manager))"
        case .mine: first = top.name
        }
        guard ranked.count > 1 else { return first }
        return "\(first), then \(ranked[1].name)"
    }

    private static func priority(top: Input, ranked: [Ranked], byID: [String: Input], baseline: Input?, league: League) -> Priority {
        guard top.availability == .freeAgent else {
            return .notAClaim("\(top.name) is on a roster — this is a trade, not a waiver claim.")
        }
        let name = top.name
        let base: Priority
        if let baseline, let targetOutlook = top.outlook, let baseOutlook = baseline.outlook {
            let gap = targetOutlook - baseOutlook
            let amount = gap.formatted(.number.precision(.fractionLength(1)))
            if gap >= Thresholds.overBaseline {
                base = .spend("Worth your \(claimWord(league)): +\(amount) pts/gm over \(baseline.name).")
            } else if gap > 0 {
                base = .hold("Only +\(amount) pts/gm over \(baseline.name) — not worth your \(claimWord(league)).")
            } else {
                base = .hold("Not an upgrade on \(baseline.name) (\(amount) pts/gm) — keep your \(claimWord(league)).")
            }
        } else {
            let nextFreeAgent = ranked.dropFirst().compactMap { byID[$0.id] }.first { $0.availability == .freeAgent }
            let gap: Double? = {
                guard let mine = top.outlook, let next = nextFreeAgent?.outlook else { return nil }
                return mine - next
            }()
            let contested = (top.trendingAdds ?? 0) >= Thresholds.contestedAdds
            let clearlyBetter = gap.map { $0 >= Thresholds.overNext } ?? (nextFreeAgent == nil)
            if clearlyBetter && contested {
                base = .spend("Worth your \(claimWord(league)): \(name) is clearly best here and others are adding him.")
            } else if contested {
                base = .spend("Others are adding \(name) — claim now if you want him.")
            } else if clearlyBetter {
                base = .hold("\(name) is best here but few are adding him — he'll likely clear waivers.")
            } else {
                base = .hold("Close call and nobody's rushing — save your \(claimWord(league)).")
            }
        }
        // Near the back of a priority order, a claim costs little.
        if case .hold(let text) = base, isNearBack(league) {
            return .hold(text + " You're near the back of the order anyway, so a claim is cheap.")
        }
        return base
    }

    private static func claimWord(_ league: League) -> String {
        if case .faab = league.waivers { return "FAAB" }
        return "waiver priority"
    }

    private static func isNearBack(_ league: League) -> Bool {
        switch league.waivers {
        case .rolling, .reverseStandings:
            guard let position = league.waiverPosition, league.teamCount > 1 else { return false }
            return position >= league.teamCount - 1
        case .faab, .unknown:
            return false
        }
    }

    /// A share of what's left: more for a contested difference-maker, a
    /// dollar or two for a hold, scaled up as the season runs out of weeks to
    /// spend on.
    private static func faabBid(top: Input, priority: Priority, league: League) -> FAABBid? {
        guard case .faab = league.waivers, let remaining = league.faabRemaining, remaining > 0 else { return nil }
        guard top.availability == .freeAgent else { return nil }
        let contested = (top.trendingAdds ?? 0) >= Thresholds.contestedAdds
        let range: (Double, Double)
        let note: String
        switch priority {
        case .spend where contested:
            range = (0.25, 0.35); note = "Contested and a real upgrade — bid to win."
        case .spend:
            range = (0.10, 0.20); note = "A real upgrade."
        default:
            range = (0.01, 0.05); note = "A speculative bid at most."
        }
        let weeksLeft = max(league.playoffStartWeek - league.currentWeek, 1)
        // Late in the season money is worth less; up to 1.5× in the last weeks.
        let urgency = min(1.5, max(1.0, 8.0 / Double(weeksLeft)))
        func dollars(_ share: Double) -> Int {
            min(remaining, max(share > 0.01 ? 1 : 0, Int((Double(remaining) * share * urgency).rounded())))
        }
        let low = dollars(range.0), high = max(dollars(range.1), low)
        return FAABBid(low: low, high: high, note: note)
    }

    private static func reasons(_ input: Input, among targets: [Input], baseline: Input?) -> [String] {
        var out: [String] = []
        if let baseline, let mine = baseline.outlook, let theirs = input.outlook {
            let gap = theirs - mine
            out.append("\(gap >= 0 ? "+" : "")\(gap.formatted(.number.precision(.fractionLength(1)))) RoS/gm vs \(baseline.name)")
        } else if let outlook = input.outlook {
            out.append("\(outlook.formatted(.number.precision(.fractionLength(1)))) RoS/gm")
        }
        if let playoffs = input.playoffMatchups {
            if playoffs >= 1.08 { out.append("soft playoff schedule") } else if playoffs <= 0.92 { out.append("tough playoff schedule") }
        }
        if let adds = input.trendingAdds, adds >= Thresholds.contestedAdds {
            out.append("contested: \(adds.formatted(.number.notation(.compactName))) adds")
        }
        if let designation = input.injuryDesignation, injuryPenalty(designation) > 0 {
            out.append(designation)
        }
        return Array(out.prefix(3))
    }
}
