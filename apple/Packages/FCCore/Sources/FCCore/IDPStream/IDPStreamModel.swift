import Foundation

// IDP streaming model: a two-stage opportunity × conversion projection for one
// week, denominated in the league's own points, with a decision layer that
// answers "is this defender a better one-week start than mine, and how sure?".
//
// Ported from the reference engine (`idp_stream.py`, mirrored by `idpModel.ts`).
// The formulas and constants are unchanged so the parity test can pin this port
// to the reference output. The only addition is QB hits, which this league pays
// for (0.5) and which contribute nothing when the league does not.
//
// Every prior and knob here is heuristic until a backtest has data — the screen
// says so, and every projection carries an `explain` trail.

// MARK: - Positions

/// The alignment a defender actually plays. Sleeper only says LB/DL/DB, and a
/// box safety and a free safety are different fantasy assets.
public enum IDPSubPosition: String, Codable, CaseIterable, Sendable {
    case lb = "LB"
    case edge = "EDGE"
    case idl = "IDL"
    case safetyBox = "S_BOX"
    case safetyFree = "S_FREE"
    case cb = "CB"

    /// The platform position Sleeper slots him at.
    public var platform: Position {
        switch self {
        case .lb: return .lb
        case .edge, .idl: return .dl
        case .safetyBox, .safetyFree, .cb: return .db
        }
    }

    public var label: String {
        switch self {
        case .lb: return "LB"
        case .edge: return "EDGE"
        case .idl: return "IDL"
        case .safetyBox: return "Box S"
        case .safetyFree: return "Free S"
        case .cb: return "CB"
        }
    }

    /// The alignment for a defender, from Sleeper's position code and its finer
    /// depth-chart position. The platform position always wins, so the
    /// alignment never moves a player out of the slot Sleeper lets him fill:
    /// a 3-4 outside linebacker listed at LB stays LB.
    ///
    /// `inferred` is true when neither field states the alignment and it was
    /// defaulted — a bare `DB` becomes a box safety, a bare `DL` an edge — so
    /// the screen can flag it for a manual check.
    public static func resolve(positionCode: String?, depthChartPosition: String?)
        -> (position: IDPSubPosition, inferred: Bool)? {
        guard let platform = Position(sleeper: positionCode), Position.idp.contains(platform) else { return nil }
        let code = positionCode?.uppercased() ?? ""
        let depth = depthChartPosition?.uppercased() ?? ""
        switch platform {
        case .lb:
            return (.lb, false)
        case .dl:
            switch depth {
            case "NT", "DT", "LDT", "RDT": return (.idl, false)
            case "LDE", "RDE", "DE", "LOLB", "ROLB", "OLB", "EDGE": return (.edge, false)
            default: break
            }
            switch code {
            case "DT", "NT": return (.idl, false)
            case "DE": return (.edge, false)
            default: return (.edge, true)
            }
        default:
            switch depth {
            case "SS": return (.safetyBox, false)
            case "FS": return (.safetyFree, false)
            case "LCB", "RCB", "CB", "NB": return (.cb, false)
            default: break
            }
            switch code {
            case "CB": return (.cb, false)
            case "SS": return (.safetyBox, false)
            case "FS": return (.safetyFree, false)
            default: return (.safetyBox, true)
            }
        }
    }
}

// MARK: - Priors and knobs

/// Per-defensive-snap priors for one sub-position.
public struct IDPPrior: Sendable, Hashable {
    public var tackles: Double
    public var soloShare: Double
    public var sacks: Double
    public var tfl: Double
    public var passesDefended: Double
    public var interceptions: Double
    public var forcedFumbles: Double
    public var qbHits: Double
}

