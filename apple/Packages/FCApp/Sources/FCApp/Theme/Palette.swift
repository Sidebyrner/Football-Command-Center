import SwiftUI
import FCCore

extension Color {
    /// `0xRRGGBB`, for the handful of brand colours carried over from the web app.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}

/// The app's colour vocabulary, in one place.
///
/// Values come from the web app (`src/index.css`, `playerHelpers.js`) so the two
/// read as one product. Views use these names, never raw `.green` or `.red`, so
/// a colour decision is made once.
public enum Palette {
    // Status colours are verdicts only — never decoration — and always come
    // with an icon (`StatusTone`). Light mode uses deeper shades so text in
    // them reads on a white card (WCAG 3:1 or better); dark mode the bright
    // ones the web app uses.

    /// Good: a start, a gain, a clean lineup.
    public static let start = Color.dynamic(light: 0x047857, dark: 0x10B981)
    /// Needs attention but isn't a guaranteed loss: an injury tag, a thin week.
    public static let caution = Color.dynamic(light: 0xB45309, dark: 0xF59E0B)
    /// A guaranteed or likely loss: a bye starter, a negative delta.
    public static let sit = Color.dynamic(light: 0xBE123C, dark: 0xFB7185)

    /// Card fill, tuned to sit on the system background in light and dark.
    public static let surface = Color.secondary.opacity(0.08)
    public static let surfaceRaised = Color.secondary.opacity(0.14)

    /// Position colours, matching the web board in dark mode and a shade
    /// deeper in light mode so chip text reads on white.
    public static func position(_ position: Position?) -> Color {
        switch position {
        case .qb: return .dynamic(light: 0x2563EB, dark: 0x60A5FA)
        case .rb: return .dynamic(light: 0x059669, dark: 0x34D399)
        case .wr: return .dynamic(light: 0x7C3AED, dark: 0xA78BFA)
        case .te: return .dynamic(light: 0xEA580C, dark: 0xFB923C)
        case .k: return .dynamic(light: 0xDB2777, dark: 0xF472B6)
        case .def: return .dynamic(light: 0x64748B, dark: 0x94A3B8)
        case .lb: return .dynamic(light: 0x0284C7, dark: 0x38BDF8)
        case .dl: return .dynamic(light: 0xDC2626, dark: 0xF87171)
        case .db: return .dynamic(light: 0xA16207, dark: 0xFACC15)
        case nil: return .dynamic(light: 0x64748B, dark: 0x94A3B8)
        }
    }

    /// Green for gains, red for losses, neutral for nothing either way.
    public static func delta(_ value: Double?) -> Color {
        guard let value else { return .secondary }
        if value > 0.05 { return start }
        if value < -0.05 { return sit }
        return .secondary
    }
}
