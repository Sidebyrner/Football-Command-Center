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
