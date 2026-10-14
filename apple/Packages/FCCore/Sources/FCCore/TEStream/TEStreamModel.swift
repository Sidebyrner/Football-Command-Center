import Foundation

// TE streaming model: the WR stream's two-stage opportunity × conversion
// projection, recalibrated for tight ends. What sets the position apart:
//
// - Routes, not snaps. A tight end blocks on a large share of his snaps, so
//   snap share overstates how often he is a target. Routes per snap differ by
//   role (a featured "move" TE runs a route on most snaps, an inline TE2 on
//   about half), and the target-share prior is scaled by the estimated route
//   share rather than snaps.
// - Touchdown dependence. TE scoring leans on red-zone TDs, which are the
//   noisiest rate in the game; the per-target TD rate is shrunk harder than a
//   receiver's, and red-zone share moves it further.
// - Coverage. Tight ends are covered by linebackers and safeties, so the
//   coverage knob is "seam coverage", not cornerbacks.
// - TE premium. Leagues that pay extra per TE catch or first down
//   (`bonus_rec_te`, `bonus_fd_te`) are scored exactly.
//
// There is no reference engine for this one: the recorded fixture under
// `Fixtures/te-stream` is this engine's own output, checked by hand-computed
// tests. Every prior and knob is heuristic until a backtest has data.

// MARK: - Roles

/// How a tight end is used — the unit the priors are set on.
public enum TERole: String, Codable, CaseIterable, Sendable {
    case featured = "FEATURED"
    case seam = "SEAM"
    case checkdown = "CHECKDOWN"
    case redZone = "RED_ZONE"
    case rotational = "ROTATIONAL"

    public var label: String {
        switch self {
        case .featured: return "Featured"
        case .seam: return "Seam"
        case .checkdown: return "Checkdown"
        case .redZone: return "Red zone"
        case .rotational: return "Rotational"
        }
    }

    public var summary: String {
        switch self {
        case .featured: return "TE1 and a top target, runs most routes"
        case .seam: return "Vertical TE, works the middle deep"
        case .checkdown: return "Short safety valve, high catch rate"
        case .redZone: return "Inline blocker, TD-dependent"
        case .rotational: return "TE2 in a committee or 12 personnel"
        }
    }
}

/// Per-target priors for one role.
public struct TEPrior: Sendable, Hashable {
    public var catchRate: Double
    public var yardsPerCatch: Double
    public var firstDowns: Double
    public var touchdowns: Double
    public var p30: Double
    public var p40: Double
    public var p50: Double
}

public enum TEStreamPriors {
    public static func prior(for role: TERole) -> TEPrior {
        switch role {
        case .featured: return TEPrior(catchRate: 0.72, yardsPerCatch: 10.8, firstDowns: 0.38, touchdowns: 0.060, p30: 0.035, p40: 0.018, p50: 0.008)
        case .seam: return TEPrior(catchRate: 0.62, yardsPerCatch: 13.0, firstDowns: 0.37, touchdowns: 0.065, p30: 0.060, p40: 0.032, p50: 0.015)
        case .checkdown: return TEPrior(catchRate: 0.76, yardsPerCatch: 8.8, firstDowns: 0.33, touchdowns: 0.040, p30: 0.018, p40: 0.008, p50: 0.003)
        case .redZone: return TEPrior(catchRate: 0.66, yardsPerCatch: 9.5, firstDowns: 0.32, touchdowns: 0.095, p30: 0.020, p40: 0.010, p50: 0.004)
        case .rotational: return TEPrior(catchRate: 0.68, yardsPerCatch: 10.0, firstDowns: 0.32, touchdowns: 0.050, p30: 0.025, p40: 0.012, p50: 0.005)
        }
    }

    public static func targetShare(for role: TERole) -> Double {
        switch role {
        case .featured: return 0.21
        case .seam: return 0.15
        case .checkdown: return 0.13
        case .redZone: return 0.09
        case .rotational: return 0.08
        }
    }

    /// Routes run per offensive snap: the rest are blocking snaps.
    public static func routesPerSnap(for role: TERole) -> Double {
        switch role {
        case .featured, .seam: return 0.85
        case .checkdown: return 0.70
        case .redZone, .rotational: return 0.55
        }
    }
}

