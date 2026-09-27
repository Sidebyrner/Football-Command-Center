import Foundation

/// Every numeric rule a scoring profile carries.
///
/// Having the rules as a type rather than as string keys is what lets the
/// Sleeper translation (`ScoringProfile.fromSleeper`) report what it *couldn't*
/// map instead of silently dropping it. `fumbleLost` was once missing from the
/// web app's profile, so Sleeper's `fum_lost` fell into an unmapped bucket and
/// every projection ran high (§4).
public enum ScoringRule: String, CaseIterable, Hashable, Sendable {
    // Passing
    case passingYardsPerPoint
    case passingTD
    case passingFirstDown
    case incompletion
    case sackTaken
    case interception
    case pickSix
    case passing300Bonus
    case passing400Bonus
    case completions25Bonus
    // Rushing
    case rushingYardsPerPoint
    case rushingTD
    case rushingFirstDown
    case rushing100Bonus
    case rushing200Bonus
    // Receiving
    case receptionPoints
    case receivingYardsPerPoint
    case receivingTD
    case receivingFirstDown
    case receiving100Bonus
    case receiving200Bonus
    // All positions
    case fumbleLost
    case passing2pt
    case rushing2pt
    case receiving2pt
    case specialTeamsTD
    // Kicker
    case fg0to39
    case fg40to49
    case fg50to59
    case fg60plus
    case xp
    case missedFG
    // Team defense
    case defSack
    case defInterception
    case defFumbleRecovery
    case defTD
    case defSafety
    case defPointsAllowed0
    case defPointsAllowed1to6
    case defPointsAllowed7to13
    case defPointsAllowed14to20
    case defPointsAllowed21to27
    case defPointsAllowed28to34
    case defPointsAllowedOver35
    // IDP
    case idpTackle
    case idpSack
    case idpInterception
    case idpFumbleRecovery
    case idpTD
    case idpPassDefended

    /// Human-readable label for the breakdown UI.
    public var label: String {
        switch self {
        case .passingYardsPerPoint: return "Pass yards"
        case .passingTD: return "Pass TD"
        case .passingFirstDown: return "Pass 1st downs"
        case .incompletion: return "Incompletions"
        case .sackTaken: return "Sacks taken"
        case .interception: return "Interceptions"
        case .pickSix: return "Pick six"
        case .passing300Bonus: return "300+ pass yds"
        case .passing400Bonus: return "400+ pass yds"
        case .completions25Bonus: return "25+ completions"
        case .rushingYardsPerPoint: return "Rush yards"
        case .rushingTD: return "Rush TD"
        case .rushingFirstDown: return "Rush 1st downs"
        case .rushing100Bonus: return "100+ rush yds"
        case .rushing200Bonus: return "200+ rush yds"
        case .receptionPoints: return "Receptions"
        case .receivingYardsPerPoint: return "Rec yards"
        case .receivingTD: return "Rec TD"
        case .receivingFirstDown: return "Rec 1st downs"
        case .receiving100Bonus: return "100+ rec yds"
        case .receiving200Bonus: return "200+ rec yds"
        case .fumbleLost: return "Fumbles lost"
        case .passing2pt: return "Pass 2-pt"
        case .rushing2pt: return "Rush 2-pt"
        case .receiving2pt: return "Rec 2-pt"
        case .specialTeamsTD: return "Return TD"
        case .fg0to39: return "FG 0-39"
        case .fg40to49: return "FG 40-49"
        case .fg50to59: return "FG 50-59"
        case .fg60plus: return "FG 60+"
        case .xp: return "Extra points"
        case .missedFG: return "Missed FG"
        case .defSack: return "DEF sacks"
        case .defInterception: return "DEF interceptions"
        case .defFumbleRecovery: return "DEF fumble recoveries"
        case .defTD: return "DEF TD"
        case .defSafety: return "DEF safety"
        case .defPointsAllowed0: return "Shutout"
        case .defPointsAllowed1to6: return "1-6 allowed"
        case .defPointsAllowed7to13: return "7-13 allowed"
        case .defPointsAllowed14to20: return "14-20 allowed"
        case .defPointsAllowed21to27: return "21-27 allowed"
        case .defPointsAllowed28to34: return "28-34 allowed"
        case .defPointsAllowedOver35: return "35+ allowed"
        case .idpTackle: return "IDP tackles"
        case .idpSack: return "IDP sacks"
        case .idpInterception: return "IDP interceptions"
        case .idpFumbleRecovery: return "IDP fumble recoveries"
        case .idpTD: return "IDP TD"
        case .idpPassDefended: return "IDP passes defended"
        }
    }
}

