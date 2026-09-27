import XCTest
@testable import FCCore

final class SleeperScoringTests: XCTestCase {
    /// Sleeper stores yardage as points per yard; this profile stores yards per
    /// point. They are reciprocals and getting it backwards is silent and
    /// catastrophic.
    func testYardageIsConvertedByReciprocal() {
        let translation = ScoringProfile.fromSleeper(
            scoringSettings: ["pass_yd": 0.04, "rush_yd": 0.1, "rec_yd": 0.1]
        )

        XCTAssertEqual(translation.profile.passingYardsPerPoint, 25, accuracy: 0.001)
        XCTAssertEqual(translation.profile.rushingYardsPerPoint, 10, accuracy: 0.001)
        XCTAssertEqual(translation.profile.receivingYardsPerPoint, 10, accuracy: 0.001)
    }

    /// A league that genuinely scores no yardage falls back to the bundled
    /// default rather than dividing by zero.
    func testZeroPointsPerYardFallsBackRatherThanExploding() {
        let translation = ScoringProfile.fromSleeper(scoringSettings: ["pass_yd": 0])

        XCTAssertTrue(translation.profile.passingYardsPerPoint.isFinite)
        XCTAssertEqual(
            translation.profile.passingYardsPerPoint,
            ScoringProfile.leagueDefault.passingYardsPerPoint
        )
    }

    /// Sleeper omits rules worth nothing, so "absent" means zero — never "keep
    /// our guess". Starting from the bundled default would make an absent rule
    /// silently inherit a value the league never set (§1).
    func testAbsentRulesAreZeroNotInherited() {
        let translation = ScoringProfile.fromSleeper(scoringSettings: ["pass_td": 6])

        XCTAssertEqual(translation.profile.passingTD, 6)
        XCTAssertEqual(translation.profile.receptionPoints, 0)
        XCTAssertEqual(translation.profile.interception, 0)
        XCTAssertEqual(translation.profile.idpTackle, 0)
        XCTAssertNotEqual(
            translation.profile.interception, ScoringProfile.leagueDefault.interception
        )
        XCTAssertEqual(translation.profile.source, .sleeper)
    }

    /// The bug this whole mechanism exists for: `fumbleLost` was once missing
    /// from the profile, so Sleeper's `fum_lost` fell into `unmapped` unnoticed
    /// and every projection silently ran high (§4).
    func testFumblesLostAreMappedAndNotSilentlyDropped() {
        let translation = ScoringProfile.fromSleeper(scoringSettings: ["fum_lost": -2])

        XCTAssertEqual(translation.profile.fumbleLost, -2)
        XCTAssertFalse(translation.unmapped.contains("fum_lost"))
    }

    /// Anything we cannot map is reported so the UI can admit the gap rather
    /// than implying full fidelity.
    func testUnmappedRulesAreSurfacedSortedAndOnlyWhenTheyPay() {
        let translation = ScoringProfile.fromSleeper(
            scoringSettings: [
                "pass_td": 6,
                "zeta_bonus": 3,
                "alpha_bonus": 1,
                "worthless_rule": 0,
            ]
        )

        XCTAssertEqual(translation.unmapped, ["alpha_bonus", "zeta_bonus"])
        XCTAssertFalse(
            translation.unmapped.contains("worthless_rule"),
            "a rule worth nothing is not a gap"
        )
    }

    func testFieldGoalTiersCollapseToTheLongestBucketInEachTier() {
        let translation = ScoringProfile.fromSleeper(
            scoringSettings: [
                "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3,
                "fgm_40_49": 4, "fgm_50_59": 5,
            ]
        )

        XCTAssertEqual(translation.profile.fg0to39, 3)
        XCTAssertEqual(translation.profile.fg40to49, 4)
        XCTAssertEqual(translation.profile.fg50to59, 5)
        XCTAssertEqual(translation.profile.fg60plus, 5, "falls back down to the 50-59 bucket")
        XCTAssertTrue(translation.lossyFieldGoalTiers.isEmpty)
    }

