import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Waiver Board against recorded 2026 Sleeper payloads: week-3 projections
/// and week-2 stat lines. Jaxon Smith-Njigba is a free agent with both; the
/// user's bench holds a receiver with neither.
@MainActor
final class WaiverBoardModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let smithNjigba = "9488"
    private static let gibbs = "9221"
    /// A back with a week-3 projection and no recorded week-2 line.
    private static let projectedOnlyBack = "9509"

    private func transport() async throws -> StubTransport {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["QB","RB","WR","WR","BN","BN","IR"],
             "scoring_settings":{"pass_yd":0.05,"pass_td":6,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6},
             "settings":{"waiver_type":2,"waiver_budget":100,"waiver_day_of_week":2,"reserve_slots":1}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1",
              "players":["qb1","rb1","wr1","wr2","wr_bench","ir_guy"],
              "starters":["qb1","rb1","wr1","wr2"],"reserve":["ir_guy"],
              "settings":{"waiver_budget_used":40,"waiver_position":1}},
             {"roster_id":2,"owner_id":"u2",
              "players":["qb2","rb2","wr3","wr4","\(Self.gibbs)"],
              "starters":["qb2","rb2","wr3","wr4"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"qb1":{"full_name":"Starter QB","position":"QB","team":"BUF","active":true},
             "rb1":{"full_name":"Starter Back","position":"RB","team":"DET","active":true},
             "wr1":{"full_name":"Receiver One","position":"WR","team":"MIN","active":true},
             "wr2":{"full_name":"Receiver Two","position":"WR","team":"DAL","active":true},
             "wr_bench":{"full_name":"Bench Receiver","position":"WR","team":"NE","active":true},
             "ir_guy":{"full_name":"Reserve Back","position":"RB","team":"KC","active":true,"injury_status":"IR"},
             "qb2":{"full_name":"Rival QB","position":"QB","team":"CIN","active":true},
             "rb2":{"full_name":"Rival Back","position":"RB","team":"KC","active":true},
             "wr3":{"full_name":"Receiver Three","position":"WR","team":"NYJ","active":true},
             "wr4":{"full_name":"Receiver Four","position":"WR","team":"MIA","active":true},
             "\(Self.gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "\(Self.smithNjigba)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true},
             "\(Self.projectedOnlyBack)":{"full_name":"Bijan Robinson","position":"RB","team":"ATL","active":true},
             "retired":{"full_name":"Retired Receiver","position":"WR","team":"SEA","active":false}}
            """)
        try await transport.on("/projections/nfl/2026/3", fixture: "projections-2026-w3")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        return transport
    }

    private func model(_ transport: StubTransport) async -> WaiverBoardModel {
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        let model = WaiverBoardModel(loader: loader, sleeper: nil)
        await model.load(leagueID: "L1", userRosterID: 1)
        return model
    }

    func testFreeAgentsRankOnProjectionOverTheProjectedStartLine() async throws {
        let model = await model(try await transport())
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(model.sort, .projectedOverLine)

        let jsn = try XCTUnwrap(model.rows.first { $0.id == Self.smithNjigba })
        XCTAssertEqual(jsn.availability, .freeAgent)
        XCTAssertNotNil(jsn.projected)
        XCTAssertNotNil(jsn.projectedOverLine)
        XCTAssertEqual(try XCTUnwrap(jsn.sleeperPointsPerGame), 33.5, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(jsn.snapShare), 47.0 / 70.0, accuracy: 0.001)
        XCTAssertEqual(jsn.redZoneTouches, 3)
        XCTAssertNotNil(jsn.targetShare, "team targets are summed from every Sleeper line that week")

        // The projected start line for WR is the 2nd-best projected receiver in
        // a two-team league starting two — and JSN is above it or on it.
        let line = try XCTUnwrap(model.projectedLines[.wr])
        XCTAssertEqual(line.starters, 4)
        XCTAssertEqual(try XCTUnwrap(jsn.projectedOverLine), try XCTUnwrap(jsn.projected) - line.startLine, accuracy: 0.001)

        // Sorted descending with the unvalued at the bottom.
        let values = model.rows.map { $0.value(.projectedOverLine) }
        let valued = values.compactMap { $0 }
        XCTAssertEqual(valued, valued.sorted(by: >))
        if let firstNil = values.firstIndex(where: { $0 == nil }) {
            XCTAssertTrue(values[firstNil...].allSatisfy { $0 == nil })
        }
        XCTAssertFalse(model.rows.contains { $0.id == "retired" })
        XCTAssertFalse(model.rows.contains { $0.id == "wr1" }, "your own players are never on the board")
    }

    func testRivalBenchesAreHiddenUntilAsked() async throws {
        let model = await model(try await transport())
        XCTAssertFalse(model.rows.contains { $0.id == Self.gibbs })
        model.includeRivalBenches = true
        let gibbs = try XCTUnwrap(model.rows.first { $0.id == Self.gibbs })
        XCTAssertEqual(gibbs.availability, .rivalBench(rosterID: 2, manager: "rival"))
    }

    func testPositionFilterSearchAndSortSwitch() async throws {
        let model = await model(try await transport())
        model.positionFilter = .rb
        XCTAssertEqual(model.rows.map(\.id), [Self.projectedOnlyBack])

        model.positionFilter = nil
        model.query = "njigba"
        XCTAssertEqual(model.rows.map(\.id), [Self.smithNjigba])

        model.query = ""
        model.sort = .snapShare
        let first = try XCTUnwrap(model.rows.first)
        XCTAssertNotNil(first.snapShare)
        XCTAssertEqual(first.id, Self.smithNjigba)
        XCTAssertEqual(model.unvaluedCount, 1, "the projected-only back has no snap share yet and ranks last")
    }

    func testLeagueFactsStripReadsLiveSettings() async throws {
        let model = await model(try await transport())
        let facts = try XCTUnwrap(model.facts)
        XCTAssertEqual(facts.system, .faab(budget: 100))
        XCTAssertEqual(facts.faabRemaining, 60)
        XCTAssertEqual(facts.waiverPosition, 1)
        XCTAssertEqual(facts.processingDay, "Tuesday")
        XCTAssertEqual(facts.irSlots, 1)
        XCTAssertEqual(facts.irUsed, 1)
        XCTAssertEqual(facts.irFree, 0)
    }

    /// The bench is the drop list: starters and IR players never appear, an
    /// IR-tagged player is marked eligible, and the weakest projection is first.
    func testDropCandidatesAreTheBenchWeakestFirst() async throws {
        let model = await model(try await transport())
        XCTAssertEqual(model.dropCandidates.map(\.id), ["wr_bench"])
        XCTAssertFalse(model.dropCandidates.contains { $0.id == "ir_guy" })
        XCTAssertFalse(model.dropCandidates.contains { $0.id == "wr1" })
    }

    /// Adding a projected receiver for an unprojected bench receiver: the
    /// lineup gains exactly what the optimizer seats.
    func testPairEffectMeasuresTheLineupOnTheProjection() async throws {
        let model = await model(try await transport())
        let jsn = try XCTUnwrap(model.rows.first { $0.id == Self.smithNjigba })
        let drop = try XCTUnwrap(model.dropCandidates.first)
        let effect = model.pairEffect(add: jsn, drop: drop)
        XCTAssertNil(effect.note)
        XCTAssertEqual(effect.before, 0, "nobody currently rostered has a projection in the fixture")
        XCTAssertEqual(try XCTUnwrap(effect.after), try XCTUnwrap(jsn.projected), accuracy: 0.11)
        XCTAssertEqual(try XCTUnwrap(effect.delta), try XCTUnwrap(jsn.projected), accuracy: 0.11)
        XCTAssertTrue(effect.basisLabel.contains("Rotowire"))
    }

    /// With no projections reachable the board still lists what it can measure
    /// and the pair effect says why it has no number.
    func testWithoutProjectionsTheBoardDegradesAndSaysSo() async throws {
        let transport = try await transport()
        await transport.fail("/projections/nfl")
        await transport.fail("/stats/nfl")
        let model = await model(transport)
        XCTAssertNil(model.errorMessage)
        XCTAssertTrue(model.projectedLines.isEmpty)
        XCTAssertTrue(model.sourceNotes.contains { $0.contains("Unavailable") })
        // The default column has nobody to rank, so the board moves to the
        // first one that does rather than showing a list of dashes.
        XCTAssertNotEqual(model.sort, .projectedOverLine)
        XCTAssertNotNil(model.rows.first?.value(model.sort))
    }
}
