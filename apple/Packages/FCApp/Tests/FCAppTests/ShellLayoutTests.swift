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

@MainActor
final class PhoneHubTests: XCTestCase {
    func testEveryScreenBelongsToExactlyOneHub() {
        for screen in RootView.Screen.allCases where screen != .settings {
            let hubs = PhoneHub.allCases.filter { $0.screens.contains(screen) }
            XCTAssertEqual(hubs.count, 1, "\(screen.rawValue) should live in one hub")
            XCTAssertEqual(PhoneHub.hub(for: screen), hubs.first)
        }
        XCTAssertEqual(PhoneHub.hub(for: .settings), .team, "Settings sits behind Team's gear")
        XCTAssertEqual(PhoneHub.allCases.count, 5, "five tabs, nothing under More")
    }

    func testHubsRememberTheirSegment() {
        let router = AppRouter(selection: .screen(.dashboard))
        XCTAssertEqual(router.phoneHub, .team)
        router.phoneHub = .streams
        XCTAssertEqual(router.selection, .screen(.idpStream), "a hub opens on its first segment")
        router.open(.wrStream)
        router.phoneHub = .market
        XCTAssertEqual(router.selection, .screen(.discovery))
        router.phoneHub = .streams
        XCTAssertEqual(router.selection, .screen(.wrStream), "back to where you were")
    }

    func testADeepLinkLandsOnItsHubAndSegment() {
        let router = AppRouter(selection: .screen(.matchup))
        XCTAssertEqual(router.phoneHub, .lineup)
        XCTAssertEqual(router.segment(in: .lineup), .matchup)
        router.open(.settings)
        XCTAssertEqual(router.phoneHub, .team)
        XCTAssertEqual(router.segment(in: .lineup), .matchup, "settings doesn't disturb other hubs")
    }
}
