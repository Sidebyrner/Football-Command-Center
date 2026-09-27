import Foundation

/// A league-relative letter grade for each roster, from two named parts that
/// are always shown alongside it:
///
/// - **Lineup** — the team's best lineup on the chosen basis, scaled from the
///   league's weakest (0) to strongest (100).
/// - **Depth** — the share of remaining weeks it can field every slot, the
///   roster-construction half.
///
/// Ported from the web app's season-mode `teamGrades.js` (65 / 35 weights and
/// the same bands). The web version valued players by a 0–100 draft
/// percentile; here the value half is the lineup itself, in points, so the
/// grade stays in the league's own scoring.
public struct TeamGrade: Hashable, Sendable, Identifiable {
    public let rosterID: Int
    /// Best lineup points on the basis; `nil` when nobody could be valued.
    public let lineupPoints: Double?
    public let lineupScore: Int?
    public let depthScore: Int
    public let score: Int?
    public let letter: String?
    /// 1 is the best in the league.
    public let rank: Int?

    public var id: Int { rosterID }
}

public enum TeamGrades {
    public static let lineupWeight = 0.65
    public static let depthWeight = 0.35

    static let bands: [(Double, String)] = [
        (90, "A+"), (80, "A"), (70, "B+"), (60, "B"), (50, "C+"), (40, "C"), (30, "D"), (0, "F"),
    ]

    public static func letter(for score: Double) -> String {
        bands.first { score >= $0.0 }?.1 ?? "F"
    }

    public struct Input: Hashable, Sendable {
        public let rosterID: Int
        public let lineupPoints: Double?
        /// Remaining weeks with any unfilled slot.
        public let shortWeeks: Int
        public let remainingWeeks: Int

        public init(rosterID: Int, lineupPoints: Double?, shortWeeks: Int, remainingWeeks: Int) {
            self.rosterID = rosterID
            self.lineupPoints = lineupPoints
            self.shortWeeks = shortWeeks
            self.remainingWeeks = remainingWeeks
        }
    }

    public static func grade(_ teams: [Input]) -> [TeamGrade] {
        let points = teams.compactMap(\.lineupPoints)
        let low = points.min() ?? 0, high = points.max() ?? 0

        let graded = teams.map { team -> (Input, Int?, Int, Double?) in
            let depth = team.remainingWeeks > 0
                ? 100 * Double(team.remainingWeeks - team.shortWeeks) / Double(team.remainingWeeks)
                : 100
            guard let value = team.lineupPoints else { return (team, nil, Int(depth.rounded()), nil) }
            let lineup = high > low ? 100 * (value - low) / (high - low) : 50
            return (team, Int(lineup.rounded()), Int(depth.rounded()), lineup * lineupWeight + depth * depthWeight)
        }
        let order = graded.compactMap { $0.3 }.sorted(by: >)
        return graded.map { team, lineup, depth, composite in
            TeamGrade(
                rosterID: team.rosterID,
                lineupPoints: team.lineupPoints,
                lineupScore: lineup,
                depthScore: depth,
                score: composite.map { Int($0.rounded()) },
                letter: composite.map(letter(for:)),
                rank: composite.flatMap { c in order.firstIndex(of: c).map { $0 + 1 } }
            )
        }
    }
}