public enum IDPStreamPriors {
    /// Heuristic starting points. Replace with backtested values.
    public static func prior(for position: IDPSubPosition) -> IDPPrior {
        switch position {
        case .lb:
            return IDPPrior(tackles: 0.115, soloShare: 0.60, sacks: 0.0030, tfl: 0.011, passesDefended: 0.005, interceptions: 0.0010, forcedFumbles: 0.0010, qbHits: 0.006)
        case .edge:
            return IDPPrior(tackles: 0.060, soloShare: 0.60, sacks: 0.0100, tfl: 0.014, passesDefended: 0.002, interceptions: 0.0003, forcedFumbles: 0.0025, qbHits: 0.022)
        case .idl:
            return IDPPrior(tackles: 0.050, soloShare: 0.58, sacks: 0.0060, tfl: 0.012, passesDefended: 0.001, interceptions: 0.0001, forcedFumbles: 0.0010, qbHits: 0.014)
        case .safetyBox:
            return IDPPrior(tackles: 0.095, soloShare: 0.68, sacks: 0.0012, tfl: 0.006, passesDefended: 0.010, interceptions: 0.0018, forcedFumbles: 0.0010, qbHits: 0.003)
        case .safetyFree:
            return IDPPrior(tackles: 0.070, soloShare: 0.70, sacks: 0.0005, tfl: 0.004, passesDefended: 0.012, interceptions: 0.0022, forcedFumbles: 0.0007, qbHits: 0.001)
        case .cb:
            return IDPPrior(tackles: 0.065, soloShare: 0.75, sacks: 0.0003, tfl: 0.004, passesDefended: 0.020, interceptions: 0.0025, forcedFumbles: 0.0007, qbHits: 0.001)
        }
    }
}

public enum IDPStreamKnobs {
    public static let leagueAverageDefensivePlays = 62.0
    public static let playsShrinkGames = 3.0
    public static let totalSlope = 0.004
    public static let spreadSlope = 0.006
    public static let snapsShrinkK = 120.0
    public static let soloShrinkK = 20.0
    public static let bigPlayShrinkK = 400.0
    public static let dvpFullWeightGames = 6.0
    public static let dvpCap = 0.12
    public static let sackEnvironmentCap = 0.35
    public static let recencyWeightLast1 = 0.6
    public static let rolePriorWeight = 0.25
    /// Below this many snaps the conversion sample is flagged as thin.
    public static let thinSampleSnaps = 60.0

    /// SD weight added to expected points to form utility, by risk setting.
    public static func riskWeight(_ risk: StreamRiskMode) -> Double {
        switch risk {
        case .floor: return -0.5
        case .neutral: return -0.2
        case .ceiling: return 0.2
        }
    }
}

// MARK: - Scoring

/// The league's IDP scoring, per event.
///
/// Sleeper pays `idp_tkl` on every tackle *on top of* `idp_tkl_solo` or
/// `idp_tkl_ast`, so a solo tackle is worth `idp_tkl + idp_tkl_solo`. A key the
/// league does not set is worth nothing — never a guessed default.
public struct IDPScoring: Codable, Sendable, Hashable {
    public var solo: Double
    public var ast: Double
    public var sack: Double
    public var tfl: Double
    public var pd: Double
    public var int: Double
    public var ff: Double
    public var fr: Double
    public var td: Double
    public var qbHit: Double

    public init(solo: Double = 0, ast: Double = 0, sack: Double = 0, tfl: Double = 0,
                pd: Double = 0, int: Double = 0, ff: Double = 0, fr: Double = 0,
                td: Double = 0, qbHit: Double = 0) {
        self.solo = solo; self.ast = ast; self.sack = sack; self.tfl = tfl
        self.pd = pd; self.int = int; self.ff = ff; self.fr = fr; self.td = td
        self.qbHit = qbHit
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func value(_ key: CodingKeys) throws -> Double { try c.decodeIfPresent(Double.self, forKey: key) ?? 0 }
        self.init(solo: try value(.solo), ast: try value(.ast), sack: try value(.sack), tfl: try value(.tfl),
                  pd: try value(.pd), int: try value(.int), ff: try value(.ff), fr: try value(.fr),
                  td: try value(.td), qbHit: try value(.qbHit))
    }

