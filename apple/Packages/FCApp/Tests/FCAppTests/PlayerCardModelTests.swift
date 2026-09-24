import XCTest
import FCCore
import FCData
@testable import FCApp

/// The Player Card against recorded 2026 payloads: week-2 stat lines (served
/// for weeks 1 and 2), week-3 projections, and the shipped usage, depth and
/// team context files.
@MainActor
final class PlayerCardModelTests: XCTestCase {
    private var cacheDirectory: URL!

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private static let smithNjigba = "9488"
    private static let gibbs = "9221"

    private func context(projectionsForPlayer: Bool = true) async throws -> (LeagueContext, SleeperService) {
        let transport = await Harness.standardTransport()
        await transport.override("/state/nfl", json: #"{"week":3,"season":"2026","season_type":"regular"}"#)
        await transport.replace("/league/L1", json: """
            {"league_id":"L1","name":"Whack-A-Mole","season":"2026","total_rosters":2,
             "roster_positions":["RB","WR","BN"],
             "scoring_settings":{"rec":0,"rec_yd":0.1,"rec_td":6,"rush_yd":0.1,"rush_td":6,"rec_fd":1,"rush_fd":1}}
            """)
        await transport.replace("/league/L1/rosters", json: """
            [{"roster_id":1,"owner_id":"u1","players":["\(Self.gibbs)"],"starters":["\(Self.gibbs)","0"]},
             {"roster_id":2,"owner_id":"u2","players":[],"starters":["0","0"]}]
            """)
        await transport.replace("/players/nfl", json: """
            {"\(Self.gibbs)":{"full_name":"Jahmyr Gibbs","position":"RB","team":"DET","active":true},
             "\(Self.smithNjigba)":{"full_name":"Jaxon Smith-Njigba","position":"WR","team":"SEA","active":true,
                                    "injury_status":"Questionable","injury_body_part":"Ankle"}}
            """)
        try await transport.on("/projections/nfl/2026/3", fixture: "projections-2026-w3")
        try await transport.on("/stats/nfl/2026/1", fixture: "stats-2026-w2")
        try await transport.on("/stats/nfl/2026/2", fixture: "stats-2026-w2")
        if projectionsForPlayer {
            // Rotowire's week-by-week line for JSN, keyed by week as Sleeper sends it.
            await transport.override("/projections/nfl/player/\(Self.smithNjigba)", json: """
                {"1":{"player_id":"\(Self.smithNjigba)","week":1,"stats":{"rec_yd":70,"rec_td":0.5,"rec_fd":4},"company":"rotowire"},
                 "2":{"player_id":"\(Self.smithNjigba)","week":2,"stats":{"rec_yd":80,"rec_td":0.6,"rec_fd":4},"company":"rotowire"},
                 "3":{"player_id":"\(Self.smithNjigba)","week":3,"stats":{"rec_yd":75,"rec_td":0.5,"rec_fd":4},"company":"rotowire"}}
                """)
        }
        await transport.on("/players/nfl/\(Self.smithNjigba)/news", json: "[]")
        let harness = Harness.make(transport: transport)
        cacheDirectory = harness.cacheDirectory
        let loader = LeagueContextLoader(sleeper: harness.sleeper, staticData: harness.staticData, now: TestClock.beforeKickoffs)
        return (try await loader.load(leagueID: "L1", userRosterID: 1), harness.sleeper)
    }

    func testOverviewJoinsStatusDepthAndLines() async throws {
        let (context, sleeper) = try await context()
        let model = PlayerCardModel(playerID: Self.smithNjigba, context: context, sleeper: sleeper)
        let status = try XCTUnwrap(model.status)
        XCTAssertEqual(status.availability, .freeAgent)
        XCTAssertEqual(status.sleeperTag, "Questionable")
        XCTAssertEqual(status.bodyPart, "Ankle")
        XCTAssertNotNil(status.depthRank, "listed on SEA's official WR chart")
        XCTAssertNotNil(status.byeWeek)
        XCTAssertNotNil(model.rotowireThisWeek)
    }

    func testGradeRanksAgainstThePositionCohortAndChipsStaySeparate() async throws {
        let (context, sleeper) = try await context()
        let model = PlayerCardModel(playerID: Self.smithNjigba, context: context, sleeper: sleeper)
        let grade = try XCTUnwrap(model.grade)
        XCTAssertNotNil(grade.score)
        XCTAssertGreaterThan(grade.cohortSize, 11)
        XCTAssertTrue(grade.factors.contains { $0.metric == .targetShare })
        XCTAssertTrue(grade.factors.contains { $0.metric == .pointsPerGame })
        // A three-touchdown week puts him at the very top of the receivers.
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(grade.factors.first { $0.metric == .pointsPerGame }).percentile, 0.95)

        let chipMetrics = Set(model.chips.map(\.metric))
        XCTAssertTrue(chipMetrics.contains(.quarterbackPlay), "SEA has QBR in the team context file")
        XCTAssertTrue(chipMetrics.contains(.targetCompetition))
        XCTAssertTrue(chipMetrics.contains(.depthChartRank))
        XCTAssertNil(model.chips.first { $0.metric == .depthChartRank }?.percentile, "a rank is a fact, not a percentile")
    }

