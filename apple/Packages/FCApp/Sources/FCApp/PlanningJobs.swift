import Foundation
import FCCore
import FCData

/// Planning's three jobs, each with the one sentence the screen leads with.
public enum PlanningMode: String, CaseIterable, Hashable, Sendable {
    case byes = "Byes"
    case trades = "Trades"
    case waivers = "Waivers"

    public var purpose: String {
        switch self {
        case .byes: return "Find the weeks you can't field a full lineup, and fix them."
        case .trades: return "Rivals who can spare a player for your problem weeks."
        case .waivers: return "Free agents worth grabbing before the weeks you'll need them."
        }
    }

    public var systemImage: String {
        switch self {
        case .byes: return "calendar.badge.exclamationmark"
        case .trades: return "arrow.left.arrow.right"
        case .waivers: return "tray.and.arrow.down"
        }
    }
}

/// One player the planner is suggesting, whichever job suggested him.
public struct PlanningPlayer: Hashable, Sendable, Identifiable {
    public let id: String
    public let sleeperID: String?
    public let name: String
    public let position: Position
    /// nflverse spelling, current team where Sleeper knows it.
    public let team: String?
    /// Season points per game in the stats season. `nil` for DEF and IDP, which
    /// have no production data — never shown as zero.
    public let pointsPerGame: Double?
    public let signals: [SignalHit]
    public let availability: Availability
    /// Your short weeks this player could actually play in at a position you
    /// need that week.
    public let coversWeeks: [Int]
    /// True when the only evidence is Sleeper's league-wide add count. The UI
    /// must say "popularity only" for these (§3.2).
    public let popularityOnly: Bool
    public let trendingAdds: Int?
}

/// A rival who could cover some of your short weeks from their bench.
public struct TradeTarget: Hashable, Sendable, Identifiable {
    public let rival: LeagueTeam
    /// Your short weeks where this rival is *not* short and has a bench player
    /// at a position you need who plays that week.
    public let weeksCovered: [Int]
    public let candidates: [PlanningPlayer]

    public var id: Int { rival.rosterID }
}

extension PlanningModel {
    // MARK: - Shared

    /// Positions the user needs in a week: dedicated positions that are short,
    /// plus every position eligible for a flex group that is short.
    public func neededPositions(week: Int) -> Set<Position> {
        guard let context, let cell = cell(rosterID: context.userRosterID, week: week) else { return [] }
        return cell.report.neededPositions
    }

    /// The user's short weeks, soonest first.
    var shortWeekNumbers: [Int] {
        userShortWeeks().map(\.week).sorted()
    }

    /// A player's current NFL team in nflverse spelling. Sleeper's team wins over
    /// the stats season's, because players change teams between seasons and a
    /// bye check against last year's team would be wrong.
    func currentTeam(sleeperID: String?, fallback: String?) -> String? {
        guard let context else { return fallback }
        if let sleeperID, let player = context.players[sleeperID] {
            return player.nflverseTeam ?? player.team ?? fallback
        }
        return NFLTeams.nflverse(fallback) ?? fallback
    }

    func coversWeeks(position: Position, team: String?) -> [Int] {
        guard let context else { return [] }
        return shortWeekNumbers.filter { week in
            neededPositions(week: week).contains(position)
                && !context.byeCalendar.isOnBye(team: team, week: week)
        }
    }

    private func signalsByGSIS() -> [String: [SignalHit]] {
        Dictionary(board.map { ($0.id, $0.signals) }, uniquingKeysWith: { first, _ in first })
    }

    /// Everyone with production data, as planning players.
    private func productionPlayers(where include: (Availability) -> Bool) -> [PlanningPlayer] {
        guard let context else { return [] }
        let signals = signalsByGSIS()
        return context.seasonProfiles.compactMap { profile -> PlanningPlayer? in
            let availability = context.availability(ofGSIS: profile.gsisID)
            guard include(availability) else { return nil }
            let sleeperID = context.sleeperIDsByGSIS[profile.gsisID]
            let team = currentTeam(sleeperID: sleeperID, fallback: profile.team)
            return PlanningPlayer(
                id: sleeperID ?? profile.gsisID,
                sleeperID: sleeperID,
                name: context.playerName(sleeperID ?? "") ?? profile.name,
                position: profile.position,
                team: team,
                pointsPerGame: profile.pointsPerGame,
                signals: signals[profile.gsisID] ?? [],
                availability: availability,
                coversWeeks: coversWeeks(position: profile.position, team: team),
                popularityOnly: false,
                trendingAdds: nil
            )
        }
    }

    /// Trending adds nobody in the league rosters. The only signal that covers
    /// DEF and IDP at all, and labelled popularity-only everywhere it appears.
    private func trendingFreeAgents() -> [PlanningPlayer] {
        guard let context else { return [] }
        return trending.compactMap { entry -> PlanningPlayer? in
            guard context.availability(ofSleeperID: entry.playerID) == .freeAgent,
                  let player = context.players[entry.playerID], player.active,
                  let position = player.position
            else { return nil }
            let team = player.nflverseTeam ?? player.team ?? (position == .def ? entry.playerID : nil)
            return PlanningPlayer(
                id: entry.playerID,
                sleeperID: entry.playerID,
                name: player.name,
                position: position,
                team: team,
                pointsPerGame: nil,
                signals: [],
                availability: .freeAgent,
                coversWeeks: coversWeeks(position: position, team: team),
                popularityOnly: true,
                trendingAdds: entry.count
            )
        }
    }

    // MARK: - Byes

