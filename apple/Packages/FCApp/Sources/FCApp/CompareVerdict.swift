import Foundation
import FCCore

/// The one-line call on a comparison: keep your player or go after someone,
/// and whether the move is worth it — a waiver claim under priority, a bid
/// under FAAB. Your own players are ranked with everyone else. Pure,
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
        public let availability: Availability
        /// The user's player everyone else is measured against.
        public let isBaseline: Bool
        /// 0…1, each measure as a share of the best player's, before the
        /// injury and availability adjustments.
        public let score: Double
        /// After them — what the order is sorted on.
        public let adjustedScore: Double
        public let reasons: [String]
        /// Some measures were missing and counted as middling.
        public let thinData: Bool

        public var isMine: Bool { availability == .mine }
    }

    public enum Priority: Hashable, Sendable {
        /// Worth the claim or a real bid.
        case spend(String)
        /// Probably not worth it; wait.
        case hold(String)
        /// Your own player is the better hold — don't make the move.
        case keep(String)
        /// The top target is on a roster — a trade, not a claim.
        case notAClaim(String)
        /// Nothing in the comparison can be acquired.
        case nothing(String)

        public var text: String {
            switch self {
            case .spend(let text), .hold(let text), .keep(let text), .notAClaim(let text), .nothing(let text): return text
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

    /// Everyone compared, best first — the user's own players included, so a
    /// keeper can beat a pickup.
    public let ranked: [Ranked]
    public let headline: String
    public let priority: Priority
    /// Only in FAAB leagues.
    public let faab: FAABBid?
    /// The player the call lands on, and the one it passes over — what the
    /// gut check argues about. `nil` with fewer than two players.
    public let pickID: String?
    public let alternativeID: String?
    /// How far apart the two are on adjusted score, 0…1. Small is a close call.
    public let margin: Double?

    // MARK: - Computing

    private static let weights: [(KeyPath<Input, Double?>, Double)] = [
        (\.restOfSeason, 0.40), (\.expectedPointsLast4, 0.20), (\.projectedThisWeek, 0.15),
        (\.trendingAdds, 0.10), (\.playoffMatchups, 0.15),
    ]

    public static func compute(_ inputs: [Input], league: League) -> CompareVerdict {
        guard !inputs.isEmpty else {
            return CompareVerdict(ranked: [], headline: "Nobody to compare", priority: .nothing("Add players to compare."),
                                  faab: nil, pickID: nil, alternativeID: nil, margin: nil)
        }

        // Each measure as a share of the best player's, 0…1 — so 11.5 against
        // 12 is close, not last. Adds on a log scale so one viral name
        // doesn't flatten the rest.
        func scaled(_ path: KeyPath<Input, Double?>, _ input: Input) -> Double? {
            let transform: (Double) -> Double = path == \Input.trendingAdds ? { log1p(max($0, 0)) } : { max($0, 0) }
            guard let value = input[keyPath: path].map(transform) else { return nil }
            let best = inputs.compactMap { $0[keyPath: path] }.map(transform).max() ?? 0
            return best > 0 ? min(value / best, 1) : 1
        }

        let scored = inputs.map { input -> (input: Input, score: Double, adjusted: Double, thin: Bool) in
            var score = 0.0
            var missing = 0
            for (path, weight) in weights {
                if let value = scaled(path, input) { score += value * weight } else { score += 0.5 * weight; missing += 1 }
            }
            let adjusted = score * availabilityFactor(input.availability) - injuryPenalty(input.injuryDesignation)
            return (input, score, adjusted, missing >= 2)
        }
        .sorted { $0.adjusted != $1.adjusted ? $0.adjusted > $1.adjusted : $0.input.name < $1.input.name }

        // The yardstick: the one the user named, else his weakest player
        // here — the one a claim would drop.
        let baseline = inputs.first(where: \.isBaseline) ?? scored.last(where: { $0.input.availability == .mine })?.input
        let ranked = scored.map {
            Ranked(id: $0.input.id, name: $0.input.name, availability: $0.input.availability,
                   isBaseline: $0.input.id == baseline?.id, score: $0.score, adjustedScore: $0.adjusted,
                   reasons: reasons($0.input, baseline: baseline), thinData: $0.thin)
        }
        let byID = Dictionary(uniqueKeysWithValues: inputs.map { ($0.id, $0) })
        let rankOf = Dictionary(uniqueKeysWithValues: ranked.enumerated().map { ($1.id, $0) })

        guard let topTarget = ranked.first(where: { $0.availability.isAcquirable }).flatMap({ byID[$0.id] }) else {
            let headline = ranked.count == 1 ? "\(ranked[0].name) is yours" : "\(ranked[0].name) ranks highest of yours"
            return CompareVerdict(ranked: ranked, headline: headline,
                                  priority: .nothing("Everyone in the comparison is already yours."), faab: nil,
                                  pickID: ranked[0].id, alternativeID: ranked.count > 1 ? ranked[1].id : nil,
                                  margin: margin(ranked, ranked[0].id, ranked.count > 1 ? ranked[1].id : nil))
        }

        let call: Call
        if let baseline {
            call = callAgainst(baseline: baseline, target: topTarget,
                               targetAhead: rankOf[topTarget.id]! < rankOf[baseline.id]!, league: league)
        } else {
            let targets = ranked.filter { $0.availability.isAcquirable }
            call = Call(headline: headline(targets: targets, byID: byID),
                        priority: priority(top: topTarget, targets: targets, byID: byID, league: league),
                        pickID: topTarget.id, alternativeID: targets.count > 1 ? targets[1].id : nil)
        }
        var priority = call.priority
        // Near the back of a priority order, a claim costs little.
        if case .hold(let text) = priority, isNearBack(league) {
            priority = .hold(text + " You're near the back of the order anyway, so a claim is cheap.")
        }
        return CompareVerdict(
            ranked: ranked, headline: call.headline, priority: priority,
            faab: faabBid(top: topTarget, priority: priority, league: league),
            pickID: call.pickID, alternativeID: call.alternativeID,
            margin: margin(ranked, call.pickID, call.alternativeID)
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

    /// Keeping costs nothing and a claim costs a claim; that cost lives in the
    /// threshold a move has to clear, not here. A trade is discounted for how
    /// hard the ask is.
    static func availabilityFactor(_ availability: Availability) -> Double {
        switch availability {
        case .freeAgent, .mine: return 1.0
        case .rivalBench: return 0.85
        case .rivalStarter: return 0.7
        }
    }

    static func injuryPenalty(_ designation: String?) -> Double {
        switch designation?.lowercased() {
        case "out", "ir", "pup", "doubtful", "sus", "na": return 0.25
        case "questionable", "q": return 0.10
        default: return 0
        }
    }

    private struct Call {
        let headline: String
        let priority: Priority
        let pickID: String
        let alternativeID: String?
    }

    private static func margin(_ ranked: [Ranked], _ pick: String?, _ alternative: String?) -> Double? {
        guard let pick = ranked.first(where: { $0.id == pick }),
              let alternative = ranked.first(where: { $0.id == alternative }) else { return nil }
        return abs(pick.adjustedScore - alternative.adjustedScore)
    }

    /// One of the user's players against the best thing he could get: keep,
    /// or make the move — and a move has to clear the bar, not just edge it.
    private static func callAgainst(baseline: Input, target: Input, targetAhead: Bool, league: League) -> Call {
        let gap: Double? = target.outlook.flatMap { theirs in baseline.outlook.map { theirs - $0 } }
        let amount = gap.map { abs($0).formatted(.number.precision(.fractionLength(1))) }
        let keepHeadline = "Keep \(baseline.name) over \(target.name)"
        func keep(_ text: String) -> Call {
            Call(headline: keepHeadline, priority: .keep(text), pickID: baseline.id, alternativeID: target.id)
        }
        guard targetAhead else {
            guard let gap, let amount else { return keep("Keep \(baseline.name) — he rates ahead of \(target.name) on what's here.") }
            return gap > 0
                ? keep("Keep \(baseline.name) — \(target.name)'s +\(amount) pts/gm outlook doesn't outweigh the rest of his numbers.")
                : keep("Keep \(baseline.name) — \(target.name) projects \(amount) pts/gm less the rest of the way.")
        }
        switch target.availability {
        case .rivalBench(_, let manager), .rivalStarter(_, let manager):
            return Call(headline: "Best target: \(target.name) (trade — \(manager)), over \(baseline.name)",
                        priority: .notAClaim("\(target.name) is on a roster — this is a trade, not a waiver claim."),
                        pickID: target.id, alternativeID: baseline.id)
        case .freeAgent, .mine:
            break
        }
        let move = "Add \(target.name), drop \(baseline.name)"
        guard let gap, let amount else {
            return Call(headline: "Lean \(target.name) over \(baseline.name)",
                        priority: .hold("\(target.name) rates ahead, but there's no rest-of-season number to size the gap — a cheap claim at most."),
                        pickID: target.id, alternativeID: baseline.id)
        }
        if gap >= Thresholds.overBaseline {
            return Call(headline: move,
                        priority: .spend("Worth your \(claimWord(league)): +\(amount) pts/gm over \(baseline.name)."),
                        pickID: target.id, alternativeID: baseline.id)
        }
        return keep(gap > 0
            ? "Keep \(baseline.name) — \(target.name) is only +\(amount) pts/gm better, not worth your \(claimWord(league))."
            : "Keep \(baseline.name) — \(target.name) projects \(amount) pts/gm less the rest of the way.")
    }

    private static func headline(targets: [Ranked], byID: [String: Input]) -> String {
        let top = targets[0]
        let first: String
        switch byID[top.id]!.availability {
        case .freeAgent: first = "Best add: \(top.name)"
        case .rivalBench(_, let manager), .rivalStarter(_, let manager):
            first = "Best target: \(top.name) (trade — \(manager))"
        case .mine: first = top.name
        }
        guard targets.count > 1 else { return first }
        return "\(first), then \(targets[1].name)"
    }

    /// No player of the user's in the comparison: demand and the gap to the
    /// next free agent decide.
    private static func priority(top: Input, targets: [Ranked], byID: [String: Input], league: League) -> Priority {
        guard top.availability == .freeAgent else {
            return .notAClaim("\(top.name) is on a roster — this is a trade, not a waiver claim.")
        }
        let name = top.name
        let nextFreeAgent = targets.dropFirst().compactMap { byID[$0.id] }.first { $0.availability == .freeAgent }
        let gap: Double? = {
            guard let mine = top.outlook, let next = nextFreeAgent?.outlook else { return nil }
            return mine - next
        }()
        let contested = (top.trendingAdds ?? 0) >= Thresholds.contestedAdds
        let clearlyBetter = gap.map { $0 >= Thresholds.overNext } ?? (nextFreeAgent == nil)
        if clearlyBetter && contested {
            return .spend("Worth your \(claimWord(league)): \(name) is clearly best here and others are adding him.")
        } else if contested {
            return .spend("Others are adding \(name) — claim now if you want him.")
        } else if clearlyBetter {
            return .hold("\(name) is best here but few are adding him — he'll likely clear waivers.")
        } else {
            return .hold("Close call and nobody's rushing — save your \(claimWord(league)).")
        }
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
        if case .keep = priority { return nil }
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

    private static func reasons(_ input: Input, baseline: Input?) -> [String] {
        var out: [String] = []
        if let baseline, baseline.id != input.id, let mine = baseline.outlook, let theirs = input.outlook {
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
