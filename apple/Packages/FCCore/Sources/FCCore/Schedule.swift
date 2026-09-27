import Foundation

/// One scheduled game.
///
/// `spreadLine` and `totalLine` are **recorded closing lines** — free, no API
/// key, and they do not move during the week. They are the fallback whenever the
/// paid odds key is absent and must be labelled as recorded in the UI so they
/// are never mistaken for live lines (§3.2).
public struct ScheduledGame: Codable, Hashable, Sendable {
    public let home: String?
    public let away: String?
    public let kickoff: String?
    public let time: String?
    public let spreadLine: Double?
    public let totalLine: Double?

    public func opponent(of team: String) -> String? {
        if home == team { return away }
        if away == team { return home }
        return nil
    }
}

/// `public/data/schedule-{season}.json`.
///
/// Team codes are whatever the schedule uses — the nflverse dialect, `LA` not
/// `LAR` — so callers joining from Sleeper ids must run `NFLTeams.nflverse`
/// first.
public struct ScheduleFile: Decodable, Sendable {
    /// Keyed by week as a string, because that is how JSON objects key.
    public let byWeek: [String: [ScheduledGame]]
    public let fileMeta: FileMeta?

    enum CodingKeys: String, CodingKey {
        case byWeek
        case fileMeta = "_meta"
    }

    public struct FileMeta: Decodable, Sendable {
        public let generated: String?
        public let season: Int?
        public let games: Int?
        public let weeks: [Int]?
        public let source: String?
    }

    public struct Week: Sendable {
        public let week: Int
        public let games: [ScheduledGame]
    }

    /// Weeks in ascending numeric order, with their games.
    public var weeksAscending: [Week] {
        byWeek
            .compactMap { key, games in Int(key).map { Week(week: $0, games: games) } }
            .sorted { $0.week < $1.week }
    }

    public func games(week: Int) -> [ScheduledGame] { byWeek[String(week)] ?? [] }
}