public enum TEStreamKnobs {
    public static let leagueAveragePassAttempts = 33.5
    public static let passAttemptsShrinkGames = 3.0
    public static let totalSlope = 0.006
    public static let spreadSlope = 0.008
    public static let environmentRange = 0.82...1.18
    public static let catchShrinkK = 30.0
    public static let ypcShrinkK = 20.0
    public static let firstDownShrinkK = 30.0
    /// Harder than a receiver's 120: TE touchdown streaks regress.
    public static let touchdownShrinkK = 160.0
    public static let bigPlayShrinkK = 150.0
    public static let dvpFullWeightGames = 6.0
    public static let dvpCap = 0.18
    public static let coverageCap = 0.30
    public static let redZoneMultCap = 0.70
    public static let neutralRedZoneShare = 0.15
    public static let recencyWeightLast1 = 0.50
    public static let rolePriorWeight = 0.30
    /// A typical tight end's route share of team dropbacks.
    public static let typicalRouteShare = 0.75
    public static let shareRange = 0.02...0.40
    public static let vacatedBoostCap = 0.10
    public static let fumblesPerCatch = 0.015
    public static let thinSampleTargets = 12.0
    public static let usageSDWeight = 0.35
    public static let touchdownShareOf40 = 0.30
    public static let touchdownShareOf50 = 0.40

    public static func riskWeight(_ risk: StreamRiskMode) -> Double {
        switch risk {
        case .floor: return -0.5
        case .neutral: return -0.2
        case .ceiling: return 0.25
        }
    }
}

// MARK: - Scoring

/// The league's receiving scoring as it applies to a tight end, long-catch
/// tiers stacked as in `WRScoring`, plus TE premium per catch and per first down.
public struct TEScoring: Codable, Sendable, Hashable {
    public var reception: Double
    public var receivingYard: Double
    public var firstDown: Double
    public var touchdown: Double
    public var bonus30: Double
    public var bonus40: Double
    public var bonus50: Double
    public var fumble: Double
    public var fumbleLost: Double
    public var touchdownBonus40: Double
    public var touchdownBonus50: Double
    /// `bonus_rec_te`: extra per TE catch.
    public var premiumReception: Double
    /// `bonus_fd_te`: extra per TE first down.
    public var premiumFirstDown: Double

    public init(reception: Double = 0, receivingYard: Double = 0, firstDown: Double = 0, touchdown: Double = 0,
                bonus30: Double = 0, bonus40: Double = 0, bonus50: Double = 0, fumble: Double = 0,
                fumbleLost: Double = 0, touchdownBonus40: Double = 0, touchdownBonus50: Double = 0,
                premiumReception: Double = 0, premiumFirstDown: Double = 0) {
        self.reception = reception; self.receivingYard = receivingYard; self.firstDown = firstDown
        self.touchdown = touchdown; self.bonus30 = bonus30; self.bonus40 = bonus40; self.bonus50 = bonus50
        self.fumble = fumble; self.fumbleLost = fumbleLost
        self.touchdownBonus40 = touchdownBonus40; self.touchdownBonus50 = touchdownBonus50
        self.premiumReception = premiumReception; self.premiumFirstDown = premiumFirstDown
    }

    /// No PPR, 0.1/yd, 1/first down, 6/TD, fumble −3 — the WR reference's defaults.
    public static let referenceDefaults = TEScoring(
        receivingYard: 0.1, firstDown: 1, touchdown: 6, fumble: -3, fumbleLost: -2
    )

    public static func from(sleeperSettings s: [String: Double]) -> TEScoring {
        let range30 = s["rec_30_39"] ?? 0
        let over40 = s["rec_40p"] ?? 0
        let over50 = s["rec_50p"]
        return TEScoring(
            reception: s["rec"] ?? 0,
            receivingYard: s["rec_yd"] ?? 0,
            firstDown: s["rec_fd"] ?? 0,
            touchdown: s["rec_td"] ?? 0,
            bonus30: range30,
            bonus40: over40 - range30,
            bonus50: over50.map { $0 - over40 } ?? 0,
            fumble: s["fum"] ?? 0,
            fumbleLost: s["fum_lost"] ?? 0,
            touchdownBonus40: s["rec_td_40p"] ?? 0,
            touchdownBonus50: s["rec_td_50p"] ?? 0,
            premiumReception: s["bonus_rec_te"] ?? 0,
            premiumFirstDown: s["bonus_fd_te"] ?? 0
        )
    }

