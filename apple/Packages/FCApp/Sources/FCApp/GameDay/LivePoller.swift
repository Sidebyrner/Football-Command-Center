import SwiftUI
import FCCore
import FCData

/// When to poll during a week of games. One loop drives every live number in
/// the app — Matchup's points and the week's game states — so nothing polls
/// twice, and outside game windows it barely wakes.
public enum LivePoller {
    /// While any game may be on.
    public static let liveInterval: Duration = .seconds(60)
    /// The longest it sleeps between checks when nothing is on.
    public static let idleCap: Duration = .seconds(15 * 60)
    /// Never sooner than this, so a kickoff a second away doesn't spin.
    public static let minimum: Duration = .seconds(30)

    /// Whether a game may be on: a kickoff within its live window (kickoff to
    /// four hours after), unless Sleeper already calls every such game final.
    public static func anyGameLive(kickoffs: [Date], games: [SleeperGameScore], now: Date) -> Bool {
        let window = KickoffCalendar.liveWindow
        let started = kickoffs.filter { $0 <= now && now < $0.addingTimeInterval(window) }
        guard !started.isEmpty else { return games.contains { $0.status == .inProgress } }
        // Every game that kicked off in the window is final: nothing left live.
        let inWindow = games.filter { g in g.startTime.map { $0 <= now && now < $0.addingTimeInterval(window) } ?? false }
        if !inWindow.isEmpty, inWindow.allSatisfy({ $0.status == .complete }) { return false }
        return true
    }

    /// How long to sleep before the next check: a minute while games are on,
    /// otherwise until the next kickoff, capped so a changed schedule is
    /// noticed.
    public static func nextDelay(kickoffs: [Date], games: [SleeperGameScore], now: Date) -> Duration {
        if anyGameLive(kickoffs: kickoffs, games: games, now: now) { return liveInterval }
        guard let next = kickoffs.filter({ $0 > now }).min() else { return idleCap }
        let wait = Duration.seconds(next.timeIntervalSince(now))
        return min(max(wait, minimum), idleCap)
    }
}

private struct LiveUpdates: ViewModifier {
    let matchup: MatchupModel
    let gameDay: GameDayModel
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.task(id: scenePhase) {
            // Paused in the background; the task restarts on return.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                let delay: Duration
                if let context = gameDay.context ?? matchup.context {
                    delay = LivePoller.nextDelay(kickoffs: context.kickoffs.lockWindows(week: context.currentWeek),
                                                 games: gameDay.games, now: context.now())
                } else {
                    delay = LivePoller.liveInterval
                }
                try? await Task.sleep(for: delay)
                guard !Task.isCancelled else { break }
                async let points: Bool = matchup.liveTick()
                async let scores: Bool = gameDay.tick()
                _ = await (points, scores)
            }
        }
    }
}

extension View {
    /// Keeps live scores current while the app is in front: one loop for the
    /// whole app. Apply once, at the root.
    func liveUpdates(_ services: AppServices) -> some View {
        modifier(LiveUpdates(matchup: services.matchup, gameDay: services.gameDay))
    }
}
