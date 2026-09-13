import Foundation

/// One starting slot in a league's lineup.
///
/// A dedicated slot accepts exactly one position; a flex slot accepts a set.
/// Both carry the league's own token so the UI can name the slot the way
/// Sleeper does.
public struct Slot: Hashable, Sendable {
    /// The league's own token — `"QB"`, `"FLEX"`, `"IDP_FLEX"`.
    public let token: String
    /// The single position this slot requires, or `nil` when it is a flex slot.
    public let dedicated: Position?
    public let eligible: Set<Position>

    public var isFlex: Bool { dedicated == nil }

    public func accepts(_ position: Position?) -> Bool {
        guard let position else { return false }
        return eligible.contains(position)
    }

    public init(token: String, dedicated: Position?, eligible: Set<Position>) {
        self.token = token
        self.dedicated = dedicated
        self.eligible = eligible
    }

    static func dedicatedSlot(_ position: Position) -> Slot {
        Slot(token: position.rawValue, dedicated: position, eligible: [position])
    }

    static func flexSlot(token: String, eligible: Set<Position>) -> Slot {
        Slot(token: token, dedicated: nil, eligible: eligible)
    }
}

/// A league's starting lineup shape, parsed from its own `roster_positions`.
///
/// Never hardcode this. The app reads it live from Sleeper every load so a
/// mid-season settings change is picked up automatically (§1).
public struct SlotTemplate: Hashable, Sendable {
    public let starters: [Slot]
    public let benchCount: Int
    /// Tokens the parser did not recognise. Never silently dropped: a dropped
    /// slot corrupts every roster-construction calculation downstream.
    public let unrecognized: [String]

    public init(starters: [Slot], benchCount: Int, unrecognized: [String] = []) {
        self.starters = starters
        self.benchCount = benchCount
        self.unrecognized = unrecognized
    }

    public var totalStarterSlots: Int { starters.count }

    public var flexSlots: [Slot] { starters.filter(\.isFlex) }

    /// How many dedicated slots each position requires.
    ///
    /// Flex slots are **not** counted here. Flex demand is split across the
    /// eligible positions by whatever each manager happens to start, so charging
    /// it fully to every eligible position would count the same slot several
    /// times (§5.7).
    public func dedicatedCounts() -> [Position: Int] {
        var counts: [Position: Int] = [:]
        for slot in starters {
            guard let position = slot.dedicated else { continue }
            counts[position, default: 0] += 1
        }
        return counts
    }
}

public enum RosterSlots {
    /// Positions Sleeper names directly as a starting slot.
    public static let directPositions: Set<String> = [
        "QB", "RB", "WR", "TE", "K", "DEF", "LB", "DL", "DB",
    ]

    /// What each flex token accepts.
    public static let flexEligibility: [String: Set<Position>] = [
        "FLEX": [.rb, .wr, .te],
        "SUPER_FLEX": [.qb, .rb, .wr, .te],
        "WRRB_FLEX": [.rb, .wr],
        "WRTE_FLEX": [.wr, .te],
        "REC_FLEX": [.wr, .te],
        "IDP_FLEX": [.lb, .dl, .db],
    ]

    /// Slots that exist on a Sleeper roster but are not part of the active
    /// lineup or a countable bench spot.
    public static let ignoredTokens: Set<String> = ["TAXI", "IR"]

    /// Parses Sleeper's `roster_positions` into a starting-slot template.
    ///
    /// An unknown token containing `FLEX` falls back to standard offensive
    /// eligibility and is reported as unrecognised rather than dropped — a
    /// league-specific hybrid slot should still occupy a place in the lineup
    /// even when we cannot say exactly who fills it.
    public static func parse(_ rosterPositions: [String]?) -> SlotTemplate {
        var starters: [Slot] = []
        var benchCount = 0
        var unrecognized: [String] = []

        for rawToken in rosterPositions ?? [] {
            let token = rawToken.uppercased()

            if token == "BN" {
                benchCount += 1
                continue
            }
            if ignoredTokens.contains(token) { continue }
            if directPositions.contains(token), let position = Position(sleeper: token) {
                starters.append(.dedicatedSlot(position))
                continue
            }
            if let eligible = flexEligibility[token] {
                starters.append(.flexSlot(token: token, eligible: eligible))
                continue
            }
            if token.contains("FLEX") {
                starters.append(.flexSlot(token: token, eligible: [.rb, .wr, .te]))
                unrecognized.append(rawToken)
                continue
            }
            unrecognized.append(rawToken)
        }

        return SlotTemplate(
            starters: starters, benchCount: benchCount, unrecognized: unrecognized
        )
    }

    /// Greedy fill used for roster construction views: each player lands in the
    /// first empty dedicated slot matching their exact position, else the first
    /// empty flex slot they are eligible for, else the bench, else overflow.
    ///
    /// This is deliberately *not* the lineup optimizer. It answers "where does
    /// this roster sit", in roster order; `LineupOptimizer` answers "what is the
    /// best legal lineup under one stated basis".
    public static func assign(
        playerIDs: [String],
        template: SlotTemplate,
        positions: (String) -> Position?
    ) -> Assignment {
        var filled: [String?] = Array(repeating: nil, count: template.starters.count)
        var bench: [String] = []
        var overflow: [String] = []

        for id in playerIDs {
            guard !id.isEmpty, id != "0" else { continue }
            guard let position = positions(id) else {
                overflow.append(id)
                continue
            }

            var placed = false
            for index in template.starters.indices {
                guard filled[index] == nil else { continue }
                guard template.starters[index].dedicated == position else { continue }
                filled[index] = id
                placed = true
                break
            }
            if !placed {
                for index in template.starters.indices {
                    guard filled[index] == nil else { continue }
                    let slot = template.starters[index]
                    guard slot.isFlex, slot.accepts(position) else { continue }
                    filled[index] = id
                    placed = true
                    break
                }
            }
            if placed { continue }

            if bench.count < template.benchCount {
                bench.append(id)
            } else {
                overflow.append(id)
            }
        }

        return Assignment(slots: template.starters, filled: filled, bench: bench, overflow: overflow)
    }

    public struct Assignment: Hashable, Sendable {
        public let slots: [Slot]
        /// Player id per slot, positionally aligned to `slots`.
        public let filled: [String?]
        public let bench: [String]
        public let overflow: [String]
    }
}
