import XCTest

/// The way back on iPhone: after a tile, a link or a mis-tapped tab, the back
/// pill returns to where you were, and holding it shows the whole trail.
final class BreadcrumbUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ tab: String = "board") throws -> XCUIApplication {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "the phone shell")
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab, "-board.layout.v1", ""]
        app.launch()
        return app
    }

    private static func snapshot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["FCC_SCREENSHOT_DIR"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    func testNoWayBackOnAFreshLaunch() throws {
        let app = try launch()
        XCTAssertTrue(app.buttons["board.tile.injuries"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["nav.back"].exists)
    }

    func testATileThenBackReturnsToTheBoard() throws {
        let app = try launch()
        let tile = app.buttons["board.tile.injuries"]
        XCTAssertTrue(tile.waitForExistence(timeout: 30))
        tile.tap()
        XCTAssertTrue(app.navigationBars["Injuries"].waitForExistence(timeout: 10))
        let back = app.buttons["nav.back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        XCTAssertEqual(back.label, "Back to Board")
        Self.snapshot("breadcrumb-pill")
        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Board"].isSelected)
        XCTAssertTrue(app.buttons["board.tile.injuries"].waitForExistence(timeout: 10))
    }

    func testAMistappedTabIsOneStepBack() throws {
        let app = try launch("matchup")
        XCTAssertTrue(app.tabBars.buttons["Market"].waitForExistence(timeout: 30))
        app.tabBars.buttons["Market"].tap()
        XCTAssertTrue(app.navigationBars["Discover"].waitForExistence(timeout: 10))
        let back = app.buttons["nav.back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        XCTAssertEqual(back.label, "Back to Lineup › Matchup")
        back.tap()
        XCTAssertTrue(app.tabBars.buttons["Lineup"].isSelected)
        XCTAssertTrue(app.buttons["Matchup"].waitForExistence(timeout: 10))
    }

    func testHoldingThePillShowsTheTrail() throws {
        let app = try launch()
        XCTAssertTrue(app.buttons["board.tile.injuries"].waitForExistence(timeout: 30))
        app.buttons["board.tile.injuries"].tap()
        XCTAssertTrue(app.navigationBars["Injuries"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Market"].tap()
        XCTAssertTrue(app.navigationBars["Discover"].waitForExistence(timeout: 10))
        let back = app.buttons["nav.back"].firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.press(forDuration: 1.0)
        XCTAssertTrue(app.staticTexts["Go back to"].waitForExistence(timeout: 5), "holding shows the trail")
        Self.snapshot("breadcrumb-trail")
        // The menu's Board row, not the tab bar's.
        let tabBarTop = app.tabBars.firstMatch.frame.minY
        let row = app.buttons.matching(NSPredicate(format: "label == 'Board'")).allElementsBoundByIndex
            .first { $0.frame.maxY < tabBarTop }
        try XCTUnwrap(row, "Board in the trail").tap()
        XCTAssertTrue(app.tabBars.buttons["Board"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["board.tile.injuries"].waitForExistence(timeout: 10), "two steps back in one")
    }
}
