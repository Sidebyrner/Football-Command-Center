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
        .defaultSize(width: 1_100, height: 760)
        #endif
    }
}

/// The composition root.
///
/// `StaticDataStore` is pointed at the app bundle, so the nflverse files
/// shipped at build time work on a first launch with no network. Give it a
/// `baseURL` to enable the 7-day conditional refresh described in §9 — until
/// the generated JSON has a stable HTTPS home, bundle-only is the honest
/// configuration rather than pointing at a URL that does not exist yet.
@MainActor
final class Composition: ObservableObject {
    let sleeper: SleeperService
    let staticData: StaticDataStore
    let settingsStore: AppSettingsStore

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
            baseURL: nil
        )
        self.settingsStore = UserDefaultsSettingsStore()
    }
}
