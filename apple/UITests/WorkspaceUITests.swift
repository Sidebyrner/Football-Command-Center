import XCTest

/// Workspaces on iPad, against the demo league. iPad runs the same split shell
/// as the Mac, so this covers the desktop path without macOS UI-test signing.
/// The demo keeps its workspace library in memory, so every launch starts
/// from the three presets.
final class WorkspaceUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ tab: String) throws -> XCUIApplication {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .pad, "workspaces are an iPad and Mac feature")
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab]
        app.launch()
        return app
    }

    private func element(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        app.descendants(matching: .any)[identifier].firstMatch
    }

    func testGameDayOpensWithItsPanelsAndThePresetsAreInTheSidebar() throws {
        let app = try launch("workspace:game-day")
        XCTAssertTrue(element(app, "workspace.grid").waitForExistence(timeout: 30), "the workspace never rendered")
        for kind in ["matchupScore", "lineupReadiness", "sitStart", "injuries", "news"] {
            XCTAssertTrue(element(app, "workspace.panel.\(kind)").waitForExistence(timeout: 10), "\(kind) panel missing")
        }
        for name in ["Game day", "Waiver Tuesday", "Trade desk"] {
            XCTAssertTrue(app.buttons[name].exists || app.staticTexts[name].exists, "\(name) missing from the sidebar")
        }
    }

    func testUnlockAddAPanelAndLockAgain() throws {
        let app = try launch("workspace:trade-desk")
        XCTAssertTrue(element(app, "workspace.grid").waitForExistence(timeout: 30))
        XCTAssertFalse(element(app, "workspace.panel.rbStream").exists, "Trade desk starts without an RB Stream")

        let edit = element(app, "workspace.edit")
        XCTAssertTrue(edit.waitForExistence(timeout: 5))
        edit.tap()

        let add = element(app, "workspace.addPanel")
        XCTAssertTrue(add.waitForExistence(timeout: 5), "unlocking shows Add panel")
        add.tap()
        let addRB = element(app, "library.add.rbStream")
        XCTAssertTrue(addRB.waitForExistence(timeout: 5), "the panel library opened")
        addRB.tap()

        XCTAssertTrue(element(app, "workspace.panel.rbStream").waitForExistence(timeout: 5), "the new panel is on the grid")
        edit.tap()
        XCTAssertFalse(element(app, "workspace.addPanel").waitForExistence(timeout: 2), "locking hides Add panel")
        XCTAssertTrue(element(app, "workspace.panel.rbStream").exists, "the panel stays after locking")
    }

    func testSwitchingWorkspacesFromTheSidebar() throws {
        let app = try launch("workspace:game-day")
        XCTAssertTrue(element(app, "workspace.panel.sitStart").waitForExistence(timeout: 30))
        let waiver = app.buttons["Waiver Tuesday"].exists ? app.buttons["Waiver Tuesday"] : app.staticTexts["Waiver Tuesday"]
        waiver.tap()
        XCTAssertTrue(element(app, "workspace.panel.waiverTargets").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "workspace.panel.wrStream").exists)
        XCTAssertFalse(element(app, "workspace.panel.sitStart").exists, "Game day's panels are gone")
    }
}
