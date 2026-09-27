import XCTest

/// The top of every main iPhone screen, for comparing the look before and
/// after a design change in light, dark and large text. Skipped unless
/// `FCC_SCREENSHOT_DIR` is set; `FCC_LOOK_PREFIX` names the set.
final class LookUITests: XCTestCase {
    static let screens = ["board", "myteam", "sitstart", "matchup", "injuries", "discover", "waivers",
                          "trades", "planning", "qbstream", "wrstream"]

    func testLook() throws {
        let env = ProcessInfo.processInfo.environment
        guard let dir = env["FCC_SCREENSHOT_DIR"], !dir.isEmpty else { throw XCTSkip("FCC_SCREENSHOT_DIR not set") }
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "the phone shell")
        let prefix = env["FCC_LOOK_PREFIX"] ?? "look"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        for screen in Self.screens {
            let app = XCUIApplication()
            app.launchArguments = ["-FCCDemoLeague", "-FCCTab", screen, "-board.layout.v1", ""]
            app.launch()
            XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30))
            sleep(3)
            let data = XCUIScreen.main.screenshot().pngRepresentation
            try data.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(screen).png"))
            app.terminate()
        }
    }
}
