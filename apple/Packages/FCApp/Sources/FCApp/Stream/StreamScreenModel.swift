import Foundation
import FCCore
import FCData

/// A weekly stream screen — is there a player on waivers with a better
/// one-week outlook than the one I am starting, and how sure should I be?
///
/// Every candidate with a real role is projected under the league's own
/// scoring by the stream's engine, compared with the chosen starter, and
/// ranked. The game context is auto-filled and every piece of it can be
/// edited. `Kind` supplies what differs between streams (IDP, WR); everything
/// here is shared.
@MainActor
public final class StreamScreenModel<Kind: StreamKind>: ObservableObject {
    public typealias Overrides = StreamWeekOverrides<Kind.TeamOverride, Kind.PlayerOverride>

    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var refreshCount = 0
    @Published public private(set) var report: StreamReport<Kind.Projection>?
    /// This week's teams with overrides applied, keyed by nflverse code.
    @Published public private(set) var teams: [String: Kind.Team] = [:]
    /// Auto-filled values before any override, for the editor's reset.
    @Published public private(set) var autoTeams: [String: Kind.Team] = [:]
    @Published public private(set) var overrides: Overrides = .empty
    @Published public private(set) var scoring: Kind.Scoring = Kind.emptyScoring
    @Published public private(set) var unmodelledScoringKeys: [String] = []
    @Published public private(set) var snapshots: [StreamSnapshotSummary] = []
    @Published public private(set) var lastSnapshotAt: Date?

    @Published public var risk: StreamRiskMode = .neutral { didSet { recompute() } }
    /// How far ahead to rank, for streams with a rest-of-season layer.
    @Published public var horizon: StreamHorizon = .balanced { didSet { recompute() } }
    @Published public var onlyAvailable = true { didSet { applyFilters() } }
    @Published public var positionFilter: Position? { didSet { applyFilters() } }
    @Published public var query = "" { didSet { applyFilters() } }
    @Published public private(set) var rows: [Kind.Projection] = []
    /// Players picked for side-by-side comparison, in the order added.
    /// Session-only: a comparison is a question of the moment.
    @Published public private(set) var compareIDs: [String] = []
    public static var compareLimit: Int { 4 }

    private(set) var candidates: [Kind.Candidate] = []
    private var defense: DefenseLookup?
    private let loader: LeagueContextLoader
    private let store: StreamStore
    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    public init(loader: LeagueContextLoader, store: StreamStore? = nil) {
        self.loader = loader
        self.store = store ?? StreamStore(folder: Kind.storeFolder)
    }

    public func refresh() async {
        guard let request = lastRequest else { return }
        await load(leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: true)
        if errorMessage == nil, let context, !Freshness.isDegraded(context.provenance) {
            refreshCount += 1
        }
    }

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
            let settings = context.league.scoringSettings ?? [:]
            scoring = Kind.scoring(sleeperSettings: settings)
            unmodelledScoringKeys = Kind.unmodelledKeys(sleeperSettings: settings)

            let defense = await Task.detached(priority: .userInitiated) {
                DefenseLookup.build(context: context)
            }.value
            self.defense = defense
            overrides = await store.overrides(leagueID: leagueID, season: context.scheduleSeason, week: context.currentWeek)
            rebuild()
            await autoSnapshotIfFirstToday()
            snapshots = await store.snapshots(leagueID: leagueID)
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Whether the league starts anyone at this stream's positions.
    public var leagueStartsKind: Bool {
        guard let context else { return true }
        let covered = Set(Kind.positions)
        return context.template.starters.contains { !$0.eligible.isDisjoint(with: covered) }
    }

    // MARK: - Pipeline

    /// Context → candidates → report. Cheap; runs again after every edit.
    private func rebuild() {
        guard let context, let defense else { return }
        autoTeams = Kind.autofill(context: context, defense: defense)
        teams = Kind.apply(overrides.teams, to: autoTeams)
        candidates = Kind.candidates(
            context: context, teams: teams, players: overrides.players,
            alwaysInclude: Set(compareIDs).union([overrides.incumbentID].compactMap { $0 })
        )
        recompute()
    }

    /// Re-runs the engine on the candidates already built — risk or starter change.
    private func recompute() {
        guard context != nil else { return }
        let projections = candidates.map { Kind.project($0, scoring: scoring, risk: risk, horizon: horizon) }
        report = StreamDecision.report(projections: projections, incumbentID: incumbentID(among: projections))
        applyFilters()
    }

    func applyFilters() {
        guard let report else { rows = []; return }
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        rows = report.ranked(at: positionFilter).filter { row in
            if onlyAvailable, row.available == false { return false }
            if !needle.isEmpty, !row.name.lowercased().contains(needle), !row.team.lowercased().contains(needle) { return false }
            return true
        }
    }

    // MARK: - Starter

