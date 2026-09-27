import Foundation
import FCCore
import FCData

/// Turns a league context and this week's game contexts into WR stream
/// candidates: every receiver with a real role this season, plus everyone on
/// the user's roster and anyone the user picked.
///
/// Everything comes from Sleeper's weekly lines — targets, first downs, air
/// yards, red-zone targets, the 30–39 / 40+ catch buckets, snaps — and team
/// pass attempts from the quarterbacks' lines. Pure, so it is tested directly
/// against recorded lines.
struct WRCandidateBuilder {
    let context: LeagueContext
    let teams: [String: WRTeamContext]
    let players: [String: WRPlayerOverride]
    var alwaysInclude: Set<String> = []

    /// A receiver below both floors is a depth body rather than a stream.
    static let minimumTargetShare = 0.08
    static let minimumSnapShare = 0.40

    /// Weeks with stats that are over: every week before the one being played.
    var statWeeks: [Int] {
        context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
    }

    /// Per team-week totals every receiver on the team shares.
    struct TeamWeek {
        var targets = 0.0
        var redZoneTargets = 0.0
        var passAttempts = 0.0
    }

    func teamWeeks() -> [String: [Int: TeamWeek]] {
        var out: [String: [Int: TeamWeek]] = [:]
        for week in statWeeks {
            for line in (context.inSeason.weekStats[week] ?? [:]).values {
                guard let team = NFLTeams.nflverse(line.team) else { continue }
                var totals = out[team]?[week] ?? TeamWeek()
                totals.targets += line.stats["rec_tgt"] ?? 0
                totals.redZoneTargets += line.stats["rec_rz_tgt"] ?? 0
                totals.passAttempts += line.stats["pass_att"] ?? 0
                out[team, default: [:]][week] = totals
            }
        }
        return out
    }

    func candidates() -> [WRCandidate] {
        let totals = teamWeeks()
        let mine = Set(context.userTeam?.roster.map(\.id) ?? [])
        return context.players.players(at: .wr)
            .compactMap { candidate(for: $0, totals: totals, isMine: mine.contains($0.id)) }
            .sorted { $0.name < $1.name }
    }

