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
    /// Good: a start, a gain, a clean lineup.
    public static let start = Color(hex: 0x10B981)
    /// Needs attention but isn't a guaranteed loss: an injury tag, a thin week.
    public static let caution = Color(hex: 0xF59E0B)
    /// A guaranteed or likely loss: a bye starter, a negative delta.
    public static let sit = Color(hex: 0xF43F5E)

    /// Card fill, tuned to sit on the system background in light and dark.
    public static let surface = Color.secondary.opacity(0.08)
    public static let surfaceRaised = Color.secondary.opacity(0.14)

    /// Position colours, matching the web board.
    public static func position(_ position: Position?) -> Color {
        switch position {
        case .qb: return Color(hex: 0x60A5FA)
        case .rb: return Color(hex: 0x34D399)
        case .wr: return Color(hex: 0xA78BFA)
        case .te: return Color(hex: 0xFB923C)
        case .k: return Color(hex: 0xF472B6)
        case .def: return Color(hex: 0x94A3B8)
        case .lb: return Color(hex: 0x38BDF8)
        case .dl: return Color(hex: 0xF87171)
        case .db: return Color(hex: 0xFACC15)
        case nil: return Color(hex: 0x94A3B8)
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
