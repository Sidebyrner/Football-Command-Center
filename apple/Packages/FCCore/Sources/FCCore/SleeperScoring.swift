import Foundation

/// How a league pays for receptions.
public struct PPRFormat: Hashable, Sendable {
    public let value: Double
    public let label: String
}

/// The result of translating a Sleeper league's `scoring_settings`.
public struct SleeperScoringTranslation: Hashable, Sendable {
    public let profile: ScoringProfile
    public let ppr: PPRFormat
    /// Scoring rules Sleeper sent that this app does not model, sorted.
    ///
    /// Surfaced, never dropped. `fumbleLost` was once missing from the profile,
    /// so Sleeper's `fum_lost` fell into this bucket unnoticed and every
    /// projection silently ran high (§4).
    public let unmapped: [String]
    /// Field-goal buckets Sleeper pays differently *inside* one of our four
    /// tiers, so the collapse below lost information. Named so the UI can admit
    /// the gap rather than imply full fidelity.
    public let lossyFieldGoalTiers: [String]
}

public extension ScoringProfile {
    /// Sleeper event key to profile rule, for straight one-to-one point values.
    static let sleeperDirectRules: [String: ScoringRule] = [
        "pass_td": .passingTD,
        "pass_fd": .passingFirstDown,
        "pass_int": .interception,
        "pass_inc": .incompletion,
        "pass_sack": .sackTaken,
        "pass_int_td": .pickSix,
        "bonus_pass_yd_300": .passing300Bonus,
        "bonus_pass_yd_400": .passing400Bonus,
        "bonus_pass_cmp_25": .completions25Bonus,

        "rush_td": .rushingTD,
        "rush_fd": .rushingFirstDown,
        "bonus_rush_yd_100": .rushing100Bonus,
        "bonus_rush_yd_200": .rushing200Bonus,

        "fum_lost": .fumbleLost,
        "pass_2pt": .passing2pt,
        "rush_2pt": .rushing2pt,
        "rec_2pt": .receiving2pt,
        "st_td": .specialTeamsTD,

        "rec": .receptionPoints,
        "rec_td": .receivingTD,
        "rec_fd": .receivingFirstDown,
        "bonus_rec_yd_100": .receiving100Bonus,
        "bonus_rec_yd_200": .receiving200Bonus,

        "xpm": .xp,
        "fgmiss": .missedFG,

        "sack": .defSack,
        "int": .defInterception,
        "fum_rec": .defFumbleRecovery,
        "def_td": .defTD,
        "safe": .defSafety,
        "pts_allow_0": .defPointsAllowed0,
        "pts_allow_1_6": .defPointsAllowed1to6,
        "pts_allow_7_13": .defPointsAllowed7to13,
        "pts_allow_14_20": .defPointsAllowed14to20,
        "pts_allow_21_27": .defPointsAllowed21to27,
        "pts_allow_28_34": .defPointsAllowed28to34,
        "pts_allow_35p": .defPointsAllowedOver35,

        "idp_tkl": .idpTackle,
        "idp_sack": .idpSack,
        "idp_int": .idpInterception,
        "idp_fum_rec": .idpFumbleRecovery,
        "idp_def_td": .idpTD,
        "idp_pass_def": .idpPassDefended,
    ]

    /// Sleeper stores yardage as **points per yard** (`pass_yd: 0.04`); this
    /// profile stores **yards per point** (`passingYardsPerPoint: 25`). They are
    /// reciprocals and getting it backwards is silent and catastrophic.
    static func yardsPerPoint(fromPointsPerYard pointsPerYard: Double?) -> Double? {
        guard let pointsPerYard, pointsPerYard > 0, pointsPerYard.isFinite else { return nil }
        return roundHalfUp(1 / pointsPerYard, places: 2)
    }

    /// Builds a profile from a league's own `scoring_settings`.
    ///
    /// Starts from an all-zero base rather than the bundled default, because
    /// Sleeper omits rules worth nothing — an absent rule means zero, and
    /// inheriting our guess for it would be a silent lie (§1).
    static func fromSleeper(
        scoringSettings: [String: Double],
        leagueName: String = "League"
    ) -> SleeperScoringTranslation {
        var profile = ScoringProfile.zeroed(
            id: "sleeper-league", name: "\(leagueName) (from Sleeper)", source: .sleeper
        )

        var unmapped: [String] = []
        let yardageKeys: Set<String> = ["pass_yd", "rush_yd", "rec_yd"]

        for (key, value) in scoringSettings {
            guard value.isFinite else { continue }
            if let rule = sleeperDirectRules[key] {
                profile[rule] = value
                continue
            }
            if yardageKeys.contains(key) { continue }   // handled below
            if key.hasPrefix("fgm") { continue }        // handled below
            if value != 0 { unmapped.append(key) }
        }

        profile.passingYardsPerPoint = yardsPerPoint(fromPointsPerYard: scoringSettings["pass_yd"])
            ?? ScoringProfile.leagueDefault.passingYardsPerPoint
        profile.rushingYardsPerPoint = yardsPerPoint(fromPointsPerYard: scoringSettings["rush_yd"])
            ?? ScoringProfile.leagueDefault.rushingYardsPerPoint
        profile.receivingYardsPerPoint = yardsPerPoint(fromPointsPerYard: scoringSettings["rec_yd"])
            ?? ScoringProfile.leagueDefault.receivingYardsPerPoint

        // Sleeper buckets field goals by ten yards; this profile buckets by
        // scoring tier. Take the longest distance in each of our tiers, which is
        // what the tier actually pays for, and fall back down the buckets when a
        // league omits some.
        func firstPresent(_ keys: [String]) -> Double? {
            for key in keys {
                if let value = scoringSettings[key], value.isFinite { return value }
            }
            return nil
        }
        profile.fg0to39 = firstPresent(["fgm_30_39", "fgm_20_29", "fgm_0_19"]) ?? 0
        profile.fg40to49 = firstPresent(["fgm_40_49"]) ?? 0
        profile.fg50to59 = firstPresent(["fgm_50_59", "fgm_50p"]) ?? 0
        profile.fg60plus = firstPresent(["fgm_60p", "fgm_50p", "fgm_50_59"]) ?? 0

        // The 0-39 collapse is lossy whenever the league pays differently inside
        // it. Say so instead of implying a faithful translation.
        let shortTiers = ["fgm_0_19", "fgm_20_29", "fgm_30_39"]
        let shortValues = shortTiers.compactMap { scoringSettings[$0] }
        var lossy: [String] = []
        if Set(shortValues).count > 1 { lossy.append(contentsOf: shortTiers) }

        return SleeperScoringTranslation(
            profile: profile,
            ppr: detectPPR(scoringSettings),
            unmapped: unmapped.sorted(),
            lossyFieldGoalTiers: lossy
        )
    }

    /// PPR format from the per-reception value.
    static func detectPPR(_ scoringSettings: [String: Double]?) -> PPRFormat {
        let rec = scoringSettings?["rec"] ?? 0
        if rec >= 1 {
            return PPRFormat(value: rec, label: rec > 1 ? "\(rec) PPR" : "Full PPR")
        }
        if rec > 0 {
            return PPRFormat(value: rec, label: rec == 0.5 ? "Half PPR" : "\(rec) PPR")
        }
        return PPRFormat(value: 0, label: "Non-PPR (standard)")
    }
}
