import SwiftUI

/// The accent colour the user picked in Settings.
public enum AccentTheme: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    /// The default: clear of every status colour, so a button never looks
    /// like a warning.
    case indigo
    /// The web app's accent — also the caution colour, which is why it is no
    /// longer the default.
    case amber
    case blue
    case green
    case purple
    case red
    case teal

    public static let `default`: AccentTheme = .indigo

    public var id: String { rawValue }

    public var label: String { rawValue.capitalized }

    public var color: Color {
        switch self {
        case .indigo: return Color(hex: 0x6366F1)
        case .amber: return Color(hex: 0xF59E0B)
        case .blue: return Color(hex: 0x3B82F6)
        case .green: return Color(hex: 0x10B981)
        case .purple: return Color(hex: 0x8B5CF6)
        case .red: return Color(hex: 0xF43F5E)
        case .teal: return Color(hex: 0x14B8A6)
        }
    }

    /// The status colour this accent shares, if any — said in Settings, since
    /// a button that looks like a warning muddies both.
    public var sharedStatus: String? {
        switch self {
        case .amber: return "caution"
        case .green: return "start"
        case .red: return "sit"
        default: return nil
        }
    }

    /// Reads a stored value, falling back to the default for anything this
    /// version does not know — so removing a theme later cannot break an
    /// existing install's settings.
    public init(stored: String?) {
        self = stored.flatMap(AccentTheme.init(rawValue:)) ?? .default
    }
}
