import Foundation

// RB streaming model: a two-stage opportunity × conversion projection for one
// week, in the league's own points. With no PPR and a point per first down,
// carries are the volume, rushing first downs the floor and touchdowns the
// ceiling — and touchdowns follow red-zone work and the team's implied total,
// not yards. Game script runs the opposite way to WR: favorites run more.
//
// Ported from the reference engine (`rb_stream.py`). Formulas and constants are
// unchanged so the parity tests can pin this port to the reference output.
// Two additions, both zero in the parity runs: run and catch long-play bonuses
// are scored separately (this league pays them differently), and long rushing
// TDs (40+/50+ yards), which this league pays and the reference does not model.
//
// Every prior and knob is heuristic until a backtest has data.

// MARK: - Roles

public enum RBRole: String, Codable, CaseIterable, Sendable {
    case bellcow = "BELLCOW"
    case lead = "LEAD"
    case committee = "COMMITTEE"
    case passDown = "PASS_DOWN"
    case goalLine = "GOAL_LINE"

    public var label: String {
        switch self {
        case .bellcow: return "Bellcow"
        case .lead: return "Lead"
        case .committee: return "Committee"
        case .passDown: return "Pass-down"
        case .goalLine: return "Goal-line"
        }
    }

    public var summary: String {
        switch self {
        case .bellcow: return "Workhorse, most carries and goal-line work"
        case .lead: return "Lead back in a two-man split"
        case .committee: return "Shared backfield"
        case .passDown: return "Third-down and two-minute back"
        case .goalLine: return "Short-yardage and goal-line back"
        }
    }
}

/// Team-share and per-carry / per-target priors for one role.
public struct RBPrior: Sendable, Hashable {
    public var carryShare: Double
    public var targetShare: Double
    public var yardsPerCarry: Double
    public var rushFirstDowns: Double
    public var rushTouchdowns: Double
    public var run30: Double
    public var run40: Double
    public var run50: Double
    public var catchRate: Double
    public var yardsPerCatch: Double
    public var catchFirstDowns: Double
    public var catchTouchdowns: Double
    /// Neutral share of team red-zone carries for the role.
    public var redZoneShare: Double
}

public enum RBStreamPriors {
    public static func prior(for role: RBRole) -> RBPrior {
        switch role {
        case .bellcow:
            return RBPrior(carryShare: 0.62, targetShare: 0.11, yardsPerCarry: 4.3, rushFirstDowns: 0.24, rushTouchdowns: 0.030,
                           run30: 0.010, run40: 0.0055, run50: 0.0030, catchRate: 0.77, yardsPerCatch: 8.0,
                           catchFirstDowns: 0.24, catchTouchdowns: 0.020, redZoneShare: 0.60)
        case .lead:
            return RBPrior(carryShare: 0.50, targetShare: 0.08, yardsPerCarry: 4.3, rushFirstDowns: 0.23, rushTouchdowns: 0.028,
                           run30: 0.009, run40: 0.0050, run50: 0.0027, catchRate: 0.77, yardsPerCatch: 7.8,
                           catchFirstDowns: 0.23, catchTouchdowns: 0.018, redZoneShare: 0.50)
        case .committee:
            return RBPrior(carryShare: 0.38, targetShare: 0.07, yardsPerCarry: 4.2, rushFirstDowns: 0.22, rushTouchdowns: 0.024,
                           run30: 0.008, run40: 0.0045, run50: 0.0024, catchRate: 0.76, yardsPerCatch: 7.5,
                           catchFirstDowns: 0.22, catchTouchdowns: 0.016, redZoneShare: 0.35)
        case .passDown:
            return RBPrior(carryShare: 0.20, targetShare: 0.10, yardsPerCarry: 4.5, rushFirstDowns: 0.20, rushTouchdowns: 0.018,
                           run30: 0.009, run40: 0.0050, run50: 0.0027, catchRate: 0.80, yardsPerCatch: 8.2,
                           catchFirstDowns: 0.26, catchTouchdowns: 0.018, redZoneShare: 0.15)
        case .goalLine:
            return RBPrior(carryShare: 0.25, targetShare: 0.03, yardsPerCarry: 3.7, rushFirstDowns: 0.25, rushTouchdowns: 0.045,
                           run30: 0.004, run40: 0.0020, run50: 0.0010, catchRate: 0.75, yardsPerCatch: 6.5,
                           catchFirstDowns: 0.20, catchTouchdowns: 0.020, redZoneShare: 0.45)
        }
    }
}

