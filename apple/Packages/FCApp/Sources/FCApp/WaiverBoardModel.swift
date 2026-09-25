import Foundation
import FCCore
import FCData

/// One column the board can rank on. Each is a separately named measure from
/// a named source; the board never folds them into one number (§6).
public enum WaiverSort: String, CaseIterable, Hashable, Sendable, Identifiable {
    case projectedOverLine
    case projected
    case expectedPoints
    case snapShare
    case targetShare
    case redZone
    case sleeperPointsPerGame
    case seasonPointsPerGame
    case trending

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .projectedOverLine: return "Proj. over start line"
        case .projected: return "Projected this week"
        case .expectedPoints: return "Expected pts, last 4"
        case .snapShare: return "Snap share, last 4"
        case .targetShare: return "Target share, last 4"
        case .redZone: return "Red zone touches, last 4"
        case .sleeperPointsPerGame: return "This season pts/gm"
        case .seasonPointsPerGame: return "Stats season pts/gm"
        case .trending: return "Trending adds"
        }
    }

    public var source: String {
        switch self {
        case .projectedOverLine, .projected: return "Rotowire via Sleeper, in your scoring"
        case .expectedPoints: return "ffopportunity expected fantasy points, a usage measure"
        case .snapShare, .targetShare, .redZone: return "Sleeper weekly stat lines"
        case .sleeperPointsPerGame: return "Sleeper weekly stat lines, in your scoring"
        case .seasonPointsPerGame: return "nflverse weekly file, in your scoring"
        case .trending: return "Sleeper league-wide add counts — popularity, not production"
        }
    }

    /// Short unit for the prominent number.
    public var unit: String {
        switch self {
        case .projectedOverLine: return "over line"
        case .projected: return "proj"
        case .expectedPoints: return "xFP"
        case .snapShare: return "snaps"
        case .targetShare: return "tgt share"
        case .redZone: return "RZ"
        case .sleeperPointsPerGame, .seasonPointsPerGame: return "pts/gm"
        case .trending: return "adds"
        }
    }

    public var isPercent: Bool { self == .snapShare || self == .targetShare }
}

/// One free agent (or rival bench player) with every measure the board shows.
/// Every measure is optional: absent is not zero.
public struct WaiverRow: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: Position
    public let team: String?
    public let opponent: String?
    public let availability: Availability
    public let byeWeek: Int?
    public let injuryTag: String?
    public let playsThisWeek: Bool
    public let isLocked: Bool
    public let projected: Double?
    public let projectedOverLine: Double?
    public let expectedPoints: Double?
    public let snapShare: Double?
    public let targetShare: Double?
    public let redZoneTouches: Double?
    public let sleeperPointsPerGame: Double?
    public let sleeperGames: Int
    public let seasonPointsPerGame: Double?
    public let trendingAdds: Int?
    public let signals: [SignalHit]
    /// Your short weeks he could actually play in at a position you need.
    public let coversWeeks: [Int]

    public func value(_ sort: WaiverSort) -> Double? {
        switch sort {
        case .projectedOverLine: return projectedOverLine
        case .projected: return projected
        case .expectedPoints: return expectedPoints
        case .snapShare: return snapShare
        case .targetShare: return targetShare
        case .redZone: return redZoneTouches
        case .sleeperPointsPerGame: return sleeperPointsPerGame
        case .seasonPointsPerGame: return seasonPointsPerGame
        case .trending: return trendingAdds.map(Double.init)
        }
    }

    /// A sort key with no value ranks last. For `KeyPathComparator` on desktop.
    public var projectedForSort: Double { projected ?? -.infinity }
    public var projectedOverLineForSort: Double { projectedOverLine ?? -.infinity }
    public var expectedPointsForSort: Double { expectedPoints ?? -.infinity }
    public var snapShareForSort: Double { snapShare ?? -.infinity }
    public var targetShareForSort: Double { targetShare ?? -.infinity }
    public var redZoneForSort: Double { redZoneTouches ?? -.infinity }
    public var sleeperPointsForSort: Double { sleeperPointsPerGame ?? -.infinity }
    public var seasonPointsForSort: Double { seasonPointsPerGame ?? -.infinity }
    public var trendingForSort: Double { trendingAdds.map(Double.init) ?? -.infinity }
    public var availabilityLabel: String { availability.label }
}

