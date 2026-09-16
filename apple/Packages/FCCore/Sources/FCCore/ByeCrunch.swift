import Foundation

/// A roster slot's worth of player, as the crunch calculation sees them.
public struct RosterEntry: Hashable, Sendable {
    public let id: String
    public let position: Position?
    /// Team code in whatever dialect the caller holds; normalised to the
    /// nflverse dialect before the bye lookup.
    public let team: String?

    public init(id: String, position: Position?, team: String?) {
        self.id = id
        self.position = position
        self.team = team
    }
}

/// Dedicated-slot supply and demand at one position.
public struct PositionCrunch: Hashable, Sendable {
    public let required: Int
    public let available: Int
    public let shortfall: Int
}

/// One family of flex slots — all the slots in the template that accept the
/// same set of positions.
public struct FlexGroupCrunch: Hashable, Sendable {
    /// The league's own tokens for the slots in this group, in template order.
    public let tokens: [String]
    public let eligible: Set<Position>
    public let required: Int
    public let filled: Int
    public let shortfall: Int
}

/// Can this roster field a legal lineup in a given week?
///
/// Reported per position rather than as one feasible/infeasible verdict, because
/// "RB: 1 available for 2 slots" is the thing you act on and a boolean isn't
/// (§5.5).
public struct CrunchReport: Hashable, Sendable {
    /// Only positions the template actually requires appear here.
    public let byPosition: [Position: PositionCrunch]
    public let flexGroups: [FlexGroupCrunch]
    public let flexRequired: Int
    public let flexFilled: Int
    public let flexShortfall: Int
    public let totalShortfall: Int
    public let onBye: [RosterEntry]
    /// Roster ids whose position we could not determine, so they counted toward
    /// nothing. Surfaced rather than silently dropped.
    public let unknownPosition: [String]

    public var isFeasible: Bool { totalShortfall == 0 }
}

public enum ByeCrunch {
    /// Shortfall for one week.
    ///
    /// 1. Count dedicated slots per position, and flex slots with their own
    ///    eligibility sets.
    /// 2. A player whose normalised team is on bye that week goes to `onBye`;
    ///    everyone else increments availability at their position.
    /// 3. Fill dedicated slots first. Surplus at a flex-eligible position
    ///    becomes flex supply.
    /// 4. Shortfall is unfilled dedicated slots plus unfilled flex slots.
    ///
    /// **Deviation from the web app, on purpose.** `crunchForWeek` in the React
    /// codebase pools *all* flex slots against the union of their eligibility
    /// sets. In this league that union is `{RB, WR, TE, LB, DL, DB}` across one
    /// `FLEX` and two `IDP_FLEX` slots, so a spare receiver reads as covering a
    /// missing linebacker and the week looks fillable when it isn't. Here each
    /// flex slot is matched only against positions it actually accepts, via a
    /// maximum bipartite matching so overlapping eligibility sets (a league
    /// running both `WRRB_FLEX` and `WRTE_FLEX`) still fill optimally. The
    /// result is never smaller than the pooled number, which is the safe
    /// direction for an alarm.
    public static func forWeek(
        roster: [RosterEntry],
        template: SlotTemplate,
        byeTeams: Set<String>
    ) -> CrunchReport {
        let required = template.dedicatedCounts()
        let flexSlots = template.flexSlots

        var availableByPosition: [Position: Int] = [:]
        var onBye: [RosterEntry] = []
        var unknownPosition: [String] = []

        for entry in roster {
            guard !entry.id.isEmpty, entry.id != "0" else { continue }
            guard let position = entry.position else {
                unknownPosition.append(entry.id)
                continue
            }
            let team = NFLTeams.nflverse(entry.team)
            if let team, byeTeams.contains(team) {
                onBye.append(RosterEntry(id: entry.id, position: position, team: team))
                continue
            }
            availableByPosition[position, default: 0] += 1
        }

        var byPosition: [Position: PositionCrunch] = [:]
        var totalShortfall = 0
        var surplus: [Position: Int] = [:]

        for position in Set(required.keys).union(availableByPosition.keys) {
            let req = required[position] ?? 0
            let avail = availableByPosition[position] ?? 0
            if req > 0 {
                let shortfall = max(0, req - avail)
                byPosition[position] = PositionCrunch(
                    required: req, available: avail, shortfall: shortfall
                )
                totalShortfall += shortfall
            }
            let spare = max(0, avail - req)
            if spare > 0 { surplus[position] = spare }
        }

        let matching = matchFlexSlots(flexSlots, surplus: surplus)
        let flexFilled = matching.compactMap { $0 }.count
        let flexShortfall = flexSlots.count - flexFilled
        totalShortfall += flexShortfall

        return CrunchReport(
            byPosition: byPosition,
            flexGroups: groupFlex(flexSlots, matching: matching),
            flexRequired: flexSlots.count,
            flexFilled: flexFilled,
            flexShortfall: flexShortfall,
            totalShortfall: totalShortfall,
            onBye: onBye,
            unknownPosition: unknownPosition
        )
    }

