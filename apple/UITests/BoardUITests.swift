import XCTest

/// The iPhone Board against the demo league: it's where the app opens, its
/// tiles open their screens, and a tile hidden in the edit sheet stays hidden
/// across a relaunch.
final class BoardUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ arguments: [String] = []) throws -> XCUIApplication {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "the phone shell")
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague"] + arguments
        app.launch()
        return app
    }

    /// The standard tiles regardless of what an earlier run saved: a launch
    /// argument sets the stored layout for that launch only.
    static let cleanLayout = ["-board.layout.v1", ""]

    /// Flips a tile's switch in the open edit sheet to `on`.
    private func set(_ tile: String, on: Bool, in app: XCUIApplication) {
        let cell = app.switches["board.toggle.\(tile)"]
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        let control = cell.switches.firstMatch.exists ? cell.switches.firstMatch : cell
        if ((cell.value as? String) == "1") != on { control.tap() }
    }

    private static func snapshot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["FCC_SCREENSHOT_DIR"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    func testTheAppOpensOnTheBoard() throws {
        let app = try launch(Self.cleanLayout)
        XCTAssertTrue(app.tabBars.buttons["Board"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.tabBars.buttons["Board"].isSelected)
        XCTAssertTrue(app.buttons["board.tile.liveMatchup"].waitForExistence(timeout: 30))
        Self.snapshot("board")
        app.swipeUp()
        Self.snapshot("board-lower")
    }

    func testATileOpensItsScreen() throws {
        let app = try launch(["-FCCTab", "board"] + Self.cleanLayout)
        let tile = app.buttons["board.tile.injuries"]
        XCTAssertTrue(tile.waitForExistence(timeout: 30))
        tile.tap()
        XCTAssertTrue(app.tabBars.buttons["Lineup"].isSelected)
        XCTAssertTrue(app.navigationBars["Injuries"].waitForExistence(timeout: 10))
    }

    func testAHiddenTileStaysHidden() throws {
        var app = try launch(["-FCCTab", "board"])
        let edit = app.buttons["board.edit"]
        XCTAssertTrue(edit.waitForExistence(timeout: 30))
        edit.tap()
        set("liveMatchup", on: true, in: app)
        Self.snapshot("board-edit")
        set("liveMatchup", on: false, in: app)
        app.buttons["board.done"].tap()
        XCTAssertFalse(app.buttons["board.tile.liveMatchup"].waitForExistence(timeout: 3))

        app.terminate()
        app = try launch(["-FCCTab", "board"])
        XCTAssertTrue(app.buttons["board.tile.games"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["board.tile.liveMatchup"].exists, "still hidden after a relaunch")

        // Put it back.
        app.buttons["board.edit"].tap()
        set("liveMatchup", on: true, in: app)
        app.buttons["board.done"].tap()
        XCTAssertTrue(app.buttons["board.tile.liveMatchup"].waitForExistence(timeout: 10))
    }
}
