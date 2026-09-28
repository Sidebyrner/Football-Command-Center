import XCTest
import FCCore
@testable import FCApp

@MainActor
final class DiscoveryModelTests: XCTestCase {
    private var cacheDirectory: URL?

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func services() async throws -> AppServices {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        XCTAssertNil(services.discovery.errorMessage)
        return services
    }

    func testEveryFreeAgentIsListedEvenWithNoDataButTheBoardStillHidesThem() async throws {
        let services = try await services()
        let discovery = services.discovery
        XCTAssertTrue(discovery.allRows.contains { $0.id == WorkspaceFixture.unknown }, "no-data free agent listed")
        XCTAssertTrue(discovery.visible.contains { $0.id == WorkspaceFixture.henderson })
        XCTAssertFalse(services.waivers.rows.contains { $0.id == WorkspaceFixture.unknown }, "the Waiver Board is unchanged")
        XCTAssertFalse(discovery.allRows.contains { $0.id == WorkspaceFixture.cook }, "my players aren't acquirable")
        XCTAssertFalse(discovery.allRows.contains { $0.id == WorkspaceFixture.gibbs }, "rival starters aren't either")
    }

    func testRowsWithoutTheSortedNumberSinkToTheBottom() async throws {
        let discovery = try await services().discovery
        discovery.sort = .column(.projected)
        let values = discovery.visible.map { $0.value(.projected) }
        let firstNil = values.firstIndex { $0 == nil } ?? values.count
        XCTAssertTrue(values[firstNil...].allSatisfy { $0 == nil }, "nothing valued after the first blank")
        let valued = values[..<firstNil].compactMap { $0 }
        XCTAssertEqual(valued, valued.sorted(by: >))
        XCTAssertGreaterThan(discovery.unvaluedCount, 0)

        discovery.sort = .name
        let names = discovery.visible.map(\.name)
        XCTAssertEqual(names, names.sorted())
        XCTAssertEqual(discovery.unvaluedCount, 0)
    }

    func testSearchForgivesTyposAndMatchesTeams() async throws {
        let discovery = try await services().discovery
        discovery.query = "hendersn"
        XCTAssertEqual(discovery.visible.first?.id, WorkspaceFixture.henderson)
        discovery.query = "deep sleper"
        XCTAssertEqual(discovery.visible.map(\.id), [WorkspaceFixture.unknown])
        discovery.query = "zzzz"
        XCTAssertTrue(discovery.visible.isEmpty)
    }

    func testBenchToggleAndPositionFilter() async throws {
        let discovery = try await services().discovery
        XCTAssertFalse(discovery.visible.contains { $0.id == WorkspaceFixture.hampton }, "rival bench hidden by default")
        discovery.includeRivalBenches = true
        XCTAssertTrue(discovery.visible.contains { $0.id == WorkspaceFixture.hampton })
        discovery.positionFilter = .qb
        XCTAssertTrue(discovery.visible.allSatisfy { $0.position == .qb })
        XCTAssertTrue(discovery.filterablePositions.contains(.lb), "IDP positions the league starts are filterable")
    }

    func testAPanelCanSortAndFilterWithoutMovingTheSharedList() async throws {
        let discovery = try await services().discovery
        let shared = discovery.visible
        let names = discovery.rows(position: .rb, sort: .name)
        XCTAssertTrue(names.allSatisfy { $0.position == .rb })
        XCTAssertEqual(names.map(\.name), names.map(\.name).sorted())
        XCTAssertEqual(discovery.visible, shared)
        XCTAssertEqual(DiscoverySort(storageKey: "name"), .name)
        XCTAssertEqual(DiscoverySort(storageKey: WaiverSort.snapShare.rawValue), .column(.snapShare))
        XCTAssertNil(DiscoverySort(storageKey: "nonsense"))
    }

    func testAnyPlayerHasARowForCompareIncludingMine() async throws {
        let discovery = try await services().discovery
        XCTAssertEqual(discovery.row(for: WorkspaceFixture.cook)?.availability, .mine)
        XCTAssertNil(discovery.row(for: "not-a-player"))
    }
}

