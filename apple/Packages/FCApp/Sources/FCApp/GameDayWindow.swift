import Foundation
import FCCore
import FCData

/// The hours around kickoffs when things change fast enough to justify
/// re-reading data more often than usual.
public enum GameDayWindow {
    /// Inactives and final injury designations land in the hours before a game.
    public static let before: TimeInterval = 6 * 60 * 60
    /// Games run long; stat corrections and late news trail them.
    public static let after: TimeInterval = 4 * 60 * 60

    /// How young the player index — and so the injury tags — must be inside the
    /// window. Sleeper asks for the 5 MB file at most once a day; this allows a
    /// handful of extra downloads on a game day and none on any other day.
    public static let gameDayPlayerIndexMaxAge: TimeInterval = 3 * 60 * 60

    /// Whether `now` falls within `before` of some kickoff this week, or `after`
    /// of it.
    public static func isActive(kickoffs: KickoffCalendar, week: Int, now: Date) -> Bool {
        kickoffs.lockWindows(week: week).contains { kickoff in
            now >= kickoff.addingTimeInterval(-before) && now <= kickoff.addingTimeInterval(after)
        }
    }

    public static func playerIndexMaxAge(kickoffs: KickoffCalendar, week: Int, now: Date) -> TimeInterval {
        isActive(kickoffs: kickoffs, week: week, now: now) ? gameDayPlayerIndexMaxAge : CacheTTL.players
    }
}
