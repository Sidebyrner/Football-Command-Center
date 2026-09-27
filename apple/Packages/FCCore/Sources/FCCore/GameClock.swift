import Foundation

public extension ScheduledGame {
    /// The schedule's kickoff times are US Eastern — nfldata's `gametime`. Week 1
    /// of 2025's Thursday game is listed at 20:20, which is the 8:20pm ET
    /// broadcast slot.
    static let scheduleTimeZone = TimeZone(identifier: "America/New_York")!

    /// Kickoff as an absolute instant, or `nil` when the date or time is missing
    /// or malformed. Parsed through a calendar in the schedule's time zone, so
    /// the daylight-saving change in early November is handled.
    var kickoffDate: Date? {
        guard let kickoff, let time else { return nil }
        let day = kickoff.split(separator: "-").compactMap { Int($0) }
        let clock = time.split(separator: ":").compactMap { Int($0) }
        guard day.count == 3, clock.count >= 2 else { return nil }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = Self.scheduleTimeZone
        return calendar.date(from: DateComponents(
            year: day[0], month: day[1], day: day[2], hour: clock[0], minute: clock[1]
        ))
    }
}

/// When each team's game kicks off, week by week.
///
/// Sleeper locks a player's lineup slot at his game's kickoff, so this is what
/// tells the app which moves are still possible. A recommendation to start or
/// sit someone whose game has begun is not advice — Sleeper would reject it.
public struct KickoffCalendar: Hashable, Sendable {
    /// Week → nflverse team code → kickoff.
    private let byWeek: [Int: [String: Date]]

    /// How long after kickoff a game counts as possibly still in progress.
    /// Deliberately generous: overtime and long reviews run past three hours,
    /// and treating a finished game as live costs a few extra refreshes while
    /// the reverse would miss scoring.
    public static let liveWindow: TimeInterval = 4 * 60 * 60

    public init(schedule: ScheduleFile) {
        var out: [Int: [String: Date]] = [:]
        for week in schedule.weeksAscending {
            for game in week.games {
                guard let date = game.kickoffDate else { continue }
                if let home = game.home { out[week.week, default: [:]][home] = date }
                if let away = game.away { out[week.week, default: [:]][away] = date }
            }
        }
        byWeek = out
    }

    /// A team's kickoff that week. Sleeper team codes are normalised (`LAR` →
    /// `LA`). `nil` for a team on bye or not in the schedule.
    public func kickoff(team: String?, week: Int) -> Date? {
        guard let team = NFLTeams.nflverse(team) else { return nil }
        return byWeek[week]?[team]
    }

    /// Whether a team's game has kicked off, locking its players' slots.
    /// A team with no game that week is never locked.
    public func isLocked(team: String?, week: Int, now: Date) -> Bool {
        guard let kickoff = kickoff(team: team, week: week) else { return false }
        return now >= kickoff
    }

    /// Whether a team's game may be in progress right now.
    public func isLive(team: String?, week: Int, now: Date) -> Bool {
        guard let kickoff = kickoff(team: team, week: week) else { return false }
        return now >= kickoff && now < kickoff.addingTimeInterval(Self.liveWindow)
    }

    /// The distinct kickoff times in a week, soonest first — the moments at
    /// which some lineup slots lock.
    public func lockWindows(week: Int) -> [Date] {
        Array(Set(byWeek[week]?.values.map { $0 } ?? [])).sorted()
    }

    /// The next kickoff after `now` among the given teams, if any.
    public func nextLock(week: Int, teams: [String?], now: Date) -> Date? {
        teams
            .compactMap { kickoff(team: $0, week: week) }
            .filter { $0 > now }
            .min()
    }
}
