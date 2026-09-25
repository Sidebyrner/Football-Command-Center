import SwiftUI
import FCCore
import FCData

/// The app shell.
///
/// One multiplatform view rather than Catalyst, per §2: `NavigationSplitView`
/// gives the Mac a sidebar and iPad a column, while iPhone falls back to a tab
/// bar — the four screens are list-shaped and adapt without a separate layout.
public struct RootView: View {
    /// The only models the shell itself reads — whether setup is complete and
    /// the accent colour, and where the user is — so the only ones it observes.
    @StateObject private var settingsModel: SettingsModel
    @StateObject private var router: AppRouter
    #if os(iOS)
    /// Feeds `ShellLayout.resolve` — an iPad in Slide Over or a narrow Split
    /// View reports compact here, and must fall back to the phone shell.
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Every screen model, held but not observed — see `AppServices`.
    @State private var services: AppServices

    public init(services: AppServices, router: AppRouter) {
        _services = State(initialValue: services)
        _settingsModel = StateObject(wrappedValue: services.settingsModel)
        _router = StateObject(wrappedValue: router)
    }

    /// - Parameter initialScreen: the tab to open on. The app passes a Debug-only
    ///   launch argument through here so screenshots and UI tests can open any
    ///   screen directly.
    public init(
        sleeper: SleeperService,
        staticData: StaticDataStore,
        settingsStore: AppSettingsStore,
        initialScreen: Screen = .dashboard,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.init(
            services: AppServices(sleeper: sleeper, staticData: staticData, settingsStore: settingsStore, now: now),
            router: AppRouter(selection: .screen(initialScreen))
        )
    }

    /// The four screens of the first release (§7), plus Settings.
    public enum Screen: String, CaseIterable, Identifiable, Hashable, Sendable {
        /// Parses a launch-argument value like `matchup` or `sitstart`.
        public init?(argument: String) {
            let wanted = argument.lowercased().filter(\.isLetter)
            // "dashboard" still opens the hub it became.
            if wanted == "dashboard" { self = .dashboard; return }
            guard let match = Screen.allCases.first(where: {
                $0.rawValue.lowercased().filter(\.isLetter) == wanted
            }) else { return nil }
            self = match
        }

        case dashboard = "My Team"
        case injuries = "Injuries"
        case discovery = "Discover"
        case planning = "Planning"
        case waivers = "Waivers"
        case trades = "Trades"
        case idpStream = "IDP Stream"
        case wrStream = "WR Stream"
        case rbStream = "RB Stream"
        case matchup = "Matchup"
        case sitStart = "Sit/Start"
        case settings = "Settings"

        public var id: String { rawValue }

        var systemImage: String {
            switch self {
            case .planning: return "calendar.badge.exclamationmark"
            case .dashboard: return "person.crop.square"
            case .injuries: return "cross.case"
            case .discovery: return "binoculars"
            case .waivers: return "tray.and.arrow.down"
            case .trades: return "arrow.triangle.swap"
            case .idpStream: return "shield.lefthalf.filled"
            case .wrStream: return "figure.american.football"
            case .rbStream: return "figure.run"
            case .matchup: return "person.2"
            case .sitStart: return "arrow.left.arrow.right"
            case .settings: return "gearshape"
            }
        }

        /// Which sidebar group this screen sits under on desktop.
        var section: SidebarSection {
            switch self {
            case .dashboard, .sitStart, .injuries: return .team
            case .matchup: return .week
            case .planning, .waivers, .trades, .idpStream, .wrStream, .rbStream, .discovery: return .market
            case .settings: return .settings
            }
        }

        /// Every screen except Settings, which becomes a `Settings` scene on
        /// macOS rather than a sidebar row — not yet built, so it stays here
        /// for now and is filtered only where noted.
        static var sidebarCases: [Screen] { allCases }
    }

