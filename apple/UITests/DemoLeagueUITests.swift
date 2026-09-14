import XCTest

/// UI tests against the Debug-only demo league: real 2025 data, no network.
///
/// These exist for two reasons the model tests can't cover — that every screen
/// actually renders from a fixture (§10 of the brief), and that no screen is
/// wider than the phone. The second is the Matchup "sideways drift" regression.
final class DemoLeagueUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(tab: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-FCCDemoLeague", "-FCCTab", tab]
        app.launch()
        return app
    }

    /// Every text element on screen must sit inside the window. Content wider than
    /// the screen is what lets a vertical scroll view drift sideways.
    private func assertNothingWiderThanTheWindow(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let window = app.windows.firstMatch.frame
        let texts = app.staticTexts.allElementsBoundByIndex
        var offenders: [String] = []
        for text in texts where text.exists {
            let frame = text.frame
            guard !frame.isEmpty else { continue }
            // A swipeable page parked fully off screen is not overflow — only
            // something straddling the window edge is.
            guard frame.maxX > window.minX + 1, frame.minX < window.maxX - 1 else { continue }
            if frame.minX < window.minX - 1 || frame.maxX > window.maxX + 1 {
                offenders.append("\"\(text.label.prefix(60))\" x=\(Int(frame.minX))…\(Int(frame.maxX))")
            }
        }
        XCTAssertTrue(
            offenders.isEmpty,
            "wider than the \(Int(window.width))pt window:\n" + offenders.joined(separator: "\n"),
            file: file, line: line
        )
    }

    /// Swiping pages Matchup between modes. Each page must fit the screen, and
    /// after swiping away and back the content must sit exactly where it was —
    /// nothing may be left drifted.
    func testMatchupPagesSwipeAndNothingDriftsSideways() throws {
        let app = launch(tab: "matchup")
        let headToHeadRow = app.descendants(matching: .any)["matchup.row.1"].firstMatch
        XCTAssertTrue(headToHeadRow.waitForExistence(timeout: 30), "matchup never rendered")
        assertNothingWiderThanTheWindow(app)
        let startX = headToHeadRow.frame.minX

        func selected() -> String {
            ["Head-to-head", "You", "Opponent"].first { app.buttons[$0].isSelected } ?? "none"
        }

        headToHeadRow.swipeLeft()
        XCTAssertTrue(app.buttons["You"].waitForSelected(timeout: 5), "swipe left should page to You, got \(selected())")
        assertNothingWiderThanTheWindow(app)

        app.descendants(matching: .any)["matchup.detail.1"].firstMatch.swipeLeft()
        XCTAssertTrue(app.buttons["Opponent"].waitForSelected(timeout: 5), "second swipe should page to Opponent, got \(selected())")
        assertNothingWiderThanTheWindow(app)

        app.descendants(matching: .any)["matchup.detail.1"].firstMatch.swipeRight()
        XCTAssertTrue(app.buttons["You"].waitForSelected(timeout: 5), "swipe right should page back to You, got \(selected())")
        app.descendants(matching: .any)["matchup.detail.1"].firstMatch.swipeRight()
        XCTAssertTrue(app.buttons["Head-to-head"].waitForSelected(timeout: 5), "should return to head-to-head, got \(selected())")

        XCTAssertEqual(headToHeadRow.frame.minX, startX, accuracy: 1, "the matchup content moved sideways")

        // Tapping the picker works too.
        app.buttons["Opponent"].tap()
        XCTAssertTrue(app.buttons["Opponent"].waitForSelected(timeout: 5))
    }

    func testEveryScreenRendersFromTheDemoLeague() throws {
        for (tab, marker) in [("myteam", "myteam.hero"), ("planning", "Planning"),
                              ("matchup", "matchup.row.0"), ("sitstart", "Proposed lineup")] {
            let app = launch(tab: tab)
            let element = app.descendants(matching: .any)[marker].firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 30), "\(tab) did not render \(marker)")
            assertNothingWiderThanTheWindow(app)
            app.terminate()
        }
    }
}

private extension XCUIElement {
    func waitForSelected(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if exists, isSelected { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return exists && isSelected
    }
}
