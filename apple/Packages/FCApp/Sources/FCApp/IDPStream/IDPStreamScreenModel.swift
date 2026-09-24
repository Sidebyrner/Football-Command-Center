import Foundation
import FCCore
import FCData

/// IDP Stream — is there a defender on waivers with a better one-week outlook
/// than the one I am starting, and how sure should I be?
///
/// Every free-agent defender with a real role is projected under the league's
/// own scoring by `IDPStreamEngine`, compared with the chosen starter, and
/// ranked. The game context is auto-filled and every piece of it can be edited.
@MainActor
public final class IDPStreamScreenModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var refreshCount = 0
    @Published public private(set) var report: IDPStreamReport?
    /// This week's teams with overrides applied, keyed by nflverse code.
    @Published public private(set) var teams: [String: IDPTeamContext] = [:]
    /// Auto-filled values before any override, for the editor's reset.
    @Published public private(set) var autoTeams: [String: IDPTeamContext] = [:]
    @Published public private(set) var overrides: IDPWeekOverrides = .empty
    @Published public private(set) var scoring = IDPScoring()
    @Published public private(set) var unmodelledScoringKeys: [String] = []
    @Published public private(set) var snapshots: [IDPSnapshotSummary] = []
    @Published public private(set) var lastSnapshotAt: Date?

    @Published public var risk: IDPRiskMode = .neutral { didSet { recompute() } }
    @Published public var onlyAvailable = true { didSet { applyFilters() } }
    @Published public var positionFilter: Position? { didSet { applyFilters() } }
    @Published public var query = "" { didSet { applyFilters() } }
    @Published public private(set) var rows: [IDPProjection] = []
    /// Defenders picked for side-by-side comparison, in the order added.
    /// Session-only: a comparison is a question of the moment.
    @Published public private(set) var compareIDs: [String] = []
    public static let compareLimit = 4

    private var candidates: [IDPCandidate] = []
    private var defense: DefenseLookup?
    private let loader: LeagueContextLoader
    private let store: IDPStreamStore
    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    public init(loader: LeagueContextLoader, store: IDPStreamStore = IDPStreamStore()) {
        self.loader = loader
        self.store = store
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
            scoring = IDPScoring.from(sleeperSettings: settings)
            unmodelledScoringKeys = IDPScoring.unmodelledKeys(sleeperSettings: settings)

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

    /// Whether the league starts any IDP at all.
    public var leagueHasIDP: Bool {
        guard let context else { return true }
        return context.template.starters.contains { !$0.eligible.isDisjoint(with: Position.idp) }
    }

    // MARK: - Pipeline

    /// Context → candidates → report. Cheap; runs again after every edit.
    private func rebuild() {
        guard let context, let defense else { return }
        autoTeams = IDPContextAutofill.build(schedule: context.schedule, week: context.currentWeek, defense: defense.sleeper)
        teams = IDPContextAutofill.apply(overrides.teams, to: autoTeams)
        var builder = IDPCandidateBuilder(context: context, teams: teams, players: overrides.players)
        builder.alwaysInclude = Set(compareIDs).union([overrides.incumbentID].compactMap { $0 })
        candidates = builder.candidates()
        recompute()
    }

    /// Re-runs the engine on the candidates already built — risk or starter change.
    private func recompute() {
        guard context != nil else { return }
        report = IDPStreamEngine.report(candidates: candidates, scoring: scoring,
                                        incumbentID: incumbentID, risk: risk)
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

    /// The user's rostered defenders, the choices for the starter to beat.
    public var myDefenders: [IDPCandidate] {
        guard let mine = context?.userTeam else { return [] }
        let ids = Set(mine.roster.map(\.id))
        return candidates.filter { $0.playerID.map(ids.contains) ?? false }
    }

    /// The chosen starter, or by default the weakest IDP the user is starting
    /// this week — the one a stream would replace.
    public var incumbentID: String? {
        if let chosen = overrides.incumbentID, candidates.contains(where: { $0.id == chosen }) { return chosen }
        guard let mine = context?.userTeam else { return nil }
        let starters = Set(mine.starterIDs)
        let pool = myDefenders.filter { starters.contains($0.id) }
        let options = pool.isEmpty ? myDefenders : pool
        return options
            .map { ($0.id, IDPStreamEngine.project($0, scoring: scoring, risk: risk).expPts) }
            .min { $0.1 < $1.1 }?.0
    }

    public var incumbentIsDefault: Bool { overrides.incumbentID == nil }

    /// Any defender can be the one to beat — yours, a rival's, a free agent.
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

    /// Every IDP in the pool matching a search, for the any-player pickers.
    /// An empty search lists the best projected defenders instead, so there is
    /// something to browse before typing.
    public func searchDefenders(_ query: String, limit: Int = 25) -> [IDPPickerRow] {
        guard let context else { return [] }
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        let players: [IndexedPlayer]
        if trimmed.isEmpty {
            let ranked = (report?.ranked ?? []) + [report?.incumbent].compactMap { $0 }
            players = ranked.sorted { $0.expPts > $1.expPts }.prefix(limit).compactMap { $0.playerID.flatMap { context.players[$0] } }
        } else {
            // Forgiving: typos, any word order, and team code or name count.
            let scored = idpPool.compactMap { player -> (IndexedPlayer, Int)? in
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
            IDPPickerRow(
                id: player.id, name: player.name, team: player.nflverseTeam, platform: player.position,
                alignment: IDPSubPosition.resolve(positionCode: player.positionCode, depthChartPosition: player.depthChartPosition)?.position,
                availability: context.availability(ofSleeperID: player.id),
                projected: projection(for: player.id)?.expPts
            )
        }
    }

    /// Active defenders on an NFL team — the pool the pickers search.
    private var idpPool: [IndexedPlayer] {
        guard let context else { return [] }
        return [Position.lb, .dl, .db].flatMap { context.players.players(at: $0) }.filter { $0.team != nil }
    }

    /// His last few completed games from Sleeper's lines, newest first, scored
    /// in this league — what he has actually been doing next to what he is
    /// projected to do.
    public func recentGames(_ id: String, limit: Int = 3) -> [IDPGameLine] {
        guard let context else { return [] }
        let scoring = context.league.scoringSettings ?? [:]
        return context.inSeason.weekStats.keys
            .filter { $0 < context.currentWeek }
            .sorted(by: >)
            .compactMap { week -> IDPGameLine? in
                guard let line = context.inSeason.weekStats[week]?[id] else { return nil }
                let s = line.stats
                let tackles = s["idp_tkl"] ?? ((s["idp_tkl_solo"] ?? 0) + (s["idp_tkl_ast"] ?? 0))
                return IDPGameLine(
                    week: week,
                    opponent: line.opponent.flatMap { NFLTeams.nflverse($0) },
                    points: line.score(scoring: scoring).points,
                    snapShare: line.defensiveSnapShare,
                    tackles: tackles,
                    sacks: s["idp_sack"] ?? 0
                )
            }
            .prefix(limit)
            .map { $0 }
    }

    /// The current projection for any defender in the report, starter included.
    public func projection(for id: String) -> IDPProjection? {
        if report?.incumbent?.id == id { return report?.incumbent }
        return report?.ranked.first { $0.id == id }
    }

    // MARK: - Compare

    public func isComparing(_ id: String) -> Bool { compareIDs.contains(id) }

    public var canAddToCompare: Bool { compareIDs.count < Self.compareLimit }

    /// Adds or removes a defender. Someone outside the stream list is
    /// projected on the spot, so anyone in the pool can be compared.
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

    /// The compared defenders, in the order added, with every head-to-head.
    public var comparison: IDPComparison? {
        let players = compareIDs.compactMap(projection(for:))
        return players.isEmpty ? nil : IDPComparison(players: players)
    }

    // MARK: - Editing context

    public func setTeamOverride(_ change: IDPTeamOverride?, team: String) async {
        if let change, !change.isEmpty { overrides.teams[team] = change } else { overrides.teams[team] = nil }
        await saveOverrides()
        rebuild()
    }

    public func setPlayerOverride(_ change: IDPPlayerOverride?, playerID: String) async {
        if let change, !change.isEmpty { overrides.players[playerID] = change } else { overrides.players[playerID] = nil }
        await saveOverrides()
        rebuild()
    }

    public func resetAllOverrides() async {
        overrides = IDPWeekOverrides(incumbentID: overrides.incumbentID)
        await saveOverrides()
        rebuild()
    }

    /// Imports a context file in the reference tool's shape. Returns how many
    /// teams and players it changed.
    @discardableResult
    public func importContext(_ data: Data) async throws -> (teams: Int, players: Int) {
        let incoming = try IDPContextImport.parse(data)
        overrides = IDPContextImport.merge(incoming, into: overrides)
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

    public func loadSnapshot(id: String) async -> IDPStreamSnapshot? {
        await store.snapshot(id: id)
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
                leagueID: leagueID, season: context.scheduleSeason, week: context.currentWeek, asOf: context.now(),
                risk: risk, scoring: scoring, teams: Array(teams.values), candidates: candidates,
                report: report, pinned: pinned
            )
            lastSnapshotAt = saved.asOf
        } catch {
            errorMessage = "Could not save a snapshot: \(error.localizedDescription)"
        }
    }

    // MARK: - Labels

    /// A FAAB range in dollars for a gain, or a plain claim verdict when the
    /// league does not bid.
    public func bidLabel(_ row: IDPProjection) -> String? {
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
        if weeks.isEmpty {
            notes.append("No \(context.scheduleSeason) Sleeper stat lines yet — every defender is projected from position priors alone.")
        } else {
            notes.append("Stats: Sleeper weekly lines, weeks \(weeks.first!)–\(weeks.last!) of \(context.scheduleSeason).")
        }
        let lineless = teams.values.filter { $0.linesSource == .standard }.count
        if lineless > 0 {
            notes.append("\(lineless) teams have no recorded spread or total this week and use a neutral 0 / 45 — edit them in Game context.")
        }
        if !teams.values.contains(where: { $0.dvpSource == .sleeperDvP }) {
            notes.append("IDP matchup (points an offense allows to LB/DL/DB) needs \(DefenseVsPosition.defaultMinimumGames) games per offense before it is used, so it is neutral for now unless edited or imported.")
        }
        notes.append("Spread and total are recorded closing lines from the schedule file, not live odds. Opponent pass protection is neutral unless edited.")
        if !unmodelledScoringKeys.isEmpty {
            notes.append("Your league also pays for \(unmodelledScoringKeys.joined(separator: ", ")); these are rare and not projected.")
        }
        notes.append("Priors and knobs are heuristic until backtested. Availability is read from your league's rosters.")
        return notes
    }
}

/// One row in the any-player pickers.
public struct IDPPickerRow: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let team: String?
    public let platform: Position?
    public let alignment: IDPSubPosition?
    public let availability: Availability
    /// `nil` until he has been projected this session.
    public let projected: Double?
}

/// One completed game, for the comparison's recent-form rows.
public struct IDPGameLine: Hashable, Sendable {
    public let week: Int
    public let opponent: String?
    /// Scored in the league's own settings.
    public let points: Double
    public let snapShare: Double?
    public let tackles: Double
    public let sacks: Double
}
