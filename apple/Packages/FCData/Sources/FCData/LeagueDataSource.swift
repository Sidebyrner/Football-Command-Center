import Foundation

/// Which fantasy platform hosts the user's league.
public enum LeagueProvider: String, Codable, Hashable, Sendable, CaseIterable {
    case sleeper
    case espn

    public var label: String {
        switch self {
        case .sleeper: return "Sleeper"
        case .espn: return "ESPN"
        }
    }
}

/// The league-specific reads a screen needs, in Sleeper's shapes.
///
/// Every screen was built on Sleeper's wire types, and they are good enough
/// shapes — a roster is a list of player ids in slot order whichever platform
/// hosts it. So a second provider translates *into* them rather than the whole
/// app learning a second dialect. Everything league-independent (the player
/// pool, projections, live scores, news) stays on `SleeperService`: it is
/// public and needs no account, so an ESPN user gets it too.
public protocol LeagueDataSource: Sendable {
    func league(id: String, force: Bool) async throws -> Fetched<SleeperLeague>
    func rosters(leagueID: String, force: Bool) async throws -> Fetched<[SleeperRoster]>
    func members(leagueID: String, force: Bool) async throws -> Fetched<[SleeperLeagueMember]>
    func matchups(leagueID: String, week: Int, force: Bool) async throws -> Fetched<[SleeperMatchup]>
    func completedMatchups(leagueID: String, week: Int) async throws -> Fetched<[SleeperMatchup]>
    func transactions(leagueID: String, week: Int, force: Bool) async throws -> Fetched<[SleeperTransaction]>
    func drafts(leagueID: String, force: Bool) async throws -> Fetched<[SleeperDraft]>
    func draftPicks(draftID: String) async throws -> Fetched<[SleeperDraftPick]>
}

extension SleeperService: LeagueDataSource {}

// Protocol requirements cannot carry default arguments; these keep call sites
// as short as the concrete services' own.
public extension LeagueDataSource {
    func league(id: String) async throws -> Fetched<SleeperLeague> { try await league(id: id, force: false) }
    func rosters(leagueID: String) async throws -> Fetched<[SleeperRoster]> { try await rosters(leagueID: leagueID, force: false) }
    func members(leagueID: String) async throws -> Fetched<[SleeperLeagueMember]> { try await members(leagueID: leagueID, force: false) }
    func matchups(leagueID: String, week: Int) async throws -> Fetched<[SleeperMatchup]> {
        try await matchups(leagueID: leagueID, week: week, force: false)
    }
    func transactions(leagueID: String, week: Int) async throws -> Fetched<[SleeperTransaction]> {
        try await transactions(leagueID: leagueID, week: week, force: false)
    }
    func drafts(leagueID: String) async throws -> Fetched<[SleeperDraft]> { try await drafts(leagueID: leagueID, force: false) }
}

/// A source whose backing provider can change while the app runs.
///
/// Every model holds one of these from launch; switching provider in Settings
/// swaps what is behind it rather than rebuilding every screen model. A lock
/// rather than an actor so the swap itself is synchronous from the main actor.
public final class SwitchableLeagueSource: LeagueDataSource, @unchecked Sendable {
    private let lock = NSLock()
    private var backing: any LeagueDataSource

    public init(_ initial: any LeagueDataSource) {
        self.backing = initial
    }

    public var current: any LeagueDataSource {
        lock.lock(); defer { lock.unlock() }
        return backing
    }

    public func use(_ source: any LeagueDataSource) {
        lock.lock(); defer { lock.unlock() }
        backing = source
    }

    public func league(id: String, force: Bool) async throws -> Fetched<SleeperLeague> {
        try await current.league(id: id, force: force)
    }

    public func rosters(leagueID: String, force: Bool) async throws -> Fetched<[SleeperRoster]> {
        try await current.rosters(leagueID: leagueID, force: force)
    }

    public func members(leagueID: String, force: Bool) async throws -> Fetched<[SleeperLeagueMember]> {
        try await current.members(leagueID: leagueID, force: force)
    }

    public func matchups(leagueID: String, week: Int, force: Bool) async throws -> Fetched<[SleeperMatchup]> {
        try await current.matchups(leagueID: leagueID, week: week, force: force)
    }

    public func completedMatchups(leagueID: String, week: Int) async throws -> Fetched<[SleeperMatchup]> {
        try await current.completedMatchups(leagueID: leagueID, week: week)
    }

    public func transactions(leagueID: String, week: Int, force: Bool) async throws -> Fetched<[SleeperTransaction]> {
        try await current.transactions(leagueID: leagueID, week: week, force: force)
    }

    public func drafts(leagueID: String, force: Bool) async throws -> Fetched<[SleeperDraft]> {
        try await current.drafts(leagueID: leagueID, force: force)
    }

    public func draftPicks(draftID: String) async throws -> Fetched<[SleeperDraftPick]> {
        try await current.draftPicks(draftID: draftID)
    }
}
