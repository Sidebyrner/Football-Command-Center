import SwiftUI
import FCCore
import FCData

/// The app shell.
///
/// One multiplatform view rather than Catalyst, per §2: `NavigationSplitView`
/// gives the Mac a sidebar and iPad a column, while iPhone falls back to a tab
/// bar — the four screens are list-shaped and adapt without a separate layout.
public struct RootView: View {
    @StateObject private var settingsModel: SettingsModel
    @StateObject private var planningModel: PlanningModel
    @StateObject private var dashboardModel: DashboardModel
    @StateObject private var matchupModel: MatchupModel
    @StateObject private var sitStartModel: SitStartModel
    @State private var selection: Screen = .dashboard
    @State private var hasLoaded = false

    private let settingsStore: AppSettingsStore

    /// - Parameter initialScreen: the tab to open on. The app passes a Debug-only
    ///   launch argument through here so screenshots and UI tests can open any
    ///   screen directly.
    public init(
        sleeper: SleeperService,
        staticData: StaticDataStore,
        settingsStore: AppSettingsStore,
        initialScreen: Screen = .dashboard
    ) {
        self.settingsStore = settingsStore
        _selection = State(initialValue: initialScreen)
        _settingsModel = StateObject(
            wrappedValue: SettingsModel(sleeper: sleeper, store: settingsStore)
        )
        let loader = LeagueContextLoader(sleeper: sleeper, staticData: staticData)
        _planningModel = StateObject(wrappedValue: PlanningModel(loader: loader))
        // The relay is optional and every call through it fails soft, so a
        // missing base URL simply means the news section never appears (§0).
        let relay = settingsStore.load().relayBaseURL.map { RelayClient(baseURL: $0) }
        _dashboardModel = StateObject(
            wrappedValue: DashboardModel(loader: loader, sleeper: sleeper, relay: relay)
        )
        _matchupModel = StateObject(wrappedValue: MatchupModel(loader: loader, sleeper: sleeper))
        _sitStartModel = StateObject(wrappedValue: SitStartModel(loader: loader))
    }

    /// The four screens of the first release (§7), plus Settings.
    public enum Screen: String, CaseIterable, Identifiable, Hashable {
        /// Parses a launch-argument value like `matchup` or `sitstart`.
        public init?(argument: String) {
            let wanted = argument.lowercased().filter(\.isLetter)
            guard let match = Screen.allCases.first(where: {
                $0.rawValue.lowercased().filter(\.isLetter) == wanted
            }) else { return nil }
            self = match
        }

        case dashboard = "Dashboard"
        case planning = "Planning"
        case matchup = "Matchup"
        case sitStart = "Sit/Start"
        case settings = "Settings"

        public var id: String { rawValue }

        var systemImage: String {
            switch self {
            case .planning: return "calendar.badge.exclamationmark"
            case .dashboard: return "square.grid.2x2"
            case .matchup: return "person.2"
            case .sitStart: return "arrow.left.arrow.right"
            case .settings: return "gearshape"
            }
        }

    }

    public var body: some View {
        Group {
            #if os(iOS)
            if UIDevice.current.userInterfaceIdiom == .phone {
                phoneLayout
            } else {
                splitLayout
            }
            #else
            splitLayout
            #endif
        }
        .tint(settingsModel.settings.accentTheme.color)
        .task { await loadIfConfigured() }
        .onChange(of: settingsModel.settings.relayBaseURL) { _, url in
            dashboardModel.setRelay(baseURL: url)
            guard let leagueID = settingsModel.settings.leagueID,
                  let rosterID = settingsModel.settings.rosterID else { return }
            Task { await dashboardModel.load(leagueID: leagueID, userRosterID: rosterID) }
        }
    }

    // MARK: - Layouts

    private var phoneLayout: some View {
        TabView(selection: $selection) {
            ForEach(Screen.allCases) { screen in
                NavigationStack {
                    view(for: screen)
                }
                .tabItem { Label(screen.rawValue, systemImage: screen.systemImage) }
                .tag(screen)
            }
        }
    }

    /// `List(selection:)` takes an optional binding on iOS, while `TabView`
    /// takes a plain one. This bridges the two without letting the sidebar
    /// clear the selection and leave an empty detail pane.
    private var sidebarSelection: Binding<Screen?> {
        Binding(
            get: { selection },
            set: { newValue in if let newValue { selection = newValue } }
        )
    }

    private var splitLayout: some View {
        NavigationSplitView {
            List(Screen.allCases, selection: sidebarSelection) { screen in
                NavigationLink(value: screen) {
                    Label(screen.rawValue, systemImage: screen.systemImage)
                }
            }
            .navigationTitle("Command Center")
        } detail: {
            NavigationStack {
                view(for: selection)
            }
        }
    }

    @ViewBuilder
    private func view(for screen: Screen) -> some View {
        switch screen {
        case .planning:
            if settingsModel.settings.isConfigured {
                PlanningView(model: planningModel)
            } else {
                needsSetup
            }
        case .dashboard:
            if settingsModel.settings.isConfigured {
                DashboardView(model: dashboardModel)
            } else {
                needsSetup
            }
        case .settings:
            SettingsView(model: settingsModel) {
                Task { await loadIfConfigured(force: true) }
            }
        case .matchup:
            if settingsModel.settings.isConfigured {
                MatchupView(model: matchupModel)
            } else {
                needsSetup
            }
        case .sitStart:
            if settingsModel.settings.isConfigured {
                SitStartView(model: sitStartModel)
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
            Button("Open Settings") { selection = .settings }
        }
    }

    private func loadIfConfigured(force: Bool = false) async {
        guard settingsModel.settings.isConfigured else { return }
        guard force || !hasLoaded else { return }
        guard let leagueID = settingsModel.settings.leagueID,
              let rosterID = settingsModel.settings.rosterID else { return }
        hasLoaded = true
        // Dashboard first: it is the screen a notification deep-links into,
        // and its alerts are the time-sensitive part.
        await dashboardModel.load(leagueID: leagueID, userRosterID: rosterID)
        await matchupModel.load(leagueID: leagueID, userRosterID: rosterID)
        await sitStartModel.load(leagueID: leagueID, userRosterID: rosterID)
        await planningModel.load(leagueID: leagueID, userRosterID: rosterID)
    }
}
