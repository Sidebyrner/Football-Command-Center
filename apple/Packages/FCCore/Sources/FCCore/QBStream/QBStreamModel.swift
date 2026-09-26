import Foundation

// QB streaming model: per-dropback efficiency × dropbacks, in the league's own
// points. With −1 per incompletion and −1 per sack, accuracy is worth as much
// as volume — so completion rate, first downs per attempt, sack rate and INT
// rate carry the projection, and volume multiplies efficiency rather than
// standing in for it. Plus the rest-of-season layer.
//
// Ported from the reference engine (`qb_stream.py`); formulas and constants
// unchanged so the parity tests pin the port. One addition, zero in the
// parity runs: long passing TDs (40+/50+), which this league pays.

public enum QBRole: String, Codable, CaseIterable, Sendable {
    case pocket = "POCKET"
    case mobile = "MOBILE"
    case dual = "DUAL"

    public var label: String {
        switch self {
        case .pocket: return "Pocket"
        case .mobile: return "Mobile"
        case .dual: return "Dual-threat"
        }
    }

    /// Rushing priors per game (attempts) and per attempt.
    var rushPrior: (att: Double, ypc: Double, fd: Double, td: Double) {
        switch self {
        case .pocket: return (2.5, 3.0, 0.22, 0.020)
        case .mobile: return (5.5, 4.8, 0.28, 0.035)
        case .dual: return (9.0, 5.3, 0.30, 0.045)
        }
    }
}

public enum QBStreamKnobs {
    // Per-attempt priors for a league-average passer.
    public static let priorComp = 0.655, priorYPA = 7.0, priorTD = 0.046, priorINT = 0.022, priorFD = 0.335
    public static let prior30 = 0.030, prior40 = 0.014, prior50 = 0.006
    public static let priorSack = 0.065
    public static let pickSixShare = 0.11

    public static let leagueAverageDropbacks = 37.0
    public static let volumeShrinkGames = 3.0
    public static let totalSlope = 0.006, spreadSlope = 0.008
    public static let environmentRange = 0.82...1.18
    public static let compK = 120.0, ypaK = 150.0, tdK = 250.0, intK = 250.0, fdK = 120.0, sackK = 150.0, bigPlayK = 250.0
    public static let rushAttK = 8.0, rushYPCK = 25.0, rushFDK = 25.0, rushTDK = 60.0
    public static let oppCompCap = 0.06, oppSackCap = 0.35, oppIntCap = 0.40, dvpCap = 0.12
    public static let fumblePerSack = 0.12, fumblePerRush = 0.012, fumbleLostShare = 0.5
    /// Share of 40+/50+ yard completions that are touchdowns — heuristic, for
    /// the long-TD bonuses the reference does not model.
    public static let touchdownShareOf40 = 0.30, touchdownShareOf50 = 0.40
}

/// The league's passing and QB rushing scoring. Sleeper scores a play by
/// summing every stat it records, so a pick-six costs `pass_int` and
/// `pass_int_td`, and a 45-yard completion earns the 30+ and 40+ tiers.
public struct QBScoring: Codable, Sendable, Hashable {
    public var passYard, passTD, passFirstDown, incompletion, sack, interception, pickSixExtra: Double
    public var rushYard, rushFirstDown, rushTD, fumble, fumbleLost: Double
    public var bonus30, bonus40, bonus50: Double
    public var touchdownBonus40, touchdownBonus50: Double

