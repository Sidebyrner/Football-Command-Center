import XCTest
import FCCore
import FCData
@testable import FCApp

/// The three forward-looking bases on Sit/Start and the matchup row's new
/// columns, against recorded 2026 Sleeper payloads: Jahmyr Gibbs and Jaxon
/// Smith-Njigba start for the user with the Jaguars defense, so a DEF slot is
/// valued for the first time; a linebacker with a recorded line is on the bench.
@MainActor
final class ProjectionBasisTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let gibbs = "9221"
    private static let smithNjigba = "9488"
    private static let jaguars = "JAX"

    /// A linebacker from the week-2 fixture with an `idp_tkl` line.
    private func linebacker() throws -> (id: String, name: String, team: String) {
        struct Line: Decodable {
            let playerID: String; let team: String?; let stats: [String: Double]
            let player: Player?
            struct Player: Decodable { let firstName: String?; let lastName: String?; let position: String?
                enum CodingKeys: String, CodingKey { case firstName = "first_name", lastName = "last_name", position } }
            enum CodingKeys: String, CodingKey { case playerID = "player_id", team, stats, player }
        }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "stats-2026-w2", withExtension: "json", subdirectory: "Fixtures"))
        let lines = try JSONDecoder().decode([Line].self, from: Data(contentsOf: url))
        let lb = try XCTUnwrap(lines.first { $0.player?.position == "LB" && ($0.stats["idp_tkl"] ?? 0) > 0 && $0.team != nil })
        return (lb.playerID, [lb.player?.firstName, lb.player?.lastName].compactMap { $0 }.joined(separator: " "), lb.team!)
    }

    private func transport() async throws -> StubTransport {
        let lb = try linebacker()
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["RB","WR","DEF","IDP_FLEX","BN","BN"],
             "scoring_settings":{"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,"idp_tkl":1,"idp_sack":5,
                                 "pts_allow_0":12,"pts_allow_1_6":9,"pts_allow_7_13":6,"pts_allow_14_20":3,"sack":1,"int":3}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1",
              "players":["\(Self.gibbs)","\(Self.smithNjigba)","\(Self.jaguars)","\(lb.id)","wr_bench"],
              "starters":["\(Self.gibbs)","\(Self.smithNjigba)","\(Self.jaguars)","0"]},
             {"roster_id":2,"owner_id":"u2","players":["rb2","wr2"],"starters":["rb2","wr2","0","0"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"\(Self.gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "\(Self.smithNjigba)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "\(Self.jaguars)":{"position":"DEF","team":"JAX","active":true},
             "\(lb.id)":{"full_name":"\(lb.name)","position":"LB","team":"\(lb.team)","active":true},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"NE","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "wr2":{"full_name":"Rival Receiver","position":"WR","team":"NYJ","active":true}}
            """)
        await transport.override("/matchups/3", json: """
            [{"roster_id":1,"matchup_id":1,"starters":["\(Self.gibbs)","\(Self.smithNjigba)","\(Self.jaguars)","0"]},
             {"roster_id":2,"matchup_id":1,"starters":["rb2","wr2","0","0"]}]
            """)
        try await transport.on("/projections/nfl/2026/3", fixture: "projections-2026-w3")
        try await transport.on("/stats/nfl/2026/1", fixture: "stats-2026-w2")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func harness(_ transport: StubTransport) -> (sleeper: SleeperService, loader: LeagueContextLoader) {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return (harness.sleeper, LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs))
    }

    func testProjectedBasisValuesEveryPositionIncludingDefense() async throws {
        let (_, loader) = harness(try await transport())
        let model = SitStartModel(loader: loader)
        await model.load(leagueID: "L1", userRosterID: 1)
        XCTAssertNil(model.errorMessage)

        model.basis = .projected
        XCTAssertEqual(model.projectionSourceLabel, "Rotowire via Sleeper")
        let lineup = model.lineup
        let defense = try XCTUnwrap(lineup.first { $0.slot == "DEF" })
        XCTAssertNotNil(defense.value, "the DEF slot is valued on the projected basis")
        XCTAssertFalse(defense.keptBecauseUnvalued)
        let back = try XCTUnwrap(lineup.first { $0.slot == "RB" })
        XCTAssertGreaterThan(try XCTUnwrap(back.value), 10)
        // The bench receiver has no projection: left out by name, never zero.
        XCTAssertTrue(model.unranked.noProjection.contains("Bench Receiver"))
        XCTAssertEqual(model.unranked.noProductionData, [])
    }

    func testThisSeasonBasisValuesDefenseAndIDPFromSleeperLines() async throws {
        let lb = try linebacker()
        let (_, loader) = harness(try await transport())
        let model = SitStartModel(loader: loader)
        await model.load(leagueID: "L1", userRosterID: 1)

        model.basis = .thisSeason
        let idp = try XCTUnwrap(model.lineup.first { $0.slot == "IDP_FLEX" })
        XCTAssertEqual(idp.playerID, lb.id, "the empty IDP slot is filled from the bench because the linebacker now has a value")
        XCTAssertNotNil(idp.value)
        let defense = try XCTUnwrap(model.lineup.first { $0.slot == "DEF" })
        XCTAssertNotNil(defense.value)
        XCTAssertTrue(model.unranked.noSleeperLine.contains("Bench Receiver"))
    }

    func testCommandCenterBasisIsItsOwnNumberWithFactors() async throws {
        let (_, loader) = harness(try await transport())
        let model = SitStartModel(loader: loader)
        await model.load(leagueID: "L1", userRosterID: 1)

        model.basis = .commandCenter
        let projection = try XCTUnwrap(model.commandCenterProjection(Self.gibbs))
        XCTAssertTrue(projection.isValued)
        XCTAssertEqual(projection.factors.map(\.name).prefix(3), ["Pace", "Usage", "Matchup"])
        // This season (one recorded game) regressed toward last season's line.
        XCTAssertTrue(projection.factors[0].detail.contains("last season"))
        let back = try XCTUnwrap(model.lineup.first { $0.slot == "RB" })
        XCTAssertEqual(back.value, projection.weekly)
        // Never the same number as Rotowire's: a separate claim.
        XCTAssertNotEqual(back.value, model.context?.projectedPoints(Self.gibbs))
    }

    func testMatchupRowsCarryProjectionAndThisSeasonLine() async throws {
        let (sleeper, loader) = harness(try await transport())
        let model = MatchupModel(loader: loader, sleeper: sleeper)
        await model.load(leagueID: "L1", userRosterID: 1)
        XCTAssertNil(model.errorMessage)

        let mine = try XCTUnwrap(model.mySide)
        let defense = try XCTUnwrap(mine.rows.first { $0.slot == "DEF" })
        XCTAssertNotNil(defense.projected)
        XCTAssertNotNil(defense.thisSeason, "DEF has a this-season line from Sleeper")
        XCTAssertNil(defense.season, "and still no nflverse line — different claims")
        let back = try XCTUnwrap(mine.rows.first { $0.slot == "RB" })
        XCTAssertNotNil(back.projected)
        XCTAssertEqual(back.defenseSource, .nflverse(season: 2025))
    }

    /// The Sleeper-based defense table covers IDP once lines exist, even before
    /// any defense has the four games needed for a rank.
    func testDefenseLookupCoversIDPFromSleeperLines() async throws {
        let (_, loader) = harness(try await transport())
        let context = try await loader.load(leagueID: "L1", userRosterID: 1)
        let lookup = DefenseLookup.build(context: context)
        XCTAssertEqual(lookup.source(for: .wr), .nflverse(season: 2025))
        XCTAssertEqual(lookup.source(for: .lb), .sleeper(season: 2026))
        XCTAssertNil(lookup.source(for: .def))
        XCTAssertTrue(lookup.sleeper.covers(.lb))
        XCTAssertNil(lookup.sleeper.ranked[.lb]?.first, "one recorded week cannot rank anyone")
    }
}
