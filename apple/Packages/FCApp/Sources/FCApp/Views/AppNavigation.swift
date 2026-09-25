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

/// Opens the Trade Desk, optionally pointed at a need, team or player —
/// "Trade for…" from a player card or any row.
public struct OpenTradeAction: Sendable {
    let handler: @MainActor @Sendable (TradeWizardPrefill?) -> Void

    @MainActor
    public func callAsFunction(_ prefill: TradeWizardPrefill? = nil) {
        handler(prefill)
    }
}

private struct OpenTradeKey: EnvironmentKey {
    static let defaultValue = OpenTradeAction { _ in }
}

public extension EnvironmentValues {
    var openTrade: OpenTradeAction {
        get { self[OpenTradeKey.self] }
        set { self[OpenTradeKey.self] = newValue }
    }
}
