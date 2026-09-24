import Foundation
import FCCore
import FCData

/// Every player's current-season grade metrics, the cohorts they rank
/// against, and the team-level numbers the situation chips compare. Built once
/// per league context from Sleeper's stat lines, the usage file and the team
/// context file — all this season, all real, nothing defaulted.
public struct GradeContext: Sendable {
    public let metricsByPlayer: [String: [GradeMetric: Double]]
    public let cohorts: [Position: [GradeMetric: [Double]]]
    /// Players who qualified for their position's cohort.
    public let qualified: Set<String>
    let profile: ScoringProfile
    let context: LeagueContext
    /// Per player: season snap shares by week, for the trend chip.
    let snapSharesByPlayer: [String: [Double]]
    /// Per team: this season's targets, air yards and red zone touches, and
    /// targets by player.
    let teamTotals: [String: TeamTotals]
    let playerTeam: [String: String]
    let playerTotals: [String: Totals]

    struct Totals: Sendable {
        var games = 0
        var sums: [String: Double] = [:]
        var points = 0.0
        subscript(_ key: String) -> Double { sums[key] ?? 0 }
    }

    struct TeamTotals: Sendable {
        var targets = 0.0
        var airYards = 0.0
        var redZone = 0.0
        var targetsByPlayer: [String: Double] = [:]
    }

    /// Minimum average snap share to join an offensive or IDP cohort; below it
    /// a player's rates are noise from a handful of snaps.
    public static let minimumSnapShare = 0.25

    public static func build(context: LeagueContext) -> GradeContext {
        let scoring = context.league.scoringSettings ?? [:]
        var totals: [String: Totals] = [:]
        var positions: [String: Position] = [:]
        var teamOf: [String: String] = [:]
        var teams: [String: TeamTotals] = [:]
        var snaps: [String: [Double]] = [:]

        for week in context.inSeason.statWeeks {
            guard let lines = context.inSeason.weekStats[week] else { continue }
            for line in lines.values where line.played {
                guard let position = line.position else { continue }
                let id = line.playerID
                positions[id] = position
                var t = totals[id] ?? Totals()
                t.games += 1
                t.points += line.score(scoring: scoring).points
                for (key, value) in line.stats { t.sums[key, default: 0] += value }
                totals[id] = t

                let share = Position.idp.contains(position) ? line.defensiveSnapShare : line.offensiveSnapShare
                if let share { snaps[id, default: []].append(share) }

                if let team = line.team.map({ NFLTeams.nflverse($0) ?? $0 }) {
                    teamOf[id] = team
                    var tt = teams[team] ?? TeamTotals()
                    let targets = line.stats["rec_tgt"] ?? 0
                    tt.targets += targets
                    tt.airYards += line.stats["rec_air_yd"] ?? 0
                    tt.redZone += (line.stats["rec_rz_tgt"] ?? 0) + (line.stats["rush_rz_att"] ?? 0)
                    if targets > 0 { tt.targetsByPlayer[id, default: 0] += targets }
                    teams[team] = tt
                }
            }
        }

        let gsisBySleeper = context.gsisIDsBySleeper
        var metrics: [String: [GradeMetric: Double]] = [:]
        var qualified: Set<String> = []
        var cohorts: [Position: [GradeMetric: [Double]]] = [:]

        for (id, t) in totals {
            guard let position = positions[id], t.games > 0 else { continue }
            let g = Double(t.games)
            var m: [GradeMetric: Double] = [:]
            m[.pointsPerGame] = t.points / g
            let shares = snaps[id] ?? []
            let snapShare = shares.isEmpty ? nil : shares.reduce(0, +) / Double(shares.count)

            switch position {
            case .qb, .rb, .wr, .te:
                if let snapShare { m[.snapShare] = snapShare }
                let rushAtt = t["rush_att"], rec = t["rec"], tgt = t["rec_tgt"]
                m[.touchesPerGame] = (rushAtt + rec) / g
                m[.rushAttemptsPerGame] = rushAtt / g
                m[.targetsPerGame] = tgt / g
                m[.redZoneTouchesPerGame] = (t["rec_rz_tgt"] + t["rush_rz_att"]) / g
                if let team = teamOf[id], let tt = teams[team] {
                    if tt.targets > 0 { m[.targetShare] = tgt / tt.targets }
                    if tt.airYards > 0 { m[.airYardsShare] = t["rec_air_yd"] / tt.airYards }
                }
                if tgt >= 5 {
                    m[.yardsPerTarget] = t["rec_yd"] / tgt
                    m[.catchRate] = rec / tgt
                    if t.sums["rec_drop"] != nil { m[.dropRate] = t["rec_drop"] / tgt }
                }
                if position == .qb, t["pass_att"] >= 10 {
                    let att = t["pass_att"]
                    m[.completionPct] = t["pass_cmp"] / att
                    m[.yardsPerAttempt] = t["pass_yd"] / att
                    m[.interceptionRate] = t["pass_int"] / att
                    m[.sackRate] = t["pass_sack"] / (att + t["pass_sack"])
                    m[.passerRating] = Self.passerRating(cmp: t["pass_cmp"], att: att, yds: t["pass_yd"], td: t["pass_td"], int: t["pass_int"])
                }
                if let gsis = gsisBySleeper[id], let usage = context.inSeason.usage?.weeks(for: gsis), !usage.isEmpty {
                    let xfp = usage.compactMap(\.expectedPoints)
                    if !xfp.isEmpty { m[.expectedPointsPerGame] = xfp.reduce(0, +) / Double(xfp.count) }
                    let ybc = usage.compactMap(\.yardsBeforeContactPerAttempt)
                    if !ybc.isEmpty { m[.yardsBeforeContact] = ybc.reduce(0, +) / Double(ybc.count) }
                    let yac = usage.compactMap(\.yardsAfterContactPerAttempt)
                    if !yac.isEmpty { m[.yardsAfterContact] = yac.reduce(0, +) / Double(yac.count) }
                    let broken = usage.compactMap(\.brokenTackles)
                    let touches = rushAtt + rec
                    if !broken.isEmpty, touches >= 10 { m[.brokenTacklesPerTouch] = broken.reduce(0, +) / touches }
                }
                let qualifies = (snapShare ?? 0) >= minimumSnapShare || (position == .qb && t["pass_att"] >= 10 * g)
                if qualifies { qualified.insert(id) }
            case .k:
                if t["fga"] > 0 { m[.fieldGoalPct] = t["fgm"] / t["fga"] }
                m[.fieldGoalAttemptsPerGame] = t["fga"] / g
                if t["fga"] + t["xpa"] > 0 { qualified.insert(id) }
            case .def:
                m[.pointsAllowedPerGame] = t["pts_allow"] / g
                m[.takeawaysPerGame] = (t["int"] + t["fum_rec"]) / g
                m[.defensiveSacksPerGame] = t["sack"] / g
                qualified.insert(id)
            case .lb, .dl, .db:
                if let snapShare { m[.defensiveSnapShare] = snapShare }
                let tackles = t.sums["idp_tkl"] ?? (t["idp_tkl_solo"] + t["idp_tkl_ast"])
                m[.tacklesPerGame] = tackles / g
                m[.sacksPerGame] = t["idp_sack"] / g
                m[.passesDefendedPerGame] = t["idp_pass_def"] / g
                if (snapShare ?? 0) >= minimumSnapShare { qualified.insert(id) }
            }
            metrics[id] = m
            if qualified.contains(id) {
                for (metric, value) in m where value.isFinite {
                    cohorts[position, default: [:]][metric, default: []].append(value)
                }
            }
        }
        for position in cohorts.keys {
            for metric in cohorts[position]!.keys { cohorts[position]![metric]!.sort() }
        }

        return GradeContext(
            metricsByPlayer: metrics, cohorts: cohorts, qualified: qualified,
            profile: context.scoring.profile, context: context,
            snapSharesByPlayer: snaps, teamTotals: teams, playerTeam: teamOf, playerTotals: totals
        )
    }