    /// Builds from a league's `scoring_settings`.
    public static func from(sleeperSettings s: [String: Double]) -> IDPScoring {
        let perTackle = s["idp_tkl"] ?? 0
        return IDPScoring(
            solo: perTackle + (s["idp_tkl_solo"] ?? 0),
            ast: perTackle + (s["idp_tkl_ast"] ?? 0),
            sack: s["idp_sack"] ?? 0,
            tfl: s["idp_tkl_loss"] ?? 0,
            pd: s["idp_pass_def"] ?? 0,
            int: s["idp_int"] ?? 0,
            ff: s["idp_ff"] ?? 0,
            fr: s["idp_fum_rec"] ?? 0,
            td: s["idp_def_td"] ?? 0,
            qbHit: s["idp_qb_hit"] ?? 0
        )
    }

    /// Keys the engine reads, directly or folded into another field.
    static let modelledKeys: Set<String> = [
        "idp_tkl", "idp_tkl_solo", "idp_tkl_ast", "idp_sack", "idp_tkl_loss",
        "idp_pass_def", "idp_int", "idp_ff", "idp_qb_hit",
    ]

    /// IDP keys the league pays for that the engine does not project, so the
    /// screen can say so instead of dropping them silently. Fumble recoveries,
    /// touchdowns and safeties are rare enough that projecting them would be
    /// noise; they are named here, not modelled.
    public static func unmodelledKeys(sleeperSettings s: [String: Double]) -> [String] {
        s.filter { $0.key.hasPrefix("idp_") && $0.value != 0 && !modelledKeys.contains($0.key) }
            .map(\.key)
            .sorted()
    }
}

// MARK: - Candidate (input)

/// One defender's evidence for one week. Stats are season-to-date over
/// `statSnaps`; game environment is from the defender's team's perspective.
public struct IDPCandidate: Codable, Identifiable, Sendable, Hashable {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var position: IDPSubPosition
    public var opponent: String
    public var home: Bool?
    /// From the DEFENDER's team perspective: positive = his team is the underdog.
    public var spreadDef: Double
    public var total: Double
    public var teamDefPlays: Double
    public var teamGames: Int
    public var snapShareLast1: Double?
    public var snapShareLast3: Double?
    public var snapShareEst: Double?
    public var roleConf: Double
    public var statSnaps: Double
    public var solo: Double?
    public var ast: Double?
    public var comb: Double?
    public var sacks: Double
    public var tfl: Double
    public var pd: Double
    public var int: Double
    public var ff: Double
    public var qbHits: Double
    public var pressures: Double?
    public var dvpPct: Double
    public var dvpGames: Int
    public var oppSackEnv: Double
    public var practice: StreamPractice
    public var rosterPct: Double?
    public var available: Bool?
    public var notes: String
    public var sources: [String]
    public var dataFlags: [String]
    public var playerID: String?

    public init(name: String, team: String, position: IDPSubPosition, opponent: String, home: Bool? = nil,
                spreadDef: Double = 0, total: Double = 45, teamDefPlays: Double = 0, teamGames: Int = 0,
                snapShareLast1: Double? = nil, snapShareLast3: Double? = nil, snapShareEst: Double? = nil,
                roleConf: Double = 0.7, statSnaps: Double = 0, solo: Double? = nil, ast: Double? = nil,
                comb: Double? = nil, sacks: Double = 0, tfl: Double = 0, pd: Double = 0, int: Double = 0,
                ff: Double = 0, qbHits: Double = 0, pressures: Double? = nil, dvpPct: Double = 0,
                dvpGames: Int = 0, oppSackEnv: Double = 1, practice: StreamPractice = .none,
                rosterPct: Double? = nil, available: Bool? = nil, notes: String = "",
                sources: [String] = [], dataFlags: [String] = [], playerID: String? = nil) {
        self.name = name; self.team = team; self.position = position; self.opponent = opponent
        self.home = home; self.spreadDef = spreadDef; self.total = total
        self.teamDefPlays = teamDefPlays; self.teamGames = teamGames
        self.snapShareLast1 = snapShareLast1; self.snapShareLast3 = snapShareLast3
        self.snapShareEst = snapShareEst; self.roleConf = roleConf; self.statSnaps = statSnaps
        self.solo = solo; self.ast = ast; self.comb = comb; self.sacks = sacks; self.tfl = tfl
        self.pd = pd; self.int = int; self.ff = ff; self.qbHits = qbHits; self.pressures = pressures
        self.dvpPct = dvpPct; self.dvpGames = dvpGames; self.oppSackEnv = oppSackEnv
        self.practice = practice; self.rosterPct = rosterPct; self.available = available
        self.notes = notes; self.sources = sources; self.dataFlags = dataFlags; self.playerID = playerID
    }

