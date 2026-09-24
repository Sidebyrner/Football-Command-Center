import Foundation

/// Fantasy points one NFL defense allowed to one position.
public struct DefenseCell: Hashable, Sendable {
    /// Games this defense played in the window — the denominator.
    public let games: Int
    /// Player-weeks at this position that faced the defense. Not the
    /// denominator; kept so a thin sample is visible.
    public let playerWeeks: Int
    public let totalPoints: Double
    /// `nil` when no player at the position faced this defense.
    public let perGame: Double?
    /// 1 is the *softest* defense — most points allowed. `nil` when the defense
    /// is under the sample-size floor, which is a different claim from "average".
    public let rank: Int?
    /// Points per game above (+) or below (−) the league average for the
    /// position. `nil` exactly when `rank` is.
    public let vsLeagueAverage: Double?
}

/// Defense-vs-position for a season, under one scoring profile.
public struct DefenseVsPositionTable: Sendable {
    /// Defense (nflverse team code) → position → cell.
    public let byDefense: [String: [Position: DefenseCell]]
    /// Mean points per game allowed across ranked defenses, per position.
    public let leagueAverage: [Position: Double]
    /// Ranked defenses per position, softest first.
    public let ranked: [Position: [String]]
    public let weeks: [Int]
    public let minimumGames: Int
    /// How many defenses there are to be ranked against — the "of 32".
    public var defenseCount: Int { byDefense.count }

    public static let empty = DefenseVsPositionTable(
        byDefense: [:], leagueAverage: [:], ranked: [:], weeks: [], minimumGames: DefenseVsPosition.defaultMinimumGames
    )

    public func cell(defense: String?, position: Position?) -> DefenseCell? {
        guard let defense, let position else { return nil }
        return byDefense[NFLTeams.nflverse(defense) ?? defense]?[position]
    }

    /// Whether any player at the position faced any defense in this table.
    public func covers(_ position: Position) -> Bool {
        byDefense.values.contains { $0[position]?.playerWeeks ?? 0 > 0 }
    }
}

/// One player-week against one defense, already scored. The unit both
/// sources — the nflverse weekly file and Sleeper's own stat lines — reduce to.
public struct DefenseFacing: Hashable, Sendable {
    public let week: Int
    public let position: Position
    /// nflverse team code of the defense faced.
    public let defense: String
    public let points: Double

    public init(week: Int, position: Position, defense: String, points: Double) {
        self.week = week
        self.position = position
        self.defense = NFLTeams.nflverse(defense) ?? defense
        self.points = points
    }
}

/// Computes defense-vs-position from the weekly file.
///
/// Computed at runtime rather than pre-baked, as the web app does and for the
/// same reason: a baked table would be frozen to nflverse's PPR scoring, and
/// this league is not PPR and pays for first downs. Scoring here, under the
/// league's own profile, keeps the numbers in the points actually collected.
public enum DefenseVsPosition {
    /// Below this many games a defense is left unranked rather than given a rank
    /// the data can't support.
    public static let defaultMinimumGames = 4

    /// **Definition, which the UI should state rather than bury:** points
    /// allowed to position P by defense D is the sum of the weekly points of
    /// *every* player at P who faced D, divided by the number of *games* D
    /// played — not by player-weeks. That is the standard volume-inclusive
    /// definition, and it is why a defense that happens to face three-receiver
    /// offenses looks softer to receivers.
    ///
    /// Games are counted as distinct weeks in which someone faced D, so byes are
    /// handled without a schedule.
    ///
    /// Values are kept at full precision; rounding is a display concern, the
    /// same judgement `Baselines` makes.
    public static func compute(
        file: WeeklyFile,
        profile: ScoringProfile,
        positions: Set<Position> = Position.coveredByWeeklyData,
        weekRange: ClosedRange<Int>? = nil,
        minimumGames: Int = defaultMinimumGames
    ) -> DefenseVsPositionTable {
        var facing: [DefenseFacing] = []
        for player in file.allPlayers() {
            guard let position = player.position, positions.contains(position) else { continue }
            for row in player.rows {
                if let weekRange, !weekRange.contains(row.week) { continue }
                guard let defense = row.opponent, !defense.isEmpty else { continue }
                // A week the engine cannot score still counts as a game the
                // defense played, so it is recorded with no points.
                let points = ScoringEngine.score(row, profile: profile, position: position).points
                facing.append(DefenseFacing(week: row.week, position: position, defense: defense, points: points ?? .nan))
            }
        }
        return compute(facing: facing, positions: positions, minimumGames: minimumGames)
    }