    public init(passYard: Double = 0, passTD: Double = 0, passFirstDown: Double = 0, incompletion: Double = 0,
                sack: Double = 0, interception: Double = 0, pickSixExtra: Double = 0, rushYard: Double = 0,
                rushFirstDown: Double = 0, rushTD: Double = 0, fumble: Double = 0, fumbleLost: Double = 0,
                bonus30: Double = 0, bonus40: Double = 0, bonus50: Double = 0,
                touchdownBonus40: Double = 0, touchdownBonus50: Double = 0) {
        self.passYard = passYard; self.passTD = passTD; self.passFirstDown = passFirstDown
        self.incompletion = incompletion; self.sack = sack; self.interception = interception
        self.pickSixExtra = pickSixExtra; self.rushYard = rushYard; self.rushFirstDown = rushFirstDown
        self.rushTD = rushTD; self.fumble = fumble; self.fumbleLost = fumbleLost
        self.bonus30 = bonus30; self.bonus40 = bonus40; self.bonus50 = bonus50
        self.touchdownBonus40 = touchdownBonus40; self.touchdownBonus50 = touchdownBonus50
    }

    /// The reference's defaults: Connor's passing scoring as it read it.
    public static let referenceDefaults = QBScoring(
        passYard: 0.05, passTD: 6, passFirstDown: 1, incompletion: -1, sack: -1, interception: -5, pickSixExtra: -5,
        rushYard: 0.1, rushFirstDown: 1, rushTD: 6, fumble: -3, fumbleLost: -2
    )

    public static func from(sleeperSettings s: [String: Double]) -> QBScoring {
        let range30 = s["pass_cmp_30_39"] ?? 0
        let over40 = s["pass_cmp_40p"] ?? 0
        let over50 = s["pass_cmp_50p"]
        return QBScoring(
            passYard: s["pass_yd"] ?? 0, passTD: s["pass_td"] ?? 0, passFirstDown: s["pass_fd"] ?? 0,
            incompletion: s["pass_inc"] ?? 0, sack: s["pass_sack"] ?? 0, interception: s["pass_int"] ?? 0,
            pickSixExtra: s["pass_int_td"] ?? 0,
            rushYard: s["rush_yd"] ?? 0, rushFirstDown: s["rush_fd"] ?? 0, rushTD: s["rush_td"] ?? 0,
            fumble: s["fum"] ?? 0, fumbleLost: s["fum_lost"] ?? 0,
            bonus30: range30, bonus40: over40 - range30, bonus50: over50.map { $0 - over40 } ?? 0,
            touchdownBonus40: s["pass_td_40p"] ?? 0, touchdownBonus50: s["pass_td_50p"] ?? 0
        )
    }

    static let modelledKeys: Set<String> = [
        "pass_yd", "pass_td", "pass_fd", "pass_inc", "pass_sack", "pass_int", "pass_int_td",
        "pass_cmp_30_39", "pass_cmp_40p", "pass_cmp_50p", "pass_td_40p", "pass_td_50p",
        "rush_yd", "rush_fd", "rush_td", "fum", "fum_lost", "pass_att", "pass_cmp",
    ]

    /// Passing keys the league pays that aren't projected, named on screen.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { key, value in
            value != 0 && !modelledKeys.contains(key) && (key.hasPrefix("pass") || key.hasPrefix("bonus_pass"))
        }
        .map(\.key).sorted()
    }
}

// MARK: - Candidate

