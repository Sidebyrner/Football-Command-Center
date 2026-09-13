import SwiftUI

/// Lets a screen send the user to another tab — "Fix in Sit/Start", "open
/// Matchup" — without holding a reference to the shell.
public struct OpenScreenAction: Sendable {
    let handler: @MainActor @Sendable (RootView.Screen) -> Void

    @MainActor
    public func callAsFunction(_ screen: RootView.Screen) {
        handler(screen)
    }
}

private struct OpenScreenKey: EnvironmentKey {
    static let defaultValue = OpenScreenAction { _ in }
}

public extension EnvironmentValues {
    var openScreen: OpenScreenAction {
        get { self[OpenScreenKey.self] }
        set { self[OpenScreenKey.self] = newValue }
    }
}
