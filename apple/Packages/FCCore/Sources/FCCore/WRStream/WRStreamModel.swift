import Foundation

// WR streaming model: a two-stage opportunity × conversion projection for one
// week, denominated in the league's own points. Built for no-PPR, first-down
// scoring, where a catch is worth nothing until it moves the chains, gains
// yards, scores or goes long — so the rates that matter are first downs per
// target, air yards (the long-catch tiers) and red-zone share (TDs).
//
// Ported from the reference engine (`wr_stream.py`). Formulas and constants are
// unchanged so the parity test can pin this port to the reference output. The
// one addition is long-TD bonuses (40+/50+ yard TDs), which this league pays
// and the reference does not model; they contribute nothing when unscored.
//
// Every prior and knob is heuristic until a backtest has data.

// MARK: - Roles

/// How a receiver is used — the unit the priors are set on, because a slot
/// chain-mover and a boundary deep threat turn targets into points differently.
public enum WRRole: String, Codable, CaseIterable, Sendable {
    case alpha = "ALPHA"
    case boundary = "BOUNDARY"
    case deep = "DEEP"
    case slot = "SLOT"
    case gadget = "GADGET"

    public var label: String {
        switch self {
        case .alpha: return "Alpha"
        case .boundary: return "Boundary"
        case .deep: return "Deep"
        case .slot: return "Slot"
        case .gadget: return "Gadget"
        }
    }

    public var summary: String {
        switch self {
        case .alpha: return "True WR1, all-field usage"
        case .boundary: return "Outside X/Z, intermediate and deep"
        case .deep: return "Low-volume field stretcher"
        case .slot: return "Chain-mover, short aDOT"
        case .gadget: return "Screens, motion, jet sweeps"
        }
    }
}

/// Per-target priors for one role.
public struct WRPrior: Sendable, Hashable {
    public var catchRate: Double
    public var yardsPerCatch: Double
    public var firstDowns: Double
    public var touchdowns: Double
    public var p30: Double
    public var p40: Double
    public var p50: Double
}

public enum WRStreamPriors {
    public static func prior(for role: WRRole) -> WRPrior {
        switch role {
        case .alpha: return WRPrior(catchRate: 0.63, yardsPerCatch: 13.5, firstDowns: 0.38, touchdowns: 0.055, p30: 0.055, p40: 0.032, p50: 0.016)
        case .boundary: return WRPrior(catchRate: 0.58, yardsPerCatch: 14.5, firstDowns: 0.36, touchdowns: 0.050, p30: 0.070, p40: 0.042, p50: 0.022)
        case .deep: return WRPrior(catchRate: 0.48, yardsPerCatch: 17.5, firstDowns: 0.33, touchdowns: 0.055, p30: 0.110, p40: 0.075, p50: 0.042)
        case .slot: return WRPrior(catchRate: 0.70, yardsPerCatch: 10.5, firstDowns: 0.40, touchdowns: 0.040, p30: 0.030, p40: 0.015, p50: 0.006)
        case .gadget: return WRPrior(catchRate: 0.72, yardsPerCatch: 9.0, firstDowns: 0.30, touchdowns: 0.035, p30: 0.030, p40: 0.018, p50: 0.008)
        }
    }

    public static func targetShare(for role: WRRole) -> Double {
        switch role {
        case .alpha: return 0.26
        case .boundary: return 0.18
        case .deep: return 0.12
        case .slot: return 0.17
        case .gadget: return 0.11
        }
    }
}