public struct QBCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: QBRole
    public var opp: String
    public var home: Bool?
    /// His team's spread: positive = underdog.
    public var spreadOff: Double
    public var total: Double
    public var teamDropbacks: Double
    public var teamGames: Int
    /// P(he takes ~all dropbacks if active).
    public var starterConf: Double
    public var att: Double
    public var comp: Double
    public var passYd: Double
    public var passTd: Double
    public var ints: Double
    public var sacks: Double
    public var passFd: Double?
    public var pickSix: Double
    public var comp30p: Double
    public var comp40p: Double
    public var comp50p: Double
    public var games: Int
    public var rushAtt: Double
    public var rushYd: Double
    public var rushTd: Double
    public var rushFd: Double?
    public var fumblesLost: Double
    public var dvpPct: Double
    public var dvpGames: Int
    public var oppCompAllowed: Double?
    public var oppSackRate: Double?
    public var oppIntRate: Double?
    public var leagueComp: Double
    public var leagueSack: Double
    public var leagueInt: Double
    /// Week → opponent for the whole season (the bye is missing).
    public var schedule: [Int: String]
    /// Opponent → generosity to QBs, % vs average.
    public var oppDvp: [String: Double]
    public var currentWeek: Int
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, role: QBRole, opp: String, home: Bool? = nil, spreadOff: Double = 0,
                total: Double = 45, teamDropbacks: Double = 0, teamGames: Int = 0, starterConf: Double = 0.9,
                att: Double = 0, comp: Double = 0, passYd: Double = 0, passTd: Double = 0, ints: Double = 0,
                sacks: Double = 0, passFd: Double? = nil, pickSix: Double = 0, comp30p: Double = 0,
                comp40p: Double = 0, comp50p: Double = 0, games: Int = 0, rushAtt: Double = 0, rushYd: Double = 0,
                rushTd: Double = 0, rushFd: Double? = nil, fumblesLost: Double = 0, dvpPct: Double = 0,
                dvpGames: Int = 0, oppCompAllowed: Double? = nil, oppSackRate: Double? = nil,
                oppIntRate: Double? = nil, leagueComp: Double = 0.655, leagueSack: Double = 0.065,
                leagueInt: Double = 0.022, schedule: [Int: String] = [:], oppDvp: [String: Double] = [:],
                currentWeek: Int = 3, practice: StreamPractice = .none, rosterPct: Double? = nil,
                available: Bool? = nil, notes: String = "", sources: [String] = [], dataFlags: [String] = [],
                playerID: String? = nil) {
        self.name = name; self.team = team; self.role = role; self.opp = opp; self.home = home
        self.spreadOff = spreadOff; self.total = total; self.teamDropbacks = teamDropbacks; self.teamGames = teamGames
        self.starterConf = starterConf; self.att = att; self.comp = comp; self.passYd = passYd; self.passTd = passTd
        self.ints = ints; self.sacks = sacks; self.passFd = passFd; self.pickSix = pickSix; self.comp30p = comp30p
        self.comp40p = comp40p; self.comp50p = comp50p; self.games = games; self.rushAtt = rushAtt
        self.rushYd = rushYd; self.rushTd = rushTd; self.rushFd = rushFd; self.fumblesLost = fumblesLost
        self.dvpPct = dvpPct; self.dvpGames = dvpGames; self.oppCompAllowed = oppCompAllowed
        self.oppSackRate = oppSackRate; self.oppIntRate = oppIntRate; self.leagueComp = leagueComp
        self.leagueSack = leagueSack; self.leagueInt = leagueInt; self.schedule = schedule; self.oppDvp = oppDvp
        self.currentWeek = currentWeek; self.practice = practice; self.rosterPct = rosterPct
        self.available = available; self.notes = notes; self.sources = sources; self.dataFlags = dataFlags
        self.playerID = playerID
    }

    enum CodingKeys: String, CodingKey {
        case name, team, role, opp, home, spreadOff = "spread_off", total, teamDropbacks = "team_dropbacks"
        case teamGames = "team_games", starterConf = "starter_conf", att, comp, passYd = "pass_yd"
        case passTd = "pass_td", ints, sacks, passFd = "pass_fd", pickSix = "pick_six", comp30p = "comp_30p"
        case comp40p = "comp_40p", comp50p = "comp_50p", games, rushAtt = "rush_att", rushYd = "rush_yd"
        case rushTd = "rush_td", rushFd = "rush_fd", fumblesLost = "fumbles_lost", dvpPct = "dvp_pct"
        case dvpGames = "dvp_games", oppCompAllowed = "opp_comp_allowed", oppSackRate = "opp_sack_rate"
        case oppIntRate = "opp_int_rate", leagueComp = "league_comp", leagueSack = "league_sack"
        case leagueInt = "league_int", schedule, oppDvp = "opp_dvp", currentWeek = "current_week", practice
        case rosterPct = "roster_pct", available, notes, sources, dataFlags = "data_flags", playerID = "player_id"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func d(_ k: CodingKeys, _ fallback: Double = 0) throws -> Double { try c.decodeIfPresent(Double.self, forKey: k) ?? fallback }
        name = try c.decode(String.self, forKey: .name)
        team = try c.decode(String.self, forKey: .team)
        role = try c.decode(QBRole.self, forKey: .role)
        opp = try c.decode(String.self, forKey: .opp)
        home = try c.decodeIfPresent(Bool.self, forKey: .home)
        spreadOff = try d(.spreadOff); total = try d(.total, 45)
        teamDropbacks = try d(.teamDropbacks); teamGames = try c.decodeIfPresent(Int.self, forKey: .teamGames) ?? 0
        starterConf = try d(.starterConf, 0.9)
        att = try d(.att); comp = try d(.comp); passYd = try d(.passYd); passTd = try d(.passTd)
        ints = try d(.ints); sacks = try d(.sacks); passFd = try c.decodeIfPresent(Double.self, forKey: .passFd)
        pickSix = try d(.pickSix); comp30p = try d(.comp30p); comp40p = try d(.comp40p); comp50p = try d(.comp50p)
        games = try c.decodeIfPresent(Int.self, forKey: .games) ?? 0
        rushAtt = try d(.rushAtt); rushYd = try d(.rushYd); rushTd = try d(.rushTd)
        rushFd = try c.decodeIfPresent(Double.self, forKey: .rushFd); fumblesLost = try d(.fumblesLost)
        dvpPct = try d(.dvpPct); dvpGames = try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0
        oppCompAllowed = try c.decodeIfPresent(Double.self, forKey: .oppCompAllowed)
        oppSackRate = try c.decodeIfPresent(Double.self, forKey: .oppSackRate)
        oppIntRate = try c.decodeIfPresent(Double.self, forKey: .oppIntRate)
        leagueComp = try d(.leagueComp, 0.655); leagueSack = try d(.leagueSack, 0.065); leagueInt = try d(.leagueInt, 0.022)
        schedule = (try c.decodeIfPresent([String: String].self, forKey: .schedule) ?? [:]).intKeyed()
        oppDvp = try c.decodeIfPresent([String: Double].self, forKey: .oppDvp) ?? [:]
        currentWeek = try c.decodeIfPresent(Int.self, forKey: .currentWeek) ?? 3
        practice = try c.decodeIfPresent(StreamPractice.self, forKey: .practice) ?? .none
        rosterPct = try c.decodeIfPresent(Double.self, forKey: .rosterPct)
        available = try c.decodeIfPresent(Bool.self, forKey: .available)
        notes = try c.decodeIfPresent(String.self, forKey: .notes) ?? ""
        sources = try c.decodeIfPresent([String].self, forKey: .sources) ?? []
        dataFlags = try c.decodeIfPresent([String].self, forKey: .dataFlags) ?? []
        playerID = try c.decodeIfPresent(String.self, forKey: .playerID)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name); try c.encode(team, forKey: .team); try c.encode(role, forKey: .role)
        try c.encode(opp, forKey: .opp); try c.encodeIfPresent(home, forKey: .home)
        try c.encode(spreadOff, forKey: .spreadOff); try c.encode(total, forKey: .total)
        try c.encode(teamDropbacks, forKey: .teamDropbacks); try c.encode(teamGames, forKey: .teamGames)
        try c.encode(starterConf, forKey: .starterConf); try c.encode(att, forKey: .att); try c.encode(comp, forKey: .comp)
        try c.encode(passYd, forKey: .passYd); try c.encode(passTd, forKey: .passTd); try c.encode(ints, forKey: .ints)
        try c.encode(sacks, forKey: .sacks); try c.encodeIfPresent(passFd, forKey: .passFd)
        try c.encode(pickSix, forKey: .pickSix); try c.encode(comp30p, forKey: .comp30p)
        try c.encode(comp40p, forKey: .comp40p); try c.encode(comp50p, forKey: .comp50p); try c.encode(games, forKey: .games)
        try c.encode(rushAtt, forKey: .rushAtt); try c.encode(rushYd, forKey: .rushYd); try c.encode(rushTd, forKey: .rushTd)
        try c.encodeIfPresent(rushFd, forKey: .rushFd); try c.encode(fumblesLost, forKey: .fumblesLost)
        try c.encode(dvpPct, forKey: .dvpPct); try c.encode(dvpGames, forKey: .dvpGames)
        try c.encodeIfPresent(oppCompAllowed, forKey: .oppCompAllowed); try c.encodeIfPresent(oppSackRate, forKey: .oppSackRate)
        try c.encodeIfPresent(oppIntRate, forKey: .oppIntRate); try c.encode(leagueComp, forKey: .leagueComp)
        try c.encode(leagueSack, forKey: .leagueSack); try c.encode(leagueInt, forKey: .leagueInt)
        try c.encode(Dictionary(uniqueKeysWithValues: schedule.map { (String($0.key), $0.value) }), forKey: .schedule)
        try c.encode(oppDvp, forKey: .oppDvp); try c.encode(currentWeek, forKey: .currentWeek)
        try c.encode(practice, forKey: .practice); try c.encodeIfPresent(rosterPct, forKey: .rosterPct)
        try c.encodeIfPresent(available, forKey: .available); try c.encode(notes, forKey: .notes)
        try c.encode(sources, forKey: .sources); try c.encode(dataFlags, forKey: .dataFlags)
        try c.encodeIfPresent(playerID, forKey: .playerID)
    }
}

