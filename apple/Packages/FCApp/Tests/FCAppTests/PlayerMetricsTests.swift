import XCTest
import FCCore
@testable import FCApp

/// Weekly metrics from the recorded week-2 lines (served for weeks 1 and 2).
@MainActor
final class PlayerMetricsTests: XCTestCase {
    private var cacheDirectory: URL?

    override func tearDown() {
        if let cacheDirectory { try? FileManager.default.removeItem(at: cacheDirectory) }
        super.tearDown()
    }

    private func index() async throws -> PlayerMetricsIndex {
        let (services, directory) = try await WorkspaceFixture.services()
        cacheDirectory = directory
        return try XCTUnwrap(services.discovery.metrics)
    }

    func testCountingStatsComeFromSleepersLines() async throws {
        let index = try await index()
        let cook = WorkspaceFixture.cook
        XCTAssertEqual(index.series(.carries, playerID: cook).map(\.value), [21, 21])
        XCTAssertEqual(index.series(.rushingYards, playerID: cook).map(\.value), [135, 135])
        XCTAssertEqual(index.series(.receptions, playerID: cook).map(\.value), [1, 1])
        XCTAssertEqual(index.series(.targets, playerID: cook).map(\.week), [1, 2])
        XCTAssertEqual(index.series(.redZoneTouches, playerID: cook).first?.value, 5, "1 red-zone target + 4 carries")
        XCTAssertEqual(try XCTUnwrap(index.series(.snapShare, playerID: cook).first?.value), 55.0 / 74.0, accuracy: 1e-9)
    }

    func testTargetShareIsHisTargetsOverHisTeamsThatWeek() async throws {
        let index = try await index()
        let share = try XCTUnwrap(index.series(.targetShare, playerID: WorkspaceFixture.jsn).first?.value)
        XCTAssertEqual(share, 11.0 / 11.0, accuracy: 1e-9, "the fixture carries SEA's targets only on his line")
        let cook = try XCTUnwrap(index.series(.targetShare, playerID: WorkspaceFixture.cook).first?.value)
        XCTAssertGreaterThan(cook, 0)
        XCTAssertLessThanOrEqual(cook, 1)
    }

    func testDefensiveMetricsAndZerosSleeperLeavesOut() async throws {
        let index = try await index()
        let bolton = WorkspaceFixture.bolton
        XCTAssertEqual(index.series(.tackles, playerID: bolton).map(\.value), [13, 13], "6 solo + 7 assisted")
        XCTAssertEqual(index.series(.sacks, playerID: bolton).map(\.value), [0, 0], "no sack key in a played game is zero")
        XCTAssertEqual(try XCTUnwrap(index.series(.snapShare, playerID: bolton).first?.value), 1, accuracy: 1e-9, "defensive snaps for IDP")
    }

    func testMetricsOnlyApplyWhereTheyMeanSomething() async throws {
        let index = try await index()
        XCTAssertTrue(index.series(.tackles, playerID: WorkspaceFixture.cook).isEmpty)
        XCTAssertTrue(index.series(.targets, playerID: WorkspaceFixture.mahomes).isEmpty)
        XCTAssertFalse(index.series(.fantasyPoints, playerID: WorkspaceFixture.mahomes).isEmpty)
        XCTAssertTrue(PlayerMetric.yardsAfterContact.applies(to: .rb))
        XCTAssertFalse(PlayerMetric.yardsAfterContact.applies(to: .wr))
    }

    func testSummaryAndRankAtHisPosition() async throws {
        let index = try await index()
        let summary = try XCTUnwrap(index.summary(.rushingYards, playerID: WorkspaceFixture.cook))
        XCTAssertEqual(summary.games, 2)
        XCTAssertEqual(summary.seasonAverage, 135)
        XCTAssertEqual(summary.lastGame, 135)
        XCTAssertEqual(summary.lastWeek, 2)
        XCTAssertEqual(summary.lastThreeAverage, 135)
        XCTAssertNil(summary.trend, "a trend needs four or more games")
        let board = index.leaderboard(.rushingYards, position: .rb)
        XCTAssertEqual(summary.rankOf, board.count)
        XCTAssertEqual(board.map(\.average), board.map(\.average).sorted(by: >))
        let rank = try XCTUnwrap(summary.rank)
        XCTAssertEqual(board[rank - 1].id, WorkspaceFixture.cook)
    }

    func testRosterScopeListsMyPlayersBestFirst() async throws {
        let index = try await index()
        let roster = index.rosterPlayers(.fantasyPoints)
        XCTAssertFalse(roster.contains(WorkspaceFixture.kyren), "IR players are left out")
        let averages = roster.compactMap { index.summary(.fantasyPoints, playerID: $0)?.seasonAverage }
        XCTAssertEqual(averages, averages.sorted(by: >))
        XCTAssertEqual(index.rosterPlayers(.tackles), [WorkspaceFixture.bolton])
    }
}
