import Foundation
import FCCore
import FCData

/// One cell of the bye-crunch grid: what a team cannot field in a given week.
public struct CrunchCell: Hashable, Sendable, Identifiable {
    public let rosterID: Int
    public let week: Int
    public let report: CrunchReport

    public var id: String { "\(rosterID)-\(week)" }
    public var shortfall: Int { report.totalShortfall }
    public var isShort: Bool { report.totalShortfall > 0 }

    /// The positions actually short, for the cell's detail.
    public var shortPositions: [Position] {
        report.byPosition
            .filter { $0.value.shortfall > 0 }
            .keys
            .sorted { $0.rawValue < $1.rawValue }
    }
}

/// A row of the acquisition board.
public struct BoardRow: Hashable, Sendable, Identifiable {
    public let candidate: AcquisitionCandidate
    public let availability: Availability
    /// The player's Sleeper id, when the crosswalk knows it. `nil` for anyone
    /// the export has no row for.
    public let sleeperID: String?

    public var id: String { candidate.player.gsisID }
    public var name: String { candidate.player.name }
    public var position: Position { candidate.player.position }
    public var team: String? { candidate.player.team }
    public var signals: [SignalHit] { candidate.signals }
    public var valueOverStartLine: Double { candidate.valueOverStartLine }
}