// MARK: - Projection

public struct QBProjection: StreamROSProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: QBRole
    public var opponent: String
    public var playerID: String?
    public var expDropbacks: Double
    public var envMult: Double
    public var expAtt: Double
    public var eComp: Double
    public var eInc: Double
    public var compRate: Double
    public var ePassYd: Double
    public var ePassTd: Double
    public var eInt: Double
    public var eSacks: Double
    public var ePassFd: Double
    public var eRushAtt: Double
    public var eRushYd: Double
    public var eRushFd: Double
    public var eRushTd: Double
    public var dvpMult: Double
    public var compAdj: Double
    public var sackAdj: Double
    public var intAdj: Double
    public var meanIfPlays: Double
    public var sdIfPlays: Double
    public var pPlay: Double
    public var expPts: Double
    public var floorP25: Double
    public var ceilingP75: Double
    public var utility: Double
    public var neutralMean: Double
    public var ros: StreamROS
    public var starterConf: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var flags: [String]
    public var notes: String
    public var sources: [String]
    public var explain: [String]
    /// Points by stat, if he plays.
    public var breakdown: [StreamStatPoints]
    public var pBeatIncumbent: Double?
    public var expGain: Double?
    public var bidBand: StreamBidBand?

    public var platform: Position { .qb }
    public var roleLabel: String { role.label }
    public var roleConf: Double { starterConf }
}

