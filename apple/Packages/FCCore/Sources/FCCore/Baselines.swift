import Foundation

/// Where the startable and replacement lines sit at one position, on a **season
/// per-game** basis.
public struct PositionBaseline: Hashable, Sendable {
    public let position: Position
    /// How many of this position the league actually starts: dedicated slots
    /// times the number of teams.
    public let starters: Int
    /// The season pace of the last player the league actually starts — the
    /// 16th-best RB in an 8-team league starting two.
    public let startLine: Double
    /// The next player down. `nil` when the pool is not deep enough to have one.
    public let replacementLine: Double?
    /// How many players were eligible to set the line.
    public let pool: Int
}

public enum Baselines {
    /// Below this, a per-game average is an artefact of one hot afternoon and
    /// has no business setting a positional line.
    public static let minimumGamesForLine = 3

    /// Season-pace baselines per position.
    ///
    /// The start line is the season points-per-game pace of the **last player
    /// the league actually starts** at that position; the replacement line is
    /// the next player down.
    ///
    /// Do not substitute the web app's `positionBaselines` from
    /// `weeklyAggregates.js` here. That averages each *week's* Nth-best
    /// single-week score, which is right for the matchup screen (one week
    /// against that same week's line) and wrong for season comparisons: a
    /// different player holds the Nth rank every week, so the average of weekly
    /// Nth-bests sits far above the season pace of the actual Nth-best player.
    /// Measured on the shipped 2025 file that is 29.7 against 23.9 for QB, and
    /// the inflated line left two of seventy quarterbacks reading as startable
    /// (§5.7).
    ///
    /// Flex slots are deliberately excluded from the starter counts. Flex demand
    /// splits across RB/WR/TE by whatever each manager happens to start, so
    /// charging it fully to every eligible position would count the same slot
    /// three times and push all three lines too high. Excluding it makes the
    /// lines mildly conservative, which is the safer direction.
    ///
    /// Lines are kept at full precision. Rounding them for display is a UI
    /// concern; rounding them *before* comparing pushes the line above the very
    /// player who set it, and a position's Nth-best player stops clearing his
    /// own line.
    ///
    /// A position with no weekly production data gets no baseline at all rather
    /// than a zero one — the absence is the honest answer (§3.2).
    public static func seasonPace(
        players: [SeasonProfile],
        template: SlotTemplate,
        teamCount: Int,
        minimumGames: Int = Baselines.minimumGamesForLine
    ) -> [Position: PositionBaseline] {
        guard teamCount > 0 else { return [:] }
        let counts = template.dedicatedCounts()

        var byPosition: [Position: [Double]] = [:]
        for player in players where player.games >= minimumGames {
            byPosition[player.position, default: []].append(player.pointsPerGame)
        }

        var out: [Position: PositionBaseline] = [:]
        for (position, values) in byPosition {
            let starters = (counts[position] ?? 0) * teamCount
            guard starters > 0, !values.isEmpty else { continue }

            let descending = values.sorted(by: >)
            // A pool shallower than the league's demand cannot name an Nth-best
            // player; fall back to the worst qualifying one so the line stays
            // defined, and report no replacement below it.
            let startLine = starters - 1 < descending.count
                ? descending[starters - 1]
                : descending[descending.count - 1]
            let replacementLine: Double? = starters < descending.count
                ? descending[starters]
                : nil

            out[position] = PositionBaseline(
                position: position,
                starters: starters,
                startLine: startLine,
                replacementLine: replacementLine,
                pool: descending.count
            )
        }
        return out
    }
}
