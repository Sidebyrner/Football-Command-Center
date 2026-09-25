import SwiftUI
import FCCore
import FCData

/// The app shell.
///
/// One multiplatform view rather than Catalyst, per §2: `NavigationSplitView`
/// gives the Mac a sidebar and iPad a column, while iPhone falls back to a tab
/// bar — the four screens are list-shaped and adapt without a separate layout.
public struct RootView: View {
    /// The only model the shell itself reads — whether setup is complete, and the
    /// accent colour — so it is the only one the shell observes.
    @StateObject private var settingsModel: SettingsModel
    #if os(iOS)
    /// Feeds `ShellLayout.resolve` — an iPad in Slide Over or a narrow Split
    /// View reports compact here, and must fall back to the phone shell.
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    // The screen models are *held* here but deliberately not observed. They were
    // @StateObject, which re-rendered the whole tab view every time any screen
    // published — and at launch four screens publish repeatedly while they load.
    // Scrolling Matchup while Planning finished loading in the background meant
    // Matchup was being rebuilt mid-scroll, the likeliest cause of the jitter
    // reported on device. Each screen observes its own model instead.
    @State private var planningModel: PlanningModel
    @State private var dashboardModel: DashboardModel
    @State private var matchupModel: MatchupModel
    @State private var sitStartModel: SitStartModel
    @State private var injuryModel: InjuryCenterModel
    @State private var waiverModel: WaiverBoardModel
    @State private var idpStreamModel: IDPStreamScreenModel
    @State private var wrStreamModel: WRStreamScreenModel
    @State private var rbStreamModel: RBStreamScreenModel
    @State private var selection: Screen = .dashboard
    /// The Player Card on screen, opened from any row's context menu.
    @State private var playerCard: PlayerCardModel?
    private let sleeper: SleeperService
    @State private var hasLoaded = false

    private let settingsStore: AppSettingsStore

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
        self.settingsStore = settingsStore
        self.sleeper = sleeper
        _selection = State(initialValue: initialScreen)
        _settingsModel = StateObject(
            wrappedValue: SettingsModel(sleeper: sleeper, store: settingsStore)
        )
        let loader = LeagueContextLoader(sleeper: sleeper, staticData: staticData, now: now)
        // The relay is optional and every call through it fails soft, so a
        // missing base URL simply means the news section never appears (§0).
        let relayBaseURL = settingsStore.load().relayBaseURL
        let planning = PlanningModel(loader: loader, sleeper: sleeper)
        planning.relayBaseURL = relayBaseURL
        _planningModel = State(initialValue: planning)
        let relay = relayBaseURL.map { RelayClient(baseURL: $0) }
        _dashboardModel = State(
            initialValue: DashboardModel(loader: loader, sleeper: sleeper, relay: relay)
        )
        _matchupModel = State(initialValue: MatchupModel(loader: loader, sleeper: sleeper))
        _sitStartModel = State(initialValue: SitStartModel(loader: loader))
        _injuryModel = State(initialValue: InjuryCenterModel(loader: loader, sleeper: sleeper))
        _waiverModel = State(initialValue: WaiverBoardModel(loader: loader, sleeper: sleeper))
        _idpStreamModel = State(initialValue: IDPStreamScreenModel(loader: loader))
        _wrStreamModel = State(initialValue: WRStreamScreenModel(loader: loader))
        _rbStreamModel = State(initialValue: RBStreamScreenModel(loader: loader))
    }

    /// The four screens of the first release (§7), plus Settings.
    public enum Screen: String, CaseIterable, Identifiable, Hashable {
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
        case planning = "Planning"
        case waivers = "Waivers"
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
            case .waivers: return "tray.and.arrow.down"
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
            case .planning, .waivers, .idpStream, .wrStream, .rbStream: return .market
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
        .environment(\.openScreen, OpenScreenAction { screen in
            selection = screen
        })
        .environment(\.openPlayerCard, OpenPlayerCardAction { id, context in
            let store = settingsStore
            playerCard = PlayerCardModel(
                playerID: id,
                context: context,
                sleeper: sleeper,
                weights: store.load().gradeWeights,
                onWeightsChange: { weights in
                    var settings = store.load()
                    settings.gradeWeights = weights
                    store.save(settings)
                }
            )
        })
        .sheet(item: $playerCard) { model in
            PlayerCardSheet(model: model)
        }
        .task { await loadIfConfigured() }
        .onChange(of: settingsModel.settings.relayBaseURL) { _, url in
            dashboardModel.setRelay(baseURL: url)
            planningModel.relayBaseURL = url
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
            List(selection: sidebarSelection) {
                ForEach(SidebarSection.allCases) { section in
                    let screens = Screen.sidebarCases.filter { $0.section == section }
                    if !screens.isEmpty {
                        Section(section.rawValue) {
                            ForEach(screens) { screen in
                                NavigationLink(value: screen) {
                                    Label(screen.rawValue, systemImage: screen.systemImage)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Command Center")
            #if os(macOS)
            .navigationSplitViewColumnWidth(min: 190, ideal: 210, max: 260)
            #endif
        } detail: {
            NavigationStack {
                view(for: selection)
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
    private func view(for screen: Screen) -> some View {
        switch screen {
        case .planning:
            if settingsModel.settings.isConfigured {
                PlanningView(
                    model: planningModel,
                    introSeen: settingsModel.settings.hasSeenPlanningIntro,
                    onDismissIntro: { settingsModel.markPlanningIntroSeen() }
                )
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
        case .injuries:
            if settingsModel.settings.isConfigured {
                InjuryCenterView(model: injuryModel)
            } else {
                needsSetup
            }
        case .waivers:
            if settingsModel.settings.isConfigured {
                WaiverBoardView(model: waiverModel)
            } else {
                needsSetup
            }
        case .idpStream:
            if settingsModel.settings.isConfigured {
                IDPStreamView(model: idpStreamModel)
            } else {
                needsSetup
            }
        case .wrStream:
            if settingsModel.settings.isConfigured {
                WRStreamView(model: wrStreamModel)
            } else {
                needsSetup
            }
        case .rbStream:
            if settingsModel.settings.isConfigured {
                RBStreamView(model: rbStreamModel)
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
        // In parallel: they share one league context through the loader's memo,
        // so this is one assembly, and no screen waits behind another.
        async let dashboard: Void = dashboardModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let matchup: Void = matchupModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let sitStart: Void = sitStartModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let planning: Void = planningModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let injuries: Void = injuryModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let waivers: Void = waiverModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let idpStream: Void = idpStreamModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let wrStream: Void = wrStreamModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let rbStream: Void = rbStreamModel.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        _ = await (dashboard, matchup, sitStart, planning, injuries, waivers, idpStream, wrStream, rbStream)
    }
}
