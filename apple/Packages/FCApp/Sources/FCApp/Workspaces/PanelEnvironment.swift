import SwiftUI
import FCData

/// Sends a click in a panel to the panel's link group.
struct LinkPublishAction {
    let group: LinkGroup?
    let handler: @MainActor (LinkChange) -> Void

    /// True when the panel is linked, so the click went somewhere.
    var isLinked: Bool { group != nil }

    @MainActor
    func callAsFunction(_ change: LinkChange) {
        handler(change)
    }
}

private struct LinkPublishKey: EnvironmentKey {
    static let defaultValue = LinkPublishAction(group: nil) { _ in }
}

private struct PanelLinkGroupKey: EnvironmentKey {
    static let defaultValue: LinkGroup? = nil
}

private struct StaticRenderKey: EnvironmentKey {
    static let defaultValue: CGFloat? = nil
}

private struct InPanelKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var linkPublish: LinkPublishAction {
        get { self[LinkPublishKey.self] }
        set { self[LinkPublishKey.self] = newValue }
    }

    var panelLinkGroup: LinkGroup? {
        get { self[PanelLinkGroupKey.self] }
        set { self[PanelLinkGroupKey.self] = newValue }
    }

    /// A fixed canvas width with no scroll views, for rendering a workspace to
    /// an image (tests, previews). `nil` in the running app.
    var workspaceStaticWidth: CGFloat? {
        get { self[StaticRenderKey.self] }
        set { self[StaticRenderKey.self] = newValue }
    }

    /// Set inside workspace panels, so a shared row view can pick its compact form.
    var inWorkspacePanel: Bool {
        get { self[InPanelKey.self] }
        set { self[InPanelKey.self] = newValue }
    }
}

extension LinkGroup {
    var color: Color {
        switch self {
        case .one: return Color(hex: 0x3B82F6)
        case .two: return Color(hex: 0xF59E0B)
        case .three: return Color(hex: 0x10B981)
        case .four: return Color(hex: 0xA855F7)
        }
    }
}

/// A player row in a panel: a click follows the link when the panel has a
/// colour, and opens the Player Card sheet when it doesn't — so a row always
/// does something.
struct PanelPlayerTap: ViewModifier {
    let playerID: String?
    let context: LeagueContext?
    @Environment(\.linkPublish) private var publish
    @Environment(\.openPlayerCard) private var openPlayerCard

    func body(content: Content) -> some View {
        if let playerID {
            Button {
                if publish.isLinked {
                    publish(.player(playerID))
                } else if let context {
                    openPlayerCard(playerID, context: context)
                }
            } label: {
                content.contentShape(Rectangle())
            }
            .buttonStyle(PanelRowStyle())
            .playerCardMenu(playerID, context: context)
            .help(publish.isLinked ? "Show in linked panels" : "Open Player Card")
        } else {
            content
        }
    }
}

/// A light hover and press highlight for panel rows.
struct PanelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PanelRowBody(configuration: configuration)
    }

    private struct PanelRowBody: View {
        let configuration: ButtonStyleConfiguration
        @State private var hovering = false

        var body: some View {
            configuration.label
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.primary.opacity(configuration.isPressed ? 0.10 : hovering ? 0.05 : 0))
                )
                .onHover { hovering = $0 }
                .animation(.easeOut(duration: 0.12), value: hovering)
        }
    }
}

extension View {
    func panelPlayerTap(_ playerID: String?, context: LeagueContext?) -> some View {
        modifier(PanelPlayerTap(playerID: playerID, context: context))
    }
}
