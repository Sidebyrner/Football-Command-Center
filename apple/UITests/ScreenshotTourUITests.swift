import XCTest

/// Walks the demo league and saves a screenshot of each screen and mode, so
/// visual changes can be reviewed side by side. Not an assertion test — it only
/// fails if a screen can't be reached.
///
/// Screenshots go to the directory in the `FCC_SCREENSHOT_DIR` environment
/// variable (passed as `TEST_RUNNER_FCC_SCREENSHOT_DIR` to xcodebuild), and are
/// skipped entirely when it isn't set.
final class ScreenshotTourUITests: XCTestCase {
    private var directory: URL?

    override func setUpWithError() throws {
        continueAfterFailure = true
        guard let path = ProcessInfo.processInfo.environment["FCC_SCREENSHOT_DIR"], !path.isEmpty else {
            throw XCTSkip("FCC_SCREENSHOT_DIR not set")
        }
        directory = URL(fileURLWithPath: path, isDirectory: true)
        try FileManager.default.createDirectory(at: directory!, withIntermediateDirectories: true)
    }

    private func shoot(_ name: String) {
        sleep(1)
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: directory!.appendingPathComponent("\(name).png"))
    }

    private func launch(tab: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab] + extra
        app.launch()
        return app
    }

    func testTour() throws {
        var app = launch(tab: "planning")
        XCTAssertTrue(app.buttons["Byes"].waitForExistence(timeout: 30))
        shoot("planning-1-intro")
        if app.buttons["Got it"].exists { app.buttons["Got it"].tap() }
        shoot("planning-2-byes")
        let firstWeek = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Week'")).firstMatch
        if firstWeek.exists {
            firstWeek.tap()
            shoot("planning-3-byes-week-open")
        }
        app.buttons["Trades"].tap()
        shoot("planning-4-trades")
        app.buttons["Waivers"].tap()
        shoot("planning-5-waivers")
        app.terminate()

        app = launch(tab: "matchup")
        XCTAssertTrue(app.buttons["Head-to-head"].waitForExistence(timeout: 30))
        shoot("matchup-1-head-to-head")
        app.buttons["You"].tap()
        shoot("matchup-2-you")
        app.terminate()

        app = launch(tab: "dashboard")
        XCTAssertTrue(app.staticTexts["Standings"].waitForExistence(timeout: 30))
        shoot("dashboard-1")
        app.swipeUp()
        shoot("dashboard-2")
        app.terminate()

        app = launch(tab: "sitstart")
        XCTAssertTrue(app.staticTexts["Proposed lineup"].waitForExistence(timeout: 30))
        shoot("sitstart-1")
        app.terminate()
    }
}