    /// Collapsing Sleeper's ten-yard buckets into four tiers is lossy whenever a
    /// league pays differently inside one. Say so rather than hide it.
    func testALossyFieldGoalCollapseIsReported() {
        let translation = ScoringProfile.fromSleeper(
            scoringSettings: ["fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 4]
        )

        XCTAssertEqual(translation.profile.fg0to39, 4)
        XCTAssertEqual(
            translation.lossyFieldGoalTiers, ["fgm_0_19", "fgm_20_29", "fgm_30_39"]
        )
    }

    func testPPRDetection() {
        XCTAssertEqual(ScoringProfile.detectPPR(["rec": 1]).label, "Full PPR")
        XCTAssertEqual(ScoringProfile.detectPPR(["rec": 0.5]).label, "Half PPR")
        XCTAssertEqual(ScoringProfile.detectPPR([:]).label, "Non-PPR (standard)")
        XCTAssertEqual(ScoringProfile.detectPPR(nil).value, 0)
        XCTAssertEqual(ScoringProfile.detectPPR(["rec": 0]).label, "Non-PPR (standard)")
    }

    /// A round trip through the real league's shape: the translated profile must
    /// score a real stat line identically to the bundled default it mirrors.
    func testTranslatedLeagueProfileScoresLikeTheBundledDefault() throws {
        let settings: [String: Double] = [
            "pass_yd": 0.05, "pass_td": 6, "pass_fd": 1, "pass_inc": -1, "pass_sack": -1,
            "pass_int": -5, "pass_int_td": -10,
            "bonus_pass_yd_300": 3, "bonus_pass_yd_400": 6, "bonus_pass_cmp_25": 3,
            "rush_yd": 0.1, "rush_td": 6, "rush_fd": 1,
            "bonus_rush_yd_100": 3, "bonus_rush_yd_200": 6,
            "rec": 0, "rec_yd": 0.1, "rec_td": 6, "rec_fd": 1,
            "bonus_rec_yd_100": 3, "bonus_rec_yd_200": 6,
            "fum_lost": -2, "pass_2pt": 2, "rush_2pt": 2, "rec_2pt": 2, "st_td": 6,
            "fgm_0_19": 3, "fgm_20_29": 3, "fgm_30_39": 3, "fgm_40_49": 4,
            "fgm_50_59": 5, "fgm_60p": 6, "xpm": 1, "fgmiss": -2,
            "sack": 1, "int": 3, "fum_rec": 2, "def_td": 6, "safe": 2,
            "pts_allow_0": 12, "pts_allow_1_6": 9, "pts_allow_7_13": 6,
            "pts_allow_14_20": 3, "pts_allow_21_27": 1, "pts_allow_28_34": 0,
            "pts_allow_35p": -3,
            "idp_tkl": 1, "idp_sack": 3, "idp_int": 5, "idp_fum_rec": 3,
            "idp_def_td": 6, "idp_pass_def": 1,
        ]
        let translated = ScoringProfile.fromSleeper(
            scoringSettings: settings, leagueName: "Command Center"
        )

        XCTAssertEqual(translated.unmapped, [])
        XCTAssertEqual(translated.ppr.label, "Non-PPR (standard)")
        XCTAssertEqual(translated.profile.name, "Command Center (from Sleeper)")

        for rule in ScoringRule.allCases {
            XCTAssertEqual(
                translated.profile[rule], ScoringProfile.leagueDefault[rule], "\(rule)"
            )
        }

        let file = try Fixtures.weekly2025()
        let rows = file.rows(for: Fixtures.Player.joshAllen)
        let fromSleeper = ScoringEngine.score(
            weeks: rows, profile: translated.profile, position: .qb
        )
        let fromDefault = ScoringEngine.score(
            weeks: rows, profile: .leagueDefault, position: .qb
        )
        XCTAssertEqual(fromSleeper.total, fromDefault.total, accuracy: 0.001)
    }

    /// Never hardcode league settings: a mid-season change must flow straight
    /// through (§1).
    func testAMidSeasonSettingsChangeFlowsThrough() throws {
        let row = try XCTUnwrap(
            Fixtures.weekly2025().rows(for: Fixtures.Player.bijanRobinson).first
        )
        let nonPPR = ScoringProfile.fromSleeper(scoringSettings: ["rec_yd": 0.1, "rec": 0])
        let fullPPR = ScoringProfile.fromSleeper(scoringSettings: ["rec_yd": 0.1, "rec": 1])

        let before = try XCTUnwrap(
            ScoringEngine.score(row, profile: nonPPR.profile, position: .rb).points
        )
        let after = try XCTUnwrap(
            ScoringEngine.score(row, profile: fullPPR.profile, position: .rb).points
        )

        XCTAssertGreaterThan(after, before)
        XCTAssertEqual(after - before, row.number(.receptions), accuracy: 0.001)
    }
}
