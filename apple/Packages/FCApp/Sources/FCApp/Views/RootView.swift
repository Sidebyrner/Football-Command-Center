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
    @State private var selection: Screen = .planning
    @State private var hasLoaded = false

    private let settingsStore: AppSettingsStore

    public init(
        sleeper: SleeperService,
        staticData: StaticDataStore,
        settingsStore: AppSettingsStore
    ) {
        self.settingsStore = settingsStore
        _settingsModel = StateObject(
            wrappedValue: SettingsModel(sleeper: sleeper, store: settingsStore)
        )
        _planningModel = StateObject(
            wrappedValue: PlanningModel(
                loader: LeagueContextLoader(sleeper: sleeper, staticData: staticData)
            )
        )
    }

    /// The four screens of the first release (§7). Dashboard, Matchup and
    /// Sit/Start are placeholders until they are built — shown rather than
    /// hidden so the shape of the app is visible from the first run.
    public enum Screen: String, CaseIterable, Identifiable, Hashable {
        case planning = "Planning"
        case dashboard = "Dashboard"
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

        var isBuilt: Bool {
            self == .planning || self == .settings
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
        .task { await loadIfConfigured() }
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
        case .settings:
            SettingsView(model: settingsModel) {
                Task { await loadIfConfigured(force: true) }
            }
        case .dashboard, .matchup, .sitStart:
            notBuiltYet(screen)
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

    /// Honest about what is not built rather than showing an empty screen that
    /// looks broken.
    private func notBuiltYet(_ screen: Screen) -> some View {
        ContentUnavailableView {
            Label(screen.rawValue, systemImage: screen.systemImage)
        } description: {
            Text("Not built yet. Planning came first — it exercises the whole core.")
        }
    }

    private func loadIfConfigured(force: Bool = false) async {
        guard settingsModel.settings.isConfigured else { return }
        guard force || !hasLoaded else { return }
        guard let leagueID = settingsModel.settings.leagueID,
              let rosterID = settingsModel.settings.rosterID else { return }
        hasLoaded = true
        await planningModel.load(leagueID: leagueID, userRosterID: rosterID)
    }
}