public enum WRStreamKnobs {
    public static let leagueAveragePassAttempts = 33.5
    public static let passAttemptsShrinkGames = 3.0
    public static let totalSlope = 0.006
    public static let spreadSlope = 0.008
    public static let environmentRange = 0.82...1.18
    public static let catchShrinkK = 30.0
    public static let ypcShrinkK = 20.0
    public static let firstDownShrinkK = 30.0
    public static let touchdownShrinkK = 120.0
    public static let bigPlayShrinkK = 150.0
    public static let dvpFullWeightGames = 6.0
    public static let dvpCap = 0.15
    public static let coverageCap = 0.30
    public static let redZoneMultCap = 0.60
    public static let neutralRedZoneShare = 0.18
    public static let recencyWeightLast1 = 0.55
    public static let rolePriorWeight = 0.30
    /// ~1.5% of catches are fumbled, league-wide.
    public static let fumblesPerCatch = 0.015
    /// Below this many targets the conversion sample is flagged as thin.
    public static let thinSampleTargets = 15.0
    /// Share of 40+ and 50+ yard catches that are touchdowns — heuristic, for
    /// the long-TD bonuses the reference engine does not model.
    public static let touchdownShareOf40 = 0.30
    public static let touchdownShareOf50 = 0.40

    /// SD weight added to expected points to form utility, by risk setting.
    public static func riskWeight(_ risk: StreamRiskMode) -> Double {
        switch risk {
        case .floor: return -0.5
        case .neutral: return -0.2
        case .ceiling: return 0.25
        }
    }
}

// MARK: - Scoring

/// The league's receiving scoring, per event, with the long-catch tiers
/// **stacked**: a 45-yard catch earns `bonus30 + bonus40`.
///
/// Sleeper's keys are not stacked — `rec_30_39` is a range and `rec_40p` a
/// threshold — so `from(sleeperSettings:)` converts: `bonus40 = rec_40p −
/// rec_30_39`, which makes a 40+ catch total exactly `rec_40p`. Long-TD keys
/// are thresholds that both apply (a 55-yard TD has `rec_td_40p` and
/// `rec_td_50p`), so they stack as they are.
public struct WRScoring: Codable, Sendable, Hashable {
    public var reception: Double
    public var receivingYard: Double
    public var rushingYard: Double
    public var firstDown: Double
    public var touchdown: Double
    public var bonus30: Double
    public var bonus40: Double
    public var bonus50: Double
    public var fumble: Double
    public var fumbleLost: Double
    public var touchdownBonus40: Double
    public var touchdownBonus50: Double

    public init(reception: Double = 0, receivingYard: Double = 0, rushingYard: Double = 0, firstDown: Double = 0,
                touchdown: Double = 0, bonus30: Double = 0, bonus40: Double = 0, bonus50: Double = 0,
                fumble: Double = 0, fumbleLost: Double = 0, touchdownBonus40: Double = 0, touchdownBonus50: Double = 0) {
        self.reception = reception; self.receivingYard = receivingYard; self.rushingYard = rushingYard
        self.firstDown = firstDown; self.touchdown = touchdown
        self.bonus30 = bonus30; self.bonus40 = bonus40; self.bonus50 = bonus50
        self.fumble = fumble; self.fumbleLost = fumbleLost
        self.touchdownBonus40 = touchdownBonus40; self.touchdownBonus50 = touchdownBonus50
    }

    /// The reference engine's defaults: 0 PPR, 0.1/yd, 1/first down, 6/TD,
    /// fumble −3 (−5 lost), long-catch bonuses unset.
    public static let referenceDefaults = WRScoring(
        reception: 0, receivingYard: 0.1, rushingYard: 0.1, firstDown: 1, touchdown: 6,
        fumble: -3, fumbleLost: -2
    )

    public static func from(sleeperSettings s: [String: Double]) -> WRScoring {
        let range30 = s["rec_30_39"] ?? 0
        let over40 = s["rec_40p"] ?? 0
        let over50 = s["rec_50p"]
        return WRScoring(
            reception: s["rec"] ?? 0,
            receivingYard: s["rec_yd"] ?? 0,
            rushingYard: s["rush_yd"] ?? 0,
            firstDown: s["rec_fd"] ?? 0,
            touchdown: s["rec_td"] ?? 0,
            bonus30: range30,
            bonus40: over40 - range30,
            bonus50: over50.map { $0 - over40 } ?? 0,
            fumble: s["fum"] ?? 0,
            fumbleLost: s["fum_lost"] ?? 0,
            touchdownBonus40: s["rec_td_40p"] ?? 0,
            touchdownBonus50: s["rec_td_50p"] ?? 0
        )
    }

