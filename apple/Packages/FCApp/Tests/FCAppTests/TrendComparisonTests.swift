import XCTest
import FCCore
@testable import FCApp

/// Several players' trend lines on one chart: who's on it, in what colour, and
/// how the smoothing reads.
@MainActor
final class TrendComparisonTests: XCTestCase {
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

    func testCompareListInOrderThenTheClickedPlayerUncoloured() async throws {
        let index = try await index()
        let trend = TrendComparison.build(index: index, metric: .fantasyPoints,
                                          compareIDs: [WorkspaceFixture.jsn, WorkspaceFixture.cook],
                                          focusedID: WorkspaceFixture.mahomes, scope: .compare, lastN: 8)
        XCTAssertEqual(trend.lines.map(\.id), [WorkspaceFixture.jsn, WorkspaceFixture.cook, WorkspaceFixture.mahomes])
        XCTAssertEqual(trend.lines.map(\.compareIndex), [0, 1, nil])
        XCTAssertEqual(trend.lines.map(\.isFocused), [false, false, true])
        XCTAssertTrue(trend.lines.allSatisfy { !$0.points.isEmpty })
        XCTAssertEqual(trend.weeks, [1, 2])
    }

    func testAClickedPlayerAlreadyComparedKeepsHisColour() async throws {
        let index = try await index()
        let trend = TrendComparison.build(index: index, metric: .fantasyPoints,
                                          compareIDs: [WorkspaceFixture.jsn, WorkspaceFixture.cook],
                                          focusedID: WorkspaceFixture.cook, scope: .compare, lastN: 8)
        XCTAssertEqual(trend.lines.count, 2)
        XCTAssertEqual(trend.lines[1].compareIndex, 1)
        XCTAssertTrue(trend.lines[1].isFocused)
    }

    func testPlayerScopeShowsOnlyTheClickedPlayer() async throws {
        let index = try await index()
        let trend = TrendComparison.build(index: index, metric: .fantasyPoints, compareIDs: [WorkspaceFixture.jsn],
                                          focusedID: WorkspaceFixture.cook, scope: .player, lastN: 8)
        XCTAssertEqual(trend.lines.map(\.id), [WorkspaceFixture.cook])
        XCTAssertNil(trend.lines[0].compareIndex)
    }

    func testAMetricThatDoesntApplyLeavesHisLineEmptyButListed() async throws {
        let index = try await index()
        let trend = TrendComparison.build(index: index, metric: .targets,
                                          compareIDs: [WorkspaceFixture.cook, WorkspaceFixture.mahomes],
                                          focusedID: nil, scope: .compare, lastN: 8)
        XCTAssertEqual(trend.lines.map(\.applies), [true, false])
        XCTAssertTrue(trend.lines[1].points.isEmpty)
        XCTAssertNil(trend.lines[1].summary)
    }

    func testLastNKeepsTheMostRecentWeeks() async throws {
        let index = try await index()
        let trend = TrendComparison.build(index: index, metric: .carries, compareIDs: [WorkspaceFixture.cook],
                                          focusedID: nil, scope: .compare, lastN: 1)
        XCTAssertEqual(trend.lines[0].points.map(\.week), [2])
    }

    func testSmoothingLooksBackIntoHistoryBeforeTheWindow() {
        let history = [4.0, 8, 12, 2].enumerated().map { MetricPoint(week: $0.offset + 1, value: $0.element) }
        let window = Array(history.suffix(2))
        let smoothed = TrendComparison.smoothed(window, over: 3, history: history)
        XCTAssertEqual(smoothed.map(\.week), [3, 4])
        XCTAssertEqual(smoothed[0].value, 8, accuracy: 1e-9, "(4 + 8 + 12) / 3")
        XCTAssertEqual(smoothed[1].value, 22.0 / 3, accuracy: 1e-9, "(8 + 12 + 2) / 3")
        XCTAssertEqual(TrendComparison.smoothed(window, over: 1, history: history).map(\.value), [12, 2])
        let early = TrendComparison.smoothed(Array(history.prefix(1)), over: 3, history: history)
        XCTAssertEqual(early[0].value, 4, "a first game averages over what there is")
    }

    func testStoredMetricKeysIncludingTheOldTrendPanels() {
        XCTAssertEqual(TrendComparison.metric(storedAs: "points"), .fantasyPoints)
        XCTAssertEqual(TrendComparison.metric(storedAs: PlayerMetric.snapShare.rawValue), .snapShare)
        XCTAssertNil(TrendComparison.metric(storedAs: nil))
        XCTAssertNil(TrendComparison.metric(storedAs: "nonsense"))
    }

    func testChartListRoundTripsInOrderWithSmoothing() {
        let specs = [TrendChartSpec(metric: .targets), TrendChartSpec(metric: .snapShare, smoothing: 3),
                     TrendChartSpec(metric: .fantasyPoints)]
        let stored = TrendChartSpec.encode(specs)
        XCTAssertEqual(stored, "targets,snapShare:3,fantasyPoints")
        XCTAssertEqual(TrendChartSpec.list(from: stored), specs)
    }

    func testUnsetChartsIsPointsAndEmptyIsNone() {
        XCTAssertEqual(TrendChartSpec.list(from: nil), [TrendChartSpec(metric: .fantasyPoints)])
        XCTAssertEqual(TrendChartSpec.list(from: ""), [])
        XCTAssertEqual(TrendChartSpec.encode([]), "")
    }

    func testChartListDropsUnknownsReadsOldKeysAndCapsAtSix() {
        XCTAssertEqual(TrendChartSpec.list(from: "bogus,points:3,sacks"),
                       [TrendChartSpec(metric: .fantasyPoints, smoothing: 3), TrendChartSpec(metric: .sacks)])
        let many = Array(repeating: "targets", count: 9).joined(separator: ",")
        XCTAssertEqual(TrendChartSpec.list(from: many).count, TrendChartSpec.maxCharts)
    }

    func testEveryMetricHasAPickerGroup() {
        for group in PlayerMetric.Group.allCases {
            XCTAssertFalse(PlayerMetric.allCases.filter { $0.group == group }.isEmpty, group.rawValue)
        }
    }
}
