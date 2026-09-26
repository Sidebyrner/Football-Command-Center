import Foundation
import FCCore
import FCData

/// This week's NFL games with their live state — score, quarter, clock, who
/// has the ball — from Sleeper's scores route. The Board's games tile and
/// live matchup read it; the shared live poller ticks it during games.
@MainActor
public final class GameDayModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var games: [SleeperGameScore] = []
    @Published public private(set) var isLoading = false
    /// Set when the scores route fails; the tiles fall back to matchup points.
    @Published public private(set) var unavailable = false
    @Published public private(set) var lastUpdate: Date?

    /// Said wherever these numbers are shown.
    public static let source = "Sleeper scores (undocumented)"

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService
    private var lastRequest: (leagueID: String, rosterID: Int)?

    public init(loader: LeagueContextLoader, sleeper: SleeperService) {
        self.loader = loader
        self.sleeper = sleeper
    }

    public func load(leagueID: String, userRosterID: Int, force: Bool = false) async {
        lastRequest = (leagueID, userRosterID)
        isLoading = true
        defer { isLoading = false }
        guard let context = try? await loader.load(leagueID: leagueID, userRosterID: userRosterID, force: force) else {
            return
        }
        self.context = context
        await fetch(context: context, force: force)
    }

    /// Re-reads the scores while any game this week may be on. Returns whether
    /// it polled.
    @discardableResult
    public func tick() async -> Bool {
        guard let context, LivePoller.anyGameLive(kickoffs: context.kickoffs.lockWindows(week: context.currentWeek),
                                                  games: games, now: context.now()) else { return false }
        await fetch(context: context, force: true)
        return true
    }

    private func fetch(context: LeagueContext, force: Bool) async {
        do {
            let fetched = try await sleeper.scores(season: context.scheduleSeason, week: context.currentWeek, force: force)
            if games != fetched.value { games = fetched.value }
            unavailable = false
            lastUpdate = context.now()
        } catch {
            unavailable = games.isEmpty
        }
    }

    public var anyLive: Bool { games.contains { $0.status == .inProgress } }
}

/// One NFL game and the fantasy starters in it, from both sides of the
/// matchup.
public struct GameWithPlayers: Identifiable, Hashable, Sendable {
    public let game: SleeperGameScore
    public let mine: [MatchupRow]
    public let theirs: [MatchupRow]
    public var id: String { game.gameID }

    /// Live games first, then the next kickoffs, then finals.
    static func order(_ a: GameWithPlayers, _ b: GameWithPlayers) -> Bool {
        func rank(_ s: SleeperGameScore.Status) -> Int {
            switch s {
            case .inProgress: return 0
            case .pregame: return 1
            case .complete: return 2
            }
        }
        let (ra, rb) = (rank(a.game.status), rank(b.game.status))
        if ra != rb { return ra < rb }
        let (ka, kb) = (a.game.startTime ?? .distantFuture, b.game.startTime ?? .distantFuture)
        if ka != kb { return ra == 2 ? ka > kb : ka < kb }
        return a.game.gameID < b.game.gameID
    }
}

public enum GameDay {
    /// The games your starters or your opponent's play in, each with those
    /// players. Team codes are joined in nflverse spelling (Sleeper's `LAR`
    /// is `LA` on the rows).
    public static func pair(games: [SleeperGameScore], mine: [MatchupRow], theirs: [MatchupRow]) -> [GameWithPlayers] {
        func code(_ team: String) -> String { NFLTeams.nflverseAliases[team] ?? team }
        func rows(_ rows: [MatchupRow], in game: SleeperGameScore) -> [MatchupRow] {
            let teams = [code(game.home), code(game.away)]
            return rows.filter { row in row.nflTeam.map { teams.contains(code($0)) } ?? false }
        }
        return games
            .map { GameWithPlayers(game: $0, mine: rows(mine, in: $0), theirs: rows(theirs, in: $0)) }
            .filter { !$0.mine.isEmpty || !$0.theirs.isEmpty }
            .sorted(by: GameWithPlayers.order)
    }

    /// "Q3 7:42", "Half", "Final", "Final/OT" or the kickoff time.
    public static func clock(_ game: SleeperGameScore, now: Date = Date()) -> String {
        switch game.status {
        case .complete:
            return (game.quarterNumber ?? 4) > 4 || game.quarter == "OT" ? "Final/OT" : "Final"
        case .inProgress:
            if game.quarter == "HT" || game.quarter?.lowercased() == "half" { return "Half" }
            let q = game.quarter.map { Int($0) != nil ? "Q\($0)" : $0 } ?? ""
            return [q, game.timeRemaining ?? ""].filter { !$0.isEmpty }.joined(separator: " ")
        case .pregame:
            guard let start = game.startTime else { return "Scheduled" }
            return LockCountdown.kickoffLabel(start)
        }
    }
}
