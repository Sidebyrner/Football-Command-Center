import XCTest
import FCCore
@testable import FCData

/// Sleeper's payload shapes, and specifically the ones with meaning encoded in
/// their structure rather than their values.
final class SleeperModelTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(json.utf8))
    }

    // MARK: - Rosters

    /// `starters` is positionally aligned to the league's starting slots, and
    /// `"0"` means the slot was left unset. Index order carries the meaning, so
    /// the raw array must survive decoding unchanged (§3.1).
    func testStartersKeepTheirPositionalAlignment() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"owner_id":"u1",
         "starters":["4034","0","6794","PHI"],
         "players":["4034","6794","PHI","1234"]}
        """)

        XCTAssertEqual(roster.starters, ["4034", "0", "6794", "PHI"])
        XCTAssertEqual(roster.starters?[1], SleeperRoster.emptyStarterSlot)
    }

    func testFilledStartersDropsUnsetSlotsButKeepsOrder() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"starters":["4034","0","6794","PHI"],"players":[]}
        """)
        XCTAssertEqual(roster.filledStarters, ["4034", "6794", "PHI"])
    }

    /// A DEF in the starting lineup is the case that breaks numeric-id code.
    func testATeamDefenceSurvivesAsAStarter() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"starters":["PHI"],"players":["PHI"]}
        """)
        XCTAssertEqual(roster.filledStarters, ["PHI"])
        XCTAssertTrue(roster.bench.isEmpty)
    }

    func testBenchIsWhatIsRosteredButNotStarting() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"starters":["4034","0"],"players":["4034","6794","1234"]}
        """)
        XCTAssertEqual(roster.bench, ["6794", "1234"])
    }

    /// The unset-slot sentinel must not be mistaken for a benched player.
    func testTheEmptySlotSentinelNeverAppearsOnTheBench() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"starters":["0","0"],"players":["4034"]}
        """)
        XCTAssertEqual(roster.bench, ["4034"])
        XCTAssertFalse(roster.bench.contains("0"))
    }

    /// Sleeper splits points either side of the decimal point.
    func testPointsRecombineAcrossSleepersSplitFields() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"settings":{"wins":7,"losses":3,"fpts":1234,"fpts_decimal":56,
         "fpts_against":1100,"fpts_against_decimal":4}}
        """)
        XCTAssertEqual(roster.settings?.pointsFor ?? 0, 1234.56, accuracy: 0.001)
        XCTAssertEqual(roster.settings?.pointsAgainst ?? 0, 1100.04, accuracy: 0.001)
    }

    func testMissingPointsAreNilRatherThanZero() throws {
        let roster = try decode(SleeperRoster.self, """
        {"roster_id":1,"settings":{"wins":0}}
        """)
        XCTAssertNil(roster.settings?.pointsFor)
    }

    // MARK: - League

    /// Roster shape and scoring are read from the league, never hardcoded (§12).
    func testLeagueParsesItsOwnSlotTemplate() throws {
        let league = try decode(SleeperLeague.self, """
        {"league_id":"L1","name":"Test","roster_positions":
         ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN","BN","IR"],
         "scoring_settings":{"rec":1.0,"pass_td":4.0}}
        """)

        let template = league.slotTemplate
        XCTAssertEqual(template.totalStarterSlots, 9)
        XCTAssertEqual(template.benchCount, 2)
        XCTAssertEqual(template.flexSlots.count, 1)
        XCTAssertEqual(template.dedicatedCounts()[.rb], 2)
    }

    func testLeagueScoringTranslatesThroughFCCore() throws {
        let league = try decode(SleeperLeague.self, """
        {"league_id":"L1","name":"Test",
         "scoring_settings":{"rec":1.0,"pass_td":4.0,"pass_yd":0.04}}
        """)

        let translation = ScoringProfile.fromSleeper(
            scoringSettings: league.scoringSettings ?? [:],
            leagueName: league.name ?? "League"
        )
        XCTAssertEqual(translation.profile.receptionPoints, 1.0)
        XCTAssertEqual(translation.profile.passingTD, 4.0)
        // 0.04 points per yard is 25 yards per point.
        XCTAssertEqual(translation.profile.passingYardsPerPoint, 25, accuracy: 0.001)
    }

    // MARK: - Members

    /// A manager's own team name supersedes their display name, and it arrives
    /// nested under `metadata`.
    func testTeamNameIsReadFromNestedMetadata() throws {
        let member = try decode(SleeperLeagueMember.self, """
        {"user_id":"u1","display_name":"connor","metadata":{"team_name":"Byrne Notice"}}
        """)
        XCTAssertEqual(member.teamName, "Byrne Notice")
        XCTAssertEqual(member.label, "Byrne Notice")
    }

    func testLabelFallsBackToDisplayNameThenID() throws {
        let noTeam = try decode(SleeperLeagueMember.self, """
        {"user_id":"u1","display_name":"connor"}
        """)
        XCTAssertEqual(noTeam.label, "connor")

        let bare = try decode(SleeperLeagueMember.self, #"{"user_id":"u1"}"#)
        XCTAssertEqual(bare.label, "u1")
    }

    /// The cache writes these back out flat, so the decoder has to read its own
    /// output — otherwise a cached league quietly loses every team name.
    func testAMemberRoundTripsThroughItsOwnEncoding() throws {
        let original = try decode(SleeperLeagueMember.self, """
        {"user_id":"u1","display_name":"connor","metadata":{"team_name":"Byrne Notice"}}
        """)

        let reloaded = try JSONDecoder().decode(
            SleeperLeagueMember.self, from: JSONEncoder().encode(original)
        )
        XCTAssertEqual(reloaded.teamName, "Byrne Notice")
        XCTAssertEqual(reloaded.label, original.label)
    }

    // MARK: - State and transactions

    func testNFLStateExposesSeasonAsANumber() throws {
        let state = try decode(NFLState.self, """
        {"week":3,"season":"2026","season_type":"regular","leg":3}
        """)
        XCTAssertEqual(state.week, 3)
        XCTAssertEqual(state.seasonYear, 2026)
        XCTAssertTrue(state.isRegularSeason)
    }

    /// Sleeper sends epoch **milliseconds**; treating them as seconds puts every
    /// transaction in 1970.
    func testTransactionTimestampsAreMilliseconds() throws {
        let transaction = try decode(SleeperTransaction.self, """
        {"transaction_id":"t1","type":"waiver","status":"complete",
         "created":1757700000000,"roster_ids":[1],"adds":{"4034":1},"drops":null}
        """)

        let date = try XCTUnwrap(transaction.date)
        let year = Calendar(identifier: .gregorian).component(.year, from: date)
        XCTAssertGreaterThan(year, 2020)
        XCTAssertTrue(transaction.isComplete)
        XCTAssertEqual(transaction.adds?["4034"], 1)
    }

    /// Sleeper adds fields without warning; a decoder that insists on knowing
    /// them all turns their next release into our outage (§9).
    func testUnknownFieldsAreIgnoredRatherThanFatal() throws {
        let league = try decode(SleeperLeague.self, """
        {"league_id":"L1","name":"Test","brand_new_field":{"nested":[1,2,3]},
         "another":"surprise"}
        """)
        XCTAssertEqual(league.leagueID, "L1")
    }
}