    public var hasLongCatchBonuses: Bool { bonus30 != 0 || bonus40 != 0 || bonus50 != 0 }

    static let modelledKeys: Set<String> = [
        "rec", "rec_yd", "rush_yd", "rec_fd", "rush_fd", "rec_td", "rush_td", "rec_30_39", "rec_40p", "rec_50p",
        "rec_td_40p", "rec_td_50p", "fum", "fum_lost",
    ]

    /// Receiving keys the league pays for that are not projected — named on
    /// screen rather than dropped. Yardage-game bonuses and two-point
    /// conversions are rare enough that projecting them would be noise.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { key, value in
            value != 0 && !modelledKeys.contains(key)
                && (key.hasPrefix("rec") || key.hasPrefix("bonus_rec") || key == "bonus_fd_wr")
        }
        .map(\.key)
        .sorted()
    }
}

// MARK: - Candidate (input)

public struct WRCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: WRRole
    public var opponent: String
    public var home: Bool?
    /// From the receiver's team perspective: positive = his team is the underdog.
    public var spreadOff: Double
    public var total: Double
    public var teamPassAttempts: Double
    public var teamGames: Int
    public var targetShareLast1: Double?
    public var targetShareLast3: Double?
    public var targetShareEst: Double?
    /// Routes run / team dropbacks; stabilizes target share early.
    public var routeShare: Double?
    public var roleConf: Double
    /// Share of team red-zone targets; `nil` uses the neutral 18%.
    public var redZoneShare: Double?
    public var statTargets: Double
    public var receptions: Double?
    public var receivingYards: Double
    public var firstDowns: Double?
    public var touchdowns: Double
    /// Catches of 30+, 40+ and 50+ yards — cumulative, so a 45-yard catch counts in 30+ and 40+.
    public var catches30: Double
    public var catches40: Double
    public var catches50: Double
    public var adot: Double?
    public var rushAttemptsPerGame: Double
    public var rushYardsPerCarry: Double
    public var rushFirstDownRate: Double
    public var dvpPct: Double
    public var dvpGames: Int
    /// 1.0 neutral; below for a shadow corner or elite man coverage, above for
    /// an injured secondary or zone-heavy defense.
    public var coverageAdj: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, role: WRRole, opponent: String, home: Bool? = nil,
                spreadOff: Double = 0, total: Double = 45, teamPassAttempts: Double = 0, teamGames: Int = 0,
                targetShareLast1: Double? = nil, targetShareLast3: Double? = nil, targetShareEst: Double? = nil,
                routeShare: Double? = nil, roleConf: Double = 0.7, redZoneShare: Double? = nil,
                statTargets: Double = 0, receptions: Double? = nil, receivingYards: Double = 0,
                firstDowns: Double? = nil, touchdowns: Double = 0, catches30: Double = 0, catches40: Double = 0,
                catches50: Double = 0, adot: Double? = nil, rushAttemptsPerGame: Double = 0,
                rushYardsPerCarry: Double = 6, rushFirstDownRate: Double = 0.25, dvpPct: Double = 0,
                dvpGames: Int = 0, coverageAdj: Double = 1, practice: StreamPractice = .none,
                rosterPct: Double? = nil, available: Bool? = nil, notes: String = "",
                sources: [String] = [], dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.role = role; self.opponent = opponent; self.home = home
        self.spreadOff = spreadOff; self.total = total; self.teamPassAttempts = teamPassAttempts
        self.teamGames = teamGames; self.targetShareLast1 = targetShareLast1; self.targetShareLast3 = targetShareLast3
        self.targetShareEst = targetShareEst; self.routeShare = routeShare; self.roleConf = roleConf
        self.redZoneShare = redZoneShare; self.statTargets = statTargets; self.receptions = receptions
        self.receivingYards = receivingYards; self.firstDowns = firstDowns; self.touchdowns = touchdowns
        self.catches30 = catches30; self.catches40 = catches40; self.catches50 = catches50; self.adot = adot
        self.rushAttemptsPerGame = rushAttemptsPerGame; self.rushYardsPerCarry = rushYardsPerCarry
        self.rushFirstDownRate = rushFirstDownRate; self.dvpPct = dvpPct; self.dvpGames = dvpGames
        self.coverageAdj = coverageAdj; self.practice = practice; self.rosterPct = rosterPct
        self.available = available; self.notes = notes; self.sources = sources; self.dataFlags = dataFlags
        self.playerID = playerID
    }

    /// Keys as the reference JSON spells them after snake-case conversion.
    enum CodingKeys: String, CodingKey {
        case name, team, role, opponent = "opp", home, spreadOff, total, teamPassAttempts = "teamPassAtt", teamGames
        case targetShareLast1 = "tgtShareLast1", targetShareLast3 = "tgtShareLast3", targetShareEst = "tgtShareEst"
        case routeShare, roleConf, redZoneShare = "rzShare", statTargets, receptions = "rec", receivingYards = "recYd"
        case firstDowns = "recFd", touchdowns = "recTd", catches30 = "rec30P", catches40 = "rec40P", catches50 = "rec50P"
        case adot, rushAttemptsPerGame = "rushAttPg", rushYardsPerCarry = "rushYpc", rushFirstDownRate = "rushFdRate"
        case dvpPct, dvpGames, coverageAdj, practice, rosterPct, available, notes, sources, dataFlags
        case playerID = "playerId"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func opt(_ key: CodingKeys) throws -> Double? { try c.decodeIfPresent(Double.self, forKey: key) }
        func num(_ key: CodingKeys, _ fallback: Double) throws -> Double { try opt(key) ?? fallback }
        self.init(
            name: try c.decode(String.self, forKey: .name),
            team: try c.decode(String.self, forKey: .team),
            role: try c.decode(WRRole.self, forKey: .role),
            opponent: try c.decodeIfPresent(String.self, forKey: .opponent) ?? "",
            home: try c.decodeIfPresent(Bool.self, forKey: .home),
            spreadOff: try num(.spreadOff, 0), total: try num(.total, 45),
            teamPassAttempts: try num(.teamPassAttempts, 0),
            teamGames: try c.decodeIfPresent(Int.self, forKey: .teamGames) ?? 0,
            targetShareLast1: try opt(.targetShareLast1), targetShareLast3: try opt(.targetShareLast3),
            targetShareEst: try opt(.targetShareEst), routeShare: try opt(.routeShare),
            roleConf: try num(.roleConf, 0.7), redZoneShare: try opt(.redZoneShare),
            statTargets: try num(.statTargets, 0), receptions: try opt(.receptions),
            receivingYards: try num(.receivingYards, 0), firstDowns: try opt(.firstDowns),
            touchdowns: try num(.touchdowns, 0), catches30: try num(.catches30, 0),
            catches40: try num(.catches40, 0), catches50: try num(.catches50, 0), adot: try opt(.adot),
            rushAttemptsPerGame: try num(.rushAttemptsPerGame, 0), rushYardsPerCarry: try num(.rushYardsPerCarry, 6),
            rushFirstDownRate: try num(.rushFirstDownRate, 0.25), dvpPct: try num(.dvpPct, 0),
            dvpGames: try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0,
            coverageAdj: try num(.coverageAdj, 1),
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

public struct WRProjection: StreamProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: WRRole
    public var opponent: String
    public var playerID: String?
    public var expPassAttempts: Double
    public var envMult: Double
    public var targetShare: Double
    public var expTargets: Double
    public var dvpMult: Double
    public var coverageMult: Double
    public var redZoneMult: Double
    public var eRec: Double
    public var eRecYd: Double
    public var eFirstDowns: Double
    public var eTouchdowns: Double
    public var e30: Double
    public var e40: Double
    public var e50: Double
    public var eRushYd: Double
    public var eRushFirstDowns: Double
    public var eTouchdowns40: Double
    public var eTouchdowns50: Double
    public var adot: Double?
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

    public var platform: Position { .wr }
    public var roleLabel: String { role.label }

    /// Expected points by scoring stat, largest first; sums to `meanIfPlays`.
    public func pointsBreakdown(scoring: WRScoring) -> [StreamStatPoints] {
        let yards = eRecYd * scoring.receivingYard + eRushYd * scoring.rushingYard
        return [
            StreamStatPoints(stat: "Yards", count: eRecYd + eRushYd, points: yards),
            StreamStatPoints(stat: "First downs", count: eFirstDowns + eRushFirstDowns, points: (eFirstDowns + eRushFirstDowns) * scoring.firstDown),
            StreamStatPoints(stat: "TD", count: eTouchdowns, points: eTouchdowns * scoring.touchdown),
            StreamStatPoints(stat: "Receptions", count: eRec, points: eRec * scoring.reception),
            StreamStatPoints(stat: "Long catches", count: e30,
                             points: e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50),
            StreamStatPoints(stat: "Long TDs", count: eTouchdowns40,
                             points: eTouchdowns40 * scoring.touchdownBonus40 + eTouchdowns50 * scoring.touchdownBonus50),
            StreamStatPoints(stat: "Fumbles", count: WRStreamKnobs.fumblesPerCatch * eRec,
                             points: -(WRStreamKnobs.fumblesPerCatch * eRec) * abs(scoring.fumble)),
        ]
        .filter { $0.points != 0 }
        .sorted { $0.points > $1.points }
    }
}

// MARK: - Engine

public enum WRStreamEngine {
    typealias M = StreamMath

    // Stage 1 — opportunity

    static func expectedPassAttempts(_ c: WRCandidate) -> (attempts: Double, environment: Double) {
        let perGame: Double? = c.teamGames > 0 ? c.teamPassAttempts / Double(c.teamGames) : nil
        let base = M.shrink(perGame, Double(c.teamGames), WRStreamKnobs.leagueAveragePassAttempts, WRStreamKnobs.passAttemptsShrinkGames)
        let range = WRStreamKnobs.environmentRange
        let env = M.clamp(1 + WRStreamKnobs.totalSlope * (c.total - 45) + WRStreamKnobs.spreadSlope * c.spreadOff,
                          range.lowerBound, range.upperBound)
        return (base * env, env)
    }

    static func projectedTargetShare(_ c: WRCandidate) -> Double {
        let w1 = WRStreamKnobs.recencyWeightLast1
        let observed: Double
        if let l1 = c.targetShareLast1, let l3 = c.targetShareLast3 {
            observed = w1 * l1 + (1 - w1) * l3
        } else if let l1 = c.targetShareLast1 {
            observed = l1
        } else if let l3 = c.targetShareLast3 {
            observed = l3
        } else if let est = c.targetShareEst {
            observed = est
        } else {
            observed = WRStreamPriors.targetShare(for: c.role)
        }
        // A receiver running most routes with a small share is likelier to grow.
        var rolePrior = WRStreamPriors.targetShare(for: c.role)
        if let routes = c.routeShare {
            rolePrior = 0.5 * rolePrior + 0.5 * (rolePrior * routes / 0.80)
        }
        let pull = WRStreamKnobs.rolePriorWeight * (1 - c.roleConf)
        return M.clamp((1 - pull) * observed + pull * rolePrior, 0.02, 0.45)
    }

    // Stage 2 — conversion

    struct Rates {
        var catchRate, yardsPerCatch, firstDowns, touchdowns, p30, p40, p50: Double
    }

    static func conversionRates(_ c: WRCandidate, _ prior: WRPrior) -> Rates {
        let n = c.statTargets
        let receptions = c.receptions
        let catchRate = M.shrink(receptions.flatMap { n > 0 ? $0 / n : nil }, n, prior.catchRate, WRStreamKnobs.catchShrinkK)
        var ypc = M.shrink(receptions.flatMap { $0 > 0 ? c.receivingYards / $0 : nil }, receptions ?? 0,
                           prior.yardsPerCatch, WRStreamKnobs.ypcShrinkK)
        // aDOT sanity: a "slot" running a 14-yard aDOT has the wrong YPC prior.
        if let adot = c.adot {
            ypc = 0.7 * ypc + 0.3 * (adot * 0.75 + 4.5)
        }
        func perTarget(_ x: Double) -> Double? { n > 0 ? x / n : nil }
        let firstDowns = M.shrink(c.firstDowns.flatMap(perTarget), n, prior.firstDowns, WRStreamKnobs.firstDownShrinkK)
        let touchdowns = M.shrink(perTarget(c.touchdowns), n, prior.touchdowns, WRStreamKnobs.touchdownShrinkK)
        let k = WRStreamKnobs.bigPlayShrinkK
        let p30 = M.shrink(perTarget(c.catches30), n, prior.p30, k)
        let p40 = min(M.shrink(perTarget(c.catches40), n, prior.p40, k), p30)
        let p50 = min(M.shrink(perTarget(c.catches50), n, prior.p50, k), p40)
        return Rates(catchRate: catchRate, yardsPerCatch: ypc, firstDowns: firstDowns, touchdowns: touchdowns,
                     p30: p30, p40: p40, p50: p50)
    }

    static func matchupMultipliers(_ c: WRCandidate) -> (dvp: Double, coverage: Double, redZone: Double) {
        var dvp = 1.0
        if c.dvpGames > 0 {
            let w = Double(c.dvpGames) / (Double(c.dvpGames) + WRStreamKnobs.dvpFullWeightGames)
            dvp = 1 + M.clamp(w * c.dvpPct / 100, -WRStreamKnobs.dvpCap, WRStreamKnobs.dvpCap)
        }
        let coverage = 1 + M.clamp(c.coverageAdj - 1, -WRStreamKnobs.coverageCap, WRStreamKnobs.coverageCap)
        let rz = c.redZoneShare ?? WRStreamKnobs.neutralRedZoneShare
        let neutral = WRStreamKnobs.neutralRedZoneShare
        let redZone = 1 + M.clamp((rz - neutral) / neutral, -WRStreamKnobs.redZoneMultCap, WRStreamKnobs.redZoneMultCap)
        return (dvp, coverage, redZone)
    }

    // Projection

    public static func project(_ c: WRCandidate, scoring: WRScoring, risk: StreamRiskMode = .neutral) -> WRProjection {
        let prior = WRStreamPriors.prior(for: c.role)
        let (attempts, env) = expectedPassAttempts(c)
        let share = projectedTargetShare(c)
        let targets = attempts * share
        let r = conversionRates(c, prior)
        let (dvpMult, covMult, rzMult) = matchupMultipliers(c)

        // The matchup acts on efficiency, not raw targets.
        let eff = dvpMult * covMult
        let eRec = targets * r.catchRate * (0.5 + 0.5 * eff)
        let eRecYd = eRec * r.yardsPerCatch * eff
        let eFd = targets * r.firstDowns * eff
        let eTd = targets * r.touchdowns * rzMult * (0.5 + 0.5 * eff)
        let e30 = targets * r.p30 * eff
        let e40 = targets * r.p40 * eff
        let e50 = targets * r.p50 * eff
        let eRushYd = c.rushAttemptsPerGame * c.rushYardsPerCarry
        let eRushFd = c.rushAttemptsPerGame * c.rushFirstDownRate
        let eTd40 = e40 * WRStreamKnobs.touchdownShareOf40
        let eTd50 = e50 * WRStreamKnobs.touchdownShareOf50

        // The reference scores rushing yards at the receiving rate (equal in this league).
        let yards = (eRecYd + eRushYd) * scoring.receivingYard
        let mean = yards
            + (eFd + eRushFd) * scoring.firstDown
            + eTd * scoring.touchdown
            + eRec * scoring.reception
            + e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50
            - (WRStreamKnobs.fumblesPerCatch * eRec) * abs(scoring.fumble)
            + eTd40 * scoring.touchdownBonus40 + eTd50 * scoring.touchdownBonus50

        // Each scoring event roughly Poisson in count; yards compound and lumpy.
        var variance = scoring.firstDown * scoring.firstDown * (eFd + eRushFd)
            + scoring.touchdown * scoring.touchdown * eTd
            + scoring.bonus30 * scoring.bonus30 * e30 + scoring.bonus40 * scoring.bonus40 * e40
            + scoring.bonus50 * scoring.bonus50 * e50
            + scoring.receivingYard * scoring.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
        variance += scoring.touchdownBonus40 * scoring.touchdownBonus40 * eTd40
            + scoring.touchdownBonus50 * scoring.touchdownBonus50 * eTd50
        let usageSD = mean * 0.30 * (1 - c.roleConf)
        let sd = (variance + usageSD * usageSD).squareRoot()

        let pPlay = c.practice.playProbability
        let expPts = pPlay * mean
        let z = StreamMath.quartileZ
        let floor = max(0, pPlay * (mean - z * sd))
        let ceiling = pPlay * (mean + z * sd)
        let utility = expPts + WRStreamKnobs.riskWeight(risk) * sd

        var flags = c.dataFlags
        if c.statTargets < WRStreamKnobs.thinSampleTargets { flags.append("thin target sample") }
        if c.targetShareLast1 == nil && c.targetShareLast3 == nil { flags.append("target share estimated") }
        if c.firstDowns == nil { flags.append("first-down rate from role prior (not observed)") }
        if c.available == nil { flags.append("availability unverified") }
        if !scoring.hasLongCatchBonuses { flags.append("big-play bonuses = 0 (not yet set)") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let pace = c.teamGames > 0 ? fmt(c.teamPassAttempts / Double(c.teamGames), 1) : "n/a"
        let spread = c.spreadOff >= 0 ? "+\(fmt(c.spreadOff, 1))" : fmt(c.spreadOff, 1)
        let explain = [
            "\(fmt(attempts, 1)) expected team pass attempts (pace \(pace)/gm, environment ×\(fmt(env, 3)) from O/U \(fmt(c.total, 1)) and spread \(spread))",
            "× \(Int((share * 100).rounded()))% target share → \(fmt(targets, 1)) targets",
            "Per target: catch \(Int((r.catchRate * 100).rounded()))%, \(fmt(r.yardsPerCatch, 1)) yds/catch, first down \(Int((r.firstDowns * 100).rounded()))%, 30+ catch \(fmt(r.p30 * 100, 1))%",
            "Matchup ×\(fmt(dvpMult, 3)) · coverage ×\(fmt(covMult, 2)) · red zone ×\(fmt(rzMult, 2)) on TDs",
            "P(plays) \(Int((pPlay * 100).rounded()))% (\(c.practice.label))",
        ]

        return WRProjection(
            name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
            expPassAttempts: attempts, envMult: env, targetShare: share, expTargets: targets,
            dvpMult: dvpMult, coverageMult: covMult, redZoneMult: rzMult,
            eRec: eRec, eRecYd: eRecYd, eFirstDowns: eFd, eTouchdowns: eTd, e30: e30, e40: e40, e50: e50,
            eRushYd: eRushYd, eRushFirstDowns: eRushFd, eTouchdowns40: eTd40, eTouchdowns50: eTd50,
            adot: c.adot, redZoneShare: c.redZoneShare,
            meanIfPlays: mean, sdIfPlays: sd, pPlay: pPlay, expPts: expPts,
            floorP25: floor, ceilingP75: ceiling, utility: utility,
            roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
            flags: flags, notes: c.notes, sources: c.sources, explain: explain,
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    private static func fmt(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }

    /// Projects, compares with the incumbent and ranks in one call.
    public static func report(candidates: [WRCandidate], scoring: WRScoring, incumbentID: String? = nil,
                              risk: StreamRiskMode = .neutral, onlyAvailable: Bool = false) -> WRStreamReport {
        StreamDecision.report(
            projections: candidates.map { project($0, scoring: scoring, risk: risk) },
            incumbentID: incumbentID, onlyAvailable: onlyAvailable
        )
    }
}

public typealias WRStreamReport = StreamReport<WRProjection>
public typealias WRComparison = StreamComparison<WRProjection>
