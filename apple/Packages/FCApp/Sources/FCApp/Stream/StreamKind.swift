import Foundation
import FCCore
import FCData

/// Where one piece of a stream's game context came from, so the screen can say so.
public enum StreamContextSource: String, Codable, Hashable, Sendable {
    /// The schedule file's recorded closing lines.
    case schedule
    /// Points Sleeper's own lines show the opponent allowing at this position.
    case sleeperDvP
    /// A neutral default because nothing was known.
    case standard
    /// Typed in on the context editor.
    case manual
    /// From an imported context file.
    case imported

    public var label: String {
        switch self {
        case .schedule: return "Schedule lines"
        case .sleeperDvP: return "Sleeper DvP"
        case .standard: return "Default"
        case .manual: return "Edited"
        case .imported: return "Imported"
        }
    }
}

/// One NFL team's game this week, as a stream model sees it.
public protocol StreamTeamContext: Codable, Hashable, Sendable, Identifiable where ID == String {
    var team: String { get }
    var opponent: String { get }
    /// "@NYG" or "vs NYG".
    var opponentLabel: String { get }
    /// Positive when this team is the underdog.
    var spread: Double { get }
    var total: Double { get }
    var linesSource: StreamContextSource { get }
    var dvpSource: StreamContextSource { get }
}

/// A stream model's input for one player.
public protocol StreamCandidate: Codable, Hashable, Sendable, Identifiable where ID == String {
    var playerID: String? { get }
    var name: String { get }
}

/// A user's change to one team's or one player's inputs.
public protocol StreamOverride: Codable, Hashable, Sendable {
    var isEmpty: Bool { get }
}

/// Everything the user has changed for one week of one stream, persisted by
/// `StreamStore`.
public struct StreamWeekOverrides<TeamOverride: StreamOverride, PlayerOverride: StreamOverride>: Codable, Hashable, Sendable {
    public var teams: [String: TeamOverride] = [:]
    public var players: [String: PlayerOverride] = [:]
    /// The starter candidates are compared against; `nil` picks the weakest.
    public var incumbentID: String?

    public init(teams: [String: TeamOverride] = [:], players: [String: PlayerOverride] = [:], incumbentID: String? = nil) {
        self.teams = teams
        self.players = players
        self.incumbentID = incumbentID
    }

    public static var empty: Self { Self() }

    /// An import over what is already stored: imported values win, and
    /// nothing the import does not mention is touched.
    public func merging(_ incoming: Self) -> Self {
        var out = self
        for (team, change) in incoming.teams { out.teams[team] = change }
        for (id, change) in incoming.players { out.players[id] = change }
        return out
    }
}

/// What makes one stream — IDP, WR — different from another. Everything else
/// (loading, the starter to beat, compare, search, snapshots, edits) is shared
/// by `StreamScreenModel`.
public protocol StreamKind {
    associatedtype Candidate: StreamCandidate
    associatedtype Projection: StreamProjection
    associatedtype Scoring: Codable, Hashable, Sendable
    associatedtype Team: StreamTeamContext
    associatedtype TeamOverride: StreamOverride
    associatedtype PlayerOverride: StreamOverride
    associatedtype GameLine: Hashable, Sendable

    /// Folder under Application Support/FantasyCommandCenter.
    static var storeFolder: String { get }
    /// Slot positions this stream covers.
    static var positions: [Position] { get }
    /// "defender", "receiver".
    static var playerNoun: String { get }
    static var emptyScoring: Scoring { get }

    static func scoring(sleeperSettings: [String: Double]) -> Scoring
    static func unmodelledKeys(sleeperSettings: [String: Double]) -> [String]
    static func autofill(context: LeagueContext, defense: DefenseLookup) -> [String: Team]
    static func apply(_ overrides: [String: TeamOverride], to teams: [String: Team]) -> [String: Team]
    static func candidates(context: LeagueContext, teams: [String: Team],
                           players: [String: PlayerOverride], alwaysInclude: Set<String>) -> [Candidate]
    static func project(_ candidate: Candidate, scoring: Scoring, risk: StreamRiskMode) -> Projection
    static func recentGames(context: LeagueContext, playerID: String, limit: Int) -> [GameLine]
    /// The finer role for a player not yet projected, for picker rows.
    static func roleLabel(for player: IndexedPlayer) -> String?
    static func parseImport(_ data: Data) throws -> StreamWeekOverrides<TeamOverride, PlayerOverride>
    /// Notes specific to this stream's sources, shown under the list.
    static func sourceNotes(teams: [String: Team]) -> [String]
}

// MARK: - Practice status

/// The official report first — a game designation outranks a practice line —
/// then Sleeper's own injury tag. Shared by every stream.
enum StreamPracticeMapper {
    static func status(_ player: IndexedPlayer, context: LeagueContext) -> StreamPractice {
        if let report = context.practiceReport(sleeperID: player.id) {
            switch report.designation {
            case .out: return .OUT
            case .doubtful: return .D
            case .questionable: return .Q
            case nil: break
            }
            switch report.practice {
            case .didNotParticipate: return .DNP
            case .limited: return .LP
            case .full: return .FP
            case nil: break
            }
        }
        switch player.injuryStatus?.lowercased() {
        case "ir", "pup", "pup-r", "nfi", "nfi-r": return .IR
        case "out", "sus", "cov": return .OUT
        case "doubtful": return .D
        case "questionable": return .Q
        default: return .none
        }
    }
}

/// One row in the any-player pickers.
public struct StreamPickerRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let team: String?
    public let platform: Position?
    public let roleLabel: String?
    public let availability: Availability
    /// `nil` until he has been projected this session.
    public let projected: Double?
}