public enum RBStreamKnobs {
    public static let leagueAverageRushAttempts = 26.0
    public static let leagueAveragePassAttempts = 33.5
    public static let volumeShrinkGames = 3.0
    public static let rushTotalSlope = 0.004
    /// Underdogs abandon the run.
    public static let rushSpreadSlope = -0.012
    public static let passTotalSlope = 0.006
    public static let passSpreadSlope = 0.008
    public static let environmentRange = 0.80...1.20
    public static let leagueAverageImplied = 22.5
    public static let impliedRange = 0.70...1.35
    public static let ypcShrinkK = 60.0
    public static let rushFirstDownShrinkK = 60.0
    public static let rushTouchdownShrinkK = 150.0
    public static let longRunShrinkK = 300.0
    public static let catchShrinkK = 20.0
    public static let yardsPerCatchShrinkK = 15.0
    public static let catchFirstDownShrinkK = 25.0
    public static let catchTouchdownShrinkK = 120.0
    public static let dvpFullWeightGames = 6.0
    public static let dvpCap = 0.15
    public static let lineCap = 0.25
    public static let redZoneMultCap = 0.60
    /// RB roles move fast — lean on the latest game.
    public static let recencyWeightLast1 = 0.60
    public static let rolePriorWeight = 0.30
    /// Fumbles per touch, and the share of those lost.
    public static let fumbleRate = 0.010
    public static let fumbleLostShare = 0.5
    /// Long catches per target, for backs (not shrunk; the reference's constants).
    public static let catch30PerTarget = 0.010
    public static let catch40PerTarget = 0.005
    public static let catch50PerTarget = 0.0025
    public static let thinSampleCarries = 20.0
    /// Share of 40+ and 50+ yard runs that are touchdowns — heuristic, for the
    /// long-TD bonuses the reference engine does not model.
    public static let touchdownShareOf40 = 0.35
    public static let touchdownShareOf50 = 0.45

    public static func riskWeight(_ risk: StreamRiskMode) -> Double {
        switch risk {
        case .floor: return -0.5
        case .neutral: return -0.2
        case .ceiling: return 0.25
        }
    }
}

// MARK: - Scoring

/// The league's rushing and receiving scoring, with long-play tiers
/// **stacked** (a 45-yard run earns `bonus30 + bonus40`) and kept separately
/// for runs and catches, because leagues pay them differently.
///
/// Sleeper's `_30_39` keys are ranges and `_40p`/`_50p` thresholds, converted
/// as for WR. A lost fumble records both `fum` and `fum_lost`, so the lost
/// penalty is on top of the fumble one.
public struct RBScoring: Codable, Sendable, Hashable {
    public var reception: Double
    public var rushingYard: Double
    public var receivingYard: Double
    public var firstDown: Double
    public var touchdown: Double
    public var runBonus30: Double
    public var runBonus40: Double
    public var runBonus50: Double
    public var catchBonus30: Double
    public var catchBonus40: Double
    public var catchBonus50: Double
    public var fumble: Double
    public var fumbleLost: Double
    public var touchdownBonus40: Double
    public var touchdownBonus50: Double

    public init(reception: Double = 0, rushingYard: Double = 0, receivingYard: Double = 0, firstDown: Double = 0,
                touchdown: Double = 0, runBonus30: Double = 0, runBonus40: Double = 0, runBonus50: Double = 0,
                catchBonus30: Double = 0, catchBonus40: Double = 0, catchBonus50: Double = 0,
                fumble: Double = 0, fumbleLost: Double = 0, touchdownBonus40: Double = 0, touchdownBonus50: Double = 0) {
        self.reception = reception; self.rushingYard = rushingYard; self.receivingYard = receivingYard
        self.firstDown = firstDown; self.touchdown = touchdown
        self.runBonus30 = runBonus30; self.runBonus40 = runBonus40; self.runBonus50 = runBonus50
        self.catchBonus30 = catchBonus30; self.catchBonus40 = catchBonus40; self.catchBonus50 = catchBonus50
        self.fumble = fumble; self.fumbleLost = fumbleLost
        self.touchdownBonus40 = touchdownBonus40; self.touchdownBonus50 = touchdownBonus50
    }