/// A league's scoring rules as data, not code. The engine walks a stat line and
/// applies them.
///
/// Yardage is stored as **yards per point** (`receivingYardsPerPoint = 10` means
/// one point per ten yards) — the reciprocal of Sleeper's points-per-yard.
/// Getting that backwards is silent and catastrophic, so every divide in the
/// engine goes through one guarded helper.
public struct ScoringProfile: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    /// Where the profile came from, so the UI can say whether these are the
    /// league's real rules or a bundled fallback.
    public var source: Source

    public enum Source: String, Codable, Sendable {
        /// Shipped defaults — a fallback and a reference, never the source of truth.
        case bundledDefault
        /// Read live from the league's own `scoring_settings`.
        case sleeper
        /// nflverse's `fantasy_points_ppr` definition, used only by the correctness gate.
        case reference
    }

    // Passing
    public var passingYardsPerPoint: Double
    public var passingTD: Double
    public var passingFirstDown: Double
    public var incompletion: Double
    public var sackTaken: Double
    public var interception: Double
    public var pickSix: Double
    public var passing300Bonus: Double
    public var passing400Bonus: Double
    public var completions25Bonus: Double
    // Rushing
    public var rushingYardsPerPoint: Double
    public var rushingTD: Double
    public var rushingFirstDown: Double
    public var rushing100Bonus: Double
    public var rushing200Bonus: Double
    // Receiving
    public var receptionPoints: Double
    public var receivingYardsPerPoint: Double
    public var receivingTD: Double
    public var receivingFirstDown: Double
    public var receiving100Bonus: Double
    public var receiving200Bonus: Double
    // All positions
    public var fumbleLost: Double
    public var passing2pt: Double
    public var rushing2pt: Double
    public var receiving2pt: Double
    public var specialTeamsTD: Double
    // Kicker
    public var fg0to39: Double
    public var fg40to49: Double
    public var fg50to59: Double
    public var fg60plus: Double
    public var xp: Double
    public var missedFG: Double
    // Team defense
    public var defSack: Double
    public var defInterception: Double
    public var defFumbleRecovery: Double
    public var defTD: Double
    public var defSafety: Double
    public var defPointsAllowed0: Double
    public var defPointsAllowed1to6: Double
    public var defPointsAllowed7to13: Double
    public var defPointsAllowed14to20: Double
    public var defPointsAllowed21to27: Double
    public var defPointsAllowed28to34: Double
    public var defPointsAllowedOver35: Double
    // IDP
    public var idpTackle: Double
    public var idpSack: Double
    public var idpInterception: Double
    public var idpFumbleRecovery: Double
    public var idpTD: Double
    public var idpPassDefended: Double

    /// Every rule zeroed. Sleeper omits rules worth nothing, so "absent" means
    /// zero — starting a translation from the bundled default would let an
    /// absent rule silently inherit our guess.
    public static func zeroed(id: String, name: String, source: Source) -> ScoringProfile {
        ScoringProfile(
            id: id, name: name, source: source,
            passingYardsPerPoint: 0, passingTD: 0, passingFirstDown: 0, incompletion: 0,
            sackTaken: 0, interception: 0, pickSix: 0, passing300Bonus: 0,
            passing400Bonus: 0, completions25Bonus: 0,
            rushingYardsPerPoint: 0, rushingTD: 0, rushingFirstDown: 0,
            rushing100Bonus: 0, rushing200Bonus: 0,
            receptionPoints: 0, receivingYardsPerPoint: 0, receivingTD: 0,
            receivingFirstDown: 0, receiving100Bonus: 0, receiving200Bonus: 0,
            fumbleLost: 0, passing2pt: 0, rushing2pt: 0, receiving2pt: 0, specialTeamsTD: 0,
            fg0to39: 0, fg40to49: 0, fg50to59: 0, fg60plus: 0, xp: 0, missedFG: 0,
            defSack: 0, defInterception: 0, defFumbleRecovery: 0, defTD: 0, defSafety: 0,
            defPointsAllowed0: 0, defPointsAllowed1to6: 0, defPointsAllowed7to13: 0,
            defPointsAllowed14to20: 0, defPointsAllowed21to27: 0,
            defPointsAllowed28to34: 0, defPointsAllowedOver35: 0,
            idpTackle: 0, idpSack: 0, idpInterception: 0, idpFumbleRecovery: 0,
            idpTD: 0, idpPassDefended: 0
        )
    }

    /// Mirrors the user's league. A **fallback and a reference**, not the source
    /// of truth — the app reads the real rules live from Sleeper on every load
    /// so a mid-season settings change is picked up automatically (§1).
    public static let leagueDefault: ScoringProfile = {
        var p = ScoringProfile.zeroed(
            id: "default-2026", name: "League Default (2026)", source: .bundledDefault
        )
        p.passingYardsPerPoint = 20
        p.passingTD = 6
        p.passingFirstDown = 1
        p.incompletion = -1
        p.sackTaken = -1
        p.interception = -5
        p.pickSix = -10
        p.passing300Bonus = 3
        p.passing400Bonus = 6
        p.completions25Bonus = 3

        p.rushingYardsPerPoint = 10
        p.rushingTD = 6
        p.rushingFirstDown = 1
        p.rushing100Bonus = 3
        p.rushing200Bonus = 6

        p.receptionPoints = 0 // NOT PPR
        p.receivingYardsPerPoint = 10
        p.receivingTD = 6
        p.receivingFirstDown = 1
        p.receiving100Bonus = 3
        p.receiving200Bonus = 6

        p.fumbleLost = -2
        p.passing2pt = 2
        p.rushing2pt = 2
        p.receiving2pt = 2
        p.specialTeamsTD = 6

        p.fg0to39 = 3
        p.fg40to49 = 4
        p.fg50to59 = 5
        p.fg60plus = 6
        p.xp = 1
        p.missedFG = -2

        p.defSack = 1
        p.defInterception = 3
        p.defFumbleRecovery = 2
        p.defTD = 6
        p.defSafety = 2
        p.defPointsAllowed0 = 12
        p.defPointsAllowed1to6 = 9
        p.defPointsAllowed7to13 = 6
        p.defPointsAllowed14to20 = 3
        p.defPointsAllowed21to27 = 1
        p.defPointsAllowed28to34 = 0
        p.defPointsAllowedOver35 = -3

        p.idpTackle = 1
        p.idpSack = 3
        p.idpInterception = 5
        p.idpFumbleRecovery = 3
        p.idpTD = 6
        p.idpPassDefended = 1
        return p
    }()

    /// nflverse's own `fantasy_points_ppr` definition expressed in this shape.
    ///
    /// Used **only** by the correctness gate: scoring a row under this must
    /// reproduce that row's own `fp_ppr_ref` to the cent, which is what proves
    /// the engine has no sign flips, unit errors, or missing terms (§4).
    public static let pprReference: ScoringProfile = {
        var p = ScoringProfile.zeroed(
            id: "nflverse-ppr-reference", name: "nflverse fantasy_points_ppr", source: .reference
        )
        p.passingYardsPerPoint = 25
        p.passingTD = 4
        p.interception = -2
        p.rushingYardsPerPoint = 10
        p.rushingTD = 6
        p.receivingYardsPerPoint = 10
        p.receivingTD = 6
        p.receptionPoints = 1
        p.passing2pt = 2
        p.rushing2pt = 2
        p.receiving2pt = 2
        p.fumbleLost = -2
        p.specialTeamsTD = 6
        return p
    }()

    /// Read/write access by rule. The switch is exhaustive, so adding a case to
    /// `ScoringRule` without a matching stored property is a compile error
    /// rather than a runtime surprise.
    public subscript(rule: ScoringRule) -> Double {
        get { self[keyPath: ScoringProfile.keyPath(for: rule)] }
        set { self[keyPath: ScoringProfile.keyPath(for: rule)] = newValue }
    }

    static func keyPath(for rule: ScoringRule) -> WritableKeyPath<ScoringProfile, Double> {
        switch rule {
        case .passingYardsPerPoint: return \.passingYardsPerPoint
        case .passingTD: return \.passingTD
        case .passingFirstDown: return \.passingFirstDown
        case .incompletion: return \.incompletion
        case .sackTaken: return \.sackTaken
        case .interception: return \.interception
        case .pickSix: return \.pickSix
        case .passing300Bonus: return \.passing300Bonus
        case .passing400Bonus: return \.passing400Bonus
        case .completions25Bonus: return \.completions25Bonus
        case .rushingYardsPerPoint: return \.rushingYardsPerPoint
        case .rushingTD: return \.rushingTD
        case .rushingFirstDown: return \.rushingFirstDown
        case .rushing100Bonus: return \.rushing100Bonus
        case .rushing200Bonus: return \.rushing200Bonus
        case .receptionPoints: return \.receptionPoints
        case .receivingYardsPerPoint: return \.receivingYardsPerPoint
        case .receivingTD: return \.receivingTD
        case .receivingFirstDown: return \.receivingFirstDown
        case .receiving100Bonus: return \.receiving100Bonus
        case .receiving200Bonus: return \.receiving200Bonus
        case .fumbleLost: return \.fumbleLost
        case .passing2pt: return \.passing2pt
        case .rushing2pt: return \.rushing2pt
        case .receiving2pt: return \.receiving2pt
        case .specialTeamsTD: return \.specialTeamsTD
        case .fg0to39: return \.fg0to39
        case .fg40to49: return \.fg40to49
        case .fg50to59: return \.fg50to59
        case .fg60plus: return \.fg60plus
        case .xp: return \.xp
        case .missedFG: return \.missedFG
        case .defSack: return \.defSack
        case .defInterception: return \.defInterception
        case .defFumbleRecovery: return \.defFumbleRecovery
        case .defTD: return \.defTD
        case .defSafety: return \.defSafety
        case .defPointsAllowed0: return \.defPointsAllowed0
        case .defPointsAllowed1to6: return \.defPointsAllowed1to6
        case .defPointsAllowed7to13: return \.defPointsAllowed7to13
        case .defPointsAllowed14to20: return \.defPointsAllowed14to20
        case .defPointsAllowed21to27: return \.defPointsAllowed21to27
        case .defPointsAllowed28to34: return \.defPointsAllowed28to34
        case .defPointsAllowedOver35: return \.defPointsAllowedOver35
        case .idpTackle: return \.idpTackle
        case .idpSack: return \.idpSack
        case .idpInterception: return \.idpInterception
        case .idpFumbleRecovery: return \.idpFumbleRecovery
        case .idpTD: return \.idpTD
        case .idpPassDefended: return \.idpPassDefended
        }
    }
}