    enum CodingKeys: String, CodingKey {
        case name, team, position = "pos", opponent = "opp", home, spreadDef, total, teamDefPlays, teamGames
        case snapShareLast1, snapShareLast3, snapShareEst, roleConf, statSnaps, solo, ast, comb
        case sacks, tfl, pd, int, ff, qbHits, pressures, dvpPct, dvpGames, oppSackEnv, practice
        case rosterPct, available, notes, sources, dataFlags, playerID = "playerId"
    }

    /// Tolerant decoding: the reference JSON omits anything at its default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            name: try c.decode(String.self, forKey: .name),
            team: try c.decode(String.self, forKey: .team),
            position: try c.decode(IDPSubPosition.self, forKey: .position),
            opponent: try c.decodeIfPresent(String.self, forKey: .opponent) ?? "",
            home: try c.decodeIfPresent(Bool.self, forKey: .home),
            spreadDef: try c.decodeIfPresent(Double.self, forKey: .spreadDef) ?? 0,
            total: try c.decodeIfPresent(Double.self, forKey: .total) ?? 45,
            teamDefPlays: try c.decodeIfPresent(Double.self, forKey: .teamDefPlays) ?? 0,
            teamGames: try c.decodeIfPresent(Int.self, forKey: .teamGames) ?? 0,
            snapShareLast1: try c.decodeIfPresent(Double.self, forKey: .snapShareLast1),
            snapShareLast3: try c.decodeIfPresent(Double.self, forKey: .snapShareLast3),
            snapShareEst: try c.decodeIfPresent(Double.self, forKey: .snapShareEst),
            roleConf: try c.decodeIfPresent(Double.self, forKey: .roleConf) ?? 0.7,
            statSnaps: try c.decodeIfPresent(Double.self, forKey: .statSnaps) ?? 0,
            solo: try c.decodeIfPresent(Double.self, forKey: .solo),
            ast: try c.decodeIfPresent(Double.self, forKey: .ast),
            comb: try c.decodeIfPresent(Double.self, forKey: .comb),
            sacks: try c.decodeIfPresent(Double.self, forKey: .sacks) ?? 0,
            tfl: try c.decodeIfPresent(Double.self, forKey: .tfl) ?? 0,
            pd: try c.decodeIfPresent(Double.self, forKey: .pd) ?? 0,
            int: try c.decodeIfPresent(Double.self, forKey: .int) ?? 0,
            ff: try c.decodeIfPresent(Double.self, forKey: .ff) ?? 0,
            qbHits: try c.decodeIfPresent(Double.self, forKey: .qbHits) ?? 0,
            pressures: try c.decodeIfPresent(Double.self, forKey: .pressures),
            dvpPct: try c.decodeIfPresent(Double.self, forKey: .dvpPct) ?? 0,
            dvpGames: try c.decodeIfPresent(Int.self, forKey: .dvpGames) ?? 0,
            oppSackEnv: try c.decodeIfPresent(Double.self, forKey: .oppSackEnv) ?? 1,
            practice: try c.decodeIfPresent(StreamPractice.self, forKey: .practice) ?? .none,
            rosterPct: try c.decodeIfPresent(Double.self, forKey: .rosterPct),
            available: try c.decodeIfPresent(Bool.self, forKey: .available),
            notes: try c.decodeIfPresent(String.self, forKey: .notes) ?? "",
            sources: try c.decodeIfPresent([String].self, forKey: .sources) ?? [],
            dataFlags: try c.decodeIfPresent([String].self, forKey: .dataFlags) ?? [],
            playerID: try c.decodeIfPresent(String.self, forKey: .playerID)
        )
    }
}