    /// The same table from already-scored player-weeks — the path Sleeper's own
    /// stat lines take, which is the only one that covers IDP. A `points` of
    /// `nan` records that the defense played that week without adding points.
    public static func compute(
        facing: [DefenseFacing],
        positions: Set<Position>,
        minimumGames: Int = defaultMinimumGames
    ) -> DefenseVsPositionTable {
        var totals: [String: [Position: (points: Double, playerWeeks: Int)]] = [:]
        var weeksByDefense: [String: Set<Int>] = [:]
        var weeksSeen: Set<Int> = []

        for line in facing where positions.contains(line.position) {
            // Keyed in the nflverse dialect, which is what `cell(defense:)`
            // looks up — Sleeper's lines say LAR, and a raw key would leave
            // every Rams matchup unresolvable.
            let defense = NFLTeams.nflverse(line.defense) ?? line.defense
            weeksSeen.insert(line.week)
            weeksByDefense[defense, default: []].insert(line.week)
            guard line.points.isFinite else { continue }
            var bucket = totals[defense, default: [:]][line.position] ?? (0, 0)
            bucket.points += line.points
            bucket.playerWeeks += 1
            totals[defense, default: [:]][line.position] = bucket
        }

        // Per-game rates, before ranking.
        var perGame: [String: [Position: (games: Int, playerWeeks: Int, total: Double, rate: Double?)]] = [:]
        for defense in weeksByDefense.keys {
            let games = weeksByDefense[defense]?.count ?? 0
            for position in positions {
                let bucket = totals[defense]?[position]
                perGame[defense, default: [:]][position] = (
                    games,
                    bucket?.playerWeeks ?? 0,
                    bucket?.points ?? 0,
                    bucket.flatMap { games > 0 ? $0.points / Double(games) : nil }
                )
            }
        }

        var byDefense: [String: [Position: DefenseCell]] = [:]
        var leagueAverage: [Position: Double] = [:]
        var ranked: [Position: [String]] = [:]

        for position in positions {
            let eligible = perGame
                .compactMap { defense, cells -> (String, Double)? in
                    guard let cell = cells[position], let rate = cell.rate, cell.games >= minimumGames
                    else { return nil }
                    return (defense, rate)
                }
                // Softest first; ties broken by code so ranks are stable.
                .sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }

            let mean = eligible.isEmpty ? nil : eligible.map(\.1).reduce(0, +) / Double(eligible.count)
            if let mean { leagueAverage[position] = mean }
            ranked[position] = eligible.map(\.0)

            let rankByDefense = Dictionary(
                eligible.enumerated().map { ($0.element.0, $0.offset + 1) },
                uniquingKeysWith: { first, _ in first }
            )

            for (defense, cells) in perGame {
                guard let cell = cells[position] else { continue }
                let rank = rankByDefense[defense]
                byDefense[defense, default: [:]][position] = DefenseCell(
                    games: cell.games,
                    playerWeeks: cell.playerWeeks,
                    totalPoints: cell.total,
                    perGame: cell.rate,
                    rank: rank,
                    vsLeagueAverage: rank != nil ? cell.rate.flatMap { rate in mean.map { rate - $0 } } : nil
                )
            }
        }

        return DefenseVsPositionTable(
            byDefense: byDefense,
            leagueAverage: leagueAverage,
            ranked: ranked,
            weeks: weeksSeen.sorted(),
            minimumGames: minimumGames
        )
    }
}