    /// The user's rostered players at this stream's positions, the first
    /// choices for the starter to beat.
    public var myPlayers: [Kind.Candidate] {
        guard let mine = context?.userTeam else { return [] }
        let ids = Set(mine.roster.map(\.id))
        return candidates.filter { $0.playerID.map(ids.contains) ?? false }
    }

    /// The chosen starter, or by default the weakest one the user is starting
    /// this week — the one a stream would replace.
    public var incumbentID: String? {
        incumbentID(among: candidates.map { Kind.project($0, scoring: scoring, risk: risk, horizon: horizon) })
    }

    private func incumbentID(among projections: [Kind.Projection]) -> String? {
        if let chosen = overrides.incumbentID, projections.contains(where: { $0.id == chosen }) { return chosen }
        guard let mine = context?.userTeam else { return nil }
        let rostered = Set(mine.roster.map(\.id))
        let starters = Set(mine.starterIDs)
        let myProjections = projections.filter { $0.playerID.map(rostered.contains) ?? false }
        let starting = myProjections.filter { starters.contains($0.id) }
        return (starting.isEmpty ? myProjections : starting).min { $0.expPts < $1.expPts }?.id
    }

    public var incumbentIsDefault: Bool { overrides.incumbentID == nil }

    /// Anyone can be the one to beat — yours, a rival's, a free agent.
    public func setIncumbent(_ id: String?) async {
        overrides.incumbentID = id
        await saveOverrides()
        rebuild()
    }

    /// Whose player the starter to beat is, when he is not the user's.
    public var incumbentOwnerLabel: String? {
        guard let id = report?.incumbent?.playerID, let context else { return nil }
        let availability = context.availability(ofSleeperID: id)
        return availability == .mine ? nil : availability.label
    }

    // MARK: - Finding players

    /// Every player at this stream's positions matching a search, for the
    /// any-player pickers. Forgiving: typos, any word order, and team code or
    /// name count. An empty search lists the best projected players instead,
    /// so there is something to browse before typing.
    public func searchPlayers(_ query: String, limit: Int = 25) -> [StreamPickerRow] {
        guard let context else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let players: [IndexedPlayer]
        if trimmed.isEmpty {
            let ranked = (report?.ranked ?? []) + [report?.incumbent].compactMap { $0 }
            players = ranked.sorted { $0.expPts > $1.expPts }.prefix(limit).compactMap { $0.playerID.flatMap { context.players[$0] } }
        } else {
            let scored = pool.compactMap { player -> (IndexedPlayer, Int)? in
                let team = player.nflverseTeam
                let extra = [team, NFLTeams.name(abbreviation: team)].compactMap { $0 }
                return FuzzyNameMatch.score(query: trimmed, name: player.name, extra: extra).map { (player, $0) }
            }
            players = scored
                .sorted { a, b in
                    if a.1 != b.1 { return a.1 > b.1 }
                    let pa = projection(for: a.0.id)?.expPts ?? -1, pb = projection(for: b.0.id)?.expPts ?? -1
                    return pa != pb ? pa > pb : a.0.name < b.0.name
                }
                .prefix(limit)
                .map(\.0)
        }
        return players.map { player in
            StreamPickerRow(
                id: player.id, name: player.name, team: player.nflverseTeam, platform: player.position,
                roleLabel: projection(for: player.id)?.roleLabel ?? Kind.roleLabel(for: player),
                availability: context.availability(ofSleeperID: player.id),
                projected: projection(for: player.id)?.expPts
            )
        }
    }

    /// Active players at this stream's positions on an NFL team.
    private var pool: [IndexedPlayer] {
        guard let context else { return [] }
        return Kind.positions.flatMap { context.players.players(at: $0) }.filter { $0.team != nil }
    }

    /// His last few completed games, newest first, scored in this league.
    public func recentGames(_ id: String, limit: Int = 3) -> [Kind.GameLine] {
        guard let context else { return [] }
        return Kind.recentGames(context: context, playerID: id, limit: limit)
    }

    /// The current projection for any player in the report, starter included.
    public func projection(for id: String) -> Kind.Projection? {
        report?.projection(for: id)
    }

    // MARK: - Compare

    public func isComparing(_ id: String) -> Bool { compareIDs.contains(id) }

    public var canAddToCompare: Bool { compareIDs.count < Self.compareLimit }

    /// Adds or removes a player. Someone outside the stream list is projected
    /// on the spot, so anyone in the pool can be compared.
    public func toggleCompare(_ id: String) {
        if let index = compareIDs.firstIndex(of: id) {
            compareIDs.remove(at: index)
        } else {
            guard canAddToCompare else { return }
            compareIDs.append(id)
        }
        if projection(for: id) == nil || !compareIDs.contains(id) { rebuild() }
    }

    public func clearCompare() {
        compareIDs = []
        rebuild()
    }

