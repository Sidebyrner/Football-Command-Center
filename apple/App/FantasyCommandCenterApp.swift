import SwiftUI
import FCApp
import FCData

/// The app target is deliberately thin: it builds the three dependencies and
/// hands them to `RootView`. Everything else lives in the packages, which is
/// what lets the whole app be tested without a simulator.
@main
struct FantasyCommandCenterApp: App {
    @StateObject private var composition = Composition()

    var body: some Scene {
        WindowGroup {
            RootView(
                sleeper: composition.sleeper,
                staticData: composition.staticData,
                settingsStore: composition.settingsStore,
                initialScreen: Composition.initialScreen,
                now: Composition.clock
            )
        }
        #if os(macOS)
        .defaultSize(width: 1_180, height: 780)
        .windowResizability(.contentMinSize)
        #endif
    }
}

/// The composition root.
///
/// `StaticDataStore` refreshes the nflverse files from the repo's `data` branch,
/// which a scheduled GitHub Action rebuilds from nflverse (§9). The copies bundled
/// at build time are the fallback: a first launch works with no network, and if
/// the data host is unreachable — or the branch doesn't exist yet — nothing
/// breaks; the screens just say the data shipped with the app.
@MainActor
final class Composition: ObservableObject {
    let sleeper: SleeperService
    let staticData: StaticDataStore
    let settingsStore: AppSettingsStore

    /// Where refreshed nflverse files are published. Paths under it mirror
    /// `public/data` (`weekly/index.json`, `schedule-2026.json`, …).
    static let dataHost = URL(string: "https://raw.githubusercontent.com/Sidebyrner/Football-Command-Center/data/")

    /// Debug-only `-FCCTab <screen>` opens a specific tab, for screenshots and
    /// UI tests. Release builds always open on the Dashboard.
    static var initialScreen: RootView.Screen {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let flag = arguments.firstIndex(of: "-FCCTab"), arguments.indices.contains(flag + 1),
           let screen = RootView.Screen(argument: arguments[flag + 1]) {
            return screen
        }
        #endif
        return .dashboard
    }

    /// The app's clock. Debug-only `-FCCNow <ISO8601>` fixes it; the demo league
    /// defaults to week 7's Sunday afternoon, so some games are locked.
    static var clock: @Sendable () -> Date {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let flag = arguments.firstIndex(of: "-FCCNow"), arguments.indices.contains(flag + 1),
           let fixed = ISO8601DateFormatter().date(from: arguments[flag + 1]) {
            return { fixed }
        }
        if DemoMode.isActive {
            let sundayAfternoon = ISO8601DateFormatter().date(from: "2025-10-19T18:30:00Z")!
            return { sundayAfternoon }
        }
        #endif
        return { Date() }
    }

    init() {
        #if DEBUG
        if DemoMode.isActive {
            let cache = DiskCache(directory: DemoMode.cacheDirectory())
            self.sleeper = SleeperService(
                client: SleeperClient(transport: DemoTransport(), retries: 0), cache: cache
            )
            self.staticData = StaticDataStore(
                bundle: .main, bundleSubdirectory: nil, cache: cache,
                transport: DemoTransport(), baseURL: nil
            )
            self.settingsStore = InMemorySettingsStore(DemoMode.settings)
            return
        }
        #endif

        let cache = DiskCache()
        self.sleeper = SleeperService(client: SleeperClient(), cache: cache)
        self.staticData = StaticDataStore(
            bundle: .main,
            bundleSubdirectory: nil,
            cache: cache,
            transport: URLSessionTransport(),
            baseURL: Composition.dataHost
        )
        self.settingsStore = UserDefaultsSettingsStore()
    }
}
