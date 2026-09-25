import Foundation
import SwiftUI
import FCCore
import FCData

/// Everything the app builds once: the loader, every screen model, and the
/// workspace library. Screens and workspace panels take their model from here,
/// so a panel and its full screen share one instance and one load.
///
/// Deliberately *not* an `ObservableObject`. The shell used to hold these as
/// `@StateObject`, which re-rendered the whole tab view every time any screen
/// published — at launch four screens publish repeatedly while they load, and
/// scrolling Matchup while Planning finished loading rebuilt Matchup mid-scroll.
/// Nothing observes this holder; each view observes only the model it shows.
@MainActor
public final class AppServices {
    public let sleeper: SleeperService
    public let settingsStore: AppSettingsStore
    public let loader: LeagueContextLoader
    public let settingsModel: SettingsModel

    public let planning: PlanningModel
    public let dashboard: DashboardModel
    public let matchup: MatchupModel
    public let sitStart: SitStartModel
    public let injuries: InjuryCenterModel
    public let waivers: WaiverBoardModel
    public let idpStream: IDPStreamScreenModel
    public let wrStream: WRStreamScreenModel
    public let rbStream: RBStreamScreenModel
    public let trades: TradeDeskScreenModel
    public let discovery: DiscoveryModel

    public let workspaces: WorkspaceStore
    public let linkBus: LinkBus
    public let playerCards: PlayerCardCache

    private var hasLoaded = false

    public init(
        sleeper: SleeperService,
        staticData: StaticDataStore,
        settingsStore: AppSettingsStore,
        workspacePersistence: WorkspacePersistence = FileWorkspacePersistence(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.sleeper = sleeper
        self.settingsStore = settingsStore
        settingsModel = SettingsModel(sleeper: sleeper, store: settingsStore)
        let loader = LeagueContextLoader(sleeper: sleeper, staticData: staticData, now: now)
        self.loader = loader
        // The relay is optional and every call through it fails soft, so a
        // missing base URL simply means the news section never appears (§0).
        let relayBaseURL = settingsStore.load().relayBaseURL
        planning = PlanningModel(loader: loader, sleeper: sleeper)
        planning.relayBaseURL = relayBaseURL
        dashboard = DashboardModel(loader: loader, sleeper: sleeper, relay: relayBaseURL.map { RelayClient(baseURL: $0) })
        matchup = MatchupModel(loader: loader, sleeper: sleeper)
        sitStart = SitStartModel(loader: loader)
        injuries = InjuryCenterModel(loader: loader, sleeper: sleeper)
        waivers = WaiverBoardModel(loader: loader, sleeper: sleeper)
        idpStream = IDPStreamScreenModel(loader: loader)
        wrStream = WRStreamScreenModel(loader: loader)
        rbStream = RBStreamScreenModel(loader: loader)
        trades = TradeDeskScreenModel(loader: loader)
        trades.relayBaseURL = relayBaseURL
        discovery = DiscoveryModel(loader: loader, sleeper: sleeper)

        workspaces = WorkspaceStore(persistence: workspacePersistence)
        linkBus = LinkBus()
        playerCards = PlayerCardCache()
    }

    /// Loads every screen once the league is set up. `force` refetches — after
    /// Settings saves a new league, say.
    public func loadIfConfigured(force: Bool = false) async {
        let settings = settingsModel.settings
        guard settings.isConfigured else { return }
        guard force || !hasLoaded else { return }
        guard let leagueID = settings.leagueID, let rosterID = settings.rosterID else { return }
        hasLoaded = true
        if force { playerCards.removeAll() }
        // In parallel: they share one league context through the loader's memo,
        // so this is one assembly, and no screen waits behind another.
        async let dashboard: Void = dashboard.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let matchup: Void = matchup.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let sitStart: Void = sitStart.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let planning: Void = planning.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let injuries: Void = injuries.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let waivers: Void = waivers.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let idpStream: Void = idpStream.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let wrStream: Void = wrStream.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let rbStream: Void = rbStream.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let trades: Void = trades.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        async let discovery: Void = discovery.load(leagueID: leagueID, userRosterID: rosterID, force: force)
        _ = await (dashboard, matchup, sitStart, planning, injuries, waivers, idpStream, wrStream, rbStream, trades, discovery)
    }

    /// A new relay address reaches every model that talks to it, and the
    /// dashboard reloads so its news section appears or goes.
    public func setRelay(baseURL url: URL?) {
        dashboard.setRelay(baseURL: url)
        planning.relayBaseURL = url
        trades.relayBaseURL = url
        guard let leagueID = settingsModel.settings.leagueID,
              let rosterID = settingsModel.settings.rosterID else { return }
        Task { await dashboard.load(leagueID: leagueID, userRosterID: rosterID) }
    }

    /// A Player Card for the sheet or a workspace panel. Linked panels ask for
    /// the same player over and over, so the model is reused while the league
    /// data stays the same.
    public func playerCard(_ id: String, context: LeagueContext) -> PlayerCardModel {
        playerCards.model(for: id) { [sleeper, settingsStore] in
            PlayerCardModel(
                playerID: id,
                context: context,
                sleeper: sleeper,
                weights: settingsStore.load().gradeWeights,
                onWeightsChange: { weights in
                    var settings = settingsStore.load()
                    settings.gradeWeights = weights
                    settingsStore.save(settings)
                }
            )
        }
    }
}

private struct AppServicesKey: EnvironmentKey {
    static let defaultValue: AppServices? = nil
}

extension EnvironmentValues {
    /// The shared services, for workspace panels. A plain reference — reading
    /// it never makes a view observe anything.
    var appServices: AppServices? {
        get { self[AppServicesKey.self] }
        set { self[AppServicesKey.self] = newValue }
    }
}
