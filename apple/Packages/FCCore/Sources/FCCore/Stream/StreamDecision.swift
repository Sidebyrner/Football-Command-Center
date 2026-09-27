import Foundation

// The decision layer every weekly stream model shares — IDP, WR, and whatever
// comes next. Each model projects its own players in its own way; from the
// projection on, "does he beat my starter, by how much, how sure, what to bid"
// is the same question and is answered here, once.

// MARK: - Status and risk

/// Practice / game status, ordered roughly by how likely he is to play.
public enum StreamPractice: String, Codable, CaseIterable, Sendable {
    case none, FP, LP, DNP, Q, D, OUT, IR

    /// P(plays) for each status.
    public var playProbability: Double {
        switch self {
        case .none: return 0.97
        case .FP: return 0.93
        case .LP: return 0.80
        case .DNP: return 0.55
        case .Q: return 0.70
        case .D: return 0.20
        case .OUT, .IR: return 0
        }
    }

    public var label: String {
        switch self {
        case .none: return "No report"
        case .FP: return "Full"
        case .LP: return "Limited"
        case .DNP: return "DNP"
        case .Q: return "Questionable"
        case .D: return "Doubtful"
        case .OUT: return "Out"
        case .IR: return "IR"
        }
    }
}

/// How much to reward variance. Favored this week → floor; the underdog →
/// ceiling. Each model sets its own SD weights.
public enum StreamRiskMode: String, Codable, CaseIterable, Sendable {
    case floor, neutral, ceiling

    public var label: String {
        switch self {
        case .floor: return "Floor (favored)"
        case .neutral: return "Neutral"
        case .ceiling: return "Ceiling (underdog)"
        }
    }
}

/// A FAAB bid band as a share of budget, from the expected gain over the incumbent.
public struct StreamBidBand: Codable, Sendable, Hashable {
    public let lower: Double
    public let upper: Double
    public let label: String

    public var isSpend: Bool { upper > 0.01 }

    public static func forGain(_ gain: Double) -> StreamBidBand {
        if gain < 1.5 { return StreamBidBand(lower: 0, upper: 0.01, label: "0–1% (don't spend)") }
        if gain < 3.5 { return StreamBidBand(lower: 0.02, upper: 0.05, label: "2–5%") }
        if gain < 6.0 { return StreamBidBand(lower: 0.06, upper: 0.10, label: "6–10%") }
        return StreamBidBand(lower: 0.11, upper: 0.18, label: "11–18%")
    }

    /// Whole-dollar range against a remaining budget, e.g. "$6–10".
    public func dollars(remaining: Int) -> String {
        let lo = Int((Double(remaining) * lower).rounded(.down))
        let hi = Int((Double(remaining) * upper).rounded(.up))
        return lo == hi ? "$\(lo)" : "$\(lo)–\(hi)"
    }
}

/// Expected count and points for one scoring stat.
public struct StreamStatPoints: Hashable, Sendable {
    public let stat: String
    public let count: Double
    public let points: Double

    public init(stat: String, count: Double, points: Double) {
        self.stat = stat
        self.count = count
        self.points = points
    }
}

// MARK: - Projection contract

/// What every stream model's projection exposes to the decision layer and the
/// shared views.
public protocol StreamProjection: Codable, Hashable, Identifiable, Sendable where ID == String {
    var name: String { get }
    var team: String { get }
    var opponent: String { get }
    var playerID: String? { get }
    /// Slot position (LB/DL/DB, WR) — for chips, filters and colours.
    var platform: Position { get }
    /// The model's finer role: "Box S", "EDGE", "DEEP".
    var roleLabel: String { get }
    var pPlay: Double { get }
    var meanIfPlays: Double { get }
    var sdIfPlays: Double { get }
    var expPts: Double { get }
    var floorP25: Double { get }
    var ceilingP75: Double { get }
    var utility: Double { get }
    var roleConf: Double { get }
    var practice: StreamPractice { get }
    var available: Bool? { get }
    var flags: [String] { get }
    var notes: String { get }
    var sources: [String] { get }
    var explain: [String] { get }
    var pBeatIncumbent: Double? { get set }
    var expGain: Double? { get set }
    var bidBand: StreamBidBand? { get set }
}

// MARK: - Decision layer

public enum StreamDecision {
    static func normalCDF(_ z: Double) -> Double { 0.5 * (1 + erf(z / 2.0.squareRoot())) }

    /// P(a outscores b), mixing over each player's play / no-play probability.
    public static func pBeat<A: StreamProjection, B: StreamProjection>(_ a: A, _ b: B) -> Double {
        let da = [(a.pPlay, a.meanIfPlays, a.sdIfPlays), (1 - a.pPlay, 0.0, 0.01)]
        let db = [(b.pPlay, b.meanIfPlays, b.sdIfPlays), (1 - b.pPlay, 0.0, 0.01)]
        var total = 0.0
        for (wa, ma, sa) in da {
            for (wb, mb, sb) in db {
                let spread = (sa * sa + sb * sb).squareRoot()
                // Two certain outcomes (no scoring, so no variance): compare directly
                // rather than divide by zero.
                let win = spread > 0 ? normalCDF((ma - mb) / spread) : (ma > mb ? 1 : ma < mb ? 0 : 0.5)
                total += wa * wb * win
            }
        }
        return total
    }

