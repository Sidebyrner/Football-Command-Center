import XCTest
@testable import FCApp

/// The app's way back: a browser-style history of every screen change.
final class NavigationHistoryTests: XCTestCase {
    private let board = SidebarItem.screen(.board)
    private let injuries = SidebarItem.screen(.injuries)
    private let sitStart = SidebarItem.screen(.sitStart)
    private let market = SidebarItem.screen(.discovery)
    private let settings = SidebarItem.screen(.settings)

    func testBackAndForwardRetraceTheSteps() {
        var history = NavigationHistory()
        history.record(from: board, to: injuries)
        history.record(from: injuries, to: sitStart)
        XCTAssertEqual(history.back, [board, injuries])
        XCTAssertEqual(history.goBack(from: sitStart), injuries)
        XCTAssertEqual(history.goBack(from: injuries), board)
        XCTAssertFalse(history.canGoBack)
        XCTAssertEqual(history.forward, [sitStart, injuries])
        XCTAssertEqual(history.goForward(from: board), injuries)
        XCTAssertEqual(history.back, [board])
    }

    func testANewStepClearsForward() {
        var history = NavigationHistory()
        history.record(from: board, to: injuries)
        _ = history.goBack(from: injuries)
        XCTAssertTrue(history.canGoForward)
        history.record(from: board, to: market)
        XCTAssertFalse(history.canGoForward, "like a browser")
    }

    func testBouncingStraightBackIsABackStepNotANewOne() {
        var history = NavigationHistory()
        history.record(from: board, to: market)
        history.record(from: market, to: board)
        XCTAssertFalse(history.canGoBack, "A → B → A doesn't ping-pong")
        XCTAssertEqual(history.forward, [market])
    }

    func testSettingsIsNeverAStep() {
        var history = NavigationHistory()
        history.record(from: .screen(.dashboard), to: settings)
        history.record(from: settings, to: .screen(.dashboard))
        XCTAssertFalse(history.canGoBack)
        XCTAssertFalse(history.canGoForward)
    }

    func testTheTrailIsCapped() {
        var history = NavigationHistory()
        let screens: [RootView.Screen] = [.board, .dashboard, .sitStart, .matchup, .injuries, .discovery, .waivers]
        for i in 0..<100 {
            history.record(from: .screen(screens[i % screens.count]), to: .screen(screens[(i + 1) % screens.count]))
        }
        XCTAssertEqual(history.back.count, NavigationHistory.capacity)
    }

    func testJumpingBackSeveralStepsKeepsThemForward() {
        var history = NavigationHistory()
        history.record(from: board, to: injuries)
        history.record(from: injuries, to: sitStart)
        history.record(from: sitStart, to: market)
        XCTAssertEqual(history.jumpBack(to: 0, from: market), board)
        XCTAssertFalse(history.canGoBack)
        XCTAssertEqual(history.forward, [market, sitStart, injuries])
        XCTAssertEqual(history.goForward(from: board), injuries)
    }

    func testADeletedWorkspaceIsForgotten() {
        let id = UUID()
        var history = NavigationHistory()
        history.record(from: board, to: .workspace(id))
        history.record(from: .workspace(id), to: market)
        history.forget(workspace: id)
        XCTAssertFalse(history.back.contains(.workspace(id)))
        XCTAssertEqual(history.back, [board])
    }

    func testTrailLabels() {
        let noName: (UUID) -> String? = { _ in nil }
        XCTAssertEqual(injuries.trailLabel(workspaceName: noName), "Lineup › Injuries")
        XCTAssertEqual(board.trailLabel(workspaceName: noName), "Board")
        XCTAssertEqual(SidebarItem.screen(.dashboard).trailLabel(workspaceName: noName), "My Team")
        XCTAssertEqual(SidebarItem.screen(.wrStream).trailLabel(workspaceName: noName), "Streams › WR")
        XCTAssertEqual(SidebarItem.screen(.wrStream).shortLabel(workspaceName: noName), "Streams WR")
        XCTAssertEqual(injuries.shortLabel(workspaceName: noName), "Injuries")
        let id = UUID()
        XCTAssertEqual(SidebarItem.workspace(id).trailLabel { $0 == id ? "Game day" : nil }, "Game day")
        XCTAssertEqual(SidebarItem.workspace(id).trailLabel(workspaceName: noName), "Workspace")
    }
}

/// The router records every move, and going back restores tab and segment.
@MainActor
final class RouterHistoryTests: XCTestCase {
    func testATileThenBackLandsWhereYouWere() {
        let router = AppRouter(selection: .screen(.board))
        router.open(.injuries)
        XCTAssertEqual(router.phoneHub, .lineup)
        XCTAssertTrue(router.canGoBack)
        router.goBack()
        XCTAssertEqual(router.selection, .screen(.board))
        XCTAssertEqual(router.segment(in: .lineup), .injuries, "Lineup still remembers its segment")
        XCTAssertTrue(router.canGoForward)
        router.goForward()
        XCTAssertEqual(router.selection, .screen(.injuries))
    }

    func testAnAccidentalTabTapIsOneStepBack() {
        let router = AppRouter(selection: .screen(.sitStart))
        router.open(.matchup)
        router.phoneHub = .market
        XCTAssertEqual(router.selection, .screen(.discovery))
        router.goBack()
        XCTAssertEqual(router.selection, .screen(.matchup), "back to the tab and segment")
    }

    func testGoingBackIsntItselfRecorded() {
        let router = AppRouter(selection: .screen(.board))
        router.open(.injuries)
        router.open(.waivers)
        router.goBack()
        router.goBack()
        XCTAssertEqual(router.selection, .screen(.board))
        XCTAssertFalse(router.canGoBack)
        XCTAssertEqual(router.history.forward.count, 2)
    }

    func testJumpingBackFromTheTrail() {
        let router = AppRouter(selection: .screen(.board))
        router.open(.injuries)
        router.open(.waivers)
        router.open(.qbStream)
        router.goBack(to: 0)
        XCTAssertEqual(router.selection, .screen(.board))
    }
}