    /// The reference engine's defaults: 0 PPR, 0.1/yd, 1/first down, 6/TD,
    /// fumble −3 (−2 more lost), long-play bonuses unset.
    public static let referenceDefaults = RBScoring(
        reception: 0, rushingYard: 0.1, receivingYard: 0.1, firstDown: 1, touchdown: 6, fumble: -3, fumbleLost: -2
    )

    /// The reference's single set of long-play bonuses, applied to runs and catches alike.
    public mutating func setLongPlayBonuses(_ b30: Double, _ b40: Double, _ b50: Double) {
        runBonus30 = b30; runBonus40 = b40; runBonus50 = b50
        catchBonus30 = b30; catchBonus40 = b40; catchBonus50 = b50
    }

    public static func from(sleeperSettings s: [String: Double]) -> RBScoring {
        func tiers(_ prefix: String) -> (Double, Double, Double) {
            let range30 = s["\(prefix)_30_39"] ?? 0
            let over40 = s["\(prefix)_40p"] ?? 0
            let over50 = s["\(prefix)_50p"]
            return (range30, over40 - range30, over50.map { $0 - over40 } ?? 0)
        }
        let run = tiers("rush"), catches = tiers("rec")
        return RBScoring(
            reception: s["rec"] ?? 0,
            rushingYard: s["rush_yd"] ?? 0,
            receivingYard: s["rec_yd"] ?? 0,
            firstDown: s["rush_fd"] ?? 0,
            touchdown: s["rush_td"] ?? 0,
            runBonus30: run.0, runBonus40: run.1, runBonus50: run.2,
            catchBonus30: catches.0, catchBonus40: catches.1, catchBonus50: catches.2,
            fumble: s["fum"] ?? 0,
            fumbleLost: s["fum_lost"] ?? 0,
            touchdownBonus40: s["rush_td_40p"] ?? 0,
            touchdownBonus50: s["rush_td_50p"] ?? 0
        )
    }

    public var hasLongPlayBonuses: Bool {
        [runBonus30, runBonus40, runBonus50, catchBonus30, catchBonus40, catchBonus50].contains { $0 != 0 }
    }

    static let modelledKeys: Set<String> = [
        "rec", "rec_yd", "rush_yd", "rec_fd", "rush_fd", "rec_td", "rush_td", "rush_att",
        "rush_30_39", "rush_40p", "rush_50p", "rec_30_39", "rec_40p", "rec_50p",
        "rush_td_40p", "rush_td_50p", "fum", "fum_lost",
    ]

    /// Rushing keys the league pays for that are not projected, named on
    /// screen rather than dropped.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { key, value in
            value != 0 && !modelledKeys.contains(key)
                && (key.hasPrefix("rush") || key.hasPrefix("bonus_rush") || key == "bonus_fd_rb" || key == "bonus_rec_rb")
        }
        .map(\.key)
        .sorted()
    }
}

// MARK: - Candidate (input)

