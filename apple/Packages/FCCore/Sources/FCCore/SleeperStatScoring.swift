import Foundation

/// One scoring key's contribution to a Sleeper-keyed stat line.
public struct SleeperScoreComponent: Hashable, Sendable {
    /// Sleeper's own key — `rec_yd`, `idp_sack`, `pts_allow_7_13`.
    public let key: String
    /// How many of the thing happened, or are projected to.
    public let units: Double
    /// Points per unit in this league.
    public let rate: Double
    public var points: Double { units * rate }
}

/// A Sleeper-keyed stat line scored under a league's own `scoring_settings`.
public struct SleeperScoredLine: Hashable, Sendable {
    public let points: Double
    /// Every key that contributed, largest contribution first.
    public let components: [SleeperScoreComponent]
    /// Stat keys with a non-zero value that the league does not pay for.
    /// Informational: `rec_tgt` in a league that does not score targets is
    /// expected, and nothing here is an error.
    public let unscoredKeys: [String]
}

/// Scores Sleeper stat lines — projections and actual weekly stats — under a
/// league's `scoring_settings`.
///
/// This is the dot product Sleeper itself uses: every key in the league's
/// scoring map is multiplied by the same-named key in the stat line. It needs no
/// dialect translation, which is what makes it exact for DEF, IDP and kickers,
/// the positions the nflverse-based engine cannot score (§3.2). The nflverse
/// engine is still the one that scores *produced* seasons; this one scores what
/// Sleeper's feeds report in Sleeper's own vocabulary.
public enum SleeperStatScoring {
    /// Keys that appear in Sleeper stat lines but are never scoring events —
    /// ranks, snap counts, games played and Sleeper's own point totals.
    static func isNonScoringKey(_ key: String) -> Bool {
        if key.hasPrefix("pts_") || key.hasPrefix("pos_rank") || key.hasPrefix("adp") || key.hasPrefix("pos_adp") {
            return true
        }
        if key.hasSuffix("_snp") || key.hasPrefix("tm_") { return true }
        switch key {
        case "gp", "gs", "gms_active", "rush_rec_yd", "anytime_tds", "first_td",
             "pass_ypa", "pass_ypc", "cmp_pct", "rec_ypr", "rec_ypt", "rush_ypa",
             "pass_rtg", "rec_lng", "rush_lng", "pass_lng", "rec_td_lng", "rush_td_lng", "pass_td_lng":
            return true
        default:
            return false
        }
    }

    /// Scores one stat line.
    ///
    /// - Parameters:
    ///   - stats: Sleeper's `stats` map for a player-week or a projection.
    ///   - scoring: the league's `scoring_settings`, read live (§1).
    public static func score(stats: [String: Double], scoring: [String: Double]) -> SleeperScoredLine {
        var components: [SleeperScoreComponent] = []
        var unscored: [String] = []

        for (key, units) in stats {
            guard units.isFinite, units != 0 else { continue }
            if let rate = scoring[key], rate.isFinite, rate != 0 {
                components.append(SleeperScoreComponent(key: key, units: units, rate: rate))
            } else if scoring[key] == nil, !isNonScoringKey(key) {
                unscored.append(key)
            }
        }

        components.sort { abs($0.points) > abs($1.points) }
        let total = components.reduce(0) { $0 + $1.points }
        return SleeperScoredLine(
            points: roundHalfUp(total, places: 2),
            components: components,
            unscoredKeys: unscored.sorted()
        )
    }

    /// Sleeper's default *standard* scoring, which is what its `pts_std` field
    /// reports. Exists so tests can prove the dot product reproduces Sleeper's
    /// own number on real stat lines; the app never scores a league with it.
    public static let sleeperStandard: [String: Double] = [
        "pass_yd": 0.04, "pass_td": 4, "pass_int": -1, "pass_2pt": 2,
        "rush_yd": 0.1, "rush_td": 6, "rush_2pt": 2,
        "rec_yd": 0.1, "rec_td": 6, "rec_2pt": 2, "rec": 0,
        "fum_lost": -2,
        "st_td": 6, "st_fum_rec": 1, "st_ff": 1,
        "fum_rec_td": 6,
        "xpm": 1, "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4, "fgm_50p": 5,
        "fgmiss": -1, "xpmiss": -1,
        "def_td": 6, "sack": 1, "int": 2, "ff": 1, "fum_rec": 2, "safe": 2, "blk_kick": 2,
        "def_st_td": 6, "def_st_ff": 1, "def_st_fum_rec": 1,
        "pts_allow_0": 10, "pts_allow_1_6": 7, "pts_allow_7_13": 4, "pts_allow_14_20": 1,
        "pts_allow_21_27": 0, "pts_allow_28_34": -1, "pts_allow_35p": -4,
        // No IDP keys: a standard league pays nothing for them, and a receiver
        // who tackles after an interception must not pick up a point here.
    ]
}
