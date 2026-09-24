import Foundation
import FCCore
import FCData

/// Turns a league context and this week's game contexts into IDP stream
/// candidates: every defender with a real role this season, plus everyone on
/// the user's roster so the starter being replaced is always in the report.
///
/// Pure — no I/O — so it is tested directly against recorded Sleeper lines.
struct IDPCandidateBuilder {
    let context: LeagueContext
    let teams: [String: IDPTeamContext]
    let players: [String: IDPPlayerOverride]
    /// Players the user picked — the starter to beat, anyone being compared —
    /// who are projected even below the snap-share floor.
    var alwaysInclude: Set<String> = []

    /// Below this snap share, in both the last game and the last three, a
    /// defender is a rotational body rather than a stream.
    static let minimumSnapShare = 0.35

    /// Weeks with stats that are over: every week before the one being played.
    var statWeeks: [Int] {
        context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
    }

    /// Plays each defense has faced per week, from the team snap count on any
    /// of its defenders' lines. Team-level, so a player who missed a game does
    /// not change his team's pace.
    func teamDefensivePlays() -> [String: [Int: Double]] {
        var out: [String: [Int: Double]] = [:]
        for week in statWeeks {
            for line in (context.inSeason.weekStats[week] ?? [:]).values {
                guard let team = NFLTeams.nflverse(line.team), let plays = line.stats["tm_def_snp"], plays > 0 else { continue }
                out[team, default: [:]][week] = max(out[team]?[week] ?? 0, plays)
            }
        }
        return out
    }

    func candidates() -> [IDPCandidate] {
        let weeks = statWeeks
        let pace = teamDefensivePlays()
        let mine = Set(context.userTeam?.roster.map(\.id) ?? [])
        var out: [IDPCandidate] = []

        for position in [Position.lb, .dl, .db] {
            for player in context.players.players(at: position) {
                if let candidate = candidate(for: player, weeks: weeks, pace: pace, isMine: mine.contains(player.id)) {
                    out.append(candidate)
                }
            }
        }
        return out.sorted { $0.name < $1.name }
    }

    private func candidate(for player: IndexedPlayer, weeks: [Int], pace: [String: [Int: Double]], isMine: Bool) -> IDPCandidate? {
        let override = players[player.id]
        guard let team = player.nflverseTeam else { return nil }
        guard let resolved = IDPSubPosition.resolve(positionCode: player.positionCode, depthChartPosition: player.depthChartPosition) else { return nil }

        // Season-to-date evidence over the weeks he actually played.
        var shares: [Double] = []
        var statSnaps = 0.0
        var solo = 0.0, ast = 0.0, combined = 0.0, hasSplit = false
        var sacks = 0.0, tfl = 0.0, pd = 0.0, int = 0.0, ff = 0.0, qbHits = 0.0
        for week in weeks {
            guard let line = context.inSeason.weekStats[week]?[player.id],
                  let share = line.defensiveSnapShare else { continue }
            let s = line.stats
            shares.append(share)
            statSnaps += s["def_snp"] ?? 0
            if s["idp_tkl_solo"] != nil || s["idp_tkl_ast"] != nil { hasSplit = true }
            solo += s["idp_tkl_solo"] ?? 0
            ast += s["idp_tkl_ast"] ?? 0
            combined += s["idp_tkl"] ?? ((s["idp_tkl_solo"] ?? 0) + (s["idp_tkl_ast"] ?? 0))
            sacks += s["idp_sack"] ?? 0
            tfl += s["idp_tkl_loss"] ?? 0
            pd += s["idp_pass_def"] ?? 0
            int += s["idp_int"] ?? 0
            ff += s["idp_ff"] ?? 0
            qbHits += s["idp_qb_hit"] ?? 0
        }

        let last1 = shares.last
        let last3 = shares.isEmpty ? nil : shares.suffix(3).reduce(0, +) / Double(shares.suffix(3).count)
        let hasRole = max(last1 ?? 0, last3 ?? 0) >= Self.minimumSnapShare || override?.snapShareEst != nil
        guard isMine || hasRole || alwaysInclude.contains(player.id) else { return nil }

        var flags: [String] = []
        if resolved.inferred {
            flags.append(resolved.position == .safetyBox
                ? "alignment not listed — treated as a box safety"
                : "alignment not listed — treated as an edge")
        }
        if shares.isEmpty { flags.append("no snaps recorded this season") }

        // Game context; a team with no game is on bye.
        let game = teams[team]
        var practice = override?.practice ?? practiceStatus(player)
        if game == nil {
            practice = .OUT
            flags.append("bye week")
        } else if game?.linesSource == .standard {
            flags.append("no recorded line — neutral spread and total")
        }

        let teamWeeks = pace[team] ?? [:]
        let availability = context.availability(ofSleeperID: player.id)
        let l1Value = last1 ?? 0, l3Value = last3 ?? 0
        let roleConf = override?.roleConf
            ?? (l1Value >= 0.85 && l3Value >= 0.8 ? 0.85 : l1Value >= 0.65 ? 0.7 : 0.5)
        let dvp = game?.dvpPct[resolved.position.platform]
        var sources = ["Sleeper weekly stats"]
        if context.practiceReport(sleeperID: player.id) != nil { sources.append("nflverse practice report") }

        return IDPCandidate(
            name: player.name,
            team: team,
            position: override?.position ?? resolved.position,
            opponent: game?.opponentLabel ?? "BYE",
            home: game?.home,
            spreadDef: game?.spreadDef ?? 0,
            total: game?.total ?? IDPContextAutofill.neutralTotal,
            teamDefPlays: teamWeeks.values.reduce(0, +),
            teamGames: teamWeeks.count,
            snapShareLast1: last1,
            snapShareLast3: last3,
            snapShareEst: override?.snapShareEst,
            roleConf: roleConf,
            statSnaps: statSnaps,
            solo: hasSplit ? solo : nil,
            ast: hasSplit ? ast : nil,
            comb: hasSplit ? nil : (shares.isEmpty ? nil : combined),
            sacks: sacks, tfl: tfl, pd: pd, int: int, ff: ff, qbHits: qbHits,
            pressures: override?.pressures,
            dvpPct: dvp ?? 0,
            dvpGames: dvp == nil ? 0 : (game?.dvpGames ?? 0),
            oppSackEnv: game?.oppSackEnv ?? 1,
            practice: practice,
            rosterPct: nil,
            // Read from the league's own rosters, so never unverified.
            available: availability == .freeAgent,
            notes: override?.notes ?? "",
            sources: sources,
            dataFlags: flags,
            playerID: player.id
        )
    }

    /// The official report first — a game designation outranks a practice
    /// line — then Sleeper's own injury tag.
    private func practiceStatus(_ player: IndexedPlayer) -> IDPPractice {
        if let report = context.practiceReport(sleeperID: player.id) {
            switch report.designation {
            case .out: return .OUT
            case .doubtful: return .D
            case .questionable: return .Q
            case nil: break
            }
            switch report.practice {
            case .didNotParticipate: return .DNP
            case .limited: return .LP
            case .full: return .FP
            case nil: break
            }
        }
        switch player.injuryStatus?.lowercased() {
        case "ir", "pup", "pup-r", "nfi", "nfi-r": return .IR
        case "out", "sus", "cov": return .OUT
        case "doubtful": return .D
        case "questionable": return .Q
        default: return .none
        }
    }
}