public struct RBCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: RBRole
    public var opponent: String
    public var home: Bool?
    /// His team's spread: positive = underdog.
    public var spreadOff: Double
    public var total: Double
    public var teamRushAttempts: Double
    public var teamPassAttempts: Double
    public var teamGames: Int
    public var carryShareLast1: Double?
    public var carryShareLast3: Double?
    public var carryShareEst: Double?
    public var targetShareLast1: Double?
    public var targetShareLast3: Double?
    public var snapShare: Double?
    public var roleConf: Double
    /// Share of team red-zone carries; `nil` uses the role's neutral share.
    public var redZoneShare: Double?
    public var statCarries: Double
    public var rushYards: Double
    public var rushFirstDowns: Double?
    public var rushTouchdowns: Double
    /// Runs of 30+, 40+ and 50+ yards — cumulative.
    public var runs30: Double
    public var runs40: Double
    public var runs50: Double
    public var statTargets: Double
    public var receptions: Double?
    public var receivingYards: Double
    public var receivingFirstDowns: Double?
    public var receivingTouchdowns: Double
    public var dvpPct: Double
    public var dvpGames: Int
    /// O-line / box-count / front-seven-injury adjustment; 1.0 neutral.
    public var lineAdj: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, role: RBRole, opponent: String, home: Bool? = nil,
                spreadOff: Double = 0, total: Double = 45, teamRushAttempts: Double = 0, teamPassAttempts: Double = 0,
                teamGames: Int = 0, carryShareLast1: Double? = nil, carryShareLast3: Double? = nil,
                carryShareEst: Double? = nil, targetShareLast1: Double? = nil, targetShareLast3: Double? = nil,
                snapShare: Double? = nil, roleConf: Double = 0.7, redZoneShare: Double? = nil,
                statCarries: Double = 0, rushYards: Double = 0, rushFirstDowns: Double? = nil, rushTouchdowns: Double = 0,
                runs30: Double = 0, runs40: Double = 0, runs50: Double = 0, statTargets: Double = 0,
                receptions: Double? = nil, receivingYards: Double = 0, receivingFirstDowns: Double? = nil,
                receivingTouchdowns: Double = 0, dvpPct: Double = 0, dvpGames: Int = 0, lineAdj: Double = 1,
                practice: StreamPractice = .none, rosterPct: Double? = nil, available: Bool? = nil,
                notes: String = "", sources: [String] = [], dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.role = role; self.opponent = opponent; self.home = home
        self.spreadOff = spreadOff; self.total = total; self.teamRushAttempts = teamRushAttempts
        self.teamPassAttempts = teamPassAttempts; self.teamGames = teamGames
        self.carryShareLast1 = carryShareLast1; self.carryShareLast3 = carryShareLast3; self.carryShareEst = carryShareEst
        self.targetShareLast1 = targetShareLast1; self.targetShareLast3 = targetShareLast3; self.snapShare = snapShare
        self.roleConf = roleConf; self.redZoneShare = redZoneShare; self.statCarries = statCarries
        self.rushYards = rushYards; self.rushFirstDowns = rushFirstDowns; self.rushTouchdowns = rushTouchdowns
        self.runs30 = runs30; self.runs40 = runs40; self.runs50 = runs50; self.statTargets = statTargets
        self.receptions = receptions; self.receivingYards = receivingYards; self.receivingFirstDowns = receivingFirstDowns
        self.receivingTouchdowns = receivingTouchdowns; self.dvpPct = dvpPct; self.dvpGames = dvpGames
        self.lineAdj = lineAdj; self.practice = practice; self.rosterPct = rosterPct; self.available = available
        self.notes = notes; self.sources = sources; self.dataFlags = dataFlags; self.playerID = playerID
    }

    /// Keys as the reference JSON spells them after snake-case conversion
    /// (Foundation capitalises the letter after a digit: `rush_30p` → `rush30P`).
    enum CodingKeys: String, CodingKey {
        case name, team, role, opponent = "opp", home, spreadOff, total
        case teamRushAttempts = "teamRushAtt", teamPassAttempts = "teamPassAtt", teamGames
        case carryShareLast1, carryShareLast3, carryShareEst
        case targetShareLast1 = "tgtShareLast1", targetShareLast3 = "tgtShareLast3", snapShare, roleConf
        case redZoneShare = "rzShare", statCarries, rushYards = "rushYd", rushFirstDowns = "rushFd", rushTouchdowns = "rushTd"
        case runs30 = "rush30P", runs40 = "rush40P", runs50 = "rush50P", statTargets
        case receptions = "rec", receivingYards = "recYd", receivingFirstDowns = "recFd", receivingTouchdowns = "recTd"
        case dvpPct, dvpGames, lineAdj, practice, rosterPct, available, notes, sources, dataFlags
        case playerID = "playerId"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func opt(_ key: CodingKeys) throws -> Double? { try c.decodeIfPresent(Double.self, forKey: key) }
        func num(_ key: CodingKeys, _ fallback: Double) throws -> Double { try opt(key) ?? fallback }
        self.init(
            name: try c.decode(String.self, forKey: .name),
            team: try c.decode(String.self, forKey: .team),
            role: try c.decode(RBRole.self, forKey: .role),
            opponent: try c.decodeIfPresent(String.self, forKey: .opponent) ?? "",
            home: try c.decodeIfPresent(Bool.self, forKey: .home),
            spreadOff: try num(.spreadOff, 0), total: try num(.total, 45),
            teamRushAttempts: try num(.teamRushAttempts, 0), teamPassAttempts: try num(.teamPassAttempts, 0),
            teamGames: try c.decodeIfPresent(Int.self, forKey: .teamGames) ?? 0,
            carryShareLast1: try opt(.carryShareLast1), carryShareLast3: try opt(.carryShareLast3),
            carryShareEst: try opt(.carryShareEst), targetShareLast1: try opt(.targetShareLast1),
            targetShareLast3: try opt(.targetShareLast3), snapShare: try opt(.snapShare),
            roleConf: try num(.roleConf, 0.7), redZoneShare: try opt(.redZoneShare),
            statCarries: try num(.statCarries, 0), rushYards: try num(.rushYards, 0),
            rushFirstDowns: try opt(.rushFirstDowns), rushTouchdowns: try num(.rushTouchdowns, 0),
            runs30: try num(.runs30, 0), runs40: try num(.runs40, 0), runs50: try num(.runs50, 0),
            statTargets: try num(.statTargets, 0), receptions: try opt(.receptions),
            receivingYards: try num(.receivingYards, 0), receivingFirstDowns: try opt(.receivingFirstDowns),
            receivingTouchdowns: try num(.receivingTouchdowns, 0), dvpPct: try num(.dvpPct, 0),
            dvpGames: try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0, lineAdj: try num(.lineAdj, 1),
            practice: try c.decodeIfPresent(StreamPractice.self, forKey: .practice) ?? .none,
            rosterPct: try opt(.rosterPct), available: try c.decodeIfPresent(Bool.self, forKey: .available),
            notes: try c.decodeIfPresent(String.self, forKey: .notes) ?? "",
            sources: try c.decodeIfPresent([String].self, forKey: .sources) ?? [],
            dataFlags: try c.decodeIfPresent([String].self, forKey: .dataFlags) ?? [],
            playerID: try c.decodeIfPresent(String.self, forKey: .playerID)
        )
    }
}

