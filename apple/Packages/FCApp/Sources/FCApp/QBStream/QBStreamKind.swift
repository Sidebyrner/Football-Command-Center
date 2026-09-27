import Foundation
import FCCore
import FCData

extension QBCandidate: StreamCandidate {}

/// One team's passing game this week, from its offense's side.
public struct QBTeamContext: StreamTeamContext {
    public var team: String
    public var opponent: String
    public var home: Bool?
    /// Positive when this team is the underdog (so it throws more).
    public var spreadOff: Double
    public var total: Double
    /// Points the opposing defense allows to QBs, % vs average.
    public var dvpPct: Double?
    public var dvpGames: Int
    /// Completion rate the opposing defense allows (0–1).
    public var oppCompAllowed: Double?
    /// Sacks per dropback the opposing defense gets.
    public var oppSackRate: Double?
    /// Interceptions per attempt the opposing defense gets.
    public var oppIntRate: Double?
    public var linesSource: StreamContextSource
    public var dvpSource: StreamContextSource
    public var ratesSource: StreamContextSource
    /// Every defense's generosity to QBs, % vs average — the rest-of-season input.
    public var leagueGenerosity: [String: Double] = [:]

    public var id: String { team }
    public var spread: Double { spreadOff }
    public var implied: Double { (total - spreadOff) / 2 }

    public var opponentLabel: String {
        switch home {
        case .some(true): return "vs \(opponent)"
        case .some(false): return "@\(opponent)"
        case .none: return "vs \(opponent) (neutral)"
        }
    }
}

public struct QBTeamOverride: StreamOverride {
    public var spreadOff: Double?
    public var total: Double?
    public var dvpPct: Double?
    public var dvpGames: Int?
    public var oppCompAllowed: Double?
    public var oppSackRate: Double?
    public var oppIntRate: Double?
    public var source: StreamContextSource

    public init(spreadOff: Double? = nil, total: Double? = nil, dvpPct: Double? = nil, dvpGames: Int? = nil,
                oppCompAllowed: Double? = nil, oppSackRate: Double? = nil, oppIntRate: Double? = nil,
                source: StreamContextSource = .manual) {
        self.spreadOff = spreadOff; self.total = total; self.dvpPct = dvpPct; self.dvpGames = dvpGames
        self.oppCompAllowed = oppCompAllowed; self.oppSackRate = oppSackRate; self.oppIntRate = oppIntRate
        self.source = source
    }

    public var isEmpty: Bool {
        spreadOff == nil && total == nil && dvpPct == nil && dvpGames == nil
            && oppCompAllowed == nil && oppSackRate == nil && oppIntRate == nil
    }
}

public struct QBPlayerOverride: StreamOverride {
    public var role: QBRole?
    public var practice: StreamPractice?
    public var starterConf: Double?
    public var notes: String?

    public init(role: QBRole? = nil, practice: StreamPractice? = nil, starterConf: Double? = nil, notes: String? = nil) {
        self.role = role; self.practice = practice; self.starterConf = starterConf; self.notes = notes
    }

    public var isEmpty: Bool { role == nil && practice == nil && starterConf == nil && (notes ?? "").isEmpty }
}

public typealias QBWeekOverrides = StreamWeekOverrides<QBTeamOverride, QBPlayerOverride>

/// One completed game, for the comparison's recent-form rows.
public struct QBGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    public let points: Double
    public let completions: Double
    public let attempts: Double
    public let yards: Double
    public let touchdowns: Double
    public let interceptions: Double
    public let sacks: Double
    public let rushYards: Double
}

/// QB Stream's part of the shared stream screen.
public enum QBStreamKind: StreamKind {
    public typealias Candidate = QBCandidate
    public typealias Projection = QBProjection
    public typealias Scoring = QBScoring
    public typealias Team = QBTeamContext
    public typealias TeamOverride = QBTeamOverride
    public typealias PlayerOverride = QBPlayerOverride
    public typealias GameLine = QBGameLine

    public static let storeFolder = "QBStream"
    public static let positions: [Position] = [.qb]
    public static let playerNoun = "quarterback"
    public static let emptyScoring = QBScoring()
    public static let usesHorizon = true

