import XCTest
@testable import FCApp

final class ShellLayoutTests: XCTestCase {
    func testPhoneAlwaysGetsTabsRegardlessOfSizeClass() {
        XCTAssertEqual(ShellLayout.resolve(isPhone: true, horizontalSizeClass: .regular), .tabs)
        XCTAssertEqual(ShellLayout.resolve(isPhone: true, horizontalSizeClass: nil), .tabs)
    }

    func testRegularWidthIPadOrMacGetsTheSplitShell() {
        XCTAssertEqual(ShellLayout.resolve(isPhone: false, horizontalSizeClass: .regular), .split)
        XCTAssertEqual(ShellLayout.resolve(isPhone: false, horizontalSizeClass: nil), .split, "macOS has no size class")
    }

    /// The bug this exists to fix: an iPad in Slide Over or a narrow Split
    /// View reports compact width and must fall back to the phone shell.
    func testCompactWidthIPadFallsBackToTabs() {
        XCTAssertEqual(ShellLayout.resolve(isPhone: false, horizontalSizeClass: .compact), .tabs)
    }
}
