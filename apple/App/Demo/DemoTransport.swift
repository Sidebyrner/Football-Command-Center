#if DEBUG
import Foundation
import FCApp
import FCData

/// Debug-only: run the app against a generated demo league with no network.
///
/// Launch with `-FCCDemoLeague` (the UI tests do). Everything a screen shows is
/// then reproducible — which is what lets layout bugs like the Matchup drift be
/// reproduced in a simulator, and screenshots be compared between changes.
enum DemoMode {
    static var isActive: Bool {
        ProcessInfo.processInfo.arguments.contains("-FCCDemoLeague")
    }

    /// Already configured, so the app opens straight onto the screens.
    /// `-FCCAccent <theme>` picks the accent, for comparing themes in screenshots.
    static var settings: AppSettings {
        let arguments = ProcessInfo.processInfo.arguments
        var accent = AccentTheme.default
        if let flag = arguments.firstIndex(of: "-FCCAccent"), arguments.indices.contains(flag + 1) {
            accent = AccentTheme(stored: arguments[flag + 1])
        }
        return AppSettings(
            sleeperUsername: "connor", userID: "u1", leagueID: "L1", rosterID: 1,
            accentTheme: accent
        )
    }

    /// `-FCCWatchlist id1,id2,…` starts the demo with those players on the
    /// watchlist, the first four compared — for UI tests and screenshots.
    /// Otherwise empty, and never iCloud's.
    static func watchlistStore() -> WatchlistStore {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "-FCCWatchlist"), arguments.indices.contains(flag + 1) else {
            return InMemoryWatchlistStore()
        }
        let ids = arguments[flag + 1].split(separator: ",").map(String.init)
        let start = Date(timeIntervalSince1970: 1_760_000_000)
        let entries = ids.enumerated().map { index, id in
            let added = start.addingTimeInterval(Double(index))
            return WatchlistEntry(playerID: id, addedAt: added, isComparing: index < WatchlistModel.compareLimit,
                                  comparedAt: index < WatchlistModel.compareLimit ? added : nil)
        }
        let snapshot = WatchlistSnapshot(entries: entries, modifiedAt: start)
        return InMemoryWatchlistStore([WatchlistModel.key(leagueID: settings.leagueID): snapshot])
    }

    /// A throwaway cache, so demo data can never leak into a real install's cache.
    static func cacheDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("fcc-demo-\(UUID().uuidString)", isDirectory: true)
    }
}

/// Serves `DemoLeagueData.routes` by URL path.
struct DemoTransport: HTTPTransport {
    /// A short delay, so loading states are visible rather than instantaneous.
    var latency: Duration = .milliseconds(250)

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        try await Task.sleep(for: latency)
        guard let path = request.url?.path, let body = DemoLeagueData.routes[path] else {
            return HTTPResponse(status: 404, body: Data("null".utf8))
        }
        return HTTPResponse(status: 200, body: Data(body.utf8))
    }
}
#endif
