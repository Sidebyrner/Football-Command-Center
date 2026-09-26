import XCTest

/// The iPhone's five hubs against the demo league: every tab is on the bar
/// (nothing under More), segments switch and are remembered, a deep link
/// lands on its hub and segment, and Team's gear opens Settings.
final class HubNavigationUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ tab: String) throws -> XCUIApplication {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "the phone shell")
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab]
        app.launch()
        return app
    }

    private static func snapshot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["FCC_SCREENSHOT_DIR"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    func testFiveHubsAndNothingUnderMore() throws {
        let app = try launch("myteam")
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 30))
        for title in ["Team", "Lineup", "Injuries", "Market", "Streams"] {
            XCTAssertTrue(bar.buttons[title].exists, "\(title) tab missing")
        }
        XCTAssertFalse(bar.buttons["More"].exists)
        Self.snapshot("hub-team")
    }

    func testSegmentsSwitchAndAreRemembered() throws {
        let app = try launch("myteam")
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 30))
        bar.buttons["Streams"].tap()
        let segments = app.descendants(matching: .any)["hub.segments"]
        XCTAssertTrue(segments.waitForExistence(timeout: 10), "the Streams segment bar")
        segments.buttons["WR"].tap()
        XCTAssertTrue(app.navigationBars["WR Stream"].waitForExistence(timeout: 10))
        Self.snapshot("hub-streams-wr")
        bar.buttons["Market"].tap()
        XCTAssertTrue(app.navigationBars["Discover"].waitForExistence(timeout: 10), "Market opens on Discover")
        Self.snapshot("hub-market")
        bar.buttons["Streams"].tap()
        XCTAssertTrue(app.navigationBars["WR Stream"].waitForExistence(timeout: 10), "Streams came back on WR")
    }

    func testADeepLinkLandsOnItsHubAndSegment() throws {
        let app = try launch("matchup")
        XCTAssertTrue(app.tabBars.buttons["Lineup"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.tabBars.buttons["Lineup"].isSelected)
        XCTAssertTrue(app.buttons["Matchup"].waitForExistence(timeout: 10))
        Self.snapshot("hub-lineup-matchup")
    }

    func testTheGearOnTeamOpensSettings() throws {
        let app = try launch("myteam")
        let gear = app.buttons["hub.settings"]
        XCTAssertTrue(gear.waitForExistence(timeout: 30))
        gear.tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 10))
    }
}
