import XCTest
import FCCore
@testable import FCData

/// The trimmed projection of Sleeper's ~5 MB player payload (§3.1).
final class PlayerIndexTests: XCTestCase {
    /// A payload shaped like Sleeper's, including the awkward records: a team
    /// defense keyed by abbreviation, a retired player, and one with no `active`
    /// flag at all.
    private let payload = """
    {
      "4034": {"full_name":"Christian McCaffrey","first_name":"Christian",
               "last_name":"McCaffrey","position":"RB","team":"SF",
               "injury_status":null,"active":true},
      "6794": {"full_name":"Justin Jefferson","first_name":"Justin",
               "last_name":"Jefferson","position":"WR","team":"MIN",
               "injury_status":"Questionable","active":true},
      "PHI":  {"position":"DEF","team":"PHI","active":true},
      "1234": {"full_name":"Retired Guy","position":"WR","team":"FA","active":false},
      "9999": {"full_name":"No Flag","position":"TE","team":"NYJ"},
      "5555": {"first_name":"Only","last_name":"Parts","position":"QB",
               "team":"LAR","active":true}
    }
    """

    private func index() throws -> PlayerIndex {
        try PlayerIndex.build(fromSleeperPayload: Data(payload.utf8))
    }

    func testBuildsFromTheRawPayload() throws {
        let index = try index()
        XCTAssertEqual(index.count, 6)
        XCTAssertEqual(index["4034"]?.name, "Christian McCaffrey")
        XCTAssertEqual(index["4034"]?.position, .rb)
    }

    /// The whole point: a team defense's id is its team abbreviation, and
    /// anything assuming numeric ids breaks here (§3.1).
    func testATeamDefenceIsKeyedByAbbreviationAndStillGetsAName() throws {
        let index = try index()
        let defence = try XCTUnwrap(index["PHI"])

        XCTAssertEqual(defence.position, .def)
        XCTAssertTrue(defence.isTeamDefense)
        XCTAssertNil(Int(defence.id), "a DEF id is not a number")
        XCTAssertFalse(defence.name.isEmpty, "a DEF has no full_name and must not be dropped")
    }

    /// Forgetting the active flag silently fills the pool with retired players.
    func testInactivePlayersAreExcludedFromTheActivePool() throws {
        let index = try index()
        let active = index.activePlayers().map(\.id)

        XCTAssertFalse(active.contains("1234"), "a retired player must not be in the pool")
        XCTAssertTrue(active.contains("4034"))
    }

    /// Absent is treated as inactive, so an unrecognised record cannot sneak in.
    func testAMissingActiveFlagIsTreatedAsInactive() throws {
        let index = try index()
        XCTAssertEqual(index["9999"]?.active, false)
        XCTAssertFalse(index.activePlayers().map(\.id).contains("9999"))
    }

    func testFallsBackToFirstAndLastNameWhenFullNameIsAbsent() throws {
        let index = try index()
        XCTAssertEqual(index["5555"]?.name, "Only Parts")
    }

    func testFiltersByPosition() throws {
        let index = try index()
        XCTAssertEqual(index.players(at: .rb).map(\.id), ["4034"])
        XCTAssertEqual(index.players(at: .def).map(\.id), ["PHI"])
    }

    func testSearchIgnoresCaseAndPunctuation() throws {
        let index = try index()
        XCTAssertEqual(index.search("mccaffrey").map(\.id), ["4034"])
        XCTAssertEqual(index.search("Mc.Caffrey").map(\.id), ["4034"])
        XCTAssertEqual(index.search("JEFFERSON").map(\.id), ["6794"])
    }

    func testSearchExcludesInactivePlayers() throws {
        let index = try index()
        XCTAssertTrue(index.search("Retired").isEmpty)
    }

    func testEmptySearchReturnsNothingRatherThanEverything() throws {
        let index = try index()
        XCTAssertTrue(index.search("").isEmpty)
        XCTAssertTrue(index.search("   ").isEmpty)
    }