    public var body: some View {
        Group {
            #if os(iOS)
            let layout = ShellLayout.resolve(
                isPhone: UIDevice.current.userInterfaceIdiom == .phone,
                horizontalSizeClass: horizontalSizeClass == .compact ? .compact : .regular
            )
            switch layout {
            case .tabs: phoneLayout
            case .split: splitLayout
            }
            #else
            splitLayout
            #endif
        }
        .tint(settingsModel.settings.accentTheme.color)
        .environment(\.appServices, services)
        .environmentObject(services.linkBus)
        .environment(\.openScreen, OpenScreenAction { [router] screen in
            router.open(screen)
        })
        .environment(\.openTrade, OpenTradeAction { [router, services] prefill in
            router.open(.trades)
            Task { await services.trades.open(prefill) }
        })
        .environment(\.openPlayerCard, OpenPlayerCardAction { [router, services] id, context in
            router.playerCard = services.playerCard(id, context: context)
        })
        .sheet(item: $router.playerCard) { model in
            PlayerCardSheet(model: model)
        }
        .task { await services.loadIfConfigured() }
        .onChange(of: settingsModel.settings.relayBaseURL) { _, url in
            services.setRelay(baseURL: url)
        }
    }

    // MARK: - Layouts

    private var phoneLayout: some View {
        TabView(selection: $router.phoneScreen) {
            ForEach(Screen.allCases) { screen in
                NavigationStack {
                    view(for: screen)
                }
                .tabItem { Label(screen.rawValue, systemImage: screen.systemImage) }
                .tag(screen)
            }
        }
    }

    private var splitLayout: some View {
        NavigationSplitView {
            SidebarView(router: router, store: services.workspaces)
            #if os(macOS)
            .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
            #endif
        } detail: {
            NavigationStack {
                detail(for: router.selection)
            }
            #if os(macOS)
            .frame(minWidth: 620)
            #endif
        }
        #if os(macOS)
        .frame(minWidth: 900, minHeight: 600)
        #endif
    }

    @ViewBuilder
    private func detail(for item: SidebarItem) -> some View {
        switch item {
        case .screen(let screen):
            view(for: screen)
        case .workspace(let id):
            if settingsModel.settings.isConfigured {
                WorkspaceScreen(workspaceID: id, store: services.workspaces, router: router, services: services)
                    .id(id)
            } else {
                needsSetup
            }
        }
    }

    @ViewBuilder
    private func view(for screen: Screen) -> some View {
        switch screen {
        case .planning:
            if settingsModel.settings.isConfigured {
                PlanningView(
                    model: services.planning,
                    introSeen: settingsModel.settings.hasSeenPlanningIntro,
                    onDismissIntro: { settingsModel.markPlanningIntroSeen() }
                )
            } else {
                needsSetup
            }
        case .dashboard:
            if settingsModel.settings.isConfigured {
                DashboardView(model: services.dashboard)
            } else {
                needsSetup
            }
        case .settings:
            SettingsView(model: settingsModel) {
                Task { await services.loadIfConfigured(force: true) }
            }
        case .matchup:
            if settingsModel.settings.isConfigured {
                MatchupView(model: services.matchup)
            } else {
                needsSetup
            }
        case .sitStart:
            if settingsModel.settings.isConfigured {
                SitStartView(model: services.sitStart)
            } else {
                needsSetup
            }
        case .injuries:
            if settingsModel.settings.isConfigured {
                InjuryCenterView(model: services.injuries)
            } else {
                needsSetup
            }
        case .waivers:
            if settingsModel.settings.isConfigured {
                WaiverBoardView(model: services.waivers)
            } else {
                needsSetup
            }
        case .trades:
            if settingsModel.settings.isConfigured {
                TradeDeskScreen(screen: services.trades)
            } else {
                needsSetup
            }
        case .idpStream:
            if settingsModel.settings.isConfigured {
                IDPStreamView(model: services.idpStream)
            } else {
                needsSetup
            }
        case .wrStream:
            if settingsModel.settings.isConfigured {
                WRStreamView(model: services.wrStream)
            } else {
                needsSetup
            }
        case .rbStream:
            if settingsModel.settings.isConfigured {
                RBStreamView(model: services.rbStream)
            } else {
                needsSetup
            }
        case .discovery:
            if settingsModel.settings.isConfigured {
                DiscoverView(model: services.discovery, services: services)
            } else {
                needsSetup
            }
        }
    }

    private var needsSetup: some View {
        ContentUnavailableView {
            Label("Connect your league", systemImage: "link")
        } description: {
            Text("Add your Sleeper username in Settings to load your league.")
        } actions: {
            Button("Open Settings") { router.open(.settings) }
        }
    }
}
