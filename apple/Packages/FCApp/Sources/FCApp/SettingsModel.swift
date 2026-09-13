import Foundation
import FCCore
import FCData

/// The username → league pick flow named in step 2 of the build order.
///
/// Uncached on purpose at both steps: a user who mistyped their username and
/// retypes it expects a fresh answer, not their own typo played back from a
/// cache (see `SleeperService.user(username:)`).
@MainActor
public final class SettingsModel: ObservableObject {
    public enum Stage: Hashable, Sendable {
        case needsUsername
        case pickingLeague
        case pickingTeam
        case ready
    }

    @Published public private(set) var stage: Stage = .needsUsername
    @Published public var username: String = ""
    @Published public private(set) var leagues: [SleeperLeague] = []
    @Published public private(set) var teams: [(rosterID: Int, manager: String)] = []
    @Published public private(set) var isWorking = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var settings: AppSettings

    private let sleeper: SleeperService
    private let store: AppSettingsStore

    public init(sleeper: SleeperService, store: AppSettingsStore) {
        self.sleeper = sleeper
        self.store = store
        let loaded = store.load()
        self.settings = loaded
        self.username = loaded.sleeperUsername ?? ""
        self.stage = loaded.isConfigured ? .ready : .needsUsername
    }

    /// Looks up the user, then their leagues for the current season.
    public func lookUpUser() async {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Enter your Sleeper username."
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        do {
            let user = try await sleeper.user(username: trimmed)
            let season = try await currentSeason()
            let found = try await sleeper.leagues(userID: user.userID, season: season)

            settings.sleeperUsername = trimmed
            settings.userID = user.userID
            store.save(settings)

            leagues = found
            if found.isEmpty {
                // A real answer, not a failure — say which season was searched
                // rather than leaving them guessing.
                errorMessage = "No leagues found for \(trimmed) in \(season)."
                stage = .needsUsername
            } else {
                stage = .pickingLeague
            }
        } catch {
            errorMessage = Self.message(for: error, username: trimmed)
            stage = .needsUsername
        }
    }

    /// Picks a league and loads its rosters so the user can say which team is
    /// theirs. Sleeper's own user id usually identifies it, so the matching
    /// roster is offered first rather than making them hunt.
    public func selectLeague(_ league: SleeperLeague) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        settings.leagueID = league.leagueID
        store.save(settings)

        do {
            let rosters = try await sleeper.rosters(leagueID: league.leagueID)
            let members = try await sleeper.members(leagueID: league.leagueID)
            let names = Dictionary(
                members.value.map { ($0.userID, $0.label) }, uniquingKeysWith: { first, _ in first }
            )

            teams = rosters.value
                .map { roster in
                    (
                        rosterID: roster.rosterID,
                        manager: roster.ownerID.flatMap { names[$0] } ?? "Roster \(roster.rosterID)"
                    )
                }
                .sorted { $0.rosterID < $1.rosterID }

            // If we can tell which roster is theirs, take it and skip a step.
            if let userID = settings.userID,
               let mine = rosters.value.first(where: { $0.ownerID == userID }) {
                selectTeam(rosterID: mine.rosterID)
            } else {
                stage = .pickingTeam
            }
        } catch {
            errorMessage = String(describing: error)
            stage = .pickingLeague
        }
    }

    public func selectTeam(rosterID: Int) {
        settings.rosterID = rosterID
        store.save(settings)
        stage = .ready
    }

    /// Clears the league selection but keeps the username, which is what
    /// "switch league" means in practice.
    public func changeLeague() {
        settings.leagueID = nil
        settings.rosterID = nil
        store.save(settings)
        leagues = []
        teams = []
        stage = .needsUsername
    }

    public func setRelayURL(_ url: URL?) {
        settings.relayBaseURL = url
        store.save(settings)
    }

    private func currentSeason() async throws -> Int {
        if let season = try? await sleeper.nflState().value.seasonYear { return season }
        return Calendar.current.component(.year, from: Date())
    }

    /// A 404 here means the username does not exist, which is worth saying
    /// plainly — it is by far the most common thing to go wrong in setup.
    static func message(for error: Error, username: String) -> String {
        if case DataLayerError.httpStatus(let code, _) = error, code == 404 {
            return "Sleeper has no user called \"\(username)\"."
        }
        return String(describing: error)
    }
}