    public var hasLongCatchBonuses: Bool { bonus30 != 0 || bonus40 != 0 || bonus50 != 0 }
    public var hasPremium: Bool { premiumReception != 0 || premiumFirstDown != 0 }

    static let modelledKeys: Set<String> = [
        "rec", "rec_yd", "rec_fd", "rec_td", "rec_30_39", "rec_40p", "rec_50p",
        "rec_td_40p", "rec_td_50p", "fum", "fum_lost", "bonus_rec_te", "bonus_fd_te",
    ]

    /// Receiving keys the league pays for that are not projected.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { key, value in
            value != 0 && !modelledKeys.contains(key)
                && (key.hasPrefix("rec") || key.hasPrefix("bonus_rec") || key == "bonus_fd_te")
                && key != "bonus_rec_wr" && key != "bonus_rec_rb"
        }
        .map(\.key)
        .sorted()
    }
}

// MARK: - Candidate (input)

public struct TECandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: TERole
    public var opponent: String
    public var home: Bool?
    /// From the TE's team perspective: positive = his team is the underdog.
    public var spreadOff: Double
    public var total: Double
    public var teamPassAttempts: Double
    public var teamGames: Int
    public var targetShareLast1: Double?
    public var targetShareLast3: Double?
    public var targetShareEst: Double?
    /// Offensive snap share, last three games. Routes are estimated from it by role.
    public var snapShare: Double?
    public var roleConf: Double
    /// Share of team red-zone targets; `nil` uses the neutral 15%.
    public var redZoneShare: Double?
    public var statTargets: Double
    public var receptions: Double?
    public var receivingYards: Double
    public var firstDowns: Double?
    public var touchdowns: Double
    public var catches30: Double
    public var catches40: Double
    public var catches50: Double
    public var adot: Double?
    public var dvpPct: Double
    public var dvpGames: Int
    /// 1.0 neutral; above when the linebackers or safeties are hurt or poor in
    /// coverage, below against a strong coverage linebacker or safety.
    public var seamCoverageAdj: Double
    /// Target share added because a teammate (a WR1, the other TE) is out; 0–0.10.
    public var vacatedTargetBoost: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, role: TERole, opponent: String, home: Bool? = nil,
                spreadOff: Double = 0, total: Double = 45, teamPassAttempts: Double = 0, teamGames: Int = 0,
                targetShareLast1: Double? = nil, targetShareLast3: Double? = nil, targetShareEst: Double? = nil,
                snapShare: Double? = nil, roleConf: Double = 0.7, redZoneShare: Double? = nil,
                statTargets: Double = 0, receptions: Double? = nil, receivingYards: Double = 0,
                firstDowns: Double? = nil, touchdowns: Double = 0, catches30: Double = 0, catches40: Double = 0,
                catches50: Double = 0, adot: Double? = nil, dvpPct: Double = 0, dvpGames: Int = 0,
                seamCoverageAdj: Double = 1, vacatedTargetBoost: Double = 0, practice: StreamPractice = .none,
                rosterPct: Double? = nil, available: Bool? = nil, notes: String = "",
                sources: [String] = [], dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.role = role; self.opponent = opponent; self.home = home
        self.spreadOff = spreadOff; self.total = total; self.teamPassAttempts = teamPassAttempts
        self.teamGames = teamGames; self.targetShareLast1 = targetShareLast1; self.targetShareLast3 = targetShareLast3
        self.targetShareEst = targetShareEst; self.snapShare = snapShare; self.roleConf = roleConf
        self.redZoneShare = redZoneShare; self.statTargets = statTargets; self.receptions = receptions
        self.receivingYards = receivingYards; self.firstDowns = firstDowns; self.touchdowns = touchdowns
        self.catches30 = catches30; self.catches40 = catches40; self.catches50 = catches50; self.adot = adot
        self.dvpPct = dvpPct; self.dvpGames = dvpGames; self.seamCoverageAdj = seamCoverageAdj
        self.vacatedTargetBoost = vacatedTargetBoost; self.practice = practice; self.rosterPct = rosterPct
        self.available = available; self.notes = notes; self.sources = sources; self.dataFlags = dataFlags
        self.playerID = playerID
    }
}

// MARK: - Projection (output)

