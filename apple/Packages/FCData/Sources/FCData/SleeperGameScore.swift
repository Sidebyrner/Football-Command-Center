import Foundation

/// One NFL game's live state, from Sleeper's undocumented
/// `/scores/nfl/regular/{season}/{week}`: score, quarter and clock, who has
/// the ball, and the pregame line. Flattened from Sleeper's `metadata` so it
/// caches as plain Codable; every field but the teams is optional because a
/// game before kickoff sends nulls and empty strings.
public struct SleeperGameScore: Codable, Hashable, Sendable {
    public enum Status: String, Codable, Sendable {
        case pregame, inProgress, complete
    }

    public let gameID: String
    public let week: Int?
    public let status: Status
    /// Kickoff.
    public let startTime: Date?
    public let home: String
    public let away: String
    public let homeScore: Int?
    public let awayScore: Int?
    /// "1"–"4", "OT", "HT", "F"; empty before kickoff.
    public let quarter: String?
    public let quarterNumber: Int?
    /// "7:42".
    public let timeRemaining: String?
    /// The team with the ball.
    public let possession: String?
    /// "3rd & 4".
    public let downAndDistance: String?
    public let yardLine: String?
    public let yardLineTerritory: String?
    public let isRedZone: Bool
    /// Points each team is favoured by, negative for the favourite.
    public let spread: [String: Double]
    /// Pregame win chance per team, 0–100, from the moneyline.
    public let winChance: [String: Double]
    public let forecastWindMph: Double?
    public let forecastTempHigh: Double?
    public let forecastDescription: String?
    public let channel: String?
    public let updatedAt: Date?

    public init(
        gameID: String, week: Int?, status: Status, startTime: Date?, home: String, away: String,
        homeScore: Int? = nil, awayScore: Int? = nil, quarter: String? = nil, quarterNumber: Int? = nil,
        timeRemaining: String? = nil, possession: String? = nil, downAndDistance: String? = nil,
        yardLine: String? = nil, yardLineTerritory: String? = nil, isRedZone: Bool = false,
        spread: [String: Double] = [:], winChance: [String: Double] = [:], forecastWindMph: Double? = nil,
        forecastTempHigh: Double? = nil, forecastDescription: String? = nil, channel: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.gameID = gameID
        self.week = week
        self.status = status
        self.startTime = startTime
        self.home = home
        self.away = away
        self.homeScore = homeScore
        self.awayScore = awayScore
        self.quarter = quarter
        self.quarterNumber = quarterNumber
        self.timeRemaining = timeRemaining
        self.possession = possession
        self.downAndDistance = downAndDistance
        self.yardLine = yardLine
        self.yardLineTerritory = yardLineTerritory
        self.isRedZone = isRedZone
        self.spread = spread
        self.winChance = winChance
        self.forecastWindMph = forecastWindMph
        self.forecastTempHigh = forecastTempHigh
        self.forecastDescription = forecastDescription
        self.channel = channel
        self.updatedAt = updatedAt
    }

    public func involves(_ team: String) -> Bool { home == team || away == team }
    public func opponent(of team: String) -> String? { home == team ? away : away == team ? home : nil }
    public func score(of team: String) -> Int? { home == team ? homeScore : away == team ? awayScore : nil }
}

// MARK: - Sleeper's wire shape

/// The response as Sleeper sends it, mapped to `SleeperGameScore`. Tolerant:
/// numbers may come as numbers or strings, and pregame fields are null or "".
struct SleeperGameScoreWire: Decodable {
    let gameID: String
    let week: Int?
    let status: String?
    let startTime: Double?
    let updatedAt: Double?
    let metadata: Metadata?

    enum CodingKeys: String, CodingKey {
        case gameID = "game_id", week, status, startTime = "start_time", updatedAt = "updated_at", metadata
    }

    struct Metadata: Decodable {
        let homeTeam: String?
        let awayTeam: String?
        let homeScore: LossyNumber?
        let awayScore: LossyNumber?
        let quarter: String?
        let quarterNum: LossyNumber?
        let timeRemaining: String?
        let possession: String?
        let downAndDistance: String?
        let yardLine: LossyString?
        let yardLineTerritory: String?
        let redZone: LossyString?
        let isInProgress: Bool?
        let isOver: Bool?
        let spread: [String: LossyNumber]?
        let moneyline: [String: LossyNumber]?
        let forecastWindSpeed: LossyNumber?
        let forecastTempHigh: LossyNumber?
        let forecastDescription: String?
        let channel: String?

        enum CodingKeys: String, CodingKey {
            case homeTeam = "home_team", awayTeam = "away_team", homeScore = "home_score", awayScore = "away_score"
            case quarter, quarterNum = "quarter_num", timeRemaining = "time_remaining", possession
            case downAndDistance = "down_and_distance", yardLine = "yard_line", yardLineTerritory = "yard_line_territory"
            case redZone = "red_zone", isInProgress = "is_in_progress", isOver = "is_over", spread, moneyline
            case forecastWindSpeed = "forecast_wind_speed", forecastTempHigh = "forecast_temp_high"
            case forecastDescription = "forecast_description", channel
        }
    }

    /// `nil` when the game can't be placed (no teams).
    var score: SleeperGameScore? {
        guard let m = metadata, let home = m.homeTeam, let away = m.awayTeam else { return nil }
        let status: SleeperGameScore.Status
        if m.isOver == true || self.status == "complete" {
            status = .complete
        } else if m.isInProgress == true || self.status == "in_progress" {
            status = .inProgress
        } else {
            status = .pregame
        }
        func blank(_ s: String?) -> String? { (s?.isEmpty ?? true) ? nil : s }
        func teams(_ map: [String: LossyNumber]?) -> [String: Double] {
            (map ?? [:]).reduce(into: [:]) { out, pair in
                if pair.key != "updated_at", let v = pair.value.value { out[pair.key] = v }
            }
        }
        let redZone = m.redZone?.value.map { !["", "0", "false"].contains($0.lowercased()) } ?? false
        return SleeperGameScore(
            gameID: gameID, week: week, status: status,
            startTime: startTime.map { Date(timeIntervalSince1970: $0 / 1000) },
            home: home, away: away,
            homeScore: m.homeScore?.value.map { Int($0) }, awayScore: m.awayScore?.value.map { Int($0) },
            quarter: blank(m.quarter), quarterNumber: m.quarterNum?.value.map { Int($0) },
            timeRemaining: blank(m.timeRemaining), possession: blank(m.possession),
            downAndDistance: blank(m.downAndDistance), yardLine: blank(m.yardLine?.value),
            yardLineTerritory: blank(m.yardLineTerritory), isRedZone: status == .inProgress && redZone,
            spread: teams(m.spread), winChance: teams(m.moneyline),
            forecastWindMph: m.forecastWindSpeed?.value, forecastTempHigh: m.forecastTempHigh?.value,
            forecastDescription: blank(m.forecastDescription), channel: blank(m.channel),
            updatedAt: updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        )
    }
}

/// A number Sleeper may send as a number, a numeric string, "" or null.
struct LossyNumber: Decodable {
    let value: Double?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let d = try? c.decode(Double.self) { value = d }
        else if let s = try? c.decode(String.self) { value = Double(s) }
        else { value = nil }
    }
}

/// A string Sleeper may send as a string, a number or a bool.
struct LossyString: Decodable {
    let value: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let d = try? c.decode(Double.self) { value = String(Int(d)) }
        else if let b = try? c.decode(Bool.self) { value = b ? "true" : "false" }
        else { value = nil }
    }
}