// MARK: - Projection (output)

public struct IDPProjection: StreamProjection {
    public var id: String { playerID ?? name }
    public var name: String
    public var team: String
    public var position: IDPSubPosition
    public var opponent: String
    public var playerID: String?
    public var expPlays: Double
    public var envMult: Double
    public var snapShare: Double
    public var expSnaps: Double
    public var tklMult: Double
    public var sackMult: Double
    public var eSolo: Double
    public var eAst: Double
    public var eSack: Double
    public var eTfl: Double
    public var ePd: Double
    public var eInt: Double
    public var eFf: Double
    public var eQbHit: Double
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

    public var platform: Position { position.platform }
    public var roleLabel: String { position.label }
    public var expTackles: Double { eSolo + eAst }

    /// Expected count and points for each stat the league pays for, largest
    /// first. Sums to `meanIfPlays` — the projection if he plays.
    public func pointsBreakdown(scoring: IDPScoring) -> [StreamStatPoints] {
        [
            StreamStatPoints(stat: "Solo", count: eSolo, points: eSolo * scoring.solo),
            StreamStatPoints(stat: "Assist", count: eAst, points: eAst * scoring.ast),
            StreamStatPoints(stat: "Sack", count: eSack, points: eSack * scoring.sack),
            StreamStatPoints(stat: "TFL", count: eTfl, points: eTfl * scoring.tfl),
            StreamStatPoints(stat: "QB hit", count: eQbHit, points: eQbHit * scoring.qbHit),
            StreamStatPoints(stat: "Pass def", count: ePd, points: ePd * scoring.pd),
            StreamStatPoints(stat: "INT", count: eInt, points: eInt * scoring.int),
            StreamStatPoints(stat: "FF", count: eFf, points: eFf * scoring.ff),
        ]
        .filter { $0.points != 0 }
        .sorted { $0.points > $1.points }
    }
}

/// The shared decision-layer types, named for IDP call sites.
public typealias IDPStreamReport = StreamReport<IDPProjection>
public typealias IDPComparison = StreamComparison<IDPProjection>

// MARK: - Engine

public enum IDPStreamEngine {
    static func shrink(_ observed: Double?, _ n: Double, _ prior: Double, _ k: Double) -> Double {
        guard let observed, n > 0 else { return prior }
        let w = n / (n + k)
        return w * observed + (1 - w) * prior
    }

    static func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { max(lo, min(hi, x)) }


    // Stage 1 — opportunity

    static func expectedDefensivePlays(_ c: IDPCandidate) -> (plays: Double, environment: Double) {
        let perGame: Double? = c.teamGames > 0 ? c.teamDefPlays / Double(c.teamGames) : nil
        let base = shrink(perGame, Double(c.teamGames), IDPStreamKnobs.leagueAverageDefensivePlays, IDPStreamKnobs.playsShrinkGames)
        let env = clamp(1 + IDPStreamKnobs.totalSlope * (c.total - 45) + IDPStreamKnobs.spreadSlope * c.spreadDef, 0.85, 1.15)
        return (base * env, env)
    }

    static func projectedSnapShare(_ c: IDPCandidate) -> Double {
        let observed: Double
        if let l1 = c.snapShareLast1, let l3 = c.snapShareLast3 {
            observed = IDPStreamKnobs.recencyWeightLast1 * l1 + (1 - IDPStreamKnobs.recencyWeightLast1) * l3
        } else if let l1 = c.snapShareLast1 {
            observed = l1
        } else if let l3 = c.snapShareLast3 {
            observed = l3
        } else if let est = c.snapShareEst {
            observed = est
        } else {
            observed = 0.55
        }
        // Full-timers regress toward 0.85, rotational players toward 0.5.
        let rolePrior = observed >= 0.7 ? 0.85 : 0.5
        let pull = IDPStreamKnobs.rolePriorWeight * (1 - c.roleConf)
        return clamp((1 - pull) * observed + pull * rolePrior, 0.05, 1.0)
    }

