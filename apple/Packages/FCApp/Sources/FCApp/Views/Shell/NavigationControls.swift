import SwiftUI

/// The way back, wherever you are. On iPhone a pill at the top-left of every
/// tab's screen — "‹ Board" in that screen's hue — tapped to go back, held for
/// the whole trail. On Mac and iPad, back and forward in the toolbar (held for
/// the trail) and in the Go menu.

/// The iPhone's back pill. Hidden when there's nowhere to go back to; pushed
/// pages inside a tab keep the system back button instead.
struct BackPill: View {
    @ObservedObject var router: AppRouter
    var workspaceName: (UUID) -> String? = { _ in nil }

    var body: some View {
        if let previous = router.history.previous {
            let hue = hue(previous)
            Menu {
                TrailItems(router: router, workspaceName: workspaceName)
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left").font(.footnote.weight(.bold))
                    Text(previous.shortLabel(workspaceName: workspaceName))
                        .font(.footnote.weight(.semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(hue)
            } primaryAction: {
                withAnimation(Motion.snappy) { router.goBack() }
            }
            .accessibilityLabel("Back to \(previous.trailLabel(workspaceName: workspaceName))")
            .accessibilityHint("Hold for everywhere you've been")
            .accessibilityIdentifier("nav.back")
            .sensoryFeedback(.selection, trigger: router.history)
        }
    }

    private func hue(_ item: SidebarItem) -> Color {
        item.screen.map(HubStyle.tint(for:)) ?? .accentColor
    }
}

/// Puts the back pill at the leading edge of a tab's root screen.
struct BackPillToolbar: ViewModifier {
    let router: AppRouter

    func body(content: Content) -> some View {
        #if os(iOS)
        content.toolbar {
            ToolbarItem(placement: .topBarLeading) { BackPill(router: router) }
        }
        #else
        content
        #endif
    }
}

/// The trail, newest first, each step one tap away.
struct TrailItems: View {
    @ObservedObject var router: AppRouter
    let workspaceName: (UUID) -> String?

    var body: some View {
        Section("Go back to") {
            ForEach(Array(router.history.back.enumerated().reversed()), id: \.offset) { index, item in
                Button {
                    withAnimation(Motion.snappy) { router.goBack(to: index) }
                } label: {
                    Label(item.trailLabel(workspaceName: workspaceName), systemImage: icon(item))
                }
            }
        }
    }

    private func icon(_ item: SidebarItem) -> String {
        item.screen?.systemImage ?? "square.grid.2x2"
    }
}

/// Back and forward for the split layout's toolbar. Each is a menu whose
/// click goes one step and whose hold shows that direction's trail.
struct HistoryButtons: View {
    @ObservedObject var router: AppRouter
    @ObservedObject var store: WorkspaceStore

    private func name(_ id: UUID) -> String? { store.workspaces.first { $0.id == id }?.name }

    var body: some View {
        Menu {
            TrailItems(router: router, workspaceName: name)
        } label: {
            Label("Back", systemImage: "chevron.left")
        } primaryAction: {
            router.goBack()
        }
        .disabled(!router.canGoBack)
        .help(router.history.previous.map { "Back to \($0.trailLabel(workspaceName: name))" } ?? "Back")
        .accessibilityIdentifier("nav.back")

        Menu {
            Section("Go forward to") {
                ForEach(Array(router.history.forward.enumerated().reversed()), id: \.offset) { offset, item in
                    Button(item.trailLabel(workspaceName: name)) {
                        for _ in 0..<(router.history.forward.count - offset) { router.goForward() }
                    }
                }
            }
        } label: {
            Label("Forward", systemImage: "chevron.right")
        } primaryAction: {
            router.goForward()
        }
        .disabled(!router.canGoForward)
        .help(router.history.next.map { "Forward to \($0.trailLabel(workspaceName: name))" } ?? "Forward")
        .accessibilityIdentifier("nav.forward")
    }
}

/// "from Board" under the window title on the Mac.
struct CameFromSubtitle: ViewModifier {
    @ObservedObject var router: AppRouter
    @ObservedObject var store: WorkspaceStore

    func body(content: Content) -> some View {
        #if os(macOS)
        content.navigationSubtitle(router.history.previous.map {
            "from \($0.trailLabel { id in store.workspaces.first { $0.id == id }?.name })"
        } ?? "")
        #else
        content
        #endif
    }
}

/// The Go menu: Back ⌘[ and Forward ⌘].
public struct GoCommands: Commands {
    @ObservedObject var router: AppRouter

    public init(router: AppRouter) {
        self.router = router
    }

    public var body: some Commands {
        CommandMenu("Go") {
            Button("Back") { router.goBack() }
                .keyboardShortcut("[", modifiers: .command)
                .disabled(!router.canGoBack)
            Button("Forward") { router.goForward() }
                .keyboardShortcut("]", modifiers: .command)
                .disabled(!router.canGoForward)
        }
    }
}