// MARK: - Projection (output)

public struct RBProjection: StreamProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: RBRole
    public var opponent: String
    public var playerID: String?
    public var expRushAttempts: Double
    public var expPassAttempts: Double
    public var rushEnv: Double
    public var passEnv: Double
    public var implied: Double
    public var impliedMult: Double
    public var carryShare: Double
    public var targetShare: Double
    public var expCarries: Double
    public var expTargets: Double
    public var dvpMult: Double
    public var lineMult: Double
    public var redZoneMult: Double
    public var eRushYd: Double
    public var eRushFirstDowns: Double
    public var eRushTouchdowns: Double
    public var eRec: Double
    public var eRecYd: Double
    public var eRecFirstDowns: Double
    public var eRecTouchdowns: Double
    /// Long plays of 30+/40+/50+ yards, runs and catches together.
    public var e30: Double
    public var e40: Double
    public var e50: Double
    public var eRun30: Double
    public var eRun40: Double
    public var eRun50: Double
    public var eFumbles: Double
    public var eTouchdowns40: Double
    public var eTouchdowns50: Double
    public var redZoneShare: Double?
    public var meanIfPlays: Double
    public var sdIfPlays: Double
    public var pPlay: Double
    public var expPts: Double
    public var floorP25: Double
    public var ceilingP75: Double
    public var utility: Double
    public var roleConf: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var flags: [String]
    public var notes: String
    public var sources: [String]
    public var explain: [String]
    public var pBeatIncumbent: Double?
    public var expGain: Double?
    public var bidBand: StreamBidBand?

    public var platform: Position { .rb }
    public var roleLabel: String { role.label }
    public var eTouchdowns: Double { eRushTouchdowns + eRecTouchdowns }
    public var eFirstDowns: Double { eRushFirstDowns + eRecFirstDowns }

    /// Expected points by scoring stat, largest first; sums to `meanIfPlays`.
    public func pointsBreakdown(scoring s: RBScoring) -> [StreamStatPoints] {
        let catch30 = e30 - eRun30, catch40 = e40 - eRun40, catch50 = e50 - eRun50
        return [
            StreamStatPoints(stat: "Rush yards", count: eRushYd, points: eRushYd * s.rushingYard),
            StreamStatPoints(stat: "Rec yards", count: eRecYd, points: eRecYd * s.receivingYard),
            StreamStatPoints(stat: "First downs", count: eFirstDowns, points: eFirstDowns * s.firstDown),
            StreamStatPoints(stat: "TD", count: eTouchdowns, points: eTouchdowns * s.touchdown),
            StreamStatPoints(stat: "Receptions", count: eRec, points: eRec * s.reception),
            StreamStatPoints(stat: "Long plays", count: e30,
                             points: eRun30 * s.runBonus30 + eRun40 * s.runBonus40 + eRun50 * s.runBonus50
                                 + catch30 * s.catchBonus30 + catch40 * s.catchBonus40 + catch50 * s.catchBonus50),
            StreamStatPoints(stat: "Long TDs", count: eTouchdowns40,
                             points: eTouchdowns40 * s.touchdownBonus40 + eTouchdowns50 * s.touchdownBonus50),
            StreamStatPoints(stat: "Fumbles", count: eFumbles,
                             points: eFumbles * (s.fumble + RBStreamKnobs.fumbleLostShare * s.fumbleLost)),
        ]
        .filter { $0.points != 0 }
        .sorted { $0.points > $1.points }
    }
}

