import Foundation

// The rest-of-season layer the QB, D/ST and K streams share: a player's
// per-game projection in a neutral game, times how generous his remaining
// opponents are to his position, and a horizon that decides how much that
// counts against this week when ranking. Ported from `streamcore.py`.

/// How far ahead a stream ranks: this week alone, the rest of the season, or
/// an even mix.
public enum StreamHorizon: String, Codable, CaseIterable, Sendable {
    case week, balanced, ros

    public var label: String {
        switch self {
        case .week: return "This week"
        case .balanced: return "Balanced"
        case .ros: return "Rest of season"
        }
    }

    public var hint: String {
        switch self {
        case .week: return "Sunday's lineup call — this week only."
        case .balanced: return "A waiver claim you'll hold a few weeks — half this week, half the rest of the season."
        case .ros: return "One roster spot for the playoff run — mostly the rest of the season."
        }
    }

    /// Weight on this week's expected points, and on the rest-of-season per-game projection.
    public var weights: (week: Double, ros: Double) {
        switch self {
        case .week: return (1.0, 0.0)
        case .balanced: return (0.5, 0.5)
        case .ros: return (0.15, 0.85)
        }
    }
}

/// A player's remaining schedule, summarised.
public struct StreamROS: Codable, Hashable, Sendable {
    public var games: Int
    /// Mean opponent generosity to his position, % vs average.
    public var avgDvp: Double
    /// Mean capped matchup multiplier over the remaining games.
    public var mult: Double
    public var perGame: Double
    public var total: Double
    /// Mean generosity in fantasy playoff weeks 15–17.
    public var playoffAvgDvp: Double
    public var playoffGames: Int
    public var byeWeek: Int?
    /// "W7 KC (-24%)" — the three toughest and three softest remaining games.
    public var hardest: [String]
    public var easiest: [String]

    public init(games: Int, avgDvp: Double, mult: Double, perGame: Double, total: Double, playoffAvgDvp: Double,
                playoffGames: Int, byeWeek: Int?, hardest: [String], easiest: [String]) {
        self.games = games; self.avgDvp = avgDvp; self.mult = mult; self.perGame = perGame; self.total = total
        self.playoffAvgDvp = playoffAvgDvp; self.playoffGames = playoffGames; self.byeWeek = byeWeek
        self.hardest = hardest; self.easiest = easiest
    }
}

public enum StreamRestOfSeason {
    public static let playoffWeeks: Set<Int> = [15, 16, 17]
    public static let lastWeek = 18

    /// Opponent generosity → multiplier, shrunk by games played and capped.
    public static func dvpMult(_ dvpPct: Double, games: Int, fullWeightGames: Double = 6, cap: Double = 0.15) -> Double {
        guard games > 0 else { return 1 }
        let w = Double(games) / (Double(games) + fullWeightGames)
        return 1 + StreamMath.clamp(w * dvpPct / 100, -cap, cap)
    }

    /// - Parameters:
    ///   - schedule: this team's opponent by week; a missing week is the bye.
    ///   - oppDvp: each opponent's generosity to the position, % vs average.
    ///   - neutralMean: the player's per-game projection in a neutral game.
    ///   - venueAdj: an optional per-week multiplier (a kicker's dome or cold).
    public static func summary(currentWeek: Int, schedule: [Int: String], oppDvp: [String: Double], dvpGames: Int,
                               neutralMean: Double, venueAdj: [Int: Double] = [:],
                               fullWeightGames: Double = 6, cap: Double = 0.15) -> StreamROS {
        let remaining = schedule.filter { currentWeek < $0.key && $0.key <= lastWeek }.sorted { $0.key < $1.key }
        let scheduled = Set(schedule.keys).union([currentWeek])
        let bye = currentWeek < lastWeek ? ((currentWeek + 1)...lastWeek).first { !scheduled.contains($0) } : nil
        guard !remaining.isEmpty else {
            return StreamROS(games: 0, avgDvp: 0, mult: 1, perGame: neutralMean, total: 0, playoffAvgDvp: 0,
                             playoffGames: 0, byeWeek: bye, hardest: [], easiest: [])
        }
        var mults: [Double] = [], dvps: [Double] = [], playoff: [Double] = []
        for (week, opponent) in remaining {
            let d = oppDvp[opponent] ?? 0
            mults.append(dvpMult(d, games: dvpGames, fullWeightGames: fullWeightGames, cap: cap) * (venueAdj[week] ?? 1))
            dvps.append(d)
            if playoffWeeks.contains(week) { playoff.append(d) }
        }
        let mult = mults.reduce(0, +) / Double(mults.count)
        // Stable by generosity, ties in week order — as the reference sorts.
        let ranked = remaining.enumerated()
            .sorted { a, b in
                let da = oppDvp[a.element.value] ?? 0, db = oppDvp[b.element.value] ?? 0
                return da != db ? da < db : a.offset < b.offset
            }
            .map(\.element)
        func label(_ game: (key: Int, value: String)) -> String {
            "W\(game.key) \(game.value) (\(String(format: "%+.0f", oppDvp[game.value] ?? 0))%)"
        }
        return StreamROS(
            games: remaining.count,
            avgDvp: dvps.reduce(0, +) / Double(dvps.count),
            mult: mult,
            perGame: neutralMean * mult,
            total: neutralMean * mults.reduce(0, +),
            playoffAvgDvp: playoff.isEmpty ? 0 : playoff.reduce(0, +) / Double(playoff.count),
            playoffGames: playoff.count,
            byeWeek: bye,
            hardest: ranked.prefix(3).map(label),
            easiest: ranked.suffix(3).reversed().map(label)
        )
    }

    /// Ranking value: this week and the rest-of-season per-game projection,
    /// weighted by the horizon, plus the risk mode's pull on the spread.
    public static func blendedUtility(expPts: Double, sd: Double, rosPerGame: Double, pPlay: Double,
                                      risk: StreamRiskMode, horizon: StreamHorizon) -> Double {
        let (ww, wr) = horizon.weights
        return ww * expPts + wr * rosPerGame * pPlay + riskWeight(risk) * sd * (ww + 0.5 * wr)
    }

    public static func riskWeight(_ risk: StreamRiskMode) -> Double {
        switch risk {
        case .floor: return -0.5
        case .neutral: return -0.2
        case .ceiling: return 0.25
        }
    }
}

/// What the QB, D/ST and K projections add to the shared contract.
public protocol StreamROSProjection: StreamProjection {
    var ros: StreamROS { get }
    /// Per-game projection in a neutral matchup.
    var neutralMean: Double { get }
}

/// Decodes a `{"1": "HOU", ...}` schedule into week → value.
extension Dictionary where Key == String {
    func intKeyed() -> [Int: Value] {
        var out: [Int: Value] = [:]
        for (k, v) in self { if let week = Int(k) { out[week] = v } }
        return out
    }
}