    public static func scoring(sleeperSettings: [String: Double]) -> QBScoring { .from(sleeperSettings: sleeperSettings) }
    public static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String] {
        QBScoring.unmodelledKeys(sleeperSettings: sleeperSettings)
    }

    /// Every team playing this week: the schedule's recorded lines, and what
    /// the opposing defense allows to quarterbacks from Sleeper's lines.
    public static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: QBTeamContext] {
        let totals = SleeperTeamTotals(context: context)
        let generosity = SleeperTeamTotals.generosity(defense.sleeper, position: .qb).pct
        var out: [String: QBTeamContext] = [:]
        for (team, line) in GameLines.week(context.schedule, week: context.currentWeek) {
            var dvp: Double?
            var games = 0
            if let cell = defense.sleeper.cell(defense: line.opponent, position: .qb), cell.rank != nil,
               let perGame = cell.perGame, let average = defense.sleeper.leagueAverage[.qb], average > 0 {
                dvp = (perGame / average - 1) * 100
                games = cell.games
            }
            let faced = totals.faced(by: line.opponent)
            let hasRates = faced.total.passAttempts > 0
            out[team] = QBTeamContext(
                team: team, opponent: line.opponent, home: line.isHome,
                spreadOff: line.spread ?? 0, total: line.total ?? 45, dvpPct: dvp, dvpGames: games,
                oppCompAllowed: hasRates ? faced.total.completions / faced.total.passAttempts : nil,
                oppSackRate: hasRates ? faced.total.sacksTaken / max(faced.total.dropbacks, 1) : nil,
                oppIntRate: hasRates ? faced.total.interceptions / faced.total.passAttempts : nil,
                linesSource: line.spread != nil && line.total != nil ? .schedule : .standard,
                dvpSource: dvp == nil ? .standard : .sleeperDvP,
                ratesSource: hasRates ? .sleeperDvP : .standard,
                leagueGenerosity: generosity
            )
        }
        return out
    }

    public static func apply(_ overrides: [String: QBTeamOverride], to teams: [String: QBTeamContext]) -> [String: QBTeamContext] {
        var out = teams
        for (team, change) in overrides {
            guard var context = out[team], !change.isEmpty else { continue }
            if let v = change.spreadOff { context.spreadOff = v; context.linesSource = change.source }
            if let v = change.total { context.total = v; context.linesSource = change.source }
            if let v = change.dvpPct {
                context.dvpPct = v
                context.dvpGames = change.dvpGames ?? max(context.dvpGames, 1)
                context.dvpSource = change.source
            }
            if let v = change.oppCompAllowed { context.oppCompAllowed = v; context.ratesSource = change.source }
            if let v = change.oppSackRate { context.oppSackRate = v; context.ratesSource = change.source }
            if let v = change.oppIntRate { context.oppIntRate = v; context.ratesSource = change.source }
            out[team] = context
        }
        return out
    }

    public static func candidates(context: LeagueContext, teams: [String: QBTeamContext],
                                  players: [String: QBPlayerOverride], alwaysInclude: Set<String>) -> [QBCandidate] {
        QBCandidateBuilder(context: context, teams: teams, players: players, alwaysInclude: alwaysInclude).candidates()
    }

    public static func project(_ candidate: QBCandidate, scoring: QBScoring, risk: StreamRiskMode) -> QBProjection {
        QBStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: .week)
    }

    public static func project(_ candidate: QBCandidate, scoring: QBScoring, risk: StreamRiskMode,
                               horizon: StreamHorizon) -> QBProjection {
        QBStreamEngine.project(candidate, scoring: scoring, risk: risk, horizon: horizon)
    }

    public static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [QBGameLine] {
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted(by: >)
            .compactMap { week -> QBGameLine? in
                guard let line = context.inSeason.weekStats[week]?[playerID], line.played else { return nil }
                let s = line.stats
                return QBGameLine(week: week, opponent: NFLTeams.nflverse(line.opponent),
                                  points: line.score(scoring: scoring).points, completions: s["pass_cmp"] ?? 0,
                                  attempts: s["pass_att"] ?? 0, yards: s["pass_yd"] ?? 0, touchdowns: s["pass_td"] ?? 0,
                                  interceptions: s["pass_int"] ?? 0, sacks: s["pass_sack"] ?? 0, rushYards: s["rush_yd"] ?? 0)
            }
            .prefix(limit).map { $0 }
    }

    public static func roleLabel(for player: IndexedPlayer) -> String? { nil }

    public static func parseImport(_ data: Data) throws -> QBWeekOverrides {
        let root = try StreamImport.root(data)
        var out = QBWeekOverrides()
        for (team, row) in StreamImport.teams(root) {
            let dvp = StreamImport.number(row["dvpPct"]) ?? (row["dvpPct"] as? [String: Any]).flatMap { StreamImport.number($0["QB"]) }
            let change = QBTeamOverride(
                spreadOff: StreamImport.number(row["spreadOff"]) ?? StreamImport.number(row["spreadDef"]),
                total: StreamImport.number(row["total"]), dvpPct: dvp,
                dvpGames: dvp == nil ? nil : StreamImport.number(row["dvpGames"]).map { Int($0) },
                oppCompAllowed: StreamImport.number(row["oppCompAllowed"]),
                oppSackRate: StreamImport.number(row["oppSackRate"]),
                oppIntRate: StreamImport.number(row["oppIntRate"]), source: .imported
            )
            if !change.isEmpty { out.teams[team] = change }
        }
        for (id, row) in StreamImport.players(root) {
            let change = QBPlayerOverride(
                role: (row["role"] as? String).flatMap(QBRole.init(rawValue:)),
                practice: (row["practice"] as? String).flatMap(StreamPractice.init(rawValue:)),
                starterConf: StreamImport.number(row["starterConf"]), notes: row["notes"] as? String
            )
            if !change.isEmpty { out.players[id] = change }
        }
        return out
    }

    public static func sourceNotes(teams: [String: QBTeamContext]) -> [String] {
        var notes: [String] = []
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("QB matchup needs \(DefenseVsPosition.defaultMinimumGames) games per defense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Completion, sack and INT rates each defense allows are summed from Sleeper's lines of the quarterbacks it has faced. Spread and total are recorded closing lines, not live odds.")
        notes.append("Rest of season scores his remaining schedule against each defense's generosity to QBs; the horizon decides how much it counts. Roles and starter confidence are inferred from usage — all heuristic until backtested.")
        return notes
    }
}