/// One of your bench players as a drop.
public struct DropCandidate: Hashable, Sendable, Identifiable {
    public let row: WaiverRow
    /// Tagged with a status Sleeper lets you park on IR.
    public let irEligible: Bool
    /// "Out" — IR-eligible only if the league allows it.
    public let maybeIRWithLeagueSetting: Bool

    public var id: String { row.id }
}

/// What a claim does to your best legal lineup this week, on the projection.
public struct PairEffect: Hashable, Sendable {
    public let addID: String
    public let dropID: String
    public let before: Double?
    public let after: Double?
    public let delta: Double?
    public let basisLabel: String
    /// Why there is no delta, when there is none.
    public let note: String?
}

/// The league rules that price a claim, for the strip at the top.
public struct WaiverFacts: Hashable, Sendable {
    public let system: LeagueFacts.WaiverSystem
    public let waiverPosition: Int?
    public let faabRemaining: Int?
    public let processingDay: String?
    public let irSlots: Int
    public let irUsed: Int
    public let benchCount: Int
    public let teamCount: Int

    public var irFree: Int { max(0, irSlots - irUsed) }

    static let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
}

/// Waiver Board — every free agent with what he has actually been doing and
/// what he is projected to do, ranked on one named column at a time.
@MainActor
public final class WaiverBoardModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var rows: [WaiverRow] = []
    @Published public private(set) var dropCandidates: [DropCandidate] = []
    @Published public private(set) var facts: WaiverFacts?
    @Published public private(set) var trendingUnavailable = false
    @Published public private(set) var refreshCount = 0
    /// Projected start line per position, from every projected player in the
    /// league's pool — the Nth-best projected line, N = dedicated slots × teams.
    @Published public private(set) var projectedLines: [Position: PositionBaseline] = [:]

    @Published public var sort: WaiverSort = .projectedOverLine { didSet { applyFilters() } }
    @Published public var positionFilter: Position? { didSet { applyFilters() } }
    @Published public var includeRivalBenches = false { didSet { applyFilters() } }
    @Published public var query = "" { didSet { applyFilters() } }
    /// Hide players whose team is on bye this week.
    @Published public var playingThisWeekOnly = false { didSet { applyFilters() } }

    private var allRows: [WaiverRow] = []
    private let loader: LeagueContextLoader
    private let sleeper: SleeperService?
    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    public init(loader: LeagueContextLoader, sleeper: SleeperService? = nil) {
        self.loader = loader
        self.sleeper = sleeper
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

            var trending: [String: Int] = [:]
            if let sleeper, let adds = try? await sleeper.trendingAdds(force: force) {
                trending = Dictionary(adds.value.map { ($0.playerID, $0.count) }, uniquingKeysWith: { first, _ in first })
                trendingUnavailable = false
            } else {
                trendingUnavailable = true
            }

            let builder = RowBuilder(context: context, trending: trending)
            projectedLines = builder.projectedLines
            allRows = builder.acquirableRows()
            dropCandidates = builder.dropCandidates()
            facts = Self.buildFacts(context: context)
            fallBackToAValuedSort()
            applyFilters()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Filtering and sorting

    /// A column nobody on the board has a number for is a wall of dashes, not
    /// a ranking. When the current sort values no one — projections unreachable,
    /// or a season with no Sleeper lines yet — move to the first column that
    /// does, in the order the columns are offered.
    func fallBackToAValuedSort() {
        guard !allRows.isEmpty, allRows.allSatisfy({ $0.value(sort) == nil }) else { return }
        if let usable = WaiverSort.allCases.first(where: { column in allRows.contains { $0.value(column) != nil } }) {
            sort = usable
        }
    }

    func applyFilters() {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        var out = allRows.filter { row in
            if !includeRivalBenches, row.availability != .freeAgent { return false }
            if let positionFilter, row.position != positionFilter { return false }
            if playingThisWeekOnly, !row.playsThisWeek { return false }
            if !needle.isEmpty, !row.name.lowercased().contains(needle), !(row.team?.lowercased().contains(needle) ?? false) { return false }
            return true
        }
        let sort = self.sort
        out.sort { a, b in
            switch (a.value(sort), b.value(sort)) {
            case let (x?, y?): return x == y ? a.name < b.name : x > y
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return a.name < b.name
            }
        }
        rows = out
    }

    /// Positions the board can filter on: those the league starts, in template order.
    public var filterablePositions: [Position] {
        guard let context else { return [] }
        var seen: Set<Position> = []
        var out: [Position] = []
        for slot in context.template.starters {
            for position in slot.eligible.sorted(by: { $0.rawValue < $1.rawValue }) where seen.insert(position).inserted {
                out.append(position)
            }
        }
        return out
    }

    /// Rows the current sort cannot value, for the "and N more without this
    /// number" line.
    public var unvaluedCount: Int {
        rows.filter { $0.value(sort) == nil }.count
    }

    // MARK: - Add/drop pair

    /// What your best legal lineup this week gains from adding one player and
    /// dropping another, on Rotowire's projection under your scoring.
    public func pairEffect(add: WaiverRow, drop: DropCandidate) -> PairEffect {
        let label = "Projected this week, \(context?.inSeason.projectionSourceLabel ?? "Sleeper")"
        guard let context, let mine = context.userTeam else {
            return PairEffect(addID: add.id, dropID: drop.id, before: nil, after: nil, delta: nil, basisLabel: label, note: "No league loaded.")
        }
        guard context.inSeason.hasProjections else {
            return PairEffect(addID: add.id, dropID: drop.id, before: nil, after: nil, delta: nil, basisLabel: label, note: "Projections are unavailable, so the lineup effect cannot be measured.")
        }
        guard add.projected != nil else {
            return PairEffect(addID: add.id, dropID: drop.id, before: nil, after: nil, delta: nil, basisLabel: label, note: "\(add.name) has no projection this week.")
        }
        let locked = Set(mine.roster.map(\.id).filter { context.isLocked($0) })
        // Out, Doubtful and IR players can't be in this week's lineup — the
        // same rule Sit/Start uses — so neither side of the pair counts them.
        func best(_ ids: [String]) -> Double? {
            LineupOptimizer.optimize(
                currentStarterIDs: mine.rawStarters,
                playerIDs: ids,
                template: context.template,
                positions: { context.position($0) },
                valueOf: { StartAvailability.of($0, context: context).blocksStart ? nil : context.projectedPoints($0) },
                locked: locked
            ).proposedTotal
        }
        let current = mine.roster.map(\.id)
        let before = best(current) ?? 0
        let after = best(current.filter { $0 != drop.id } + [add.id]) ?? 0
        var note: String?
        if case .unavailable(let status) = StartAvailability.of(add.id, context: context) {
            note = "\(add.name) is \(status), so he can't help this week's lineup — a stash, not a start."
        }
        return PairEffect(
            addID: add.id, dropID: drop.id,
            before: before, after: after,
            delta: ((after - before) * 10).rounded() / 10,
            basisLabel: label, note: note
        )
    }

    // MARK: - Facts

    static func buildFacts(context: LeagueContext) -> WaiverFacts {
        let facts = context.leagueFacts
        return WaiverFacts(
            system: facts.waivers,
            waiverPosition: facts.waiverPosition,
            faabRemaining: facts.faabRemaining,
            processingDay: facts.waiverDayOfWeek.flatMap { day in
                (0..<7).contains(day) ? WaiverFacts.dayNames[day] : nil
            },
            irSlots: facts.irSlots,
            irUsed: context.userTeam?.reserveIDs.count ?? 0,
            benchCount: context.template.benchCount,
            teamCount: facts.teamCount
        )
    }

    /// Source notes for the foot of the screen.
    public var sourceNotes: [String] {
        guard let context else { return [] }
        var notes: [String] = ["\(sort.label): \(sort.source)."]
        if let label = context.inSeason.projectionSourceLabel {
            notes.append("Start line: the projected points of the last player your league starts at each position, from \(label).")
        }
        if let note = context.statsSeasonNote { notes.append(note) }
        if !context.inSeason.unavailable.isEmpty {
            notes.append("Unavailable: " + context.inSeason.unavailable.joined(separator: ", ") + ".")
        }
        return notes
    }
}