public struct TEProjection: StreamProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var role: TERole
    public var opponent: String
    public var playerID: String?
    public var expPassAttempts: Double
    public var envMult: Double
    public var estRouteShare: Double?
    public var vacatedTargetBoost: Double
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

    public var platform: Position { .te }
    public var roleLabel: String { role.label }

    /// Expected points by scoring stat, largest first; sums to `meanIfPlays`.
    public func pointsBreakdown(scoring: TEScoring) -> [StreamStatPoints] {
        [
            StreamStatPoints(stat: "Yards", count: eRecYd, points: eRecYd * scoring.receivingYard),
            StreamStatPoints(stat: "First downs", count: eFirstDowns, points: eFirstDowns * scoring.firstDown),
            StreamStatPoints(stat: "TD", count: eTouchdowns, points: eTouchdowns * scoring.touchdown),
            StreamStatPoints(stat: "Receptions", count: eRec, points: eRec * scoring.reception),
            StreamStatPoints(stat: "TE premium", count: eRec,
                             points: eRec * scoring.premiumReception + eFirstDowns * scoring.premiumFirstDown),
            StreamStatPoints(stat: "Long catches", count: e30,
                             points: e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50),
            StreamStatPoints(stat: "Long TDs", count: eTouchdowns40,
                             points: eTouchdowns40 * scoring.touchdownBonus40 + eTouchdowns50 * scoring.touchdownBonus50),
            StreamStatPoints(stat: "Fumbles", count: TEStreamKnobs.fumblesPerCatch * eRec,
                             points: -(TEStreamKnobs.fumblesPerCatch * eRec) * abs(scoring.fumble)),
        ]
        .filter { $0.points != 0 }
        .sorted { $0.points > $1.points }
    }
}

// MARK: - Engine

public enum TEStreamEngine {
    typealias M = StreamMath

    // Stage 1 — opportunity

    static func expectedPassAttempts(_ c: TECandidate) -> (attempts: Double, environment: Double) {
        let perGame: Double? = c.teamGames > 0 ? c.teamPassAttempts / Double(c.teamGames) : nil
        let base = M.shrink(perGame, Double(c.teamGames), TEStreamKnobs.leagueAveragePassAttempts, TEStreamKnobs.passAttemptsShrinkGames)
        let range = TEStreamKnobs.environmentRange
        let env = M.clamp(1 + TEStreamKnobs.totalSlope * (c.total - 45) + TEStreamKnobs.spreadSlope * c.spreadOff,
                          range.lowerBound, range.upperBound)
        return (base * env, env)
    }

    /// Routes run per team dropback, estimated from snap share and role.
    static func estimatedRouteShare(_ c: TECandidate) -> Double? {
        c.snapShare.map { $0 * TEStreamPriors.routesPerSnap(for: c.role) }
    }