    func testWeightedViewIsOptInAndPersistsItsWeights() async throws {
        let (context, sleeper) = try await context()
        var saved: [String: Double]?
        let model = PlayerCardModel(playerID: Self.smithNjigba, context: context, sleeper: sleeper,
                                    weights: [:], onWeightsChange: { saved = $0 })
        XCTAssertFalse(model.showWeighted)
        XCTAssertEqual(model.weight(for: WeightedGrade.gradeKey), WeightedGrade.defaultGradeWeight)
        let before = try XCTUnwrap(model.weighted)
        model.weights[WeightedGrade.gradeKey] = 0
        XCTAssertEqual(saved?[WeightedGrade.gradeKey], 0)
        let after = try XCTUnwrap(model.weighted)
        XCTAssertFalse(after.parts.contains { $0.name == "Cohort grade" })
        XCTAssertNotEqual(before.parts.count, after.parts.count)
    }

    func testCalibrationComparesBothProjectionsWithWhatHappened() async throws {
        let (context, sleeper) = try await context()
        let model = PlayerCardModel(playerID: Self.smithNjigba, context: context, sleeper: sleeper)
        await model.load()
        XCTAssertEqual(model.calibration.map(\.week), [2, 1])
        let week2 = try XCTUnwrap(model.calibration.first)
        // 155 yards, 3 touchdowns, 5 first downs under the fixture's rules.
        XCTAssertEqual(week2.actual, 38.5, accuracy: 0.01)
        XCTAssertEqual(try XCTUnwrap(week2.rotowire), 8 + 3.6 + 4, accuracy: 0.01)
        XCTAssertNotNil(week2.commandCenter)
        let summary = try XCTUnwrap(model.calibrationSummary)
        XCTAssertEqual(summary.weeks, 2)
        XCTAssertNotNil(summary.rotowireError)
        XCTAssertNotNil(summary.commandCenterError)
        // The log carries each week's projection beside the result.
        XCTAssertEqual(model.log.first?.week, 3, "this week's projection appears before the game")
        XCTAssertNil(model.log.first?.points)
    }

    func testWithoutPerPlayerProjectionsTheCardStillBuilds() async throws {
        let (context, sleeper) = try await context(projectionsForPlayer: false)
        let model = PlayerCardModel(playerID: Self.smithNjigba, context: context, sleeper: sleeper)
        await model.load()
        XCTAssertEqual(model.calibration.count, 2)
        XCTAssertNil(model.calibration.first?.rotowire)
        XCTAssertNotNil(model.calibration.first?.commandCenter)
    }
}