/// The Planning screen's state.
///
/// Two halves and the link between them, which is the whole reason they share a
/// screen (§7.4): the grid says which weeks break, and selecting a shortfall
/// filters the board to players who can actually play that week.
@MainActor
public final class PlanningModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var grid: [CrunchCell] = []
    @Published public private(set) var board: [BoardRow] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    /// The week whose shortfall the user tapped. Filters the board to players
    /// not themselves on bye that week.
    @Published public var selectedWeek: Int? {
        didSet { rebuildBoard() }
    }

    /// Hide players already on the user's roster, which is the default — the
    /// board is about who to *get*.
    @Published public var excludeOwnPlayers = true {
        didSet { rebuildBoard() }
    }

    /// Which of the three jobs is on screen.
    @Published public var mode: PlanningMode = .byes

    @Published public private(set) var tradeTargets: [TradeTarget] = []
    @Published public private(set) var waiverFills: [PlanningPlayer] = []
    @Published public private(set) var waiverTrending: [PlanningPlayer] = []
    @Published public private(set) var bestAvailable: [PlanningPlayer] = []
    /// Set when trending adds could not be loaded, so the popularity-only
    /// sections can say why they are empty.
    @Published public private(set) var trendingUnavailable = false

    /// The relay the trade wizard polishes pitches through. Optional, like
    /// every relay feature.
    public var relayBaseURL: URL?

    /// League-wide trending adds, the only data covering DEF and IDP.
    private(set) var trending: [TrendingPlayer] = []

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService?

    /// - Parameter sleeper: for trending adds. Optional: without it the planner
    ///   still works on production data alone, and says the trending sections
    ///   are unavailable.
    public init(loader: LeagueContextLoader, sleeper: SleeperService? = nil) {
        self.loader = loader
        self.sleeper = sleeper
    }

    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    /// Re-reads everything that can change during a week. Wired to pull-to-refresh.
    public func refresh() async {
        guard let request = lastRequest else { return }
        await load(leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: true)
        // Only a refresh that actually reached Sleeper counts. A failed fetch
        // falls back to the cached copy, labelled offline — keeping the screen
        // useful, but not something to confirm with a success haptic.
        if errorMessage == nil, let context, !Freshness.isDegraded(context.provenance) {
            refreshCount += 1
        }
    }

    /// Bumped by each successful pull-to-refresh, so the screen can play a
    /// success haptic for a refresh without also playing one on first load.
    @Published public private(set) var refreshCount = 0

    public func load(leagueID: String, userRosterID: Int, season: Int? = nil, force: Bool = false) async {
        lastRequest = (leagueID, userRosterID, season)
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let context = try await loader.load(
                leagueID: leagueID, userRosterID: userRosterID, season: season, force: force
            )
            self.context = context
            self.grid = Self.buildGrid(context)
            rebuildBoard()

            if let sleeper, let adds = try? await sleeper.trendingAdds(force: force) {
                trending = adds.value
                trendingUnavailable = false
            } else {
                trending = []
                trendingUnavailable = true
            }
            tradeTargets = buildTradeTargets()
            waiverFills = buildWaiverFills()
            waiverTrending = buildWaiverTrending()
            bestAvailable = buildBestAvailable()
        } catch {
            // Name what failed. "Couldn't load" with no subject is the failure
            // mode §6 exists to prevent.
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Grid

    static func buildGrid(_ context: LeagueContext) -> [CrunchCell] {
        var cells: [CrunchCell] = []
        for team in context.teams {
            let outlook = ByeCrunch.outlook(
                roster: team.roster,
                template: context.template,
                calendar: context.byeCalendar,
                weeks: context.remainingWeeks
            )
            for (week, report) in outlook {
                cells.append(CrunchCell(rosterID: team.rosterID, week: week, report: report))
            }
        }
        return cells.sorted {
            $0.week == $1.week ? $0.rosterID < $1.rosterID : $0.week < $1.week
        }
    }

    public func cell(rosterID: Int, week: Int) -> CrunchCell? {
        grid.first { $0.rosterID == rosterID && $0.week == week }
    }

    /// The user's own row, which the screen breaks out above the rest.
    public func userRow() -> [CrunchCell] {
        guard let context else { return [] }
        return grid.filter { $0.rosterID == context.userRosterID }
    }

    /// Weeks where the user cannot field a legal lineup — the alarm the screen
    /// exists to raise.
    public func userShortWeeks() -> [CrunchCell] {
        userRow().filter(\.isShort)
    }

    /// Rivals who are *not* short in the same week, which is who the trade is
    /// actually available with (§7.4).
    public func tradePartners(week: Int) -> [LeagueTeam] {
        guard let context else { return [] }
        return context.rivals.filter { team in
            cell(rosterID: team.rosterID, week: week).map { !$0.isShort } ?? false
        }
    }

    // MARK: - Board

    func rebuildBoard() {
        guard let context else {
            board = []
            return
        }

        let candidates = AcquisitionSignals.board(
            players: context.seasonProfiles, baselines: context.baselines
        )

        board = candidates.compactMap { candidate -> BoardRow? in
            let sleeperID = context.sleeperIDsByGSIS[candidate.player.gsisID]
            let availability = context.availability(ofGSIS: candidate.player.gsisID)

            if excludeOwnPlayers && availability == .mine { return nil }

            // The link between the two halves: with a week selected, a player
            // on bye *that* week cannot solve that week, however good he is.
            if let week = selectedWeek,
               context.byeCalendar.isOnBye(team: candidate.player.team, week: week) {
                return nil
            }

            return BoardRow(
                candidate: candidate, availability: availability, sleeperID: sleeperID
            )
        }
    }

    /// What the screen says when a position in the starting lineup has no
    /// production data behind it. Stated plainly rather than papered over, and
    /// never as a zero (§3.2).
    public var coverageWarning: String? {
        guard let context, !context.unsupportedPositions.isEmpty else { return nil }
        let names = context.unsupportedPositions.map(\.rawValue).joined(separator: ", ")
        return "No production data exists for \(names). "
            + "Bye weeks for those slots are still accurate — they come from the schedule, "
            + "not from stats — but players there are only suggested from trending adds, "
            + "which measure popularity, not production."
    }

    /// The one freshness note for the whole screen, since it is assembled from
    /// several reads of differing age.
    public var freshnessLabel: String? {
        context.flatMap { Freshness.label(for: $0.provenance) }
    }
}
