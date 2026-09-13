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
        let texts = app.scrollViews.firstMatch.staticTexts.allElementsBoundByIndex
        var offenders: [String] = []
        for text in texts where text.exists {
            let frame = text.frame
            guard !frame.isEmpty else { continue }
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

    func testMatchupDoesNotDriftSideways() throws {
        let app = launch(tab: "matchup")
        let firstRow = app.descendants(matching: .any)["matchup.row.0"].firstMatch
        XCTAssertTrue(firstRow.waitForExistence(timeout: 30), "matchup never rendered")

        assertNothingWiderThanTheWindow(app)

        let before = firstRow.frame.minX
        let scroll = app.scrollViews.firstMatch
        scroll.swipeLeft()
        scroll.swipeRight()
        scroll.swipeLeft()
        XCTAssertEqual(firstRow.frame.minX, before, accuracy: 1, "the matchup content moved sideways")
    }

    func testEveryScreenRendersFromTheDemoLeague() throws {
        for (tab, marker) in [("dashboard", "Standings"), ("planning", "Planning"),
                              ("matchup", "matchup.row.0"), ("sitstart", "Proposed lineup")] {
            let app = launch(tab: tab)
            let element = app.descendants(matching: .any)[marker].firstMatch
            XCTAssertTrue(element.waitForExistence(timeout: 30), "\(tab) did not render \(marker)")
            assertNothingWiderThanTheWindow(app)
            app.terminate()
        }
    }
}
