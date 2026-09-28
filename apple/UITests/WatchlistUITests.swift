import XCTest

/// The iPhone watchlist against the demo league: star from the Waiver Board,
/// the tray follows every Market screen, and the comparison keeps its metric
/// names pinned while the player columns scroll.
final class WatchlistUITests: XCTestCase {
    /// Mahomes, Herbert and Hurts in the demo pool.
    private static let seeded = ["4046", "6797", "6904"]

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ tab: String, watchlist: [String] = []) throws -> XCUIApplication {
        try XCTSkipIf(UIDevice.current.userInterfaceIdiom != .phone, "the phone shell")
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab]
        if !watchlist.isEmpty { app.launchArguments += ["-FCCWatchlist", watchlist.joined(separator: ",")] }
        app.launch()
        return app
    }

    private static func snapshot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["FCC_SCREENSHOT_DIR"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png"))
    }

    func testStarringOnTheWaiverBoardFillsATrayThatFollowsTheMarketTab() throws {
        let app = try launch("waivers")
        let stars = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'watch.'"))
        XCTAssertTrue(stars.firstMatch.waitForExistence(timeout: 30), "a star on each row")
        let tray = app.descendants(matching: .any)["shortlist.tray"]
        XCTAssertFalse(tray.exists, "no tray until something's starred")

        stars.element(boundBy: 0).tap()
        stars.element(boundBy: 1).tap()
        XCTAssertTrue(tray.waitForExistence(timeout: 5))
        let chips = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'shortlist.chip.'"))
        XCTAssertEqual(chips.count, 2)
        XCTAssertTrue(app.buttons["shortlist.compare"].isEnabled)
        Self.snapshot("watchlist-waivers")

        app.descendants(matching: .any)["hub.segments"].buttons["Trades"].tap()
        XCTAssertTrue(tray.waitForExistence(timeout: 5), "the tray stays across the Market screens")
        XCTAssertEqual(chips.count, 2)
    }

    func testTheComparisonPinsTheMetricNamesWhileColumnsScroll() throws {
        let app = try launch("waivers", watchlist: Self.seeded)
        let compare = app.buttons["shortlist.compare"]
        XCTAssertTrue(compare.waitForExistence(timeout: 30))
        compare.tap()

        XCTAssertTrue(app.descendants(matching: .any)["compare.phone.verdict"].waitForExistence(timeout: 20))
        let labels = app.descendants(matching: .any)["compare.phone.labels"].firstMatch
        let first = app.descendants(matching: .any)["compare.phone.column.\(Self.seeded[0])"].firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 10))
        Self.snapshot("watchlist-compare")

        let labelsX = labels.frame.minX
        let firstX = first.frame.minX
        app.descendants(matching: .any)["compare.phone.grid"].firstMatch.swipeLeft()
        XCTAssertEqual(labels.frame.minX, labelsX, accuracy: 1, "the metric names stay put")
        XCTAssertLessThan(first.frame.minX, firstX - 20, "the player columns scroll")
    }

    func testThePlayerMenuOffersTheWatchlistOnPhone() throws {
        let app = try launch("waivers")
        let stars = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'watch.'"))
        XCTAssertTrue(stars.firstMatch.waitForExistence(timeout: 30))
        let id = stars.firstMatch.identifier.replacingOccurrences(of: "watch.", with: "")
        // The row itself, left of the star.
        let row = stars.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0.5)).withOffset(CGVector(dx: -120, dy: 0))
        row.press(forDuration: 1.2)
        let add = app.buttons["Add to watchlist"]
        XCTAssertTrue(add.waitForExistence(timeout: 5))
        add.tap()
        XCTAssertTrue(app.buttons["shortlist.chip.\(id)"].waitForExistence(timeout: 5))
    }
}