// MARK: - Row building

/// Turns a league context into board rows. Pure once built; kept separate so
/// the joins — Sleeper id to gsis id, per-week team target totals — happen once.
struct RowBuilder {
    let context: LeagueContext
    let trending: [String: Int]
    let projectedLines: [Position: PositionBaseline]
    private let profilesBySleeper: [String: SeasonProfile]
    private let gsisBySleeper: [String: String]
    /// Targets thrown by each team in each week, from every Sleeper line.
    private let teamTargets: [Int: [String: Double]]
    private let lines: [String: TeamGameLine]
    private let neededByWeek: [Int: Set<Position>]
    private let scoring: [String: Double]

    init(context: LeagueContext, trending: [String: Int]) {
        self.context = context
        self.trending = trending
        self.scoring = context.league.scoringSettings ?? [:]
        self.gsisBySleeper = context.gsisIDsBySleeper

        let byGSIS = Dictionary(context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
        profilesBySleeper = context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
            if let profile = byGSIS[pair.key] { out[pair.value] = profile }
        }

        var targets: [Int: [String: Double]] = [:]
        for (week, linesByID) in context.inSeason.weekStats {
            var byTeam: [String: Double] = [:]
            for line in linesByID.values {
                guard let team = line.team, let tgt = line.targets else { continue }
                byTeam[NFLTeams.nflverse(team) ?? team, default: 0] += tgt
            }
            targets[week] = byTeam
        }
        teamTargets = targets

        lines = GameLines.week(context.schedule, week: context.currentWeek)

        var needed: [Int: Set<Position>] = [:]
        if let mine = context.userTeam {
            let outlook = ByeCrunch.outlook(
                roster: mine.roster, template: context.template, calendar: context.byeCalendar, weeks: context.remainingWeeks
            )
            for (week, report) in outlook where report.totalShortfall > 0 {
                needed[week] = report.neededPositions
            }
        }
        neededByWeek = needed

        var projectedByPosition: [Position: [Double]] = [:]
        for projection in context.inSeason.projections.values {
            guard let position = projection.position else { continue }
            projectedByPosition[position, default: []].append(projection.score(scoring: scoring).points)
        }
        projectedLines = Baselines.lines(
            byPosition: projectedByPosition, template: context.template, teamCount: context.teams.count
        )
    }

