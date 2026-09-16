import Foundation

/// What a team is missing and what it could spare, as named facts.
///
/// This is the vocabulary a trade is built from: my need matched against your
/// surplus, and yours against mine. Every fact states its own evidence — weeks,
/// a points gap — and nothing is folded into a single "trade value" (§6).
public struct TeamNeeds: Hashable, Sendable {
    public let needs: [Need]
    public let surplus: [SurplusPlayer]

    public init(needs: [Need], surplus: [SurplusPlayer]) {
        self.needs = needs
        self.surplus = surplus
    }

    public func needs(at position: Position) -> [Need] {
        needs.filter { $0.positions.contains(position) }
    }

    public func surplus(at positions: Set<Position>) -> [SurplusPlayer] {
        surplus.filter { positions.contains($0.position) }
    }
}

public struct Need: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        /// Weeks the team can't fill a slot these positions could fill.
        case shortWeeks([Int])
        /// A starter below the league's start line at his position.
        case weakStarter(playerID: String, gap: Double)
    }

    /// The positions that would meet this need. One for a dedicated slot or a
    /// weak starter; several for a short flex group.
    public let positions: Set<Position>
    public let kind: Kind
    /// True when only a flex group is short, not a dedicated slot.
    public let viaFlex: Bool

    public var id: String {
        let names = positions.map(\.rawValue).sorted().joined(separator: "/")
        switch kind {
        case .shortWeeks(let weeks): return "short-\(names)-\(viaFlex)-\(weeks)"
        case .weakStarter(let id, _): return "weak-\(names)-\(id)"
        }
    }

    /// Weeks this need covers; a weak starter matters every week.
    public var weeks: [Int]? {
        if case .shortWeeks(let weeks) = kind { return weeks }
        return nil
    }
}

public struct SurplusPlayer: Hashable, Sendable, Identifiable {
    public let playerID: String
    public let position: Position
    /// Season points per game; `nil` for DEF, IDP or anyone without a line.
    public let value: Double?
    /// Clears the league's replacement line at his position.
    public let aboveReplacement: Bool
    /// Remaining weeks his team plays (not on bye).
    public let playsWeeks: [Int]

    public var id: String { playerID }

    /// A position with no production data can only offer depth.
    public var depthOnly: Bool { !position.hasWeeklyProductionData }
}

public enum TeamNeedsBuilder {
    /// - Parameters:
    ///   - roster: every rostered player with position and nflverse team.
    ///   - starters: the current starters, positionally aligned; `"0"` for unset.
    ///   - values: season points per game by player id — absent means no line.
    public static func build(
        roster: [RosterEntry],
        starters: [String],
        template: SlotTemplate,
        values: [String: Double],
        baselines: [Position: PositionBaseline],
        calendar: ByeCalendar,
        weeks: [Int]
    ) -> TeamNeeds {
        var needs: [Need] = []

        // Short weeks, from the crunch. Dedicated shortfalls are named per
        // position; a short flex group is one need covering its eligible set.
        let outlook = ByeCrunch.outlook(roster: roster, template: template, calendar: calendar, weeks: weeks)
        var dedicatedWeeks: [Position: [Int]] = [:]
        var flexWeeks: [Set<Position>: [Int]] = [:]
        for week in weeks.sorted() {
            guard let report = outlook[week] else { continue }
            for position in report.shortDedicatedPositions {
                dedicatedWeeks[position, default: []].append(week)
            }
            for group in report.flexGroups where group.shortfall > 0 {
                flexWeeks[group.eligible, default: []].append(week)
            }
        }
        for (position, list) in dedicatedWeeks.sorted(by: { $0.key.rawValue < $1.key.rawValue }) {
            needs.append(Need(positions: [position], kind: .shortWeeks(list), viaFlex: false))
        }
        for (eligible, list) in flexWeeks.sorted(by: { $0.key.map(\.rawValue).sorted().joined() < $1.key.map(\.rawValue).sorted().joined() }) {
            needs.append(Need(positions: eligible, kind: .shortWeeks(list), viaFlex: true))
        }

        // Weak starters: dedicated slots only — a flex starter isn't competing
        // against one position's line.
        let positions = Dictionary(roster.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        for (index, slot) in template.starters.enumerated() {
            guard let dedicated = slot.dedicated, index < starters.count else { continue }
            let id = starters[index]
            guard id != "0", let value = values[id], let line = baselines[dedicated]?.startLine, value < line else { continue }
            needs.append(Need(positions: [dedicated], kind: .weakStarter(playerID: id, gap: line - value), viaFlex: false))
        }

        // Surplus: bench players at a position where the dedicated slots are
        // already covered by other rostered players.
        let startingSet = Set(starters.filter { $0 != "0" })
        let required = template.dedicatedCounts()
        var surplus: [SurplusPlayer] = []
        for entry in roster where !startingSet.contains(entry.id) {
            guard let position = entry.position else { continue }
            let atPosition = roster.filter { $0.position == position }.count
            guard atPosition > (required[position] ?? 0) else { continue }
            let value = values[entry.id]
            let replacement = baselines[position]?.replacementLine
            surplus.append(
                SurplusPlayer(
                    playerID: entry.id,
                    position: position,
                    value: value,
                    aboveReplacement: value.map { v in replacement.map { v >= $0 } ?? false } ?? false,
                    playsWeeks: weeks.filter { !calendar.isOnBye(team: entry.team, week: $0) }
                )
            )
        }
        surplus.sort { ($0.value ?? -1) > ($1.value ?? -1) }

        return TeamNeeds(needs: needs, surplus: surplus)
    }
}