extension StreamStatPoints: Codable {
    enum CodingKeys: String, CodingKey { case stat, count, points }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(stat: try c.decode(String.self, forKey: .stat), count: try c.decode(Double.self, forKey: .count),
                  points: try c.decode(Double.self, forKey: .points))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(stat, forKey: .stat); try c.encode(count, forKey: .count); try c.encode(points, forKey: .points)
    }
}

// MARK: - Engine

public enum QBStreamEngine {
    typealias M = StreamMath
    typealias K = QBStreamKnobs

    struct Rates {
        var comp, ypa, td, int, fd, p30, p40, p50, sack, rushAtt, rushYPC, rushFD, rushTD: Double
    }

    static func rates(_ c: QBCandidate) -> Rates {
        let a = c.att
        func per(_ x: Double) -> Double? { a > 0 ? x / a : nil }
        let comp = M.shrink(per(c.comp), a, K.priorComp, K.compK)
        let ypa = M.shrink(per(c.passYd), a, K.priorYPA, K.ypaK)
        let td = M.shrink(per(c.passTd), a, K.priorTD, K.tdK)
        let int = M.shrink(per(c.ints), a, K.priorINT, K.intK)
        let fd = M.shrink(c.passFd.flatMap(per), a, K.priorFD, K.fdK)
        let p30 = M.shrink(per(c.comp30p), a, K.prior30, K.bigPlayK)
        var p40 = M.shrink(per(c.comp40p), a, K.prior40, K.bigPlayK)
        var p50 = M.shrink(per(c.comp50p), a, K.prior50, K.bigPlayK)
        let db = a + c.sacks
        let sack = M.shrink(db > 0 ? c.sacks / db : nil, db, K.priorSack, K.sackK)
        p40 = min(p40, p30); p50 = min(p50, p40)
        let rp = c.role.rushPrior, g = Double(c.games)
        let rushAtt = M.shrink(c.games > 0 ? c.rushAtt / g : nil, g, rp.att, K.rushAttK)
        let rushYPC = M.shrink(c.rushAtt > 0 ? c.rushYd / c.rushAtt : nil, c.rushAtt, rp.ypc, K.rushYPCK)
        let rushFD = M.shrink(c.rushAtt > 0 ? c.rushFd.map { $0 / c.rushAtt } : nil, c.rushAtt, rp.fd, K.rushFDK)
        let rushTD = M.shrink(c.rushAtt > 0 ? c.rushTd / c.rushAtt : nil, c.rushAtt, rp.td, K.rushTDK)
        return Rates(comp: comp, ypa: ypa, td: td, int: int, fd: fd, p30: p30, p40: p40, p50: p50, sack: sack,
                     rushAtt: rushAtt, rushYPC: rushYPC, rushFD: rushFD, rushTD: rushTD)
    }