@MainActor
final class PlayerScheduleTests: XCTestCase {
    private var cacheDirectory: URL?

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func schedule(_ id: String = WorkspaceFixture.henderson,
                          liveLines: [Int: [String: TeamGameLine]] = [:]) async throws -> (PlayerSchedule, LeagueContext, DefenseLookup) {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        let context = try XCTUnwrap(services.discovery.context)
        let defense = services.discovery.defense
        return (PlayerSchedule.build(playerID: id, context: context, defense: defense, liveLines: liveLines), context, defense)
    }

    func testTheRestOfTheSeasonWithRecordedLinesWhereTheyExist() async throws {
        let (schedule, context, _) = try await schedule()
        XCTAssertEqual(schedule.team, "NE")
        XCTAssertEqual(schedule.weeks.map(\.week), context.remainingWeeks)
        XCTAssertEqual(schedule.weeks.first?.week, 3)
        let week3 = try XCTUnwrap(schedule.weeks.first)
        XCTAssertNotNil(week3.opponent)
        XCTAssertTrue(week3.hasLine, "the fixture records lines for weeks 1–4")
        XCTAssertEqual(week3.lineSource, .recordedClosing)
        XCTAssertNotNil(week3.impliedTotal)
        XCTAssertFalse(schedule.coveredWeeks.isEmpty)
        XCTAssertTrue(schedule.coveredWeeks.allSatisfy { $0 <= 4 }, "no lines past week 4 in the fixture")
        let later = try XCTUnwrap(schedule.weeks.first { $0.week > 4 && !$0.isBye })
        XCTAssertNotNil(later.opponent, "the opponent is known even without a line")
        XCTAssertFalse(later.hasLine)
        XCTAssertNil(later.lineSource)
    }

    func testTheByeWeekIsMarked() async throws {
        let (schedule, context, _) = try await schedule()
        let bye = try XCTUnwrap(context.remainingWeeks.first { context.byeCalendar.isOnBye(team: "NE", week: $0) })
        let week = try XCTUnwrap(schedule.weeks.first { $0.week == bye })
        XCTAssertTrue(week.isBye)
        XCTAssertNil(week.opponent)
        XCTAssertEqual(schedule.byeWeek, bye)
    }

    func testStrengthOfScheduleIsMeanAllowedOverLeagueAverage() async throws {
        let (schedule, _, defense) = try await schedule()
        let allowed = schedule.weeks.compactMap(\.defensePerGame)
        XCTAssertEqual(schedule.strengthOfScheduleGames, allowed.count)
        if let average = defense.leagueAverage(position: .rb), average > 0, !allowed.isEmpty {
            let expected = allowed.reduce(0, +) / Double(allowed.count) / average
            XCTAssertEqual(try XCTUnwrap(schedule.strengthOfSchedule), expected, accuracy: 1e-9)
        } else {
            XCTAssertNil(schedule.strengthOfSchedule)
        }
    }

    func testLiveLinesReplaceRecordedOnes() async throws {
        let live = TeamGameLine(team: "NE", opponent: "ZZZ", isHome: true, kickoff: nil, time: nil,
                                spread: -7, total: 44, impliedTotal: 25.5)
        let (schedule, _, _) = try await schedule(liveLines: [3: ["NE": live]])
        let week3 = try XCTUnwrap(schedule.weeks.first)
        XCTAssertEqual(week3.opponent, "ZZZ")
        XCTAssertEqual(week3.spread, -7)
        XCTAssertEqual(week3.lineSource, .live)
    }
}

