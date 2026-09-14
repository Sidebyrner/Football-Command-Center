import Foundation
import FCCore
import FCData

/// Something the user can still do something about before kickoff.
///
/// Ordered by how much it costs to ignore: a starter on bye scores exactly
/// zero, an unset slot scores exactly zero, and an injury is a risk rather
/// than a certainty. That ordering is the web app's and it is the right one.
public struct LineupAlert: Hashable, Sendable, Identifiable {
    public enum Kind: Int, Hashable, Sendable {
        case onBye = 0
        case emptySlot = 1
        case injured = 2
    }

    public let kind: Kind
    public let playerID: String?
    public let playerName: String?
    public let detail: String
    /// For injury alerts: when Sleeper's player file — the source of the tag —
    /// was downloaded. A tag is only as current as that.
    public var asOf: Date? = nil

    public var id: String { "\(kind.rawValue)-\(playerID ?? detail)" }
}

/// One row of the league table.
public struct StandingsRow: Hashable, Sendable, Identifiable {
    public let rosterID: Int
    public let manager: String
    public let isUser: Bool
    public let wins: Int
    public let losses: Int
    public let ties: Int
    public let pointsFor: Double
    public let pointsAgainst: Double

    public var id: Int { rosterID }

    public var record: String {
        ties > 0 ? "\(wins)-\(losses)-\(ties)" : "\(wins)-\(losses)"
    }
}

/// What one week's lineup scored against the best that was available.
public struct BenchWeek: Hashable, Sendable, Identifiable {
    public let week: Int
    public let actual: Double
    public let best: Double
    /// Never negative — a lineup cannot beat the best one available to it.
    public let left: Double
    /// Players who would genuinely have gained points, from the optimizer's
    /// own swaps, so equal-value reshuffles are not reported as missed moves.
    public let shouldHaveStarted: [(id: String, name: String, points: Double)]

    public var id: Int { week }

    public static func == (lhs: BenchWeek, rhs: BenchWeek) -> Bool {
        lhs.week == rhs.week && lhs.actual == rhs.actual && lhs.best == rhs.best
    }

    public func hash(into hasher: inout Hasher) {
        hasher.combine(week)
        hasher.combine(actual)
    }
}

/// One week of the scoring trend.
public struct TrendPoint: Hashable, Sendable, Identifiable {
    public let week: Int
    public let mine: Double?
    public let leagueAverage: Double?
    public let rank: Int?
    public let teamCount: Int

    public var id: Int { week }
}

/// One of the user's draft picks, against what that pick slot actually
/// returned across the league.
public struct DraftPickResult: Hashable, Sendable, Identifiable {
    public let playerID: String
    public let name: String
    public let position: Position?
    public let pickNo: Int
    public let actual: Double
    public let expected: Double
    /// Positive means the pick beat what that slot returned league-wide.
    public var surplus: Double { actual - expected }

    public var id: String { playerID }
}

/// A recent add, drop or trade in the league.
public struct TransactionSummary: Hashable, Sendable, Identifiable {
    public let transactionID: String
    public let week: Int
    public let type: String
    public let manager: String
    public let addedNames: [String]
    public let droppedNames: [String]

    public var id: String { transactionID }
}