    // Stage 2 — conversion

    struct Rates {
        var tackles, soloShare, sacks, tfl, pd, int, ff, qbHits: Double
    }

    static func conversionRates(_ c: IDPCandidate, _ prior: IDPPrior) -> Rates {
        let n = c.statSnaps
        var combined: Double?
        var soloShareObserved: Double?
        var tackleSample = 0.0
        if let solo = c.solo, let ast = c.ast {
            let comb = solo + ast
            combined = comb
            soloShareObserved = comb > 0 ? solo / comb : nil
            tackleSample = comb
        } else if let comb = c.comb {
            combined = comb
        }
        func perSnap(_ x: Double) -> Double? { n > 0 ? x / n : nil }
        let big = IDPStreamKnobs.bigPlayShrinkK
        var sacks = shrink(perSnap(c.sacks), n, prior.sacks, big)
        // Pressures predict sacks more stably than sacks do; ~6.5 pressures per sack.
        if let pressures = c.pressures, n > 0 {
            let fromPressure = (pressures / n) / 6.5
            sacks = 0.5 * sacks + 0.5 * shrink(fromPressure, n, prior.sacks, big / 2)
        }
        return Rates(
            tackles: shrink(combined.flatMap(perSnap), n, prior.tackles, IDPStreamKnobs.snapsShrinkK),
            soloShare: shrink(soloShareObserved, tackleSample, prior.soloShare, IDPStreamKnobs.soloShrinkK),
            sacks: sacks,
            tfl: shrink(perSnap(c.tfl), n, prior.tfl, big),
            pd: shrink(perSnap(c.pd), n, prior.passesDefended, big),
            int: shrink(perSnap(c.int), n, prior.interceptions, big),
            ff: shrink(perSnap(c.ff), n, prior.forcedFumbles, big),
            qbHits: shrink(perSnap(c.qbHits), n, prior.qbHits, big)
        )
    }

    static func matchupMultipliers(_ c: IDPCandidate) -> (tackle: Double, sack: Double) {
        var tackle = 1.0
        if c.dvpGames > 0 {
            let w = Double(c.dvpGames) / (Double(c.dvpGames) + IDPStreamKnobs.dvpFullWeightGames)
            tackle = 1 + clamp(w * c.dvpPct / 100, -IDPStreamKnobs.dvpCap, IDPStreamKnobs.dvpCap)
        }
        let sack = 1 + clamp(c.oppSackEnv - 1, -IDPStreamKnobs.sackEnvironmentCap, IDPStreamKnobs.sackEnvironmentCap)
        return (tackle, sack)
    }

    // Projection