@MainActor
final class PlayerComparisonTests: XCTestCase {
    func testTheBestValuePerRowRespectsDirection() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = try XCTUnwrap(services.dashboard.context)
        let ids = [WorkspaceFixture.cook, WorkspaceFixture.gibbs, WorkspaceFixture.henderson]
        let cards = ids.map { services.playerCard($0, context: context) }
        let comparison = PlayerComparison.build(cards: cards, rows: services.discovery.row(for:),
                                                defense: services.discovery.defense, lastN: 6)
        XCTAssertEqual(comparison.players.map(\.id), ids)
        XCTAssertEqual(comparison.players.map(\.seriesIndex), [0, 1, 2])
        let ppg = comparison.values(.pointsPerGame)
        if let best = comparison.bestIndex(.pointsPerGame) {
            XCTAssertEqual(ppg[best], ppg.compactMap { $0 }.max())
        }
        for player in comparison.players where player.floor != nil {
            XCTAssertLessThanOrEqual(player.floor!, player.ceiling!)
        }
    }

    func testNoTintWithFewerThanTwoValuesOrAllEqual() {
        let a = PlayerComparison.Player(id: "a", name: "A", position: .rb, team: nil, opponent: nil, seriesIndex: 0,
                                        log: [], values: [.opponentRank: 3, .pointsPerGame: 10], floor: nil, expected: nil, ceiling: nil)
        let b = PlayerComparison.Player(id: "b", name: "B", position: .rb, team: nil, opponent: nil, seriesIndex: 1,
                                        log: [], values: [.opponentRank: 12, .pointsPerGame: 10], floor: nil, expected: nil, ceiling: nil)
        let comparison = PlayerComparison(players: [a, b], lastN: 6, weeks: [])
        XCTAssertEqual(comparison.bestIndex(.opponentRank), 0, "rank 3 is the softer matchup")
        XCTAssertNil(comparison.bestIndex(.pointsPerGame), "a tie tints nobody")
        XCTAssertNil(comparison.bestIndex(.snapShare))
    }

    /// A WR and an RB meet on shared dimensions, each from his own measures;
    /// a lower-is-better measure is flipped; a dimension his position has no
    /// measure for is absent rather than zero.
    func testProfileMapsEachPositionOntoSharedDimensions() throws {
        let cohort = (1...20).map(Double.init)
        let wrGrade = PlayerGrade.compute(
            metrics: [.targetsPerGame: 18, .snapShare: 15, .targetShare: 15, .yardsPerTarget: 10, .catchRate: 10, .dropRate: 2],
            cohorts: [.targetsPerGame: cohort, .snapShare: cohort, .targetShare: cohort, .yardsPerTarget: cohort,
                      .catchRate: cohort, .dropRate: cohort],
            weights: [.targetsPerGame: 1, .snapShare: 1, .targetShare: 1, .yardsPerTarget: 1, .catchRate: 1, .dropRate: 1])
        let wr = PlayerComparison.profile(grade: wrGrade, position: .wr)
        XCTAssertEqual(Set(wr.keys), [.volume, .role, .efficiency, .ballSecurity])
        XCTAssertEqual(wr[.role]?.factors.count, 2, "snap share and target share")
        XCTAssertGreaterThan(try XCTUnwrap(wr[.ballSecurity]?.percentile), 0.8, "2 drops is near the bottom of the cohort, so flipped high")

        let rbGrade = PlayerGrade.compute(
            metrics: [.touchesPerGame: 5, .snapShare: 5],
            cohorts: [.touchesPerGame: cohort, .snapShare: cohort],
            weights: [.touchesPerGame: 1, .snapShare: 1])
        let rb = PlayerComparison.profile(grade: rbGrade, position: .rb)
        XCTAssertEqual(Set(rb.keys), [.volume, .role])
        XCTAssertLessThan(try XCTUnwrap(rb[.volume]?.percentile), try XCTUnwrap(wr[.volume]?.percentile))
        XCTAssertNil(rb[.ballSecurity], "backs have no ball-security measure")
        XCTAssertTrue(PlayerComparison.profile(grade: nil, position: .qb).isEmpty)
    }

    func testComparisonCarriesScheduleStatusAndUsageByPosition() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = try XCTUnwrap(services.dashboard.context)
        let ids = [WorkspaceFixture.cook, WorkspaceFixture.mahomes, WorkspaceFixture.bolton]
        let cards = ids.map { services.playerCard($0, context: context) }
        let comparison = PlayerComparison.build(cards: cards, rows: services.discovery.row(for:),
                                                defense: services.discovery.defense, lastN: 6)
        for player in comparison.players {
            XCTAssertNotNil(player.status, player.name)
            XCTAssertLessThanOrEqual(player.schedule.count, PlayerComparison.scheduleWeeks)
            XCTAssertEqual(player.schedule.map(\.week), player.schedule.map(\.week).sorted())
        }
        XCTAssertNil(comparison.players[2].usage, "no usage mix for a defender")
        if let usage = comparison.players[0].usage {
            XCTAssertEqual(usage.expectedPerGame, usage.expectedRushPerGame + usage.expectedReceivingPerGame, accuracy: 1e-9)
            XCTAssertEqual(usage.expectedPassingPerGame, 0, "only a quarterback throws")
        }
        if let qb = comparison.players[1].usage {
            XCTAssertGreaterThan(qb.expectedPassingPerGame, 0, "a quarterback's xFP is mostly passing")
        }
    }
}