/// Dashboard — "what needs me right now" (§7.1).
///
/// Alerts first and always; everything else is history and scrolls below.
/// This is the screen a notification deep-links into, so the top of it has to
/// answer the question the notification raised without any scrolling.
@MainActor
public final class DashboardModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var alerts: [LineupAlert] = []
    @Published public private(set) var standings: [StandingsRow] = []
    @Published public private(set) var benchWeeks: [BenchWeek] = []
    @Published public private(set) var trend: [TrendPoint] = []
    @Published public private(set) var draftResults: [DraftPickResult] = []
    @Published public private(set) var transactions: [TransactionSummary] = []
    @Published public private(set) var news: [NewsItem] = []
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    /// You against your opponent this week. `nil` before Sleeper has matchups.
    @Published public private(set) var thisWeek: ThisWeekSummary?

    // MARK: My Team hub

    /// Which altitude the hub is showing.
    @Published public var zoom: MyTeamZoom = .thisWeek
    @Published public private(set) var readiness: LineupReadiness?
    @Published public private(set) var results: [WeekResult] = []
    @Published public private(set) var streak: String?
    @Published public private(set) var place: (rank: Int, of: Int)?
    @Published public private(set) var upcoming: [UpcomingOpponent] = []
    @Published public private(set) var byeStrip: [ByeStripWeek] = []
    /// When your next starters lock, for the alerts card. `nil` once all have.
    @Published public private(set) var nextLock: Date?
    @Published public private(set) var waiverTargets: [WaiverTarget] = []
    @Published public private(set) var waiverTargetsUnavailable = false

    /// Set when the draft panel cannot be shown, saying why rather than
    /// rendering an empty card.
    @Published public private(set) var draftUnavailable: String?

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService
    private var relay: RelayClient?

    public init(loader: LeagueContextLoader, sleeper: SleeperService, relay: RelayClient? = nil) {
        self.loader = loader
        self.sleeper = sleeper
        self.relay = relay
    }

    /// Whether a relay is configured — the News pillar says so either way.
    public var hasRelay: Bool { relay != nil }

    /// Points the news panel at a relay, or removes it. Takes effect on the
    /// next load, so a URL entered in Settings works without a relaunch.
    public func setRelay(baseURL: URL?) {
        relay = baseURL.map { RelayClient(baseURL: $0) }
        if baseURL == nil { news = [] }
    }

    /// Total left on the bench across every completed week.
    public var totalLeftOnBench: Double {
        benchWeeks.reduce(0) { $0 + $1.left }
    }

    public var freshnessLabel: String? {
        context.flatMap { Freshness.label(for: $0.provenance) }
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

            // Alerts and standings need nothing beyond the context, so they
            // are built first and are on screen even if history fails.
            alerts = Self.buildAlerts(context: context)
            nextLock = context.userTeam.flatMap { team in
                context.kickoffs.nextLock(
                    week: context.currentWeek,
                    teams: team.starterIDs.map { context.nflTeam(of: $0) },
                    now: context.now()
                )
            }
            standings = Self.buildStandings(context: context)
            readiness = LineupReadiness.build(context: context)
            place = Self.place(standings: standings)
            byeStrip = Self.buildByeStrip(context: context)

            // Same cache entry the Matchup screen reads, so no second request.
            if let matchups = try? await sleeper.matchups(
                leagueID: leagueID, week: context.currentWeek, force: force
            ) {
                thisWeek = Self.buildThisWeek(context: context, matchups: matchups.value)
            } else {
                thisWeek = nil
            }

            if let trending = try? await sleeper.trendingAdds(force: force) {
                waiverTargets = Self.buildWaiverTargets(context: context, trending: trending.value)
                waiverTargetsUnavailable = false
            } else {
                waiverTargets = []
                waiverTargetsUnavailable = true
            }

            let history = await SeasonHistory.load(
                sleeper: sleeper, leagueID: leagueID, currentWeek: context.currentWeek
            )
            benchWeeks = Self.buildBenchWeeks(context: context, history: history)
            trend = Self.buildTrend(context: context, history: history)
            results = Self.buildResults(context: context, history: history)
            streak = Self.streak(results)

            // Sleeper publishes future pairings; they don't change, so the long TTL.
            var future: [Int: [SleeperMatchup]] = [:]
            let lastWeek = context.seasonWeeks.max() ?? context.currentWeek
            for week in (context.currentWeek + 1)...max(context.currentWeek + 1, min(context.currentWeek + 3, lastWeek)) {
                if let matchups = try? await sleeper.completedMatchups(leagueID: leagueID, week: week) {
                    future[week] = matchups.value
                }
            }
            upcoming = Self.buildUpcoming(context: context, matchupsByWeek: future)

            await loadDraftResults(context: context, history: history)
            await loadTransactions(context: context, force: force)
            await loadNews(context: context)
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Alerts

    static func buildAlerts(context: LeagueContext) -> [LineupAlert] {
        guard let team = context.userTeam else { return [] }
        var alerts: [LineupAlert] = []

        let positions = Dictionary(
            team.roster.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }
        )

        // A starter whose game has kicked off can no longer be moved, so an alert
        // about him is noise: there is nothing left to do about it.
        let actionable = team.starterIDs.filter { !context.isLocked($0) }

        // A starter on bye scores nothing at all — more urgent than any tag.
        for id in actionable {
            guard let entry = positions[id] else { continue }
            if context.byeCalendar.isOnBye(team: entry.team, week: context.currentWeek) {
                alerts.append(
                    LineupAlert(
                        kind: .onBye,
                        playerID: id,
                        playerName: context.playerName(id) ?? id,
                        detail: "on bye this week — starting them scores 0"
                    )
                )
            }
        }

        // Slots still unset on Sleeper. The raw starters array keeps its
        // positional alignment, so the `"0"` entries are countable here and
        // nowhere else.
        let unsetCount = team.rawStarters.filter { $0 == SleeperRoster.emptyStarterSlot }.count
        if unsetCount > 0 {
            alerts.append(
                LineupAlert(
                    kind: .emptySlot,
                    playerID: nil,
                    playerName: nil,
                    detail: "\(unsetCount) starter slot\(unsetCount == 1 ? "" : "s") not set yet on Sleeper"
                )
            )
        }

        for id in actionable {
            guard let status = context.injuryStatus(id), !status.isEmpty else { continue }
            alerts.append(
                LineupAlert(
                    kind: .injured,
                    playerID: id,
                    playerName: context.playerName(id) ?? id,
                    detail: status,
                    asOf: context.players.builtAt
                )
            )
        }

        return alerts.sorted { $0.kind.rawValue < $1.kind.rawValue }
    }

    // MARK: - Standings

    /// Sorted the way a league table is: record first, points for as the
    /// tiebreak. Sleeper already returns all of this with the rosters, so it
    /// costs no extra request.
    static func buildStandings(context: LeagueContext) -> [StandingsRow] {
        context.teams
            .compactMap { team -> StandingsRow? in
                guard let settings = team.settings else { return nil }
                return StandingsRow(
                    rosterID: team.rosterID,
                    manager: team.manager,
                    isUser: team.isUser,
                    wins: settings.wins ?? 0,
                    losses: settings.losses ?? 0,
                    ties: settings.ties ?? 0,
                    pointsFor: settings.pointsFor ?? 0,
                    pointsAgainst: settings.pointsAgainst ?? 0
                )
            }
            .sorted { lhs, rhs in
                if lhs.wins != rhs.wins { return lhs.wins > rhs.wins }
                if lhs.ties != rhs.ties { return lhs.ties > rhs.ties }
                return lhs.pointsFor > rhs.pointsFor
            }
    }

    // MARK: - Bench points

    /// What the lineup scored against the best lineup available that week.
    ///
    /// The search is `LineupOptimizer`'s job, not this one's. All this supplies
    /// is the basis — points actually scored, per Sleeper — which is why
    /// overlapping flex slots are handled properly and cosmetic shuffles are
    /// not reported as missed moves.
    static func buildBenchWeeks(context: LeagueContext, history: SeasonHistory) -> [BenchWeek] {
        let positionsByID = Dictionary(
            (context.userTeam?.roster ?? []).map { ($0.id, $0.position) },
            uniquingKeysWith: { first, _ in first }
        )

        return history.weeks(forRoster: context.userRosterID).compactMap { week -> BenchWeek? in
            let proposal = LineupOptimizer.optimize(
                currentStarterIDs: week.starters,
                playerIDs: week.players,
                template: context.template,
                // The week's own roster is authoritative for that week — a
                // player since dropped is still in it.
                positions: { id in positionsByID[id] ?? context.position(id) },
                // A player Sleeper gave no number for is excluded rather than
                // scored as zero; the optimizer reports those as `unranked`.
                valueOf: { week.points(for: $0) }
            )

            guard let actual = proposal.currentTotal else { return nil }
            let best = proposal.proposedTotal ?? actual

            return BenchWeek(
                week: week.week,
                actual: actual,
                best: best,
                left: max(0, proposal.gain ?? 0),
                shouldHaveStarted: proposal.swaps.map { swap in
                    (
                        id: swap.inID,
                        name: context.playerName(swap.inID) ?? swap.inID,
                        points: week.points(for: swap.inID) ?? 0
                    )
                }
            )
        }
    }

    // MARK: - Trend

    /// Real results only, no projection. The rank each week is against the
    /// actual field that week, not an estimate of it.
    static func buildTrend(context: LeagueContext, history: SeasonHistory) -> [TrendPoint] {
        history.weeks.map { week in
            let totals = history.totals(week: week)
            let mine = totals[context.userRosterID]
            let values = Array(totals.values)
            let average = values.isEmpty ? nil : values.reduce(0, +) / Double(values.count)
            let rank = mine.map { score in
                values.filter { $0 > score }.count + 1
            }
            return TrendPoint(
                week: week,
                mine: mine,
                leagueAverage: average,
                rank: rank,
                teamCount: values.count
            )
        }
    }

    // MARK: - Draft value realized

    /// Each of the user's picks against what that pick number actually
    /// returned league-wide this season.
    ///
    /// "Expected" is the *n*th-best actual season total among everyone drafted,
    /// so the comparison is against what the slot really produced rather than
    /// against anyone's preseason ranking.
    private func loadDraftResults(context: LeagueContext, history: SeasonHistory) async {
        guard history.weeks.isEmpty == false else {
            draftUnavailable = "No completed weeks yet, so there is nothing to grade picks against."
            return
        }
        guard let userID = context.userTeam?.ownerID else {
            draftUnavailable = "Could not tell which picks were yours."
            return
        }
        guard let drafts = try? await sleeper.drafts(leagueID: context.league.leagueID),
              let draft = drafts.value.first
        else {
            draftUnavailable = "Sleeper returned no draft for this league."
            return
        }
        guard let picks = try? await sleeper.draftPicks(draftID: draft.draftID) else {
            draftUnavailable = "Could not load the draft picks."
            return
        }

        let actualByPlayer = history.actualPointsByPlayer()
        // Every drafted player's season total, best first. Index n-1 is what
        // pick n returned.
        let ranked = picks.value
            .compactMap { $0.playerID }
            .map { actualByPlayer[$0] ?? 0 }
            .sorted(by: >)

        guard !ranked.isEmpty else {
            draftUnavailable = "No scored players from the draft yet."
            return
        }

        draftUnavailable = nil
        draftResults = picks.value
            .filter { $0.pickedBy == userID }
            .compactMap { pick -> DraftPickResult? in
                guard let playerID = pick.playerID else { return nil }
                let index = min(max(pick.pickNo - 1, 0), ranked.count - 1)
                return DraftPickResult(
                    playerID: playerID,
                    name: context.playerName(playerID) ?? playerID,
                    position: context.position(playerID),
                    pickNo: pick.pickNo,
                    actual: actualByPlayer[playerID] ?? 0,
                    expected: ranked[index]
                )
            }
            .sorted { $0.surplus > $1.surplus }
    }

    // MARK: - Transactions

    /// The last few weeks of league activity. Older weeks are not worth a
    /// request each — this is a "what did I miss" panel, not an archive.
    private func loadTransactions(context: LeagueContext, weeksBack: Int = 3, force: Bool = false) async {
        let managers = Dictionary(
            context.teams.map { ($0.rosterID, $0.manager) }, uniquingKeysWith: { first, _ in first }
        )
        let weeks = stride(from: context.currentWeek, through: max(1, context.currentWeek - weeksBack + 1), by: -1)

        var summaries: [TransactionSummary] = []
        for week in weeks {
            guard let fetched = try? await sleeper.transactions(
                leagueID: context.league.leagueID, week: week, force: force
            ) else { continue }

            for transaction in fetched.value where transaction.isComplete {
                let rosterID = transaction.rosterIDs?.first
                summaries.append(
                    TransactionSummary(
                        transactionID: transaction.transactionID,
                        week: week,
                        type: transaction.type ?? "move",
                        manager: rosterID.flatMap { managers[$0] } ?? "Unknown",
                        addedNames: (transaction.adds ?? [:]).keys
                            .map { context.playerName($0) ?? $0 }.sorted(),
                        droppedNames: (transaction.drops ?? [:]).keys
                            .map { context.playerName($0) ?? $0 }.sorted()
                    )
                )
            }
        }
        transactions = summaries
    }

    // MARK: - News

    /// Relay-backed and therefore optional. When there is no relay the section
    /// simply does not appear — no v1 feature depends on it being reachable.
    private func loadNews(context: LeagueContext) async {
        guard let relay else { return }
        guard let feed = await relay.news(feed: "rotoworld") else { return }

        let rosterNames = Set(
            (context.userTeam?.roster ?? []).compactMap { context.playerName($0.id) }
        )
        news = feed.items.filter { item in
            rosterNames.contains { name in item.title.localizedCaseInsensitiveContains(name) }
        }
    }
}