    /// The compared players, in the order added, with every head-to-head.
    public var comparison: StreamComparison<Kind.Projection>? {
        let players = compareIDs.compactMap(projection(for:))
        return players.isEmpty ? nil : StreamComparison(players: players)
    }

    // MARK: - Editing context

    public func setTeamOverride(_ change: Kind.TeamOverride?, team: String) async {
        if let change, !change.isEmpty { overrides.teams[team] = change } else { overrides.teams[team] = nil }
        await saveOverrides()
        rebuild()
    }

    public func setPlayerOverride(_ change: Kind.PlayerOverride?, playerID: String) async {
        if let change, !change.isEmpty { overrides.players[playerID] = change } else { overrides.players[playerID] = nil }
        await saveOverrides()
        rebuild()
    }

    public func resetAllOverrides() async {
        overrides = Overrides(incumbentID: overrides.incumbentID)
        await saveOverrides()
        rebuild()
    }

    /// Imports a context file in the reference tool's shape. Returns how many
    /// teams and players it changed.
    @discardableResult
    public func importContext(_ data: Data) async throws -> (teams: Int, players: Int) {
        let incoming = try Kind.parseImport(data)
        overrides = overrides.merging(incoming)
        await saveOverrides()
        rebuild()
        return (incoming.teams.count, incoming.players.count)
    }

    private func saveOverrides() async {
        guard let context, let leagueID = lastRequest?.leagueID else { return }
        do {
            try await store.saveOverrides(overrides, leagueID: leagueID, season: context.scheduleSeason, week: context.currentWeek)
        } catch {
            errorMessage = "Could not save your edits: \(error.localizedDescription)"
        }
    }

    // MARK: - Snapshots

    /// Freezes the current run by hand — the Tuesday-night and Sunday-morning runs.
    public func freezeSnapshot() async {
        await saveSnapshot(pinned: true)
        if let leagueID = lastRequest?.leagueID { snapshots = await store.snapshots(leagueID: leagueID) }
    }

    public func loadSnapshot(id: String) async -> StreamSnapshot<Kind>? {
        await store.snapshot(Kind.self, id: id)
    }

    public func deleteSnapshot(id: String) async {
        try? await store.deleteSnapshot(id: id)
        if let leagueID = lastRequest?.leagueID { snapshots = await store.snapshots(leagueID: leagueID) }
    }

    /// The first successful run each day is saved, so there is always a record
    /// of what the screen said before the games — without asking.
    private func autoSnapshotIfFirstToday() async {
        guard let context, let leagueID = lastRequest?.leagueID, report != nil else { return }
        let existing = await store.snapshots(leagueID: leagueID)
        let now = context.now()
        let alreadyToday = existing.contains {
            $0.week == context.currentWeek && Calendar.current.isDate($0.asOf, inSameDayAs: now)
        }
        guard !alreadyToday else { return }
        await saveSnapshot(pinned: false)
    }

    private func saveSnapshot(pinned: Bool) async {
        guard let context, let report, let leagueID = lastRequest?.leagueID else { return }
        do {
            let saved = try await store.saveSnapshot(
                Kind.self, leagueID: leagueID, season: context.scheduleSeason, week: context.currentWeek,
                asOf: context.now(), risk: risk, scoring: scoring, teams: Array(teams.values),
                candidates: candidates, report: report, pinned: pinned
            )
            lastSnapshotAt = saved.asOf
        } catch {
            errorMessage = "Could not save a snapshot: \(error.localizedDescription)"
        }
    }

    // MARK: - Labels

    /// A FAAB range in dollars for a gain, or a plain claim verdict when the
    /// league does not bid.
    public func bidLabel(_ row: Kind.Projection) -> String? {
        guard let band = row.bidBand else { return nil }
        if let remaining = context?.leagueFacts.faabRemaining {
            return band.isSpend ? band.dollars(remaining: remaining) : "$0–1"
        }
        return band.isSpend ? "Claim" : "Pass"
    }

    public var sourceNotes: [String] {
        guard let context else { return [] }
        var notes: [String] = []
        let weeks = context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
        if let first = weeks.first, let last = weeks.last {
            notes.append("Stats: Sleeper weekly lines, weeks \(first)–\(last) of \(context.scheduleSeason).")
        } else {
            notes.append("No \(context.scheduleSeason) Sleeper stat lines yet — every \(Kind.playerNoun) is projected from priors alone.")
        }
        let lineless = teams.values.filter { $0.linesSource == .standard }.count
        if lineless > 0 {
            notes.append("\(lineless) teams have no recorded spread or total this week and use a neutral 0 / 45 — edit them in Game context.")
        }
        notes += Kind.sourceNotes(teams: teams)
        if !unmodelledScoringKeys.isEmpty {
            notes.append("Your league also pays for \(unmodelledScoringKeys.joined(separator: ", ")); these are rare and not projected.")
        }
        notes.append("Priors and knobs are heuristic until backtested. Availability is read from your league's rosters.")
        return notes
    }
}