    func testInjuryDesignationIsOnlySetWhenSleeperReportsOne() throws {
        let index = try index()
        XCTAssertTrue(index["6794"]?.hasInjuryDesignation ?? false)
        XCTAssertFalse(index["4034"]?.hasInjuryDesignation ?? true)
    }

    /// Teams are normalised for joining against the static files (§5.6).
    func testTeamIsNormalisedToTheNflverseSpelling() throws {
        let index = try index()
        XCTAssertEqual(index["5555"]?.team, "LAR")
        XCTAssertEqual(index["5555"]?.nflverseTeam, "LA")
    }

    /// The projection must actually be smaller than what it came from —
    /// that is the entire reason it exists.
    func testTheProjectionIsSubstantiallySmallerThanThePayload() throws {
        let index = try index()
        let encoded = try JSONEncoder().encode(index)
        XCTAssertLessThan(encoded.count, Data(payload.utf8).count)
    }

    /// Sleeper sends height as inches or feet-and-inches, and weight as a
    /// string or a number, depending on the player.
    func testBioFieldsDecodeWhateverShapeSleeperSends() throws {
        let bio = """
        {
          "1": {"full_name":"A","position":"RB","team":"SF","active":true,"age":29,"years_exp":8,
                "college":"Stanford","height":"71","weight":"205","birth_date":"1996-06-07","number":23},
          "2": {"full_name":"B","position":"WR","team":"MIN","active":true,"height":"6'1\\"","weight":215,
                "birth_date":"1999-06-16","years_exp":0},
          "3": {"full_name":"C","position":"TE","team":"KC","active":true,"height":"","weight":null,"age":"31",
                "depth_chart_order":"2"}
        }
        """
        let now = ISO8601DateFormatter().date(from: "2026-09-25T12:00:00Z")!
        let index = try PlayerIndex.build(fromSleeperPayload: Data(bio.utf8), now: now)
        let a = try XCTUnwrap(index["1"])
        XCTAssertEqual(a.age, 29)
        XCTAssertEqual(a.yearsExperience, 8)
        XCTAssertEqual(a.college, "Stanford")
        XCTAssertEqual(a.heightInches, 71)
        XCTAssertEqual(a.heightLabel, "5'11\"")
        XCTAssertEqual(a.weightPounds, 205)
        XCTAssertEqual(a.jerseyNumber, 23)
        let b = try XCTUnwrap(index["2"])
        XCTAssertEqual(b.heightInches, 73)
        XCTAssertEqual(b.weightPounds, 215)
        XCTAssertEqual(b.age, 27, "worked out from the birth date")
        XCTAssertEqual(b.yearsExperience, 0)
        let c = try XCTUnwrap(index["3"], "odd types on one player must not cost him")
        XCTAssertNil(c.heightInches)
        XCTAssertNil(c.weightPounds)
        XCTAssertEqual(c.age, 31)
        XCTAssertEqual(c.depthChartOrder, 2)
    }

    /// An index cached before the bio fields existed still decodes.
    func testAnIndexCachedWithoutBioFieldsStillDecodes() throws {
        let old = #"{"players":{"1":{"id":"1","name":"A","positionCode":"RB","active":true}},"builtAt":0}"#
        let index = try JSONDecoder().decode(PlayerIndex.self, from: Data(old.utf8))
        XCTAssertEqual(index["1"]?.name, "A")
        XCTAssertNil(index["1"]?.age)
    }

    func testTheIndexRoundTripsThroughTheCache() throws {
        let index = try index()
        let encoded = try JSONEncoder().encode(index)
        let decoded = try JSONDecoder().decode(PlayerIndex.self, from: encoded)

        XCTAssertEqual(decoded.count, index.count)
        XCTAssertEqual(decoded["PHI"]?.position, .def)
    }

    func testAMalformedPayloadThrowsNamingTheEndpoint() throws {
        XCTAssertThrowsError(try PlayerIndex.build(fromSleeperPayload: Data("[]".utf8))) { error in
            guard case DataLayerError.undecodable(let path, _) = error else {
                return XCTFail("expected an undecodable error, got \(error)")
            }
            XCTAssertEqual(path, "/players/nfl")
        }
    }
}
