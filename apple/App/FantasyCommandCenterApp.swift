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
            RootView(services: composition.services, router: composition.router)
        }
        #if os(macOS)
        .defaultSize(width: 1_280, height: 820)
        .windowResizability(.contentMinSize)
        #endif
        .commands {
            WorkspaceCommands(router: composition.router, store: composition.services.workspaces)
        }
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
    let services: AppServices
    let router: AppRouter

    /// Where refreshed nflverse files are published. Paths under it mirror
    /// `public/data` (`weekly/index.json`, `schedule-2026.json`, …).
    static let dataHost = URL(string: "https://raw.githubusercontent.com/Sidebyrner/Football-Command-Center/data/")

    /// Debug-only `-FCCTab <screen>` opens a specific tab, and
    /// `-FCCTab workspace:<preset-id>` a workspace, for screenshots and UI
    /// tests. Release builds always open on the Dashboard.
    static func initialSelection(in store: WorkspaceStore) -> SidebarItem {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let flag = arguments.firstIndex(of: "-FCCTab"), arguments.indices.contains(flag + 1) {
            let value = arguments[flag + 1]
            if value.hasPrefix("workspace:") {
                let presetID = String(value.dropFirst("workspace:".count))
                if let workspace = store.workspaces.first(where: { $0.presetID == presetID }) {
                    return .workspace(workspace.id)
                }
            } else if let screen = RootView.Screen(argument: value) {
                return .screen(screen)
            }
        }
        #endif
        return .screen(.dashboard)
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
            self.services = AppServices(
                sleeper: sleeper, staticData: staticData, settingsStore: settingsStore,
                workspacePersistence: InMemoryWorkspacePersistence(), now: Composition.clock
            )
            self.router = AppRouter(selection: Composition.initialSelection(in: services.workspaces))
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
        self.services = AppServices(
            sleeper: sleeper, staticData: staticData, settingsStore: settingsStore, now: Composition.clock
        )
        self.router = AppRouter(selection: Composition.initialSelection(in: services.workspaces))
    }
}

/// The Workspace menu: lock and unlock, add a panel, make a new workspace.
struct WorkspaceCommands: Commands {
    @ObservedObject var router: AppRouter
    @ObservedObject var store: WorkspaceStore

    private var inWorkspace: Bool { router.selection.workspaceID != nil }

    var body: some Commands {
        CommandMenu("Workspace") {
            Button(router.workspaceEditing ? "Lock Layout" : "Edit Layout") {
                router.workspaceEditing.toggle()
                if !router.workspaceEditing { router.selectedPanelID = nil; store.flush() }
            }
            .keyboardShortcut("e", modifiers: .command)
            .disabled(!inWorkspace)

            Button("Add Panel…") {
                router.workspaceEditing = true
                router.showPanelLibrary = true
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(!inWorkspace)

            Divider()

            Button("New Workspace") {
                let workspace = store.addEmpty()
                router.open(workspace: workspace.id)
                router.workspaceEditing = true
                router.showPanelLibrary = true
            }
            .keyboardShortcut("n", modifiers: [.command, .shift])

            Menu("New From Preset") {
                ForEach(WorkspacePresets.all) { preset in
                    Button(preset.name) {
                        let workspace = store.add(preset: preset)
                        router.open(workspace: workspace.id)
                    }
                }
            }

            if !store.workspaces.isEmpty {
                Divider()
                ForEach(Array(store.workspaces.prefix(9).enumerated()), id: \.element.id) { index, workspace in
                    Button(workspace.name) { router.open(workspace: workspace.id) }
                        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: [.command, .option])
                }
            }
        }
    }
}
