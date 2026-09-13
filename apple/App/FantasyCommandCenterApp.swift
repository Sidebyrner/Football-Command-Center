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
                settingsStore: composition.settingsStore
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

    init() {
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