    static func matchup(_ c: QBCandidate) -> (dvp: Double, comp: Double, sack: Double, int: Double) {
        let m = StreamRestOfSeason.dvpMult(c.dvpPct, games: c.dvpGames, cap: K.dvpCap)
        let comp = c.oppCompAllowed.map { 1 + M.clamp(($0 - c.leagueComp) / c.leagueComp * 0.5, -K.oppCompCap, K.oppCompCap) } ?? 1
        let sack = c.oppSackRate.map { 1 + M.clamp(($0 / c.leagueSack - 1) * 0.5, -K.oppSackCap, K.oppSackCap) } ?? 1
        let int = c.oppIntRate.map { 1 + M.clamp(($0 / c.leagueInt - 1) * 0.5, -K.oppIntCap, K.oppIntCap) } ?? 1
        return (m, comp, sack, int)
    }

    struct Core {
        var dropbacks, env, attempts, eComp, eInc, eYds, eTd, eInt, eSacks, eFd, eRushAtt, eRushYd, eRushFd, eRushTd: Double
        var compRate, sackRate, dvp, compAdj, sackAdj, intAdj, mean, sd: Double
        var breakdown: [StreamStatPoints]
    }

    static func core(_ c: QBCandidate, _ s: QBScoring, neutral: Bool) -> Core {
        let g = Double(c.teamGames)
        let baseDB = M.shrink(c.teamGames > 0 ? c.teamDropbacks / g : nil, g, K.leagueAverageDropbacks, K.volumeShrinkGames)
        let env = neutral ? 1 : M.clamp(1 + K.totalSlope * (c.total - 45) + K.spreadSlope * c.spreadOff,
                                        K.environmentRange.lowerBound, K.environmentRange.upperBound)
        let dropbacks = baseDB * env * c.starterConf
        let r = rates(c)
        let (m, compAdj, sackAdj, intAdj) = neutral ? (1, 1, 1, 1) : matchup(c)

        let sackRate = M.clamp(r.sack * sackAdj, 0.01, 0.20)
        let eSacks = dropbacks * sackRate
        let attempts = dropbacks - eSacks
        let compRate = M.clamp(r.comp * compAdj, 0.45, 0.80)
        let eComp = attempts * compRate
        let eInc = attempts - eComp
        let eYds = attempts * r.ypa * m
        let eTd = attempts * r.td * m
        let eInt = attempts * r.int * intAdj
        let eP6 = eInt * K.pickSixShare
        let eFd = attempts * r.fd * (0.5 + 0.5 * m) * (compRate / r.comp)
        let e30 = attempts * r.p30 * m, e40 = attempts * r.p40 * m, e50 = attempts * r.p50 * m
        let eRAtt = r.rushAtt * env * c.starterConf
        let eRYd = eRAtt * r.rushYPC
        let eRFd = eRAtt * r.rushFD
        let eRTd = eRAtt * r.rushTD
        let eFum = eSacks * K.fumblePerSack + eRAtt * K.fumblePerRush
        let eTd40 = e40 * K.touchdownShareOf40, eTd50 = e50 * K.touchdownShareOf50

        let parts: [(String, Double, Double)] = [
            ("Pass yards", eYds, eYds * s.passYard),
            ("Pass first downs", eFd, eFd * s.passFirstDown),
            ("Pass TD", eTd, eTd * s.passTD),
            ("Incompletions", eInc, eInc * s.incompletion),
            ("Sacks", eSacks, eSacks * s.sack),
            ("Interceptions", eInt, eInt * s.interception + eP6 * s.pickSixExtra),
            ("Rushing", eRAtt, eRYd * s.rushYard + eRFd * s.rushFirstDown + eRTd * s.rushTD),
            ("Fumbles", eFum, eFum * (s.fumble + K.fumbleLostShare * s.fumbleLost)),
            ("Long completions", e30, e30 * s.bonus30 + e40 * s.bonus40 + e50 * s.bonus50),
            ("Long TDs", eTd40, eTd40 * s.touchdownBonus40 + eTd50 * s.touchdownBonus50),
        ]
        let mean = parts.reduce(0) { $0 + $1.2 }
        var v = s.passTD * s.passTD * eTd
        let intPts = s.interception + K.pickSixShare * s.pickSixExtra
        v += intPts * intPts * eInt
        v += s.incompletion * s.incompletion * attempts * compRate * (1 - compRate) * 1.3
        v += s.sack * s.sack * eSacks + s.passFirstDown * s.passFirstDown * eFd * 0.6
        v += s.passYard * s.passYard * (attempts * r.ypa * r.ypa * 1.8)
        v += s.rushTD * s.rushTD * eRTd + s.rushYard * s.rushYard * eRAtt * r.rushYPC * r.rushYPC * 2.0
            + s.rushFirstDown * s.rushFirstDown * eRFd
        v += s.fumble * s.fumble * eFum
        v += s.bonus30 * s.bonus30 * e30 + s.bonus40 * s.bonus40 * e40 + s.bonus50 * s.bonus50 * e50
        v += s.touchdownBonus40 * s.touchdownBonus40 * eTd40 + s.touchdownBonus50 * s.touchdownBonus50 * eTd50
        let usageSD = mean * 0.25 * (1 - c.starterConf)
        let sd = (v + usageSD * usageSD).squareRoot()
        return Core(dropbacks: dropbacks, env: env, attempts: attempts, eComp: eComp, eInc: eInc, eYds: eYds, eTd: eTd,
                    eInt: eInt, eSacks: eSacks, eFd: eFd, eRushAtt: eRAtt, eRushYd: eRYd, eRushFd: eRFd, eRushTd: eRTd,
                    compRate: compRate, sackRate: sackRate, dvp: m, compAdj: compAdj, sackAdj: sackAdj, intAdj: intAdj,
                    mean: mean, sd: sd,
                    breakdown: parts.map { StreamStatPoints(stat: $0.0, count: $0.1, points: $0.2) }.filter { $0.points != 0 })
    }

