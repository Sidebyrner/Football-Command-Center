import Foundation
import FCCore
import FCData

/// Turns a league context and this week's game contexts into RB stream
/// candidates: every back with a real role this season, plus everyone on the
/// user's roster and anyone the user picked.
///
/// Everything comes from Sleeper's weekly lines — carries, rushing first
/// downs, red-zone carries, the longest run, targets — with team rush and
/// pass volume summed from every player on the team. Pure, so it is tested
/// directly against recorded lines.
struct RBCandidateBuilder {
    let context: LeagueContext
    let teams: [String: RBTeamContext]
    let players: [String: RBPlayerOverride]
    var alwaysInclude: Set<String> = []

    /// A back below all three floors is a depth body rather than a stream.
    static let minimumCarryShare = 0.12
    static let minimumTargetShare = 0.08
    static let minimumSnapShare = 0.35

    var statWeeks: [Int] {
        context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
    }

    /// Per team-week totals every back on the team shares.
    struct TeamWeek {
        var rushAttempts = 0.0
        var passAttempts = 0.0
        var targets = 0.0
        var redZoneCarries = 0.0
    }

    func teamWeeks() -> [String: [Int: TeamWeek]] {
        var out: [String: [Int: TeamWeek]] = [:]
        for week in statWeeks {
            for line in (context.inSeason.weekStats[week] ?? [:]).values {
                guard let team = NFLTeams.nflverse(line.team) else { continue }
                var totals = out[team]?[week] ?? TeamWeek()
                totals.rushAttempts += line.stats["rush_att"] ?? 0
                totals.passAttempts += line.stats["pass_att"] ?? 0
                totals.targets += line.stats["rec_tgt"] ?? 0
                totals.redZoneCarries += line.stats["rush_rz_att"] ?? 0
                out[team, default: [:]][week] = totals
            }
        }
        return out
    }

    func candidates() -> [RBCandidate] {
        let totals = teamWeeks()
        let mine = Set(context.userTeam?.roster.map(\.id) ?? [])
        return context.players.players(at: .rb)
            .compactMap { candidate(for: $0, totals: totals, isMine: mine.contains($0.id)) }
            .sorted { $0.name < $1.name }
    }

