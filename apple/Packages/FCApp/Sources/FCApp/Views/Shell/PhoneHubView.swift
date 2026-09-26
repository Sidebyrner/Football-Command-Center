import SwiftUI

/// One iPhone tab: a segment bar pinned under the title, and a navigation
/// stack per segment kept alive, so each keeps its own scroll position and
/// pushed pages when you switch away and back.
struct PhoneHubView<Content: View>: View {
    let hub: PhoneHub
    @ObservedObject var router: AppRouter
    @ViewBuilder let content: (RootView.Screen) -> Content

    private var current: RootView.Screen { router.segment(in: hub) }

    var body: some View {
        ZStack {
            ForEach(hub.screens) { screen in
                let shown = screen == current
                NavigationStack {
                    root(screen)
                        .safeAreaInset(edge: .top, spacing: 0) {
                            // Only the visible stack carries the bar, so there's
                            // one set of segment buttons on screen.
                            if hub.screens.count > 1, shown { segmentBar }
                        }
                }
                .opacity(shown ? 1 : 0)
                .allowsHitTesting(shown)
                .accessibilityHidden(!shown)
            }
        }
    }

    @ViewBuilder
    private func root(_ screen: RootView.Screen) -> some View {
        if hub == .team {
            content(screen)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            router.open(.settings)
                        } label: {
                            Label("Settings", systemImage: "gearshape")
                        }
                        .accessibilityIdentifier("hub.settings")
                    }
                }
                .navigationDestination(isPresented: Binding(
                    get: { router.selection == .screen(.settings) },
                    set: { if !$0 { router.open(.dashboard) } }
                )) {
                    content(.settings)
                }
        } else {
            content(screen)
        }
    }

    private var segmentBar: some View {
        SlidingPicker(
            options: hub.screens,
            selection: Binding(get: { current }, set: { screen in
                withAnimation(Motion.snappy) { router.open(screen) }
            })
        ) { PhoneHub.segmentLabel($0) }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(.bar)
        .sensoryFeedback(.selection, trigger: current)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("hub.segments")
    }
}

/// Tab badges, each observing only the model it counts, so the shell itself
/// still observes nothing but the router and settings.
struct InjuryHubBadge<Content: View>: View {
    @ObservedObject var model: InjuryCenterModel
    @ViewBuilder let content: Content

    /// Starters who can't play this week.
    private var count: Int {
        guard let context = model.context else { return 0 }
        return model.roster.filter { $0.isStarter && StartAvailability.of($0.id, context: context).blocksStart }.count
    }

    var body: some View {
        content.badge(count)
    }
}

struct LineupHubBadge<Content: View>: View {
    @ObservedObject var model: SitStartModel
    @ViewBuilder let content: Content

    /// Starters the recommended lineup would change.
    var body: some View {
        content.badge(model.starts.count)
    }
}
