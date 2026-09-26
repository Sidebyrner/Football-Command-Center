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

/// The iPhone's five tabs. Each hub holds one or more screens, switched by a
/// segment bar under the title; Settings opens from a gear on Team.
public enum PhoneHub: String, CaseIterable, Hashable, Sendable, Identifiable {
    case team, lineup, injuries, market, streams

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .team: return "Team"
        case .lineup: return "Lineup"
        case .injuries: return "Injuries"
        case .market: return "Market"
        case .streams: return "Streams"
        }
    }

    public var systemImage: String {
        switch self {
        case .team: return "person.crop.square"
        case .lineup: return "arrow.left.arrow.right"
        case .injuries: return "cross.case"
        case .market: return "binoculars"
        case .streams: return "figure.run"
        }
    }

    /// The hub's segments, in bar order; the first is where it opens.
    public var screens: [RootView.Screen] {
        switch self {
        case .team: return [.dashboard]
        case .lineup: return [.sitStart, .matchup]
        case .injuries: return [.injuries]
        case .market: return [.discovery, .waivers, .trades, .planning]
        case .streams: return [.qbStream, .rbStream, .wrStream, .kStream, .dstStream, .idpStream]
        }
    }

    /// Which hub a screen lives in. Settings sits behind Team's gear.
    public static func hub(for screen: RootView.Screen) -> PhoneHub {
        if screen == .settings { return .team }
        return allCases.first { $0.screens.contains(screen) } ?? .team
    }

    /// Short names for the segment bar.
    public static func segmentLabel(_ screen: RootView.Screen) -> String {
        switch screen {
        case .idpStream: return "IDP"
        case .wrStream: return "WR"
        case .rbStream: return "RB"
        case .qbStream: return "QB"
        case .dstStream: return "D/ST"
        case .kStream: return "K"
        default: return screen.rawValue
        }
    }
}
