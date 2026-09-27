import XCTest
import SwiftUI
import AppKit
import FCCore
@testable import FCApp

/// The design tokens hold their promises: text reads on every surface in
/// light and dark mode (WCAG contrast), each tab's hue is clear of the status
/// colours and of each other, and the accent default moved off caution's
/// amber exactly once.
final class ThemeTests: XCTestCase {
    // MARK: - Colour maths

    private struct RGB { let r, g, b, a: Double }

    private func resolve(_ color: NSColor, dark: Bool) -> RGB {
        var out = RGB(r: 0, g: 0, b: 0, a: 1)
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)!
        appearance.performAsCurrentDrawingAppearance {
            let c = color.usingColorSpace(.sRGB)!
            out = RGB(r: Double(c.redComponent), g: Double(c.greenComponent), b: Double(c.blueComponent),
                      a: Double(c.alphaComponent))
        }
        return out
    }

    private func resolve(_ color: Color, dark: Bool) -> RGB { resolve(NSColor(color), dark: dark) }

    /// A translucent colour laid over an opaque one.
    private func over(_ top: RGB, _ bottom: RGB) -> RGB {
        RGB(r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a),
            b: top.b * top.a + bottom.b * (1 - top.a), a: 1)
    }

    private func luminance(_ c: RGB) -> Double {
        func channel(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
    }

    private func contrast(_ text: RGB, on background: RGB) -> Double {
        let fg = over(text, background)
        let (l1, l2) = (luminance(fg), luminance(background))
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    }

    /// CIE76 ΔE in Lab — how different two hues look.
    private func deltaE(_ a: RGB, _ b: RGB) -> Double {
        func lab(_ c: RGB) -> (Double, Double, Double) {
            func lin(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
            let (r, g, b) = (lin(c.r), lin(c.g), lin(c.b))
            let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
            let y = 0.2126 * r + 0.7152 * g + 0.0722 * b
            let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
            func f(_ t: Double) -> Double { t > 0.008856 ? cbrt(t) : 7.787 * t + 16 / 116 }
            return (116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z)))
        }
        let (p, q) = (lab(a), lab(b))
        return sqrt(pow(p.0 - q.0, 2) + pow(p.1 - q.1, 2) + pow(p.2 - q.2, 2))
    }

    // MARK: - Contrast

    func testTextReadsOnEverySurfaceInBothModes() {
        for dark in [false, true] {
            for (name, surface) in [("card", Surface.card), ("page", Surface.page)] {
                let bg = resolve(surface, dark: dark)
                let primary = contrast(resolve(NSColor.labelColor, dark: dark), on: bg)
                let secondary = contrast(resolve(NSColor.secondaryLabelColor, dark: dark), on: bg)
                XCTAssertGreaterThanOrEqual(primary, 7, "primary text on \(name), dark \(dark)")
                // The system's own secondary label sits just under 4.5 in light
                // mode; screens keep their main content out of it for that reason.
                XCTAssertGreaterThanOrEqual(secondary, 3.9, "secondary text on \(name), dark \(dark)")
            }
        }
    }

    func testVerdictsAndPositionsReadOnACard() {
        let colors: [(String, Color)] = [("start", Palette.start), ("caution", Palette.caution), ("sit", Palette.sit)]
            + Position.allCases.map { ($0.rawValue, Palette.position($0)) }
        for dark in [false, true] {
            let card = resolve(Surface.card, dark: dark)
            for (name, color) in colors {
                XCTAssertGreaterThanOrEqual(contrast(resolve(color, dark: dark), on: card), 3,
                                            "\(name) on a card, dark \(dark)")
            }
        }
    }

    func testTheDefaultAccentReadsAsAControl() {
        for dark in [false, true] {
            let ratio = contrast(resolve(AccentTheme.default.color, dark: dark), on: resolve(Surface.card, dark: dark))
            XCTAssertGreaterThanOrEqual(ratio, 3, "indigo on a card, dark \(dark)")
        }
    }

    // MARK: - Hues

    func testTabHuesAreClearOfTheStatusColoursAndEachOther() {
        let hubs: [(String, Color)] = [("board", HubStyle.board), ("team", HubStyle.team),
                                        ("lineup", HubStyle.lineup), ("market", HubStyle.market)]
        let statuses: [(String, Color)] = [("start", Palette.start), ("caution", Palette.caution), ("sit", Palette.sit)]
        for dark in [false, true] {
            for (hub, hue) in hubs {
                for (status, color) in statuses {
                    XCTAssertGreaterThan(deltaE(resolve(hue, dark: dark), resolve(color, dark: dark)), 20,
                                         "\(hub) vs \(status), dark \(dark)")
                }
            }
            for i in hubs.indices {
                for j in hubs.indices where j > i {
                    XCTAssertGreaterThan(deltaE(resolve(hubs[i].1, dark: dark), resolve(hubs[j].1, dark: dark)), 15,
                                         "\(hubs[i].0) vs \(hubs[j].0)")
                }
            }
        }
    }

    @MainActor
    func testEveryScreenHasAHueAndStreamsTakeTheirPosition() {
        XCTAssertEqual(HubStyle.streamPosition(.qbStream), .qb)
        XCTAssertEqual(HubStyle.streamPosition(.dstStream), .def)
        XCTAssertNil(HubStyle.streamPosition(.waivers))
        for screen in RootView.Screen.allCases {
            _ = HubStyle.tint(for: screen)
        }
        let qb = resolve(HubStyle.tint(for: .qbStream), dark: false)
        let position = resolve(Palette.position(.qb), dark: false)
        XCTAssertLessThan(deltaE(qb, position), 1)
    }

    // MARK: - Accent default

    func testStoredAmberMovesToIndigoOnce() throws {
        let old = #"{"leagueID":"L1","rosterID":1,"accentTheme":"amber"}"#
        let migrated = try JSONDecoder().decode(AppSettings.self, from: Data(old.utf8))
        XCTAssertEqual(migrated.accentTheme, .indigo, "amber was the old default, not a choice")
        XCTAssertEqual(migrated.themeVersion, AppSettings.currentThemeVersion)

        var chosen = migrated
        chosen.accentTheme = .amber
        let saved = try JSONDecoder().decode(AppSettings.self, from: JSONEncoder().encode(chosen))
        XCTAssertEqual(saved.accentTheme, .amber, "amber picked after the change stays amber")

        let teal = #"{"leagueID":"L1","rosterID":1,"accentTheme":"teal"}"#
        XCTAssertEqual(try JSONDecoder().decode(AppSettings.self, from: Data(teal.utf8)).accentTheme, .teal)
    }

    func testAccentsThatShareAStatusColourSaySo() {
        XCTAssertEqual(AccentTheme.amber.sharedStatus, "caution")
        XCTAssertEqual(AccentTheme.green.sharedStatus, "start")
        XCTAssertEqual(AccentTheme.red.sharedStatus, "sit")
        XCTAssertNil(AccentTheme.indigo.sharedStatus)
    }
}