    public static func project(_ c: QBCandidate, scoring s: QBScoring, risk: StreamRiskMode = .neutral,
                               horizon: StreamHorizon = .week) -> QBProjection {
        let x = core(c, s, neutral: false)
        let n = core(c, s, neutral: true)
        let pPlay = c.practice.playProbability
        let expPts = pPlay * x.mean
        let z = StreamMath.quartileZ
        let ros = StreamRestOfSeason.summary(currentWeek: c.currentWeek, schedule: c.schedule, oppDvp: c.oppDvp,
                                             dvpGames: c.dvpGames, neutralMean: n.mean, cap: K.dvpCap)
        let utility = StreamRestOfSeason.blendedUtility(expPts: expPts, sd: x.sd, rosPerGame: ros.perGame,
                                                        pPlay: pPlay, risk: risk, horizon: horizon)
        var flags = c.dataFlags
        if c.att < 40 { flags.append("thin passing sample") }
        if c.passFd == nil { flags.append("pass first-down rate from league prior") }
        if c.available == nil { flags.append("availability unverified") }
        if c.schedule.isEmpty { flags.append("no remaining schedule → ROS = neutral") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let spread = c.spreadOff >= 0 ? "+\(f(c.spreadOff, 1))" : f(c.spreadOff, 1)
        let explain = [
            "\(f(x.dropbacks, 1)) dropbacks (script ×\(f(x.env, 3)) from O/U \(f(c.total, 1)), spread \(spread)) → \(f(x.attempts, 1)) attempts, \(f(x.eSacks, 1)) sacks",
            "Completion \(Int((x.compRate * 100).rounded()))% → \(f(x.eInc, 1)) incompletions; \(f(x.eFd, 1)) passing first downs",
            "\(f(x.eYds, 0)) pass yds, \(f(x.eTd, 2)) TD, \(f(x.eInt, 2)) INT · rushing \(f(x.eRushYd, 0)) yds, \(f(x.eRushFd, 1)) first downs",
            "Matchup: QB points ×\(f(x.dvp, 3)) · completions ×\(f(x.compAdj, 3)) · sacks ×\(f(x.sackAdj, 3)) · INTs ×\(f(x.intAdj, 3))",
            "Rest of season \(f(ros.perGame, 1))/g over \(ros.games) games" + (ros.byeWeek.map { " (bye W\($0))" } ?? ""),
            "P(plays) \(Int((pPlay * 100).rounded()))% (\(c.practice.label)) · starter confidence \(f(c.starterConf, 2))",
        ]
        return QBProjection(
            name: c.name, team: c.team, role: c.role, opponent: c.opp, playerID: c.playerID,
            expDropbacks: x.dropbacks, envMult: x.env, expAtt: x.attempts, eComp: x.eComp, eInc: x.eInc,
            compRate: x.compRate, ePassYd: x.eYds, ePassTd: x.eTd, eInt: x.eInt, eSacks: x.eSacks, ePassFd: x.eFd,
            eRushAtt: x.eRushAtt, eRushYd: x.eRushYd, eRushFd: x.eRushFd, eRushTd: x.eRushTd,
            dvpMult: x.dvp, compAdj: x.compAdj, sackAdj: x.sackAdj, intAdj: x.intAdj,
            meanIfPlays: x.mean, sdIfPlays: x.sd, pPlay: pPlay, expPts: expPts,
            floorP25: max(0, pPlay * (x.mean - z * x.sd)), ceilingP75: pPlay * (x.mean + z * x.sd),
            utility: utility, neutralMean: n.mean, ros: ros, starterConf: c.starterConf, practice: c.practice,
            rosterPct: c.rosterPct, available: c.available, flags: flags, notes: c.notes, sources: c.sources,
            explain: explain, breakdown: x.breakdown.sorted { $0.points > $1.points },
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    static func f(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }
}

public typealias QBStreamReport = StreamReport<QBProjection>