    public static func project(_ c: IDPCandidate, scoring: IDPScoring, risk: StreamRiskMode = .neutral) -> IDPProjection {
        let prior = IDPStreamPriors.prior(for: c.position)
        let (plays, env) = expectedDefensivePlays(c)
        let share = projectedSnapShare(c)
        let snaps = plays * share
        let r = conversionRates(c, prior)
        let (tklMult, sackMult) = matchupMultipliers(c)

        let eComb = snaps * r.tackles * tklMult
        let eSolo = eComb * r.soloShare
        let eAst = eComb - eSolo
        let eSack = snaps * r.sacks * sackMult
        let eTfl = snaps * r.tfl * (0.5 + 0.5 * tklMult) // half-tied to the tackle environment
        let ePd = snaps * r.pd
        let eInt = snaps * r.int
        let eFf = snaps * r.ff
        let eQbHit = snaps * r.qbHits * sackMult

        let counts: [(Double, Double)] = [
            (eSolo, scoring.solo), (eAst, scoring.ast), (eSack, scoring.sack), (eTfl, scoring.tfl),
            (ePd, scoring.pd), (eInt, scoring.int), (eFf, scoring.ff), (eQbHit, scoring.qbHit),
        ]
        let mean = counts.reduce(0) { $0 + $1.0 * $1.1 }
        // Poisson variance per stat, plus role doubt that scales with the projection.
        let statVariance = counts.reduce(0) { $0 + $1.1 * $1.1 * $1.0 }
        let usageSD = mean * 0.25 * (1 - c.roleConf)
        let sd = (statVariance + usageSD * usageSD).squareRoot()

        let pPlay = c.practice.playProbability
        let expPts = pPlay * mean
        let z25 = 0.6745
        let floor = max(0, pPlay * (mean - z25 * sd))
        let ceiling = pPlay * (mean + z25 * sd)
        let utility = expPts + IDPStreamKnobs.riskWeight(risk) * sd

        var flags = c.dataFlags
        if c.statSnaps < IDPStreamKnobs.thinSampleSnaps { flags.append("thin conversion sample") }
        if c.snapShareLast1 == nil && c.snapShareLast3 == nil { flags.append("snap share estimated") }
        if c.available == nil { flags.append("availability unverified") }
        var seen = Set<String>()
        flags = flags.filter { seen.insert($0).inserted }

        let pace = c.teamGames > 0 ? String(format: "%.1f", c.teamDefPlays / Double(c.teamGames)) : "n/a"
        let spread = c.spreadDef >= 0 ? "+\(fmt(c.spreadDef, 1))" : fmt(c.spreadDef, 1)
        let explain = [
            "\(fmt(plays, 1)) expected defensive plays (team pace \(pace)/gm, environment ×\(fmt(env, 3)) from O/U \(fmt(c.total, 1)) and spread \(spread))",
            "× \(Int((share * 100).rounded()))% snap share → \(Int(snaps.rounded())) snaps",
            "Tackle rate \(fmt(r.tackles * 100, 1))/100 snaps (solo share \(Int((r.soloShare * 100).rounded()))%), matchup ×\(fmt(tklMult, 3))",
            "Sack rate \(fmt(r.sacks * 100, 2))/100 snaps, opponent pass protection ×\(fmt(sackMult, 2))",
            "P(plays) \(Int((pPlay * 100).rounded()))% (\(c.practice.label))",
        ]

        return IDPProjection(
            name: c.name, team: c.team, position: c.position, opponent: c.opponent, playerID: c.playerID,
            expPlays: plays, envMult: env, snapShare: share, expSnaps: snaps,
            tklMult: tklMult, sackMult: sackMult,
            eSolo: eSolo, eAst: eAst, eSack: eSack, eTfl: eTfl, ePd: ePd, eInt: eInt, eFf: eFf, eQbHit: eQbHit,
            meanIfPlays: mean, sdIfPlays: sd, pPlay: pPlay, expPts: expPts,
            floorP25: floor, ceilingP75: ceiling, utility: utility,
            roleConf: c.roleConf, practice: c.practice, rosterPct: c.rosterPct, available: c.available,
            flags: flags, notes: c.notes, sources: c.sources, explain: explain,
            pBeatIncumbent: nil, expGain: nil, bidBand: nil
        )
    }

    private static func fmt(_ x: Double, _ places: Int) -> String { String(format: "%.\(places)f", x) }

    /// Projects, compares with the incumbent and ranks in one call.
    public static func report(candidates: [IDPCandidate], scoring: IDPScoring,
                              incumbentID: String? = nil, risk: StreamRiskMode = .neutral,
                              onlyAvailable: Bool = false) -> IDPStreamReport {
        StreamDecision.report(
            projections: candidates.map { project($0, scoring: scoring, risk: risk) },
            incumbentID: incumbentID, onlyAvailable: onlyAvailable
        )
    }

    /// Kept for call sites and tests written against the IDP engine.
    public static func pBeat(_ a: IDPProjection, _ b: IDPProjection) -> Double { StreamDecision.pBeat(a, b) }
}