    private func candidate(for player: IndexedPlayer, totals: [String: [Int: TeamWeek]], isMine: Bool) -> WRCandidate? {
        let override = players[player.id]
        guard let team = player.nflverseTeam else { return nil }
        let teamTotals = totals[team] ?? [:]

        var shares: [Double] = []
        var snapShares: [Double] = []
        var targets = 0.0, receptions = 0.0, yards = 0.0, touchdowns = 0.0
        var firstDowns = 0.0, sawFirstDowns = false
        var catches30 = 0.0, catches40 = 0.0, catches50 = 0.0
        var airYards = 0.0, redZone = 0.0, teamRedZone = 0.0
        var rushAttempts = 0.0, rushYards = 0.0, rushFirstDowns = 0.0
        var games = 0
        for week in statWeeks {
            guard let line = context.inSeason.weekStats[week]?[player.id] else { continue }
            let s = line.stats
            let tgt = s["rec_tgt"] ?? 0
            guard (s["off_snp"] ?? 0) > 0 || tgt > 0 else { continue }
            games += 1
            if let teamTargets = teamTotals[week]?.targets, teamTargets > 0 { shares.append(tgt / teamTargets) }
            if let share = line.offensiveSnapShare { snapShares.append(share) }
            targets += tgt
            receptions += s["rec"] ?? 0
            yards += s["rec_yd"] ?? 0
            touchdowns += s["rec_td"] ?? 0
            if let fd = s["rec_fd"] { firstDowns += fd; sawFirstDowns = true }
            // Sleeper's buckets: 30–39 is a range, 40+ a threshold. The engine
            // wants cumulative counts. There is no 50+ catch bucket, so the
            // longest catch is the only 50+ evidence — a lower bound.
            catches30 += (s["rec_30_39"] ?? 0) + (s["rec_40p"] ?? 0)
            catches40 += s["rec_40p"] ?? 0
            if (s["rec_lng"] ?? 0) >= 50 { catches50 += 1 }
            airYards += s["rec_air_yd"] ?? 0
            redZone += s["rec_rz_tgt"] ?? 0
            teamRedZone += teamTotals[week]?.redZoneTargets ?? 0
            rushAttempts += s["rush_att"] ?? 0
            rushYards += s["rush_yd"] ?? 0
            rushFirstDowns += s["rush_fd"] ?? 0
        }

        let last1 = shares.last
        let last3 = shares.isEmpty ? nil : shares.suffix(3).reduce(0, +) / Double(shares.suffix(3).count)
        let snapShare = snapShares.isEmpty ? nil : snapShares.suffix(3).reduce(0, +) / Double(snapShares.suffix(3).count)
        let hasRole = max(last1 ?? 0, last3 ?? 0) >= Self.minimumTargetShare || (snapShare ?? 0) >= Self.minimumSnapShare
            || override?.targetShareEst != nil
        guard isMine || hasRole || alwaysInclude.contains(player.id) else { return nil }

        var flags: [String] = []
        let adot = targets > 0 ? airYards / targets : nil
        let rushPerGame = games > 0 ? rushAttempts / Double(games) : 0
        let inferred = Self.inferRole(targetShare: last3, adot: adot, rushPerGame: rushPerGame)
        if override?.role == nil { flags.append(games > 0 ? "role inferred from usage" : "role defaulted — no games yet") }
        if games == 0 { flags.append("no games recorded this season") }
        if snapShare != nil { flags.append("route share from snap share") }
        if catches50 > 0 { flags.append("50+ catches counted from longest catch only") }

        // Team pass attempts from the quarterbacks; targets stand in without them.
        let passWeeks = teamTotals.values.filter { $0.passAttempts > 0 }
        var teamPassAttempts = passWeeks.reduce(0) { $0 + $1.passAttempts }
        var teamGames = passWeeks.count
        if passWeeks.isEmpty, !teamTotals.isEmpty {
            teamPassAttempts = teamTotals.values.reduce(0) { $0 + $1.targets } / 0.95
            teamGames = teamTotals.count
            flags.append("team pass attempts estimated from targets")
        }

        let game = teams[team]
        var practice = override?.practice ?? StreamPracticeMapper.status(player, context: context)
        if game == nil {
            practice = .OUT
            flags.append("bye week")
        } else if game?.linesSource == .standard {
            flags.append("no recorded line — neutral spread and total")
        }

        let steady = shares.count >= 2 && abs((last1 ?? 0) - (last3 ?? 0)) < 0.05
        let roleConf = override?.roleConf ?? (steady ? 0.8 : games > 0 ? 0.7 : 0.5)
        var sources = ["Sleeper weekly stats"]
        if context.practiceReport(sleeperID: player.id) != nil { sources.append("nflverse practice report") }

        return WRCandidate(
            name: player.name,
            team: team,
            role: override?.role ?? inferred,
            opponent: game?.opponentLabel ?? "BYE",
            home: game?.home,
            spreadOff: game?.spreadOff ?? 0,
            total: game?.total ?? WRContextAutofill.neutralTotal,
            teamPassAttempts: teamPassAttempts,
            teamGames: teamGames,
            targetShareLast1: last1,
            targetShareLast3: last3,
            targetShareEst: override?.targetShareEst,
            routeShare: snapShare,
            roleConf: roleConf,
            redZoneShare: override?.redZoneShare ?? (teamRedZone > 0 ? redZone / teamRedZone : nil),
            statTargets: targets,
            receptions: games > 0 ? receptions : nil,
            receivingYards: yards,
            firstDowns: sawFirstDowns ? firstDowns : nil,
            touchdowns: touchdowns,
            catches30: catches30,
            catches40: catches40,
            catches50: catches50,
            adot: adot,
            rushAttemptsPerGame: override?.rushAttemptsPerGame ?? rushPerGame,
            rushYardsPerCarry: rushAttempts > 0 ? rushYards / rushAttempts : 6,
            rushFirstDownRate: rushAttempts > 0 ? rushFirstDowns / rushAttempts : 0.25,
            dvpPct: game?.dvpPct ?? 0,
            dvpGames: game?.dvpPct == nil ? 0 : (game?.dvpGames ?? 0),
            coverageAdj: game?.coverageAdj ?? 1,
            practice: practice,
            rosterPct: nil,
            // Read from the league's own rosters, so never unverified.
            available: context.availability(ofSleeperID: player.id) == .freeAgent,
            notes: override?.notes ?? "",
            sources: sources,
            dataFlags: flags,
            playerID: player.id
        )
    }

    /// The role a receiver's usage points to: jet-sweep or screen usage, a
    /// deep low-volume role, a true WR1 share, a short slot aDOT, else outside.
    static func inferRole(targetShare: Double?, adot: Double?, rushPerGame: Double) -> WRRole {
        let share = targetShare ?? 0
        if rushPerGame >= 1 || (adot.map { $0 < 5 } ?? false) { return .gadget }
        if let adot, adot >= 14, share < 0.18 { return .deep }
        if share >= 0.24 { return .alpha }
        if let adot, adot < 9 { return .slot }
        return .boundary
    }
}
