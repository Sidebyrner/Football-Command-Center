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

    /// `FCC_ACCENT` picks the demo's accent theme for this run.
    private var accentArguments: [String] {
        guard let accent = ProcessInfo.processInfo.environment["FCC_ACCENT"], !accent.isEmpty else { return [] }
        return ["-FCCAccent", accent]
    }

    private func launch(tab: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab] + accentArguments + extra
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
        let startTrade = app.buttons["start-trade"]
        if startTrade.waitForExistence(timeout: 5) {
            startTrade.tap()
            XCTAssertTrue(app.descendants(matching: .any)["trade-wizard"].firstMatch.waitForExistence(timeout: 10))
            shoot("trade-1-goal")
            // The first goal may be one no rival can fill; walk them until one has a partner.
            var reachedPartners = false
            for index in 0..<6 {
                let goal = app.buttons["trade-goal-\(index)"]
                guard goal.exists else { break }
                goal.tap()
                if !reachedPartners { shoot("trade-2-partners"); reachedPartners = true }
                let partner = app.buttons["trade-partner-0"]
                if partner.waitForExistence(timeout: 3) {
                    shoot("trade-2-partners")
                    partner.tap()
                    shoot("trade-3-deal")
                    let proceed = app.buttons["trade-continue"]
                    if !proceed.isEnabled, app.buttons["trade-send-0"].exists {
                        app.buttons["trade-send-0"].tap()
                    }
                    app.swipeUp()
                    shoot("trade-4-deal-effects")
                    app.swipeUp()
                    if proceed.exists, proceed.isEnabled {
                        proceed.tap()
                        shoot("trade-5-pitch")
                    }
                    break
                }
                app.buttons["Back"].firstMatch.tap()
            }
            if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        }
        app.buttons["Waivers"].tap()
        shoot("planning-5-waivers")
        app.terminate()

        app = launch(tab: "matchup")
        XCTAssertTrue(app.buttons["Head-to-head"].waitForExistence(timeout: 30))
        shoot("matchup-1-head-to-head")
        app.buttons["You"].tap()
        shoot("matchup-2-you")
        app.terminate()

        app = launch(tab: "myteam")
        XCTAssertTrue(app.descendants(matching: .any)["myteam.hero"].firstMatch.waitForExistence(timeout: 30))
        shoot("myteam-1-this-week")
        app.swipeUp()
        shoot("myteam-2-this-week-scrolled")
        app.swipeDown()
        app.swipeDown()
        if app.buttons["Season"].waitForExistence(timeout: 5) { app.buttons["Season"].tap() }
        shoot("myteam-3-season")
        app.swipeUp()
        shoot("myteam-4-season-scrolled")
        app.terminate()

        app = launch(tab: "sitstart")
        XCTAssertTrue(app.staticTexts["Proposed lineup"].waitForExistence(timeout: 30))
        shoot("sitstart-1")
        app.terminate()
    }
}