    private func candidate(for player: IndexedPlayer, totals: [String: [Int: TeamWeek]], isMine: Bool) -> RBCandidate? {
        let override = players[player.id]
        guard let team = player.nflverseTeam else { return nil }
        let teamTotals = totals[team] ?? [:]

        var carryShares: [Double] = [], targetShares: [Double] = [], snapShares: [Double] = []
        var carries = 0.0, rushYards = 0.0, rushTouchdowns = 0.0
        var rushFirstDowns = 0.0, sawRushFirstDowns = false
        var runs30 = 0.0, runs40 = 0.0, runs50 = 0.0
        var targets = 0.0, receptions = 0.0, receivingYards = 0.0, receivingTouchdowns = 0.0
        var receivingFirstDowns = 0.0, sawReceivingFirstDowns = false
        var redZone = 0.0, teamRedZone = 0.0
        var games = 0
        for week in statWeeks {
            guard let line = context.inSeason.weekStats[week]?[player.id] else { continue }
            let s = line.stats
            let att = s["rush_att"] ?? 0, tgt = s["rec_tgt"] ?? 0
            guard (s["off_snp"] ?? 0) > 0 || att > 0 || tgt > 0 else { continue }
            games += 1
            let teamWeek = teamTotals[week] ?? TeamWeek()
            if teamWeek.rushAttempts > 0 { carryShares.append(att / teamWeek.rushAttempts) }
            if teamWeek.targets > 0 { targetShares.append(tgt / teamWeek.targets) }
            if let share = line.offensiveSnapShare { snapShares.append(share) }
            carries += att
            rushYards += s["rush_yd"] ?? 0
            rushTouchdowns += s["rush_td"] ?? 0
            if let fd = s["rush_fd"] { rushFirstDowns += fd; sawRushFirstDowns = true }
            // Sleeper has no long-run buckets; the longest run is the only
            // evidence, so these are lower bounds.
            let longest = s["rush_lng"] ?? 0
            if longest >= 30 { runs30 += 1 }
            if longest >= 40 { runs40 += 1 }
            if longest >= 50 { runs50 += 1 }
            targets += tgt
            receptions += s["rec"] ?? 0
            receivingYards += s["rec_yd"] ?? 0
            receivingTouchdowns += s["rec_td"] ?? 0
            if let fd = s["rec_fd"] { receivingFirstDowns += fd; sawReceivingFirstDowns = true }
            redZone += s["rush_rz_att"] ?? 0
            teamRedZone += teamWeek.redZoneCarries
        }

        func recent(_ shares: [Double]) -> (last1: Double?, last3: Double?) {
            guard !shares.isEmpty else { return (nil, nil) }
            let window = shares.suffix(3)
            return (shares.last, window.reduce(0, +) / Double(window.count))
        }
        let carry = recent(carryShares), target = recent(targetShares), snap = recent(snapShares)
        let hasRole = max(carry.last1 ?? 0, carry.last3 ?? 0) >= Self.minimumCarryShare
            || max(target.last1 ?? 0, target.last3 ?? 0) >= Self.minimumTargetShare
            || (snap.last3 ?? 0) >= Self.minimumSnapShare
            || override?.carryShareEst != nil
        guard isMine || hasRole || alwaysInclude.contains(player.id) else { return nil }

        let redZoneShare = override?.redZoneShare ?? (teamRedZone > 0 ? redZone / teamRedZone : nil)
        var flags: [String] = []
        if override?.role == nil { flags.append(games > 0 ? "role inferred from usage" : "role defaulted — no games yet") }
        if games == 0 { flags.append("no games recorded this season") }
        if runs30 > 0 { flags.append("long runs counted from longest run only") }

        let passWeeks = teamTotals.values.filter { $0.passAttempts > 0 }
        var teamPassAttempts = passWeeks.reduce(0) { $0 + $1.passAttempts }
        if passWeeks.isEmpty, !teamTotals.isEmpty {
            teamPassAttempts = teamTotals.values.reduce(0) { $0 + $1.targets } / 0.95
            flags.append("team pass attempts estimated from targets")
        }
        let teamRushAttempts = teamTotals.values.reduce(0) { $0 + $1.rushAttempts }

        let game = teams[team]
        var practice = override?.practice ?? StreamPracticeMapper.status(player, context: context)
        if game == nil {
            practice = .OUT
            flags.append("bye week")
        } else if game?.linesSource == .standard {
            flags.append("no recorded line — neutral spread and total")
        }

        let steady = carryShares.count >= 2 && abs((carry.last1 ?? 0) - (carry.last3 ?? 0)) < 0.08
        let roleConf = override?.roleConf ?? (steady ? 0.8 : games > 0 ? 0.65 : 0.5)
        var sources = ["Sleeper weekly stats"]
        if context.practiceReport(sleeperID: player.id) != nil { sources.append("nflverse practice report") }

        return RBCandidate(
            name: player.name,
            team: team,
            role: override?.role ?? Self.inferRole(carryShare: carry.last3, targetShare: target.last3, redZoneShare: redZoneShare),
            opponent: game?.opponentLabel ?? "BYE",
            home: game?.home,
            spreadOff: game?.spreadOff ?? 0,
            total: game?.total ?? RBContextAutofill.neutralTotal,
            teamRushAttempts: teamRushAttempts,
            teamPassAttempts: teamPassAttempts,
            teamGames: teamTotals.count,
            carryShareLast1: carry.last1,
            carryShareLast3: carry.last3,
            carryShareEst: override?.carryShareEst,
            targetShareLast1: target.last1,
            targetShareLast3: target.last3,
            snapShare: snap.last3,
            roleConf: roleConf,
            redZoneShare: redZoneShare,
            statCarries: carries,
            rushYards: rushYards,
            rushFirstDowns: sawRushFirstDowns ? rushFirstDowns : nil,
            rushTouchdowns: rushTouchdowns,
            runs30: runs30,
            runs40: runs40,
            runs50: runs50,
            statTargets: targets,
            receptions: games > 0 ? receptions : nil,
            receivingYards: receivingYards,
            receivingFirstDowns: sawReceivingFirstDowns ? receivingFirstDowns : nil,
            receivingTouchdowns: receivingTouchdowns,
            dvpPct: game?.dvpPct ?? 0,
            dvpGames: game?.dvpPct == nil ? 0 : (game?.dvpGames ?? 0),
            lineAdj: game?.lineAdj ?? 1,
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

    /// The role a back's usage points to.
    static func inferRole(carryShare: Double?, targetShare: Double?, redZoneShare: Double?) -> RBRole {
        let carries = carryShare ?? 0, targets = targetShare ?? 0
        if carries >= 0.58 { return .bellcow }
        if carries >= 0.45 { return .lead }
        if carries < 0.28 && targets >= 0.08 { return .passDown }
        if carries < 0.30, let rz = redZoneShare, rz >= 0.40 { return .goalLine }
        return .committee
    }
}