extension PlayerComparisonTests {
    /// The watchlist's columns: where each stands, his adds, bye and playoff
    /// weeks, and a baseline that's never picked as best.
    func testComparisonCarriesAvailabilityPlayoffsAndTheBaseline() async throws {
        let (services, directory) = try await WorkspaceFixture.services()
        defer { try? FileManager.default.removeItem(at: directory) }
        let context = try XCTUnwrap(services.dashboard.context)
        let ids = [WorkspaceFixture.cook, WorkspaceFixture.gibbs, WorkspaceFixture.henderson]
        let cards = ids.map { services.playerCard($0, context: context) }
        let comparison = PlayerComparison.build(cards: cards, rows: services.discovery.row(for:), defense: services.discovery.defense,
                                                lastN: 4, baselineID: WorkspaceFixture.cook)
        let byID = Dictionary(uniqueKeysWithValues: comparison.players.map { ($0.id, $0) })
        XCTAssertEqual(byID[WorkspaceFixture.cook]?.availability, .mine)
        XCTAssertEqual(byID[WorkspaceFixture.cook]?.isBaseline, true)
        XCTAssertEqual(byID[WorkspaceFixture.henderson]?.availability, .freeAgent)
        if case .rivalBench = byID[WorkspaceFixture.gibbs]?.availability {} else if case .rivalStarter = byID[WorkspaceFixture.gibbs]?.availability {} else {
            XCTFail("Gibbs is on the rival's roster")
        }
        let playoffWeeks = context.leagueFacts.playoffWeeks
        for player in comparison.players {
            XCTAssertEqual(player.playoffSchedule.map(\.week), playoffWeeks, "every playoff week, past the regular season")
            XCTAssertFalse(player.isBaseline && player.id != WorkspaceFixture.cook)
        }
        for metric in PlayerComparison.Metric.allCases {
            XCTAssertNotEqual(comparison.bestIndex(metric), 0, "\(metric): the baseline column is never best")
        }
    }

    func testTheBaselineIsLeftOutOfBest() {
        var mine = PlayerComparison.Player(id: "m", name: "M", position: .rb, team: nil, opponent: nil, seriesIndex: 0,
                                           log: [], values: [.pointsPerGame: 30], floor: nil, expected: nil, ceiling: nil)
        mine.isBaseline = true
        let a = PlayerComparison.Player(id: "a", name: "A", position: .rb, team: nil, opponent: nil, seriesIndex: 1,
                                        log: [], values: [.pointsPerGame: 10], floor: nil, expected: nil, ceiling: nil)
        let b = PlayerComparison.Player(id: "b", name: "B", position: .rb, team: nil, opponent: nil, seriesIndex: 2,
                                        log: [], values: [.pointsPerGame: 12], floor: nil, expected: nil, ceiling: nil)
        let comparison = PlayerComparison(players: [mine, a, b], lastN: 4, weeks: [])
        XCTAssertEqual(comparison.bestIndex(.pointsPerGame), 2)
        XCTAssertNil(PlayerComparison(players: [mine, a], lastN: 4, weeks: []).bestIndex(.pointsPerGame),
                     "one target and the baseline: nothing to pick between")
    }
}
