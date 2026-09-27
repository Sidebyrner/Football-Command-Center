import Foundation
import FCCore
import FCData

/// Two to four players side by side, from their Player Card models plus the
/// Waiver Board's usage columns. Pure given the models' current state.
public struct PlayerComparison: Sendable {
    public enum Metric: String, CaseIterable, Identifiable, Sendable {
        case pointsPerGame, expectedPointsLast4, snapShare, targetShare, redZoneTouches,
             projectedThisWeek, restOfSeason, gradeScore, opponentRank

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .pointsPerGame: return "Pts/gm this season"
            case .expectedPointsLast4: return "xFP, last 4"
            case .snapShare: return "Snap share, last 4"
            case .targetShare: return "Target share, last 4"
            case .redZoneTouches: return "Red zone touches, last 4"
            case .projectedThisWeek: return "Projected this week"
            case .restOfSeason: return "Rest of season /gm"
            case .gradeScore: return "Grade"
            case .opponentRank: return "Opponent vs position"
            }
        }

        public var isPercent: Bool { self == .snapShare || self == .targetShare }

        /// Opponent rank: 1 is the softest defense, so lower is better.
        public var higherIsBetter: Bool { self != .opponentRank }

        public func format(_ value: Double) -> String {
            switch self {
            case .snapShare, .targetShare: return "\(Int((value * 100).rounded()))%"
            case .gradeScore: return "\(Int(value.rounded()))"
            case .opponentRank: return "#\(Int(value))"
            default: return value.formatted(.number.precision(.fractionLength(1)))
            }
        }
    }

    public struct Player: Identifiable, Hashable, Sendable {
        public let id: String
        public let name: String
        public let position: Position?
        public let team: String?
        public let opponent: String?
        /// 0…3 — the chart colour.
        public let seriesIndex: Int
        /// Played weeks, oldest first, the last N.
        public let log: [PlayerLogWeek]
        public let values: [Metric: Double]
        /// Worst and best game this season; the estimate is this week's
        /// projection, else his average.
        public let floor: Double?
        public let expected: Double?
        public let ceiling: Double?
    }

    public let players: [Player]
    public let lastN: Int
    /// Every week any of them played in the window, ascending.
    public let weeks: [Int]

    public func values(_ metric: Metric) -> [Double?] {
        players.map { $0.values[metric] }
    }

    /// The column holding the best value on a row; `nil` when fewer than two
    /// players have a value or they're all equal.
    public func bestIndex(_ metric: Metric) -> Int? {
        let present = values(metric).enumerated().compactMap { index, value in value.map { (index, $0) } }
        guard present.count >= 2, Set(present.map(\.1)).count > 1 else { return nil }
        let best = metric.higherIsBetter ? present.max { $0.1 < $1.1 } : present.min { $0.1 < $1.1 }
        return best?.0
    }

    @MainActor
    public static func build(
        cards: [PlayerCardModel],
        rows: (String) -> WaiverRow?,
        defense: DefenseLookup,
        lastN: Int
    ) -> PlayerComparison {
        var weeks: Set<Int> = []
        let players = cards.prefix(LinkBus.compareLimit).enumerated().map { index, card -> Player in
            let played = card.log.filter(\.played).sorted { $0.week < $1.week }
            let window = Array(played.suffix(max(lastN, 1)))
            weeks.formUnion(window.map(\.week))
            let row = rows(card.id)
            var values: [Metric: Double] = [:]
            values[.pointsPerGame] = card.context.sleeperPointsPerGame(card.id)
            values[.expectedPointsLast4] = row?.expectedPoints
            values[.snapShare] = row?.snapShare
            values[.targetShare] = row?.targetShare
            values[.redZoneTouches] = row?.redZoneTouches
            values[.projectedThisWeek] = card.rotowireThisWeek
            values[.restOfSeason] = card.commandCenter?.restOfSeasonPerGame
            values[.gradeScore] = card.grade?.score.map(Double.init)
            values[.opponentRank] = defense.cell(defense: card.status?.opponent, position: card.position)?.rank.map(Double.init)
            // Hook: prefer projection bounds once CommandCenterProjection carries them.
            let points = played.compactMap(\.points)
            return Player(
                id: card.id, name: card.name, position: card.position, team: card.team,
                opponent: card.status?.opponent, seriesIndex: index, log: window, values: values,
                floor: points.min(), expected: card.rotowireThisWeek ?? values[.pointsPerGame], ceiling: points.max()
            )
        }
        return PlayerComparison(players: players, lastN: lastN, weeks: weeks.sorted())
    }
}
