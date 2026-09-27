import SwiftUI
import FCCore
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

// The app's design tokens. Everything visual is built from these, so screens
// differ by what they say rather than by one-off paddings and opacities.
//
// Three rules the tokens exist to keep:
// - Contrast comes from elevation and size: a recessed page, raised cards,
//   insets inside cards — not from more colours.
// - Each colour has one job: the accent is for things you can press, status
//   colours are verdicts (always with an icon), and each tab has a hue that
//   says where you are.
// - Type follows Dynamic Type: roles, not point sizes.

// MARK: - Colour helpers

extension Color {
    /// A colour with its own value in light and dark mode.
    static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor { traits in
            UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light))
        })
        #elseif canImport(AppKit)
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(Color(hex: isDark ? dark : light))
        })
        #else
        Color(hex: light)
        #endif
    }
}

// MARK: - Surfaces

/// The three levels a screen is built from.
enum Surface {
    /// The page behind everything, recessed so cards stand off it.
    static var page: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemGroupedBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    /// A raised card: a solid fill a step brighter than the page.
    static var card: Color {
        #if canImport(UIKit)
        Color(uiColor: .secondarySystemGroupedBackground)
        #else
        Color(nsColor: .controlBackgroundColor)
        #endif
    }

    /// A block inside a card.
    static let inset = Color.secondary.opacity(0.08)

    /// Text on a filled `primary` shape: the page colour, reversed.
    static var reversed: Color {
        #if canImport(UIKit)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .textBackgroundColor)
        #endif
    }

    /// The hairline around a card.
    static var stroke: Color {
        #if canImport(UIKit)
        Color(uiColor: .separator).opacity(0.5)
        #else
        Color(nsColor: .separatorColor).opacity(0.6)
        #endif
    }
}

enum Radius {
    static let small: CGFloat = 8
    static let card: CGFloat = 14
    static let hero: CGFloat = 22
}

enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
    /// Between a screen's tiers — hero, sections, reference — so groups read
    /// as groups.
    static let tier: CGFloat = 32
}

// MARK: - Type

/// Six roles, all on Dynamic Type.
enum TypeRole {
    /// The one big number or answer a hero leads with.
    case display
    /// A smaller headline number: scores in a row, a tile's value.
    case title
    /// A section's title.
    case section
    /// Running text and row titles.
    case body
    /// Secondary facts under a row.
    case meta
    /// An uppercase overline above a hero or tile.
    case micro

    var font: Font {
        switch self {
        case .display: return .system(.largeTitle, design: .rounded).weight(.bold).monospacedDigit()
        case .title: return .system(.title2, design: .rounded).weight(.bold).monospacedDigit()
        case .section: return .headline
        case .body: return .subheadline
        case .meta: return .caption
        case .micro: return .caption2.weight(.bold)
        }
    }
}

extension View {
    /// Applies a type role; overlines are uppercased and tracked.
    @ViewBuilder
    func textStyle(_ role: TypeRole) -> some View {
        if role == .micro {
            self.font(role.font).textCase(.uppercase).kerning(0.8)
        } else {
            self.font(role.font)
        }
    }
}

// MARK: - Status

/// A verdict: start, caution or sit. Always shown with its icon, so it never
/// relies on colour alone and never reads as decoration.
enum StatusTone: Hashable, Sendable {
    case start, caution, sit

    var color: Color {
        switch self {
        case .start: return Palette.start
        case .caution: return Palette.caution
        case .sit: return Palette.sit
        }
    }

    var systemImage: String {
        switch self {
        case .start: return "checkmark.circle.fill"
        case .caution: return "exclamationmark.triangle.fill"
        case .sit: return "xmark.octagon.fill"
        }
    }
}

// MARK: - Tab identity

/// Each iPhone tab's hue: its header band, section icons and tab icon, so
/// you always know where you are. The hues are kept clear of the status
/// colours; Streams take the position's own colour.
enum HubStyle {
    static let board = Color(hex: 0x6366F1)
    static let team = Color(hex: 0x3B82F6)
    static let lineup = Color(hex: 0x14B8A6)
    static let market = Color(hex: 0x9333EA)

    static func tint(_ hub: PhoneHub) -> Color {
        switch hub {
        case .board: return board
        case .team: return team
        case .lineup: return lineup
        case .market: return market
        case .streams: return Palette.position(.wr)
        }
    }

    /// A screen's hue: its tab's, or for a stream, its position's.
    static func tint(for screen: RootView.Screen) -> Color {
        if let position = streamPosition(screen) { return Palette.position(position) }
        return tint(PhoneHub.hub(for: screen))
    }

    static func streamPosition(_ screen: RootView.Screen) -> Position? {
        switch screen {
        case .qbStream: return .qb
        case .rbStream: return .rb
        case .wrStream: return .wr
        case .kStream: return .k
        case .dstStream: return .def
        case .idpStream: return .lb
        default: return nil
        }
    }
}

private struct HubTintKey: EnvironmentKey {
    static let defaultValue: Color? = nil
}

extension EnvironmentValues {
    /// The hue of the screen being drawn. `nil` outside a screen (a sheet, a
    /// workspace panel), where things fall back to the accent.
    var hubTint: Color? {
        get { self[HubTintKey.self] }
        set { self[HubTintKey.self] = newValue }
    }
}