    static func projectedTargetShare(_ c: TECandidate) -> Double {
        let w1 = TEStreamKnobs.recencyWeightLast1
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
            observed = TEStreamPriors.targetShare(for: c.role)
        }
        // A tight end out on most routes with a small share is likelier to grow;
        // one blocking most snaps is not, however many snaps he plays.
        var rolePrior = TEStreamPriors.targetShare(for: c.role)
        if let routes = estimatedRouteShare(c) {
            rolePrior = 0.5 * rolePrior + 0.5 * (rolePrior * routes / TEStreamKnobs.typicalRouteShare)
        }
        let pull = TEStreamKnobs.rolePriorWeight * (1 - c.roleConf)
        let boost = M.clamp(c.vacatedTargetBoost, 0, TEStreamKnobs.vacatedBoostCap)
        let range = TEStreamKnobs.shareRange
        return M.clamp((1 - pull) * observed + pull * rolePrior + boost, range.lowerBound, range.upperBound)
    }

    // Stage 2 — conversion

    struct Rates {
        var catchRate, yardsPerCatch, firstDowns, touchdowns, p30, p40, p50: Double
    }

    static func conversionRates(_ c: TECandidate, _ prior: TEPrior) -> Rates {
        let n = c.statTargets
        let receptions = c.receptions
        let catchRate = M.shrink(receptions.flatMap { n > 0 ? $0 / n : nil }, n, prior.catchRate, TEStreamKnobs.catchShrinkK)
        var ypc = M.shrink(receptions.flatMap { $0 > 0 ? c.receivingYards / $0 : nil }, receptions ?? 0,
                           prior.yardsPerCatch, TEStreamKnobs.ypcShrinkK)
        // Tight ends gain more after the catch per air yard than receivers.
        if let adot = c.adot {
            ypc = 0.7 * ypc + 0.3 * (adot * 0.7 + 5.0)
        }
        func perTarget(_ x: Double) -> Double? { n > 0 ? x / n : nil }
        let firstDowns = M.shrink(c.firstDowns.flatMap(perTarget), n, prior.firstDowns, TEStreamKnobs.firstDownShrinkK)
        let touchdowns = M.shrink(perTarget(c.touchdowns), n, prior.touchdowns, TEStreamKnobs.touchdownShrinkK)
        let k = TEStreamKnobs.bigPlayShrinkK
        let p30 = M.shrink(perTarget(c.catches30), n, prior.p30, k)
        let p40 = min(M.shrink(perTarget(c.catches40), n, prior.p40, k), p30)
        let p50 = min(M.shrink(perTarget(c.catches50), n, prior.p50, k), p40)
        return Rates(catchRate: catchRate, yardsPerCatch: ypc, firstDowns: firstDowns, touchdowns: touchdowns,
                     p30: p30, p40: p40, p50: p50)
    }

    static func matchupMultipliers(_ c: TECandidate) -> (dvp: Double, coverage: Double, redZone: Double) {
        var dvp = 1.0
        if c.dvpGames > 0 {
            let w = Double(c.dvpGames) / (Double(c.dvpGames) + TEStreamKnobs.dvpFullWeightGames)
            dvp = 1 + M.clamp(w * c.dvpPct / 100, -TEStreamKnobs.dvpCap, TEStreamKnobs.dvpCap)
        }
        let coverage = 1 + M.clamp(c.seamCoverageAdj - 1, -TEStreamKnobs.coverageCap, TEStreamKnobs.coverageCap)
        let neutral = TEStreamKnobs.neutralRedZoneShare
        let rz = c.redZoneShare ?? neutral
        let redZone = 1 + M.clamp((rz - neutral) / neutral, -TEStreamKnobs.redZoneMultCap, TEStreamKnobs.redZoneMultCap)
        return (dvp, coverage, redZone)
    }

    // Projection

    public static func project(_ c: TECandidate, scoring: TEScoring, risk: StreamRiskMode = .neutral) -> TEProjection {
        let prior = TEStreamPriors.prior(for: c.role)
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
        let eTd40 = e40 * TEStreamKnobs.touchdownShareOf40
        let eTd50 = e50 * TEStreamKnobs.touchdownShareOf50

        let perCatch = scoring.reception + scoring.premiumReception
        let perFirstDown = scoring.firstDown + scoring.premiumFirstDown
        let mean = eRecYd * scoring.receivingYard
            + eFd * perFirstDown
            + eTd * scoring.touchdown
            + eRec * perCatch
            + e30 * scoring.bonus30 + e40 * scoring.bonus40 + e50 * scoring.bonus50
            - (TEStreamKnobs.fumblesPerCatch * eRec) * abs(scoring.fumble)
            + eTd40 * scoring.touchdownBonus40 + eTd50 * scoring.touchdownBonus50

        // Each scoring event roughly Poisson in count; yards compound and lumpy.
        var variance = perFirstDown * perFirstDown * eFd
            + scoring.touchdown * scoring.touchdown * eTd
            + perCatch * perCatch * eRec * (1 - r.catchRate)
            + scoring.bonus30 * scoring.bonus30 * e30 + scoring.bonus40 * scoring.bonus40 * e40
            + scoring.bonus50 * scoring.bonus50 * e50
            + scoring.receivingYard * scoring.receivingYard * (eRec * r.yardsPerCatch * r.yardsPerCatch * 1.6)
        variance += scoring.touchdownBonus40 * scoring.touchdownBonus40 * eTd40
            + scoring.touchdownBonus50 * scoring.touchdownBonus50 * eTd50
        let usageSD = mean * TEStreamKnobs.usageSDWeight * (1 - c.roleConf)
        let sd = (variance + usageSD * usageSD).squareRoot()

        let pPlay = c.practice.playProbability
        let expPts = pPlay * mean
        let z = StreamMath.quartileZ
        let floor = max(0, pPlay * (mean - z * sd))
        let ceiling = pPlay * (mean + z * sd)
        let utility = expPts + TEStreamKnobs.riskWeight(risk) * sd

        var flags = c.dataFlags
        if c.statTargets < TEStreamKnobs.thinSampleTargets { flags.append("thin target sample") }
        if c.targetShareLast1 == nil && c.targetShareLast3 == nil { flags.append("target share estimated") }
        if c.firstDowns == nil { flags.append("first-down rate from role prior (not observed)") }
        if c.available == nil { flags.append("availability unverified") }
        if c.statTargets > 0, c.touchdowns / c.statTargets > 0.12 { flags.append("TD rate well above norm — regressed") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let routes = estimatedRouteShare(c)
        let pace = c.teamGames > 0 ? fmt(c.teamPassAttempts / Double(c.teamGames), 1) : "n/a"
        let spread = c.spreadOff >= 0 ? "+\(fmt(c.spreadOff, 1))" : fmt(c.spreadOff, 1)
        var shareLine = "× \(pct(share)) target share → \(fmt(targets, 1)) targets"
        if let routes { shareLine += " (est. route share \(pct(routes)))" }
        if c.vacatedTargetBoost > 0 { shareLine += ", +\(pct(min(c.vacatedTargetBoost, TEStreamKnobs.vacatedBoostCap))) vacated" }
        let explain = [
            "\(fmt(attempts, 1)) expected team pass attempts (pace \(pace)/gm, environment ×\(fmt(env, 3)) from O/U \(fmt(c.total, 1)) and spread \(spread))",
            shareLine,
            "Per target: catch \(pct(r.catchRate)), \(fmt(r.yardsPerCatch, 1)) yds/catch, first down \(pct(r.firstDowns)), TD \(fmt(r.touchdowns * 100, 1))%",
            "TE matchup ×\(fmt(dvpMult, 3)) · seam coverage ×\(fmt(covMult, 2)) · red zone ×\(fmt(rzMult, 2)) on TDs",
            "P(plays) \(pct(pPlay)) (\(c.practice.label))",
        ]

        return TEProjection(
            name: c.name, team: c.team, role: c.role, opponent: c.opponent, playerID: c.playerID,
            expPassAttempts: attempts, envMult: env, estRouteShare: routes, vacatedTargetBoost: c.vacatedTargetBoost,
            targetShare: share, expTargets: targets,
            dvpMult: dvpMult, coverageMult: covMult, redZoneMult: rzMult,
            eRec: eRec, eRecYd: eRecYd, eFirstDowns: eFd, eTouchdowns: eTd, e30: e30, e40: e40, e50: e50,
            eTouchdowns40: eTd40, eTouchdowns50: eTd50,
            adot: c.adot, redZoneShare: c.redZoneShare,
            meanIfPlays: mean, sdIfPlays: sd, pPlay: pPlay, expPts: expPts,
            floorP25: floor, ceilingP75: ceiling, utility: utility,
            roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
            flags: flags, notes: c.notes, sources: c.sources, explain: explain,
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    private static func fmt(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }
    private static func pct(_ x: Double) -> String { "\(Int((x * 100).rounded()))%" }

    /// Projects, compares with the incumbent and ranks in one call.
    public static func report(candidates: [TECandidate], scoring: TEScoring, incumbentID: String? = nil,
                              risk: StreamRiskMode = .neutral, onlyAvailable: Bool = false) -> TEStreamReport {
        StreamDecision.report(
            projections: candidates.map { project($0, scoring: scoring, risk: risk) },
            incumbentID: incumbentID, onlyAvailable: onlyAvailable
        )
    }

    /// The role a tight end's usage points to: a top share, an inline TD role,
    /// a part-time TE2, then aDOT for the rest.
    public static func inferRole(targetShare: Double?, adot: Double?, redZoneShare: Double?, snapShare: Double?) -> TERole {
        let share = targetShare ?? 0
        if share >= 0.20 { return .featured }
        if share < 0.14, (redZoneShare ?? 0) >= 0.22 { return .redZone }
        if let snaps = snapShare, snaps < 0.55 { return .rotational }
        if let adot, adot >= 9 { return .seam }
        return .checkdown
    }
}

public typealias TEStreamReport = StreamReport<TEProjection>
public typealias TEComparison = StreamComparison<TEProjection>
