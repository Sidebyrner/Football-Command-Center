import Foundation
import FCCore
import FCData

/// The Trade Desk as a screen: loads the league through the shared loader and
/// holds the desk, rebuilt when a "Trade for…" request arrives from elsewhere
/// so the deal always starts from current rosters.
@MainActor
public final class TradeDeskScreenModel: ObservableObject {
    @Published public private(set) var desk: TradeWizardModel?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var refreshCount = 0

    public var relayBaseURL: URL?
    private let loader: LeagueContextLoader
    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    public init(loader: LeagueContextLoader) {
        self.loader = loader
    }

    public var context: LeagueContext? { desk?.context }

    public func load(leagueID: String, userRosterID: Int, season: Int? = nil, force: Bool = false) async {
        lastRequest = (leagueID, userRosterID, season)
        await build(prefill: nil, force: force)
    }

    public func refresh() async {
        await build(prefill: nil, force: true)
        if errorMessage == nil, let context, !Freshness.isDegraded(context.provenance) { refreshCount += 1 }
    }

    /// Starts a fresh deal pointed at a need, a team or a player.
    public func open(_ prefill: TradeWizardPrefill?) async {
        await build(prefill: prefill, force: false)
    }

    /// Starts over on the current rosters.
    public func startOver() async {
        await build(prefill: nil, force: false)
    }

    private func build(prefill: TradeWizardPrefill?, force: Bool) async {
        guard let request = lastRequest else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let context = try await loader.load(
                leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: force
            )
            // Local inference on a home GPU takes seconds, not milliseconds.
            let relay = relayBaseURL.map { RelayClient(baseURL: $0, transport: URLSessionTransport(timeout: 90)) }
            let desk = TradeWizardModel(context: context, relay: relay, prefill: prefill)
            self.desk = desk
            await desk.prepare()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
