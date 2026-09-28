import Foundation

// ESPN's league payload, decoded only as far as the translator needs.
//
// One response shape serves every `view=` combination — ESPN returns the same
// object with more or fewer fields filled in — so there is one type, with every
// field optional. Unknown fields are ignored, and one malformed team or roster
// entry costs that entry rather than the league.

/// `/seasons/{season}/segments/0/leagues/{id}`.
public struct ESPNLeague: Decodable, Sendable {
    public let id: Int?
    public let seasonId: Int?
    /// The week ESPN is currently scoring.
    public let scoringPeriodId: Int?
    public let settings: Settings?
    public let members: [Member]?
    public let teams: [Team]?
    public let schedule: [Matchup]?

    public struct Settings: Decodable, Sendable {
        public let name: String?
        public let rosterSettings: RosterSettings?
        public let scoringSettings: ScoringSettings?
        public let scheduleSettings: ScheduleSettings?
        public let tradeSettings: TradeSettings?
        public let acquisitionSettings: AcquisitionSettings?
    }

    public struct RosterSettings: Decodable, Sendable {
        /// Slot id (as a string key) → how many of that slot. See
        /// `ESPNTranslator.slotTokens` for what the ids mean.
        public let lineupSlotCounts: [String: Int]?
    }

    public struct ScoringSettings: Decodable, Sendable {
        public let scoringItems: [ScoringItem]?
    }

    public struct ScoringItem: Decodable, Sendable {
        public let statId: Int?
        public let points: Double?
    }

    public struct ScheduleSettings: Decodable, Sendable {
        /// Regular-season matchup weeks; playoffs start the week after.
        public let matchupPeriodCount: Int?
        public let playoffTeamCount: Int?
    }

    public struct TradeSettings: Decodable, Sendable {
        /// Epoch milliseconds. ESPN sets it far in the future for "no deadline".
        public let deadlineDate: Double?
    }

    public struct AcquisitionSettings: Decodable, Sendable {
        public let acquisitionBudget: Int?
        public let isUsingAcquisitionBudget: Bool?
        /// `WAIVERS_TRADITIONAL`, `WAIVERS_CONTINUOUS` or `FREEAGENCY`.
        public let acquisitionType: String?
        /// Day names, e.g. `["WEDNESDAY"]`.
        public let waiverProcessDays: [String]?
    }

    public struct Member: Decodable, Sendable {
        /// The SWID, braces included.
        public let id: String?
        public let displayName: String?
        public let firstName: String?
        public let lastName: String?
    }

    public struct Team: Decodable, Sendable {
        public let id: Int?
        /// Seasons from 2024 send one `name`; earlier ones `location` +
        /// `nickname`. Both are kept so either era decodes.
        public let name: String?
        public let location: String?
        public let nickname: String?
        public let abbrev: String?
        /// SWIDs. Co-managed teams have more than one; the first is the owner.
        public let owners: [String]?
        public let record: Record?
        public let roster: Roster?
        public let waiverRank: Int?
        public let transactionCounter: TransactionCounter?

        public var displayName: String? {
            if let name, !name.isEmpty { return name }
            let joined = [location, nickname].compactMap { $0 }.joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            return joined.isEmpty ? nil : joined
        }
    }

    public struct Record: Decodable, Sendable {
        public let overall: Line?

        public struct Line: Decodable, Sendable {
            public let wins: Int?
            public let losses: Int?
            public let ties: Int?
            public let pointsFor: Double?
            public let pointsAgainst: Double?
        }
    }

    public struct TransactionCounter: Decodable, Sendable {
        public let acquisitionBudgetSpent: Int?
    }

    public struct Roster: Decodable, Sendable {
        public let entries: [Entry]?
    }

    public struct Entry: Decodable, Sendable {
        public let playerId: Int?
        /// Which slot the manager put him in. 20 is bench, 21 IR.
        public let lineupSlotId: Int?
        public let playerPoolEntry: PoolEntry?

        /// One bad entry must not cost the roster, so each field is decoded on
        /// its own.
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            playerId = (try? c.decodeIfPresent(Int.self, forKey: .playerId)) ?? nil
            lineupSlotId = (try? c.decodeIfPresent(Int.self, forKey: .lineupSlotId)) ?? nil
            playerPoolEntry = (try? c.decodeIfPresent(PoolEntry.self, forKey: .playerPoolEntry)) ?? nil
        }

        enum CodingKeys: String, CodingKey {
            case playerId, lineupSlotId, playerPoolEntry
        }
    }

    public struct PoolEntry: Decodable, Sendable {
        public let id: Int?
        /// Fantasy points for the scoring period the response was asked for.
        public let appliedStatTotal: Double?
        public let player: Player?
    }

    public struct Player: Decodable, Sendable {
        public let id: Int?
        public let fullName: String?
        public let firstName: String?
        public let lastName: String?
        /// ESPN's team number; see `ESPNTranslator.proTeams`.
        public let proTeamId: Int?
        /// 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 D/ST.
        public let defaultPositionId: Int?
        public let injuryStatus: String?
    }

    public struct Matchup: Decodable, Sendable {
        public let id: Int?
        public let matchupPeriodId: Int?
        public let home: Side?
        public let away: Side?
        public let winner: String?
    }

    public struct Side: Decodable, Sendable {
        public let teamId: Int?
        /// The matchup's total so far — for a completed week, the final score.
        public let totalPoints: Double?
        /// Week (as a string key) → points that week, when ESPN splits it.
        public let pointsByScoringPeriod: [String: Double]?
        /// Only with `view=mBoxscore`: the lineup and each player's points for
        /// the requested scoring period.
        public let rosterForCurrentScoringPeriod: Roster?
    }
}
