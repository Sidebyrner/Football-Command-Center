import SwiftUI

/// The accent colour the user picked in Settings.
public enum AccentTheme: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    /// The web app's own accent, so a first launch looks like the product.
    case amber
    case blue
    case green
    case purple
    case red
    case teal

    public static let `default`: AccentTheme = .amber

    public var id: String { rawValue }

    public var label: String { rawValue.capitalized }

    public var color: Color {
        switch self {
        case .amber: return Color(hex: 0xF59E0B)
        case .blue: return Color(hex: 0x3B82F6)
        case .green: return Color(hex: 0x10B981)
        case .purple: return Color(hex: 0x8B5CF6)
        case .red: return Color(hex: 0xF43F5E)
        case .teal: return Color(hex: 0x14B8A6)
        }
    }

    /// Reads a stored value, falling back to the default for anything this
    /// version does not know — so removing a theme later cannot break an
    /// existing install's settings.
    public init(stored: String?) {
        self = stored.flatMap(AccentTheme.init(rawValue:)) ?? .default
    }
}