    static func passerRating(cmp: Double, att: Double, yds: Double, td: Double, int: Double) -> Double? {
        guard att > 0 else { return nil }
        func clamp(_ x: Double) -> Double { max(0, min(2.375, x)) }
        let a = clamp((cmp / att - 0.3) * 5)
        let b = clamp((yds / att - 3) * 0.25)
        let c = clamp((td / att) * 20)
        let d = clamp(2.375 - (int / att) * 25)
        return (a + b + c + d) / 6 * 100
    }

    // MARK: - Grade

    public func grade(_ id: String) -> PlayerGrade? {
        guard let position = context.position(id), let metrics = metricsByPlayer[id] else { return nil }
        let weights = GradeWeights.applyProfile(GradeWeights.weekly(for: position), profile: profile)
        return PlayerGrade.compute(metrics: metrics, cohorts: cohorts[position] ?? [:], weights: weights)
    }

    // MARK: - Situation chips

    public func chips(_ id: String) -> [SituationChip] {
        guard let position = context.position(id) else { return [] }
        let team = playerTeam[id] ?? context.nflTeam(of: id)
        let offense: Set<Position> = [.qb, .rb, .wr, .te]
        let receiving: Set<Position> = [.rb, .wr, .te]
        var out: [SituationChip] = []
        let teamFile = context.inSeason.teamContext
        let allTeams = teamFile?.allTeams() ?? [:]

        func teamMean(_ weeks: [TeamContextWeek], _ key: (TeamContextWeek) -> Double?) -> Double? {
            let values = weeks.compactMap(key)
            return values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
        }
        func leagueSet(_ key: (TeamContextWeek) -> Double?) -> [Double] {
            allTeams.values.compactMap { teamMean($0, key) }.sorted()
        }
        func teamChip(_ metric: SituationMetric, inverted: Bool = false, format: String, _ key: (TeamContextWeek) -> Double?) {
            guard let team, let weeks = teamFile?.weeks(team: team), let value = teamMean(weeks, key) else { return }
            let set = leagueSet(key)
            guard set.count >= 12 else { return }
            var pct = Percentile.rank(value, in: set)
            if inverted { pct = 1 - pct }
            out.append(SituationChip(metric: metric, value: value, percentile: pct,
                                     detail: String(format: format, value), comparedTo: "\(set.count) teams"))
        }

        if [.qb, .wr, .te].contains(position) {
            teamChip(.passProtection, inverted: true, format: "pressured on %.0f%% of dropbacks") { $0.pressureRate.map { $0 * 100 } }
        }
        if [.rb, .qb].contains(position) {
            teamChip(.runBlocking, format: "%.1f yards before contact per carry") { $0.yardsBeforeContactPerAttempt }
        }
        if offense.contains(position) {
            teamChip(.quarterbackPlay, format: "QBR %.0f") { $0.qbr }
            teamChip(.teamPace, format: "%.0f plays per game") { $0.plays }
        }

        // Target competition: the share of team targets the top two *other*
        // pass-catchers take. Less is better, compared across his position.
        if receiving.contains(position) {
            func competition(_ player: String) -> Double? {
                guard let team = playerTeam[player], let tt = teamTotals[team], tt.targets > 0 else { return nil }
                let others = tt.targetsByPlayer.filter { $0.key != player }.values.sorted(by: >).prefix(2)
                return others.reduce(0, +) / tt.targets
            }
            if let value = competition(id) {
                let set = qualified.filter { context.position($0) == position }.compactMap(competition).sorted()
                out.append(SituationChip(
                    metric: .targetCompetition, value: value,
                    percentile: set.count >= 12 ? 1 - Percentile.rank(value, in: set) : nil,
                    detail: String(format: "top two teammates take %.0f%% of targets", value * 100),
                    comparedTo: "\(set.count) \(position.rawValue)s"
                ))
            }
            if let value = metricsByPlayer[id]?[.airYardsShare] {
                let set = cohorts[position]?[.airYardsShare] ?? []
                out.append(SituationChip(
                    metric: .airYardsShare, value: value,
                    percentile: set.count >= 12 ? Percentile.rank(value, in: set) : nil,
                    detail: String(format: "%.0f%% of team air yards", value * 100),
                    comparedTo: "\(set.count) \(position.rawValue)s"
                ))
            }
            func redZoneShare(_ player: String) -> Double? {
                guard let team = playerTeam[player], let tt = teamTotals[team], tt.redZone > 0,
                      let t = playerTotals[player] else { return nil }
                return (t["rec_rz_tgt"] + t["rush_rz_att"]) / tt.redZone
            }
            if let value = redZoneShare(id) {
                let set = qualified.filter { context.position($0) == position }.compactMap(redZoneShare).sorted()
                out.append(SituationChip(
                    metric: .redZoneShare, value: value,
                    percentile: set.count >= 12 ? Percentile.rank(value, in: set) : nil,
                    detail: String(format: "%.0f%% of team red zone touches", value * 100),
                    comparedTo: "\(set.count) \(position.rawValue)s"
                ))
            }
        }

        // Game environment this week.
        let lines = GameLines.week(context.schedule, week: context.currentWeek)
        if let team, let implied = lines[team]?.impliedTotal {
            let set = lines.values.compactMap(\.impliedTotal).sorted()
            out.append(SituationChip(
                metric: .gameEnvironment, value: implied,
                percentile: set.count >= 12 ? Percentile.rank(implied, in: set) : nil,
                detail: String(format: "implied %.1f points this week (recorded line)", implied),
                comparedTo: "\(set.count) teams this week"
            ))
        }

        // Snap trend: last three games against the season.
        func trend(_ player: String) -> Double? {
            guard let shares = snapSharesByPlayer[player], shares.count >= 2 else { return nil }
            let season = shares.reduce(0, +) / Double(shares.count)
            let recent = shares.suffix(3)
            return recent.reduce(0, +) / Double(recent.count) - season
        }
        if position != .k, position != .def, let value = trend(id) {
            let set = qualified.filter { context.position($0) == position }.compactMap(trend).sorted()
            out.append(SituationChip(
                metric: .snapTrend, value: value,
                percentile: set.count >= 12 ? Percentile.rank(value, in: set) : nil,
                detail: String(format: "last 3 games %+.0f points of snap share against his season", value * 100),
                comparedTo: "\(set.count) \(position.rawValue)s"
            ))
        }

        // Depth chart: a fact, not a percentile.
        if let gsis = context.gsisIDsBySleeper[id], let rank = context.inSeason.depthCharts?.rank(gsisID: gsis, team: team, position: position) {
            out.append(SituationChip(
                metric: .depthChartRank, value: Double(rank + 1), percentile: nil,
                detail: "listed #\(rank + 1) at \(position.rawValue) on the official depth chart",
                comparedTo: "his team"
            ))
        }
        return out
    }
}
