import Foundation

/// Which shell chrome a screen size gets. Phone always gets tabs; iPad and
/// Mac get the sidebar split — except a compact-width iPad (Slide Over, a
/// narrow multitasking split), which is the same cramped shape as a phone and
/// should be treated as one.
public enum ShellLayout: Hashable, Sendable {
    case tabs
    case split

    /// Pure so it can be unit tested without a simulator.
    ///
    /// - Parameters:
    ///   - isPhone: the device idiom is `.phone`. iPhone in landscape can
    ///     still report a `.regular` horizontal size class, so the idiom check
    ///     comes first and wins outright — a phone never gets the split shell.
    ///   - horizontalSizeClass: `nil` on macOS, where there is no compact
    ///     width to fall back from.
    public static func resolve(isPhone: Bool, horizontalSizeClass: SizeClass?) -> ShellLayout {
        if isPhone { return .tabs }
        if horizontalSizeClass == .compact { return .tabs }
        return .split
    }

    /// A platform-agnostic stand-in for `UserInterfaceSizeClass`, so this file
    /// carries no SwiftUI/UIKit import and stays testable in a plain package.
    public enum SizeClass: Hashable, Sendable {
        case compact
        case regular
    }
}

/// Groups the sidebar into sections on desktop, so the split shell reads as a
/// real app structure rather than a flat list of tabs.
public enum SidebarSection: String, CaseIterable, Hashable, Sendable, Identifiable {
    case team = "Team"
    case week = "This Week"
    /// The user's own panel layouts. Holds no fixed screens.
    case workspaces = "Workspaces"
    case market = "Market"
    case settings = "Settings"

    public var id: String { rawValue }
}
