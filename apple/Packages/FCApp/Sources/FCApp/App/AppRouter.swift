import Foundation
import SwiftUI

/// What the sidebar can show: one of the fixed screens, or one of the user's
/// workspaces. `RootView.Screen` stays a plain string enum because it also
/// drives the iPhone tab bar and the `-FCCTab` launch argument.
public enum SidebarItem: Hashable, Sendable {
    case screen(RootView.Screen)
    case workspace(UUID)

    public var screen: RootView.Screen? {
        if case .screen(let screen) = self { return screen }
        return nil
    }

    public var workspaceID: UUID? {
        if case .workspace(let id) = self { return id }
        return nil
    }
}

/// Where the app is: which sidebar item is open, whether a workspace is being
/// edited, and the Player Card sheet. Small and cheap to publish — the shell
/// observes this and the settings, nothing else.
@MainActor
public final class AppRouter: ObservableObject {
    @Published public var selection: SidebarItem {
        didSet {
            if let screen = selection.screen, screen != .settings {
                hubSegments[PhoneHub.hub(for: screen)] = screen
            }
        }
    }
    /// The segment each phone hub was last on, so coming back to a hub
    /// returns to where you were.
    @Published public private(set) var hubSegments: [PhoneHub: RootView.Screen] = [:]
    /// The Player Card sheet, opened from any row's context menu.
    @Published public var playerCard: PlayerCardModel?
    /// Unlocked: panels show drag and resize handles. Locked by default, so a
    /// finished layout can't be nudged by accident.
    @Published public var workspaceEditing = false
    @Published public var selectedPanelID: UUID?
    @Published public var showPanelLibrary = false
    /// The panel tray beside an unlocked workspace: full, or an icon strip.
    @Published public var panelTrayExpanded = true
    /// What's being dragged out of the tray, so the grid can size its ghost.
    @Published var trayDrag: TrayItem?

    public init(selection: SidebarItem = .screen(.dashboard)) {
        self.selection = selection
        if let screen = selection.screen, screen != .settings {
            hubSegments[PhoneHub.hub(for: screen)] = screen
        }
    }

    /// The phone tab: the hub of the current screen. Choosing a hub goes to
    /// its remembered segment, else its first.
    public var phoneHub: PhoneHub {
        get { PhoneHub.hub(for: phoneScreen) }
        set {
            guard newValue != phoneHub else { return }
            selection = .screen(segment(in: newValue))
        }
    }

    /// The segment a hub shows: the current screen if it's in the hub, else
    /// the one it was last on, else its first.
    public func segment(in hub: PhoneHub) -> RootView.Screen {
        if let screen = selection.screen, hub.screens.contains(screen) { return screen }
        return hubSegments[hub] ?? hub.screens[0]
    }

    public func open(_ screen: RootView.Screen) {
        selection = .screen(screen)
    }

    public func open(workspace id: UUID) {
        if selection != .workspace(id) {
            workspaceEditing = false
            selectedPanelID = nil
        }
        selection = .workspace(id)
    }

    /// The screen the phone's tab bar shows. A workspace can't be selected on
    /// a phone; if one ever is (a launch argument), the phone shows My Team.
    public var phoneScreen: RootView.Screen {
        get { selection.screen ?? .dashboard }
        set { selection = .screen(newValue) }
    }
}
