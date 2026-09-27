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
        return lines(byPosition: byPosition, template: template, teamCount: teamCount)
    }

    /// The same Nth-best construction over any per-position values — a week's
    /// projected points, for instance — so a "projected start line" is built
    /// exactly like the season one and the two are comparable in kind, though
    /// never blended.
    ///
    /// - Parameter flexDemand: extra starters per team at each position from
    ///   flex slots, as the league actually fills them (see `FlexDemand`). Empty
    ///   keeps the conservative dedicated-only count. A superflex league needs
    ///   it: there the QB line is roughly the 16th QB in an 8-team league, not
    ///   the 8th.
    public static func lines(
        byPosition: [Position: [Double]],
        template: SlotTemplate,
        teamCount: Int,
        flexDemand: [Position: Double] = [:]
    ) -> [Position: PositionBaseline] {
        guard teamCount > 0 else { return [:] }
        let counts = template.dedicatedCounts()

        var out: [Position: PositionBaseline] = [:]
        for (position, values) in byPosition {
            let perTeam = Double(counts[position] ?? 0) + (flexDemand[position] ?? 0)
            let starters = Int((perTeam * Double(teamCount)).rounded())
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


/// How a league's flex slots are actually filled, as extra starters per team
/// at each position. Measured from the managers' own lineups rather than
/// assumed, because the split is the league's habit: in a superflex league
/// nearly every SUPER_FLEX slot holds a quarterback.
public enum FlexDemand {
    /// - Parameter lineups: each team's current starters' positions, aligned
    ///   with `template.starters`; `nil` for an empty or unknown slot.
    public static func observed(template: SlotTemplate, lineups: [[Position?]]) -> [Position: Double] {
        guard !lineups.isEmpty else { return [:] }
        var filled: [Position: Double] = [:]
        var slotsSeen: [Int: Int] = [:]
        for lineup in lineups {
            for (index, slot) in template.starters.enumerated() where slot.isFlex {
                guard index < lineup.count, let position = lineup[index], slot.accepts(position) else { continue }
                filled[position, default: 0] += 1
                slotsSeen[index, default: 0] += 1
            }
        }
        // A flex slot left empty on some teams still exists on every team:
        // scale each position's share up to the full slot count.
        let flexSlots = template.starters.filter(\.isFlex).count
        let observedSlots = slotsSeen.values.reduce(0, +)
        guard flexSlots > 0, observedSlots > 0 else { return [:] }
        let scale = Double(flexSlots * lineups.count) / Double(observedSlots)
        return filled.mapValues { $0 * scale / Double(lineups.count) }
    }
}