    /// Adds the incumbent comparison and sorts by utility, best first.
    public static func rank<P: StreamProjection>(_ projections: [P], incumbent: P?) -> [P] {
        var out = projections
        if let incumbent {
            for i in out.indices where out[i].id != incumbent.id {
                let gain = out[i].expPts - incumbent.expPts
                out[i].pBeatIncumbent = pBeat(out[i], incumbent)
                out[i].expGain = gain
                out[i].bidBand = .forGain(gain)
            }
        }
        // Stable on ties so the order is reproducible.
        return out.enumerated()
            .sorted { $0.element.utility != $1.element.utility ? $0.element.utility > $1.element.utility : $0.offset < $1.offset }
            .map(\.element)
    }

    /// Compares with the incumbent and ranks projections already made.
    public static func report<P: StreamProjection>(projections: [P], incumbentID: String?,
                                                   onlyAvailable: Bool = false) -> StreamReport<P> {
        let incumbent = incumbentID.flatMap { id in projections.first { $0.id == id } }
        var ranked = rank(projections, incumbent: incumbent)
        if onlyAvailable {
            ranked = ranked.filter { $0.available != false || $0.id == incumbent?.id }
        }
        let incumbentRow = incumbent.flatMap { inc in ranked.first { $0.id == inc.id } } ?? incumbent
        return StreamReport(ranked: ranked.filter { $0.id != incumbentRow?.id }, incumbent: incumbentRow)
    }
}

public struct StreamReport<P: StreamProjection>: Codable, Sendable, Hashable {
    /// Every projected player except the incumbent, best utility first.
    public let ranked: [P]
    public let incumbent: P?

    public init(ranked: [P], incumbent: P?) {
        self.ranked = ranked
        self.incumbent = incumbent
    }

    public func ranked(at position: Position?) -> [P] {
        guard let position else { return ranked }
        return ranked.filter { $0.platform == position }
    }

    /// Any player in the report, the incumbent included.
    public func projection(for id: String) -> P? {
        incumbent?.id == id ? incumbent : ranked.first { $0.id == id }
    }
}

// MARK: - Comparison

/// Two to four players side by side, with every pairwise P(row beats column).
public struct StreamComparison<P: StreamProjection>: Hashable, Sendable {
    public let players: [P]
    /// `headToHead[i][j]` is P(players[i] outscores players[j]); `nil` on the diagonal.
    public let headToHead: [[Double?]]

    public init(players: [P]) {
        self.players = players
        headToHead = players.indices.map { i in
            players.indices.map { j in i == j ? nil : StreamDecision.pBeat(players[i], players[j]) }
        }
    }

    /// Who to start among the compared players, and how sure. `nil` with
    /// fewer than two.
    public var verdict: StreamVerdict? {
        guard players.count > 1 else { return nil }
        // The leader is the one with the best worst head-to-head, so a single
        // high-variance projection cannot win on mean alone; ties go to E[pts].
        let leader = players.indices.max { a, b in
            let wa = worstHeadToHead(a), wb = worstHeadToHead(b)
            return wa != wb ? wa < wb : players[a].expPts < players[b].expPts
        }!
        let others = players.indices.filter { $0 != leader }
        let odds = others.map { StreamVerdict.Odds(index: $0, pBeats: headToHead[leader][$0] ?? 0.5) }
        let runnerUp = others.max { players[$0].expPts < players[$1].expPts }!
        return StreamVerdict(
            leader: leader,
            odds: odds,
            margin: players[leader].expPts - players[runnerUp].expPts,
            runnerUp: runnerUp
        )
    }

    private func worstHeadToHead(_ i: Int) -> Double {
        headToHead[i].compactMap { $0 }.min() ?? 0.5
    }
}

public struct StreamVerdict: Hashable, Sendable {
    public struct Odds: Hashable, Sendable {
        public let index: Int
        public let pBeats: Double
    }

    /// Index into `StreamComparison.players`.
    public let leader: Int
    /// The leader's chance of outscoring each other player, in player order.
    public let odds: [Odds]
    /// Expected points over the next-best projection (can be negative when the
    /// safer player is picked over a higher mean).
    public let margin: Double
    public let runnerUp: Int

    /// How firm the call is, from the leader's closest head-to-head.
    public var confidence: Confidence {
        let closest = odds.map(\.pBeats).min() ?? 0.5
        if closest >= 0.65 { return .clear }
        if closest >= 0.55 { return .lean }
        return .tossUp
    }

    public enum Confidence: String, Hashable, Sendable {
        case clear, lean, tossUp
    }
}

// MARK: - Shared math

/// Empirical-Bayes shrinkage and clamps, identical in every stream model.
public enum StreamMath {
    /// Weight n/(n+k) on the observed rate, the rest on the prior.
    public static func shrink(_ observed: Double?, _ n: Double, _ prior: Double, _ k: Double) -> Double {
        guard let observed, n > 0 else { return prior }
        let w = n / (n + k)
        return w * observed + (1 - w) * prior
    }

    public static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { max(lo, min(hi, x)) }

    /// The 25th/75th percentile offset of a normal, in SDs.
    public static let quartileZ = 0.6745
}