public typealias QBStreamScreenModel = StreamScreenModel<QBStreamKind>

/// Quarterbacks with a real role, or on the user's roster, as QB candidates.
struct QBCandidateBuilder {
    let context: LeagueContext
    let teams: [String: QBTeamContext]
    let players: [String: QBPlayerOverride]
    let alwaysInclude: Set<String>

    func candidates() -> [QBCandidate] {
        let totals = SleeperTeamTotals(context: context)
        let league = totals.leagueRates
        let generosity = teams.values.first?.leagueGenerosity ?? [:]
        let mine = Set(context.userTeam?.roster.map(\.id) ?? [])
        return context.players.players(at: .qb).compactMap { player in
            candidate(player, totals: totals, league: league, generosity: generosity, isMine: mine.contains(player.id))
        }
        .sorted { $0.name < $1.name }
    }

    private func candidate(_ player: IndexedPlayer, totals: SleeperTeamTotals, league: (comp: Double, sack: Double, int: Double),
                           generosity: [String: Double], isMine: Bool) -> QBCandidate? {
        guard let team = player.nflverseTeam else { return nil }
        let override = players[player.id]
        var att = 0.0, comp = 0.0, yds = 0.0, td = 0.0, ints = 0.0, sacks = 0.0, fd = 0.0, sawFd = false
        var pickSix = 0.0, c40 = 0.0, c50 = 0.0, c30 = 0.0, saw30 = false
        var rushAtt = 0.0, rushYd = 0.0, rushTd = 0.0, rushFd = 0.0, sawRushFd = false, fumLost = 0.0
        var games = 0
        var lastShare: Double?
        for week in totals.weeks {
            guard let line = context.inSeason.weekStats[week]?[player.id] else { continue }
            let s = line.stats
            let a = s["pass_att"] ?? 0, r = s["rush_att"] ?? 0
            guard a > 0 || r > 0 || (s["off_snp"] ?? 0) > 0 else { continue }
            games += 1
            att += a; comp += s["pass_cmp"] ?? 0; yds += s["pass_yd"] ?? 0; td += s["pass_td"] ?? 0
            ints += s["pass_int"] ?? 0; sacks += s["pass_sack"] ?? 0; pickSix += s["pass_int_td"] ?? 0
            if let v = s["pass_fd"] { fd += v; sawFd = true }
            c40 += s["pass_cmp_40p"] ?? 0
            c50 += s["pass_cmp_50p"] ?? 0
            if let v = s["pass_cmp_30_39"] { c30 += v; saw30 = true }
            rushAtt += r; rushYd += s["rush_yd"] ?? 0; rushTd += s["rush_td"] ?? 0; fumLost += s["fum_lost"] ?? 0
            if let v = s["rush_fd"] { rushFd += v; sawRushFd = true }
            if let teamWeek = totals.offense[team]?[week], teamWeek.dropbacks > 0 {
                lastShare = (a + (s["pass_sack"] ?? 0)) / teamWeek.dropbacks
            }
        }
        let starter = player.depthChartOrder == 1
        let hasRole = att >= 10 || (lastShare ?? 0) >= 0.5 || starter
        guard hasRole || isMine || alwaysInclude.contains(player.id) else { return nil }

        var flags: [String] = []
        let comp30: Double
        if saw30 {
            comp30 = c30 + c40
        } else {
            comp30 = c40 * (QBStreamKnobs.prior30 / QBStreamKnobs.prior40)
            if c40 > 0 { flags.append("30+ completions estimated from 40+") }
        }
        let rushPerGame = games > 0 ? rushAtt / Double(games) : 0
        let role = override?.role ?? (rushPerGame >= 7 ? .dual : rushPerGame >= 3.5 ? .mobile : .pocket)
        if override?.role == nil { flags.append(games > 0 ? "role from rushing volume" : "role defaulted — no games yet") }
        let starterConf = override?.starterConf ?? {
            if let share = lastShare { return share >= 0.85 ? 0.95 : StreamMath.clamp(share, 0.3, 0.9) }
            return starter ? 0.85 : 0.4
        }()

        let offense = totals.offenseTotal(team)
        let game = teams[team]
        var practice = override?.practice ?? StreamPracticeMapper.status(player, context: context)
        if game == nil {
            practice = .OUT
            flags.append("bye week")
        } else if game?.linesSource == .standard {
            flags.append("no recorded line — neutral spread and total")
        }
        var sources = ["Sleeper weekly stats", "schedule lines"]
        if context.practiceReport(sleeperID: player.id) != nil { sources.append("nflverse practice report") }

        return QBCandidate(
            name: player.name, team: team, role: role, opp: game?.opponentLabel ?? "BYE", home: game?.home,
            spreadOff: game?.spreadOff ?? 0, total: game?.total ?? 45,
            teamDropbacks: offense.total.dropbacks, teamGames: offense.games, starterConf: starterConf,
            att: att, comp: comp, passYd: yds, passTd: td, ints: ints, sacks: sacks, passFd: sawFd ? fd : nil,
            pickSix: pickSix, comp30p: comp30, comp40p: c40, comp50p: c50, games: games,
            rushAtt: rushAtt, rushYd: rushYd, rushTd: rushTd, rushFd: sawRushFd ? rushFd : nil, fumblesLost: fumLost,
            dvpPct: game?.dvpPct ?? 0, dvpGames: game?.dvpPct == nil ? 0 : (game?.dvpGames ?? 0),
            oppCompAllowed: game?.oppCompAllowed, oppSackRate: game?.oppSackRate, oppIntRate: game?.oppIntRate,
            leagueComp: league.comp, leagueSack: league.sack, leagueInt: league.int,
            schedule: SleeperTeamTotals.schedule(context.schedule, team: team), oppDvp: generosity,
            currentWeek: context.currentWeek, practice: practice, rosterPct: nil,
            available: context.availability(ofSleeperID: player.id) == .freeAgent,
            notes: override?.notes ?? "", sources: sources, dataFlags: flags, playerID: player.id
        )
    }
}

/// Reading a stream context file: `teams` keyed by team code, `players` by
/// Sleeper id; keys starting with `_` are comments.
enum StreamImport {
    enum ImportError: Error, CustomStringConvertible {
        case notAnObject
        var description: String { "That file is not a stream context file (expected a \"teams\" object)." }
    }

    static func root(_ data: Data) throws -> [String: Any] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], root["teams"] != nil || root["players"] != nil
        else { throw ImportError.notAnObject }
        return root
    }

    static func teams(_ root: [String: Any]) -> [(String, [String: Any])] {
        ((root["teams"] as? [String: Any]) ?? [:]).compactMap { key, value in
            guard !key.hasPrefix("_"), let row = value as? [String: Any], let team = NFLTeams.nflverse(key.uppercased()) else { return nil }
            return (team, row)
        }
    }

    static func players(_ root: [String: Any]) -> [(String, [String: Any])] {
        ((root["players"] as? [String: Any]) ?? [:]).compactMap { key, value in
            guard !key.hasPrefix("_"), let row = value as? [String: Any] else { return nil }
            return (key, row)
        }
    }

    static func number(_ value: Any?) -> Double? { (value as? NSNumber)?.doubleValue }
}