    /// Bye-week shortfall for every remaining week of a season, for one roster.
    public static func outlook(
        roster: [RosterEntry],
        template: SlotTemplate,
        calendar: ByeCalendar,
        weeks: [Int]
    ) -> [Int: CrunchReport] {
        var out: [Int: CrunchReport] = [:]
        for week in weeks {
            out[week] = forWeek(
                roster: roster, template: template, byeTeams: calendar.byeTeams(week: week)
            )
        }
        return out
    }

    // MARK: - Flex matching

    /// Assigns flex slots to surplus players, maximising how many slots are
    /// filled. Returns the position assigned to each slot, positionally aligned
    /// to `slots`, with `nil` for a slot nothing can fill.
    static func matchFlexSlots(_ slots: [Slot], surplus: [Position: Int]) -> [Position?] {
        guard !slots.isEmpty else { return [] }

        // One "unit" per spare player, capped at the number of slots — no slot
        // can use more than one, so extra units only cost time.
        var units: [Position] = []
        for position in surplus.keys.sorted(by: { $0.rawValue < $1.rawValue }) {
            let count = min(surplus[position] ?? 0, slots.count)
            units.append(contentsOf: Array(repeating: position, count: count))
        }
        guard !units.isEmpty else { return Array(repeating: nil, count: slots.count) }

        // Kuhn's algorithm. Slots are processed in template order so the result
        // is deterministic when several maximum matchings exist.
        var slotForUnit = [Int?](repeating: nil, count: units.count)
        var visited = [Bool](repeating: false, count: units.count)

        func augment(_ slotIndex: Int) -> Bool {
            for unitIndex in units.indices {
                guard !visited[unitIndex] else { continue }
                guard slots[slotIndex].eligible.contains(units[unitIndex]) else { continue }
                visited[unitIndex] = true
                let reassigned: Bool
                if let occupant = slotForUnit[unitIndex] {
                    reassigned = augment(occupant)
                } else {
                    reassigned = true
                }
                if reassigned {
                    slotForUnit[unitIndex] = slotIndex
                    return true
                }
            }
            return false
        }

        for slotIndex in slots.indices {
            visited = Array(repeating: false, count: units.count)
            _ = augment(slotIndex)
        }

        var assigned = [Position?](repeating: nil, count: slots.count)
        for (unitIndex, slotIndex) in slotForUnit.enumerated() {
            guard let slotIndex else { continue }
            assigned[slotIndex] = units[unitIndex]
        }
        return assigned
    }

    /// Groups flex slots by eligibility set, in first-appearance order, and
    /// attributes the matching back to each group.
    static func groupFlex(_ slots: [Slot], matching: [Position?]) -> [FlexGroupCrunch] {
        var order: [Set<Position>] = []
        var tokens: [Set<Position>: [String]] = [:]
        var required: [Set<Position>: Int] = [:]
        var filled: [Set<Position>: Int] = [:]

        for (index, slot) in slots.enumerated() {
            let key = slot.eligible
            if required[key] == nil {
                order.append(key)
                required[key] = 0
                filled[key] = 0
                tokens[key] = []
            }
            required[key]? += 1
            tokens[key]?.append(slot.token)
            if index < matching.count, matching[index] != nil {
                filled[key]? += 1
            }
        }

        return order.map { key in
            let req = required[key] ?? 0
            let fill = filled[key] ?? 0
            return FlexGroupCrunch(
                tokens: tokens[key] ?? [],
                eligible: key,
                required: req,
                filled: fill,
                shortfall: max(0, req - fill)
            )
        }
    }
}

public extension CrunchReport {
    /// Positions that would fix this week: dedicated positions that are short,
    /// plus every position eligible for a flex group that is short.
    var neededPositions: Set<Position> {
        var needed = Set(byPosition.filter { $0.value.shortfall > 0 }.keys)
        for group in flexGroups where group.shortfall > 0 {
            needed.formUnion(group.eligible)
        }
        return needed
    }

    /// Dedicated positions short this week — not counting flex groups.
    var shortDedicatedPositions: Set<Position> {
        Set(byPosition.filter { $0.value.shortfall > 0 }.keys)
    }
}