    private var startablePositions: Set<Position> {
        Set(context.template.starters.flatMap { $0.eligible })
    }

    /// Free agents and rivals' bench players at positions the league starts,
    /// keeping only those with at least one measure — a name with no number
    /// on any column is not a candidate, it is noise.
    func acquirableRows() -> [WaiverRow] {
        let positions = startablePositions
        var out: [WaiverRow] = []
        for player in context.players.activePlayers() {
            guard let position = player.position, positions.contains(position) else { continue }
            let availability = context.availability(ofSleeperID: player.id)
            switch availability {
            case .freeAgent, .rivalBench: break
            case .mine, .rivalStarter: continue
            }
            let row = self.row(for: player, position: position, availability: availability)
            let hasAnyMeasure = WaiverSort.allCases.contains { row.value($0) != nil }
            if hasAnyMeasure { out.append(row) }
        }
        return out
    }

    /// Your bench, as rows, with the IR eligibility a drop decision needs.
    func dropCandidates() -> [DropCandidate] {
        guard let mine = context.userTeam else { return [] }
        return mine.benchIDs.compactMap { id -> DropCandidate? in
            guard let player = context.players[id], let position = player.position else { return nil }
            let row = self.row(for: player, position: position, availability: .mine)
            let severity = InjurySeverity.from(tag: player.injuryStatus, report: context.practiceReport(sleeperID: id))
            return DropCandidate(
                row: row,
                irEligible: severity == .reserve,
                maybeIRWithLeagueSetting: severity == .out
            )
        }
        .sorted { a, b in
            // Weakest first on the projection, unvalued last — the ones you
            // would drop, not the ones you would keep.
            switch (a.row.projected, b.row.projected) {
            case let (x?, y?): return x < y
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return a.row.name < b.row.name
            }
        }
    }