// MARK: - Engine

public enum RBStreamEngine {
    typealias M = StreamMath
    typealias K = RBStreamKnobs

    // Stage 1 — opportunity

    static func teamVolume(_ c: RBCandidate) -> (rush: Double, pass: Double, rushEnv: Double, passEnv: Double) {
        let g = Double(c.teamGames)
        let rushBase = M.shrink(c.teamGames > 0 ? c.teamRushAttempts / g : nil, g, K.leagueAverageRushAttempts, K.volumeShrinkGames)
        let passBase = M.shrink(c.teamGames > 0 ? c.teamPassAttempts / g : nil, g, K.leagueAveragePassAttempts, K.volumeShrinkGames)
        let lo = K.environmentRange.lowerBound, hi = K.environmentRange.upperBound
        let rushEnv = M.clamp(1 + K.rushTotalSlope * (c.total - 45) + K.rushSpreadSlope * c.spreadOff, lo, hi)
        let passEnv = M.clamp(1 + K.passTotalSlope * (c.total - 45) + K.passSpreadSlope * c.spreadOff, lo, hi)
        return (rushBase * rushEnv, passBase * passEnv, rushEnv, passEnv)
    }

    static func recencyShare(_ last1: Double?, _ last3: Double?, _ est: Double?, prior: Double, roleConf: Double) -> Double {
        let w1 = K.recencyWeightLast1
        let observed: Double
        if let l1 = last1, let l3 = last3 {
            observed = w1 * l1 + (1 - w1) * l3
        } else if let l1 = last1 {
            observed = l1
        } else if let l3 = last3 {
            observed = l3
        } else if let est {
            observed = est
        } else {
            observed = prior
        }
        let pull = K.rolePriorWeight * (1 - roleConf)
        return (1 - pull) * observed + pull * prior
    }

    /// Points the team is expected to score (a favorite's spread is negative).
    static func implied(_ c: RBCandidate) -> (implied: Double, mult: Double) {
        let implied = (c.total - c.spreadOff) / 2
        return (implied, M.clamp(implied / K.leagueAverageImplied, K.impliedRange.lowerBound, K.impliedRange.upperBound))
    }

    // Stage 2 — conversion

    struct Rates {
        var ypc, rushFd, rushTd, r30, r40, r50, catchRate, yardsPerCatch, catchFd, catchTd: Double
    }

    static func conversionRates(_ c: RBCandidate, _ p: RBPrior) -> Rates {
        let n = c.statCarries
        func perCarry(_ x: Double) -> Double? { n > 0 ? x / n : nil }
        let ypc = M.shrink(perCarry(c.rushYards), n, p.yardsPerCarry, K.ypcShrinkK)
        let rushFd = M.shrink(c.rushFirstDowns.flatMap(perCarry), n, p.rushFirstDowns, K.rushFirstDownShrinkK)
        let rushTd = M.shrink(perCarry(c.rushTouchdowns), n, p.rushTouchdowns, K.rushTouchdownShrinkK)
        let r30 = M.shrink(perCarry(c.runs30), n, p.run30, K.longRunShrinkK)
        let r40 = min(M.shrink(perCarry(c.runs40), n, p.run40, K.longRunShrinkK), r30)
        let r50 = min(M.shrink(perCarry(c.runs50), n, p.run50, K.longRunShrinkK), r40)

        let t = c.statTargets
        func perTarget(_ x: Double) -> Double? { t > 0 ? x / t : nil }
        let catchRate = M.shrink(c.receptions.flatMap(perTarget), t, p.catchRate, K.catchShrinkK)
        let ypr = M.shrink(c.receptions.flatMap { $0 > 0 ? c.receivingYards / $0 : nil }, c.receptions ?? 0,
                           p.yardsPerCatch, K.yardsPerCatchShrinkK)
        let catchFd = M.shrink(c.receivingFirstDowns.flatMap(perTarget), t, p.catchFirstDowns, K.catchFirstDownShrinkK)
        let catchTd = M.shrink(perTarget(c.receivingTouchdowns), t, p.catchTouchdowns, K.catchTouchdownShrinkK)
        return Rates(ypc: ypc, rushFd: rushFd, rushTd: rushTd, r30: r30, r40: r40, r50: r50,
                     catchRate: catchRate, yardsPerCatch: ypr, catchFd: catchFd, catchTd: catchTd)
    }