    /// Free agents who fix one short week: at a position you're short at that
    /// week, and not on bye that week.
    ///
    /// Free agents only. An earlier version listed anyone not on your roster,
    /// and seeing it with data showed a "Pick up" list headed by rivals'
    /// starters — players nobody can pick up. Rivals' spare players belong to
    /// the Trades job, where they are bench-only and framed as an ask.
    ///
    /// Positions with production data are ranked by season points per game;
    /// DEF and IDP can only come from trending adds, labelled popularity only.
    public func pickups(for week: Int, limit: Int = 8) -> [PlanningPlayer] {
        guard let context else { return [] }
        let needed = neededPositions(week: week)
        guard !needed.isEmpty else { return [] }

        func playsThatWeek(_ player: PlanningPlayer) -> Bool {
            !context.byeCalendar.isOnBye(team: player.team, week: week)
        }

        let production = productionPlayers { $0 == .freeAgent }
            .filter { needed.contains($0.position) && playsThatWeek($0) }
            .sorted { ($0.pointsPerGame ?? 0) > ($1.pointsPerGame ?? 0) }
            .prefix(limit)

        let popularity = trendingFreeAgents()
            .filter { needed.contains($0.position) && !$0.position.hasWeeklyProductionData && playsThatWeek($0) }

        return Array(production) + popularity
    }

    // MARK: - Trades

    /// Rivals ranked by how many of your short weeks they can cover.
    ///
    /// A rival qualifies for a week when they are *not* short that week and have
    /// a **bench** player at a position you need who plays that week. Bench, not
    /// starters: a bench player is one a rival can spare without breaking their
    /// own lineup, which is what makes the ask realistic.
    public func buildTradeTargets() -> [TradeTarget] {
        guard let context else { return [] }
        let shortWeeks = shortWeekNumbers
        guard !shortWeeks.isEmpty else { return [] }

        let profileBySleeper: [String: SeasonProfile] = {
            let byGSIS = Dictionary(context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
            return context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
                if let profile = byGSIS[pair.key] { out[pair.value] = profile }
            }
        }()

        var targets: [TradeTarget] = []
        for rival in context.rivals {
            let starters = Set(rival.starterIDs)
            var candidateWeeks: [String: [Int]] = [:]

            for week in shortWeeks {
                guard let cell = cell(rosterID: rival.rosterID, week: week), !cell.isShort else { continue }
                let needed = neededPositions(week: week)
                for entry in rival.roster where !starters.contains(entry.id) {
                    guard let position = entry.position, needed.contains(position),
                          !context.byeCalendar.isOnBye(team: entry.team, week: week)
                    else { continue }
                    candidateWeeks[entry.id, default: []].append(week)
                }
            }

            guard !candidateWeeks.isEmpty else { continue }

            let candidates = candidateWeeks.compactMap { id, weeks -> PlanningPlayer? in
                guard let position = context.position(id) else { return nil }
                let profile = profileBySleeper[id]
                return PlanningPlayer(
                    id: id,
                    sleeperID: id,
                    name: context.playerName(id) ?? id,
                    position: position,
                    team: currentTeam(sleeperID: id, fallback: profile?.team),
                    pointsPerGame: profile?.pointsPerGame,
                    signals: [],
                    availability: .rivalBench(rosterID: rival.rosterID, manager: rival.manager),
                    coversWeeks: weeks.sorted(),
                    popularityOnly: false,
                    trendingAdds: nil
                )
            }
            .sorted {
                if $0.coversWeeks.count != $1.coversWeeks.count { return $0.coversWeeks.count > $1.coversWeeks.count }
                return ($0.pointsPerGame ?? -1) > ($1.pointsPerGame ?? -1)
            }

            targets.append(
                TradeTarget(
                    rival: rival,
                    weeksCovered: Array(Set(candidateWeeks.values.flatMap { $0 })).sorted(),
                    candidates: candidates
                )
            )
        }

        return targets.sorted {
            if $0.weeksCovered.count != $1.weeksCovered.count { return $0.weeksCovered.count > $1.weeksCovered.count }
            return ($0.candidates.first?.pointsPerGame ?? -1) > ($1.candidates.first?.pointsPerGame ?? -1)
        }
    }

    // MARK: - Waivers

    /// Free agents with production data who would fill at least one of your
    /// short weeks — most weeks covered first, then season points per game.
    public func buildWaiverFills(limit: Int = 12) -> [PlanningPlayer] {
        productionPlayers { $0 == .freeAgent }
            .filter { !$0.coversWeeks.isEmpty }
            .sorted {
                if $0.coversWeeks.count != $1.coversWeeks.count { return $0.coversWeeks.count > $1.coversWeeks.count }
                return ($0.pointsPerGame ?? 0) > ($1.pointsPerGame ?? 0)
            }
            .prefix(limit)
            .map { $0 }
    }

    /// Trending free agents, those covering a short week first.
    public func buildWaiverTrending() -> [PlanningPlayer] {
        trendingFreeAgents().sorted {
            if $0.coversWeeks.count != $1.coversWeeks.count { return $0.coversWeeks.count > $1.coversWeeks.count }
            return ($0.trendingAdds ?? 0) > ($1.trendingAdds ?? 0)
        }
    }

    /// When nothing is short, the waiver job is simply "who's worth having":
    /// the best free agents by season points per game.
    public func buildBestAvailable(limit: Int = 10) -> [PlanningPlayer] {
        productionPlayers { $0 == .freeAgent }
            .sorted { ($0.pointsPerGame ?? 0) > ($1.pointsPerGame ?? 0) }
            .prefix(limit)
            .map { $0 }
    }
}