    func row(for player: IndexedPlayer, position: Position, availability: Availability) -> WaiverRow {
        let id = player.id
        let team = context.nflTeam(of: id)
        let gsis = gsisBySleeper[id]
        let profile = profilesBySleeper[id]
        let recent = Array(context.inSeason.statLines(sleeperID: id).filter(\.played).suffix(4))

        let projected = context.projectedPoints(id)
        let overLine: Double? = {
            guard let projected, let line = projectedLines[position]?.startLine else { return nil }
            return projected - line
        }()

        let snapShares = recent.compactMap { Position.idp.contains(position) ? $0.defensiveSnapShare : $0.offensiveSnapShare }
        let targetShares: [Double] = recent.compactMap { line in
            guard let week = line.week, let lineTeam = line.team, let tgt = line.targets,
                  let total = teamTargets[week]?[NFLTeams.nflverse(lineTeam) ?? lineTeam], total > 0 else { return nil }
            return tgt / total
        }
        let redZone: Double? = {
            let touches = recent.compactMap { line -> Double? in
                let rz = (line.redZoneTargets ?? 0) + (line.redZoneCarries ?? 0)
                return line.redZoneTargets == nil && line.redZoneCarries == nil ? nil : rz
            }
            return touches.isEmpty ? nil : touches.reduce(0, +)
        }()
        let expected: Double? = {
            guard let gsis, let weeks = context.inSeason.usage?.recentWeeks(for: gsis, count: 4) else { return nil }
            let points = weeks.compactMap(\.expectedPoints)
            return points.isEmpty ? nil : points.reduce(0, +) / Double(points.count)
        }()

        let byeWeek = context.seasonWeeks.first { context.byeCalendar.isOnBye(team: team, week: $0) }
        let covers = neededByWeek.keys.sorted().filter { week in
            neededByWeek[week]?.contains(position) == true && !context.byeCalendar.isOnBye(team: team, week: week)
        }

        return WaiverRow(
            id: id,
            name: player.name,
            position: position,
            team: team,
            opponent: team.flatMap { lines[$0]?.opponent },
            availability: availability,
            byeWeek: byeWeek,
            injuryTag: player.hasInjuryDesignation ? player.injuryStatus : nil,
            playsThisWeek: !context.byeCalendar.isOnBye(team: team, week: context.currentWeek),
            isLocked: context.isLocked(id),
            projected: projected,
            projectedOverLine: overLine,
            expectedPoints: expected,
            snapShare: snapShares.isEmpty ? nil : snapShares.reduce(0, +) / Double(snapShares.count),
            targetShare: targetShares.isEmpty ? nil : targetShares.reduce(0, +) / Double(targetShares.count),
            redZoneTouches: redZone,
            sleeperPointsPerGame: context.sleeperPointsPerGame(id),
            sleeperGames: recent.count,
            seasonPointsPerGame: profile?.pointsPerGame,
            trendingAdds: trending[id],
            signals: profile.map { AcquisitionSignals.signals(for: $0, baselines: context.baselines) } ?? [],
            coversWeeks: covers
        )
    }
}