    static func matchupMultipliers(_ c: RBCandidate, _ p: RBPrior) -> (dvp: Double, line: Double, redZone: Double) {
        var dvp = 1.0
        if c.dvpGames > 0 {
            let w = Double(c.dvpGames) / (Double(c.dvpGames) + K.dvpFullWeightGames)
            dvp = 1 + M.clamp(w * c.dvpPct / 100, -K.dvpCap, K.dvpCap)
        }
        let line = 1 + M.clamp(c.lineAdj - 1, -K.lineCap, K.lineCap)
        let neutral = p.redZoneShare
        let rz = c.redZoneShare ?? neutral
        let redZone = 1 + M.clamp((rz - neutral) / neutral, -K.redZoneMultCap, K.redZoneMultCap)
        return (dvp, line, redZone)
    }

    // Projection

    public static func project(_ c: RBCandidate, scoring s: RBScoring, risk: StreamRiskMode = .neutral) -> RBProjection {
        let p = RBStreamPriors.prior(for: c.role)
        let (rushAtt, passAtt, rushEnv, passEnv) = teamVolume(c)
        let carryShare = M.clamp(recencyShare(c.carryShareLast1, c.carryShareLast3, c.carryShareEst,
                                              prior: p.carryShare, roleConf: c.roleConf), 0.02, 0.85)
        let targetShare = M.clamp(recencyShare(c.targetShareLast1, c.targetShareLast3, nil,
                                               prior: p.targetShare, roleConf: c.roleConf), 0, 0.30)
        let carries = rushAtt * carryShare
        let targets = passAtt * targetShare
        let r = conversionRates(c, p)
        let (dvp, line, rzMult) = matchupMultipliers(c, p)
        let (implied, impMult) = implied(c)
        let eff = dvp * line

        let eRushYd = carries * r.ypc * eff
        let eRushFd = carries * r.rushFd * eff
        let eRushTd = carries * r.rushTd * rzMult * impMult * (0.5 + 0.5 * eff)
        let eRec = targets * r.catchRate
        let eRecYd = eRec * r.yardsPerCatch * (0.5 + 0.5 * eff)
        let eRecFd = targets * r.catchFd * (0.5 + 0.5 * eff)
        let eRecTd = targets * r.catchTd * impMult
        let eRun30 = carries * r.r30 * eff, eRun40 = carries * r.r40 * eff, eRun50 = carries * r.r50 * eff
        let eCatch30 = targets * K.catch30PerTarget
        let eCatch40 = targets * K.catch40PerTarget
        let eCatch50 = targets * K.catch50PerTarget
        let eFum = (carries + eRec) * K.fumbleRate
        let eTd40 = eRun40 * K.touchdownShareOf40
        let eTd50 = eRun50 * K.touchdownShareOf50

        let longPlays = eRun30 * s.runBonus30 + eRun40 * s.runBonus40 + eRun50 * s.runBonus50
            + eCatch30 * s.catchBonus30 + eCatch40 * s.catchBonus40 + eCatch50 * s.catchBonus50
        let mean = eRushYd * s.rushingYard + eRecYd * s.receivingYard
            + (eRushFd + eRecFd) * s.firstDown
            + (eRushTd + eRecTd) * s.touchdown
            + eRec * s.reception
            + longPlays
            + eFum * (s.fumble + K.fumbleLostShare * s.fumbleLost)
            + eTd40 * s.touchdownBonus40 + eTd50 * s.touchdownBonus50

        var variance = s.firstDown * s.firstDown * (eRushFd + eRecFd)
        variance += s.touchdown * s.touchdown * (eRushTd + eRecTd)
        variance += s.runBonus30 * s.runBonus30 * eRun30 + s.runBonus40 * s.runBonus40 * eRun40
            + s.runBonus50 * s.runBonus50 * eRun50
        variance += s.catchBonus30 * s.catchBonus30 * eCatch30 + s.catchBonus40 * s.catchBonus40 * eCatch40
            + s.catchBonus50 * s.catchBonus50 * eCatch50
        variance += s.rushingYard * s.rushingYard * (carries * r.ypc * r.ypc * 2.0) // runs are heavy-tailed
        variance += s.receivingYard * s.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
        variance += s.fumble * s.fumble * eFum
        variance += s.touchdownBonus40 * s.touchdownBonus40 * eTd40 + s.touchdownBonus50 * s.touchdownBonus50 * eTd50
        let usageSD = mean * 0.30 * (1 - c.roleConf)
        let sd = (variance + usageSD * usageSD).squareRoot()

        let pPlay = c.practice.playProbability
        let expPts = pPlay * mean
        let z = StreamMath.quartileZ
        let floor = max(0, pPlay * (mean - z * sd))
        let ceiling = pPlay * (mean + z * sd)
        let utility = expPts + K.riskWeight(risk) * sd

        var flags = c.dataFlags
        if c.statCarries < K.thinSampleCarries { flags.append("thin carry sample") }
        if c.carryShareLast1 == nil && c.carryShareLast3 == nil { flags.append("carry share estimated") }
        if c.rushFirstDowns == nil { flags.append("rush first-down rate from role prior") }
        if c.available == nil { flags.append("availability unverified") }
        if !s.hasLongPlayBonuses { flags.append("big-play bonuses = 0 (not yet set)") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let spread = c.spreadOff >= 0 ? "+\(fmt(c.spreadOff, 1))" : fmt(c.spreadOff, 1)
        let explain = [
            "\(fmt(rushAtt, 1)) expected team carries (script ×\(fmt(rushEnv, 3)) from O/U \(fmt(c.total, 1)) and spread \(spread)) × \(Int((carryShare * 100).rounded()))% share → \(fmt(carries, 1)) carries",
            "\(fmt(targets, 1)) targets from \(fmt(passAtt, 1)) team passes × \(Int((targetShare * 100).rounded()))% share",
            "Per carry: \(fmt(r.ypc, 2)) yds, first down \(Int((r.rushFd * 100).rounded()))%, TD \(fmt(r.rushTd * 100, 1))%",
            "Implied team total \(fmt(implied, 1)) (TD ×\(fmt(impMult, 2))) · run D ×\(fmt(dvp, 3)) · line ×\(fmt(line, 2)) · red zone ×\(fmt(rzMult, 2))",
            "P(plays) \(Int((pPlay * 100).rounded()))% (\(c.practice.label))",
        ]

        return RBProjection(
            name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
            expRushAttempts: rushAtt, expPassAttempts: passAtt, rushEnv: rushEnv, passEnv: passEnv,
            implied: implied, impliedMult: impMult, carryShare: carryShare, targetShare: targetShare,
            expCarries: carries, expTargets: targets, dvpMult: dvp, lineMult: line, redZoneMult: rzMult,
            eRushYd: eRushYd, eRushFirstDowns: eRushFd, eRushTouchdowns: eRushTd,
            eRec: eRec, eRecYd: eRecYd, eRecFirstDowns: eRecFd, eRecTouchdowns: eRecTd,
            e30: eRun30 + eCatch30, e40: eRun40 + eCatch40, e50: eRun50 + eCatch50,
            eRun30: eRun30, eRun40: eRun40, eRun50: eRun50, eFumbles: eFum,
            eTouchdowns40: eTd40, eTouchdowns50: eTd50, redZoneShare: c.redZoneShare,
            meanIfPlays: mean, sdIfPlays: sd, pPlay: pPlay, expPts: expPts,
            floorP25: floor, ceilingP75: ceiling, utility: utility,
            roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
            flags: flags, notes: c.notes, sources: c.sources, explain: explain,
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    private static func fmt(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }

    public static func report(candidates: [RBCandidate], scoring: RBScoring, incumbentID: String? = nil,
                              risk: StreamRiskMode = .neutral, onlyAvailable: Bool = false) -> RBStreamReport {
        StreamDecision.report(
            projections: candidates.map { project($0, scoring: scoring, risk: risk) },
            incumbentID: incumbentID, onlyAvailable: onlyAvailable
        )
    }
}

public typealias RBStreamReport = StreamReport<RBProjection>
public typealias RBComparison = StreamComparison<RBProjection>
