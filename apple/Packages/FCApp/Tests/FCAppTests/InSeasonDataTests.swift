import XCTest
import FCCore
import FCData
@testable import FCApp

/// The forward-looking half of a league context: projections and Sleeper's own
/// weekly lines are joined in when reachable, and their absence is a labelled
/// fact rather than a failed load.
@MainActor
final class InSeasonDataTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func loader(_ transport: StubTransport) -> LeagueContextLoader {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        return LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
    }

    /// A 2026 league in week 3 with real recorded Sleeper payloads: week-3
    /// projections and week-2 stats. Week 1 and the live week are left
    /// unscripted on purpose.
    private func transport2026Week3() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":8,
             "roster_positions":["QB","RB","RB","WR","WR","TE","SUPER_FLEX","K","DEF","IDP_FLEX","IDP_FLEX","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,
                                 "idp_sack":5,"idp_tkl":0,"pts_allow_0":12,"fum_lost":-5},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2,"trade_deadline":11,
                         "playoff_week_start":15,"playoff_teams":6,"reserve_slots":2}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["9221","9488","qb1"],"starters":["qb1","9221","0"],
              "settings":{"wins":0,"losses":2,"waiver_budget_used":35,"waiver_position":2}},
             {"roster_id":2,"owner_id":"u2","players":["qb2"],"starters":["qb2"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"9221":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "9488":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "JAX":{"position":"DEF","team":"JAX","active":true}}
            """)
        try await transport.on("/projections/nfl/2026/3", fixture: "projections-2026-w3")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    func testProjectionsAndSleeperStatsJoinTheContext() async throws {
        let context = try await loader(try await transport2026Week3()).load(leagueID: "L1", userRosterID: 1)

        XCTAssertTrue(context.inSeason.hasProjections)
        XCTAssertEqual(context.inSeason.projectionSourceLabel, "Rotowire via Sleeper")
        let gibbs = try XCTUnwrap(context.projectedPoints("9221"))
        XCTAssertGreaterThan(gibbs, 10)

        XCTAssertEqual(context.inSeason.statWeeks, [2], "week 1 and the live week 3 were unscripted")
        let jsn = try XCTUnwrap(context.sleeperPointsPerGame("9488"))
        // 155 receiving yards at 0.1 plus three touchdowns at 6 under the fixture's rules.
        XCTAssertEqual(jsn, 33.5, accuracy: 0.01)

        // Never zero, never invented: a player with no line has no number.
        XCTAssertNil(context.projectedPoints("qb1"))
        XCTAssertNil(context.sleeperPointsPerGame("qb1"))
    }

    /// DEF and IDP are covered once Sleeper's lines are in hand — by that
    /// source, and labelled as such.
    func testDefenseAndIDPCoverageComesFromSleeperStats() async throws {
        let context = try await loader(try await transport2026Week3()).load(leagueID: "L1", userRosterID: 1)

        XCTAssertEqual(context.coverage(of: .rb), .nflverseWeekly)
        XCTAssertEqual(context.coverage(of: .def), .sleeperStats)
        XCTAssertEqual(context.coverage(of: .lb), .sleeperStats)
        XCTAssertNotNil(context.sleeperPointsPerGame("JAX"))
    }

    func testLeagueFactsAreReadLive() async throws {
        let context = try await loader(try await transport2026Week3()).load(leagueID: "L1", userRosterID: 1)
        let facts = context.leagueFacts

        XCTAssertEqual(facts.waivers, .faab(budget: 100))
        XCTAssertEqual(facts.faabRemaining, 65)
        XCTAssertEqual(facts.waiverPosition, 2)
        XCTAssertEqual(facts.tradeDeadlineWeek, 11)
        XCTAssertEqual(facts.playoffWeeks, [15, 16, 17])
        XCTAssertEqual(facts.irSlots, 2)
        XCTAssertEqual(facts.teamCount, 8)
        XCTAssertTrue(context.template.starters.contains { $0.eligible.contains(.qb) && $0.dedicated == nil },
                      "the SUPER_FLEX slot parses as a QB-eligible flex")
    }

    /// The whole point of fail-soft: with none of the insight routes or files
    /// reachable, the league still loads and says exactly what is missing.
    func testAbsentSourcesAreNamedAndNothingFails() async throws {
        let context = try await loader(await Harness.standardTransport()).load(leagueID: "L1", userRosterID: 1)

        XCTAssertFalse(context.inSeason.hasProjections)
        XCTAssertTrue(context.inSeason.weekStats.isEmpty)
        XCTAssertTrue(context.inSeason.unavailable.contains("Rotowire projections via Sleeper"))
        XCTAssertTrue(context.inSeason.unavailable.contains("depth charts"))
        XCTAssertTrue(context.inSeason.unavailable.contains { $0.hasPrefix("Sleeper stats for week") })
        XCTAssertEqual(context.coverage(of: .def), .none)
        XCTAssertEqual(context.leagueFacts.waivers, .unknown)
    }
}
