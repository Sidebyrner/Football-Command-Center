import XCTest
@testable import FCCore

final class NFLTeamsTests: XCTestCase {
    /// The one live disagreement between Sleeper and nflverse. Skipping this
    /// normalisation silently breaks bye detection for every Rams player, which
    /// looks like missing data rather than a join bug (§5.6).
    func testLARNormalisesToLA() {
        XCTAssertEqual(NFLTeams.nflverse("LAR"), "LA")
    }

    func testRelocatedFranchiseCodesJoinHistoricalSeasons() {
        XCTAssertEqual(NFLTeams.nflverse("STL"), "LA")
        XCTAssertEqual(NFLTeams.nflverse("SD"), "LAC")
        XCTAssertEqual(NFLTeams.nflverse("OAK"), "LV")
    }

    func testEveryOtherCodePassesThroughUnchanged() {
        for code in ["PHI", "KC", "GB", "NYJ", "LAC", "LV", "JAX", "WAS"] {
            XCTAssertEqual(NFLTeams.nflverse(code), code)
        }
        XCTAssertNil(NFLTeams.nflverse(nil))
        XCTAssertNil(NFLTeams.nflverse(""))
    }

    /// Applying the alias map twice must not move a team again.
    func testNormalisationIsIdempotent() {
        let once = NFLTeams.nflverse("LAR")
        XCTAssertEqual(NFLTeams.nflverse(once), once)
    }

    func testOddsAPINamesResolveToSleeperAbbreviations() {
        XCTAssertEqual(NFLTeams.abbreviation(oddsAPIName: "Los Angeles Rams"), "LAR")
        XCTAssertEqual(NFLTeams.abbreviation(oddsAPIName: "Green Bay Packers"), "GB")
        XCTAssertNil(NFLTeams.abbreviation(oddsAPIName: "Toronto Argonauts"))
    }

    /// Callers routinely hold an nflverse code where a team name belongs, so the
    /// lookup accepts either dialect rather than rendering a bare abbreviation.
    func testNameLookupAcceptsEitherDialect() {
        XCTAssertEqual(NFLTeams.name(abbreviation: "LAR"), "Los Angeles Rams")
        XCTAssertEqual(NFLTeams.name(abbreviation: "LA"), "Los Angeles Rams")
        XCTAssertEqual(NFLTeams.name(abbreviation: "PHI"), "Philadelphia Eagles")
        XCTAssertNil(NFLTeams.name(abbreviation: "ZZZ"))
    }

    func testTheCrosswalkCoversAllThirtyTwoTeams() {
        XCTAssertEqual(NFLTeams.abbreviationsByName.count, 32)
        XCTAssertEqual(NFLTeams.namesByAbbreviation.count, 32)
    }

    /// Kickers are `PK` and IDP is `CB`/`S`/`DE`/`DT` in `player-ids.json`.
    /// Translating at the boundary is the point; this cost real debugging time
    /// in the web app (§3.2).
    func testDynastyProcessPositionDialect() {
        XCTAssertEqual(Position(dynastyProcess: "PK"), .k)
        XCTAssertEqual(Position(dynastyProcess: "CB"), .db)
        XCTAssertEqual(Position(dynastyProcess: "S"), .db)
        XCTAssertEqual(Position(dynastyProcess: "DE"), .dl)
        XCTAssertEqual(Position(dynastyProcess: "DT"), .dl)
        XCTAssertEqual(Position(dynastyProcess: "WR"), .wr)
        XCTAssertNil(Position(dynastyProcess: "ZZZ"))
    }

    func testSleeperPositionDialect() {
        XCTAssertEqual(Position(sleeper: "DEF"), .def)
        XCTAssertEqual(Position(sleeper: "DST"), .def)
        XCTAssertEqual(Position(sleeper: "K"), .k)
        XCTAssertNil(Position(sleeper: "PK"))
        XCTAssertNil(Position(sleeper: nil))
    }
}
