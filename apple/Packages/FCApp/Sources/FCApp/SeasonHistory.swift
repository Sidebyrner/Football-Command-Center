import Foundation
import FCCore
import FCData

/// One roster's week, as Sleeper reported it after the fact.
public struct RosterWeek: Hashable, Sendable {
    public let week: Int
    public let rosterID: Int
    public let points: Double?
    /// Positionally aligned to the starting slots, `"0"` for unset.
    public let starters: [String]
    public let players: [String]
    /// Per-player points for that week. A player absent from this map is a
    /// player Sleeper gave no number for, which is **not** the same as zero.
    public let playersPoints: [String: Double]

    /// Points for one player, or `nil` when Sleeper reported none.
    public func points(for playerID: String) -> Double? {
        playersPoints[playerID]
    }
}

/// Completed weeks for the whole league.
///
/// A finished week's scores never change, so these are read through
/// `completedMatchups` on the long TTL — the 5-minute roster TTL would have
/// every season aggregate re-fetching every past week every five minutes.
public struct SeasonHistory: Sendable {
    public let weeks: [Int]
    public let byRoster: [Int: [RosterWeek]]
    public let provenance: Provenance

    public static let empty = SeasonHistory(weeks: [], byRoster: [:], provenance: .live)

    public func weeks(forRoster rosterID: Int) -> [RosterWeek] {
        byRoster[rosterID]?.sorted { $0.week < $1.week } ?? []
    }

    /// Every roster's total for one week, for ranking the field.
    public func totals(week: Int) -> [Int: Double] {
        var out: [Int: Double] = [:]
        for (rosterID, weeks) in byRoster {
            if let points = weeks.first(where: { $0.week == week })?.points {
                out[rosterID] = points
            }
        }
        return out
    }

    /// Season points per player id, summed across every loaded week.
    ///
    /// This is the currency draft picks are graded in: what a player actually
    /// produced, not what anyone projected.
    public func actualPointsByPlayer() -> [String: Double] {
        var out: [String: Double] = [:]
        for weeks in byRoster.values {
            for week in weeks {
                for (playerID, points) in week.playersPoints {
                    out[playerID, default: 0] += points
                }
            }
        }
        return out
    }

    /// Loads every completed week up to but not including `currentWeek`.
    ///
    /// The current week is excluded on purpose: it is still being played, so
    /// including it would make "points left on your bench" accuse the user of
    /// a mistake they can still fix.
    public static func load(
        sleeper: SleeperService,
        leagueID: String,
        currentWeek: Int
    ) async -> SeasonHistory {
        let completed = Array(1..<max(1, currentWeek))
        guard !completed.isEmpty else { return .empty }

        var byRoster: [Int: [RosterWeek]] = [:]
        var loaded: [Int] = []
        var provenances: [Provenance] = []

        for week in completed {
            // A week that fails to load is skipped rather than failing the
            // screen — a missing week 3 should not cost the user weeks 1 and 2.
            guard let fetched = try? await sleeper.completedMatchups(
                leagueID: leagueID, week: week
            ) else { continue }

            provenances.append(fetched.provenance)
            loaded.append(week)

            for matchup in fetched.value {
                let entry = RosterWeek(
                    week: week,
                    rosterID: matchup.rosterID,
                    points: matchup.points,
                    starters: matchup.starters ?? [],
                    players: matchup.players ?? [],
                    playersPoints: matchup.playersPoints ?? [:]
                )
                byRoster[matchup.rosterID, default: []].append(entry)
            }
        }

        return SeasonHistory(
            weeks: loaded.sorted(),
            byRoster: byRoster,
            provenance: Provenance.weakest(provenances)
        )
    }
}
