import Foundation
import FCCore
import FCData

/// How much an injury costs to ignore, worst first. Drives the order of the
/// Injury Center and nothing else — it is a sort key, not a verdict.
public enum InjurySeverity: Int, Hashable, Sendable, Comparable {
    case out = 0
    case doubtful = 1
    /// Questionable, and did not practice on the latest report.
    case questionableNoPractice = 2
    case questionable = 3
    /// IR, PUP, suspended and the other reserve tags — already out of the
    /// lineup, so nothing to decide this week.
    case reserve = 4
    case other = 5

    public static func < (lhs: InjurySeverity, rhs: InjurySeverity) -> Bool { lhs.rawValue < rhs.rawValue }

    /// Tags Sleeper uses for players parked on a reserve list.
    static let reserveTags: Set<String> = ["IR", "PUP", "SUS", "NA", "DNR", "COV"]

    static func from(tag: String?, report: PracticeReport?) -> InjurySeverity {
        if let designation = report?.designation {
            switch designation {
            case .out: return .out
            case .doubtful: return .doubtful
            case .questionable:
                return report?.practice == .didNotParticipate ? .questionableNoPractice : .questionable
            }
        }
        guard let tag = tag?.uppercased(), !tag.isEmpty else { return .other }
        if reserveTags.contains(tag) { return .reserve }
        switch tag {
        case "OUT": return .out
        case "DOUBTFUL": return .doubtful
        case "QUESTIONABLE":
            return report?.practice == .didNotParticipate ? .questionableNoPractice : .questionable
        default: return .other
        }
    }
}

/// One of the user's players with an injury signal from any source: Sleeper's
/// tag, the official report's designation, or a limited practice.
public struct InjuredPlayer: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: Position?
    public let team: String?
    public let isStarter: Bool
    /// The slot he currently fills — `"RB"`, `"SUPER_FLEX"` — or `nil` on the bench.
    public let slotToken: String?
    /// Sleeper's tag, as sent: "Questionable", "Out", "IR".
    public let sleeperTag: String?
    public let bodyPart: String?
    public let notes: String?
    /// The official report line, when he is on it this week.
    public let report: PracticeReport?
    public let kickoff: Date?
    public let isLocked: Bool
    /// When the Sleeper tag was downloaded; a tag is only as current as that.
    public let tagAsOf: Date
    /// Rotowire's projection under the league's scoring, when there is one.
    public let projectedPoints: Double?
    public let severity: InjurySeverity

    /// "Questionable · Toe · Limited practice", from whatever is known.
    public var headline: String {
        var parts: [String] = []
        if let designation = report?.designation { parts.append(designation.rawValue) }
        else if let tag = sleeperTag, !tag.isEmpty { parts.append(tag) }
        if let injury = report?.injury ?? bodyPart, !injury.isEmpty { parts.append(injury) }
        if let practice = report?.practice { parts.append(practice.phrase) }
        return parts.isEmpty ? "Injury tag" : parts.joined(separator: " · ")
    }
}

/// Someone who stands to gain from an injury: the next names on the team's
/// official depth chart at that position, with what they have actually been
/// doing.
public struct Beneficiary: Hashable, Sendable, Identifiable {
    public let id: String
    public let sleeperID: String?
    public let name: String
    public let position: Position?
    public let team: String?
    public let availability: Availability
    /// One-based depth behind the injured player.
    public let depthBehind: Int
    public let lastSnapShare: Double?
    public let lastExpectedPoints: Double?
    public let projectedPoints: Double?
    public let sleeperPointsPerGame: Double?
}

/// An injured player anywhere in the league and the names behind him.
public struct InjuryOpening: Hashable, Sendable, Identifiable {
    public let id: String
    public let injuredName: String
    public let position: Position?
    public let team: String?
    public let availability: Availability
    public let headline: String
    public let severity: InjurySeverity
    public let beneficiaries: [Beneficiary]
}

/// A rival's tagged starter, and whether you can offer at that position.
public struct RivalInjury: Hashable, Sendable, Identifiable {
    public let id: String
    public let manager: String
    public let rosterID: Int
    public let playerName: String
    public let position: Position?
    public let headline: String
    public let severity: InjurySeverity
    /// You have a bench player at his position beyond your dedicated slots.
    public let youHaveSurplus: Bool
}

/// The one named basis a replacement list is ranked on. Each is a different
/// question; none is blended into another (§6).
public enum ReplacementBasis: String, CaseIterable, Hashable, Sendable, Identifiable {
    case projected
    case expectedPoints
    case sleeperPointsPerGame

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .projected: return "Projected this week"
        case .expectedPoints: return "Expected points, last 4"
        case .sleeperPointsPerGame: return "This season pts/gm"
        }
    }

    public var hint: String {
        switch self {
        case .projected: return "Rotowire's stat line via Sleeper, in your scoring"
        case .expectedPoints: return "what his usage should have scored (ffopportunity), not his scoring"
        case .sleeperPointsPerGame: return "what he has scored this season, in your scoring"
        }
    }
}

/// A player who could fill the injured player's slot this week.
public struct ReplacementCandidate: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: Position?
    public let team: String?
    public let opponent: String?
    public let availability: Availability
    public let value: Double?
    /// What your best legal lineup gains by having him, on the same basis —
    /// zero when he would not start over what you already have.
    public let lineupGain: Double?
    public let isLocked: Bool
    public let injuryTag: String?
}

/// Injury Center — every injury signal on your roster, who steps into the
/// vacated roles league-wide, and the best fill for each hole.
@MainActor
public final class InjuryCenterModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?
    @Published public private(set) var roster: [InjuredPlayer] = []
    @Published public private(set) var openings: [InjuryOpening] = []
    @Published public private(set) var rivalInjuries: [RivalInjury] = []
    /// Recent news per player on your roster's injury list, fetched
    /// fail-soft; absent when Sleeper's news route could not be read.
    @Published public private(set) var news: [String: [SleeperPlayerNews]] = [:]
    @Published public var basis: ReplacementBasis = .projected
    @Published public private(set) var refreshCount = 0

    private let loader: LeagueContextLoader
    private let sleeper: SleeperService
    private var lastRequest: (leagueID: String, rosterID: Int, season: Int?)?

    public init(loader: LeagueContextLoader, sleeper: SleeperService) {
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
            roster = Self.buildRoster(context: context)
            openings = Self.buildOpenings(context: context)
            rivalInjuries = Self.buildRivalInjuries(context: context)
            await loadNews(for: roster.prefix(8).map(\.id), force: force)
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Your roster

    /// Every one of the user's players with an injury signal, worst first,
    /// starters before bench, soonest kickoff first.
    static func buildRoster(context: LeagueContext) -> [InjuredPlayer] {
        guard let team = context.userTeam else { return [] }
        var out: [InjuredPlayer] = []
        for entry in team.roster {
            let player = context.players[entry.id]
            let report = context.practiceReport(sleeperID: entry.id)
            let hasSignal = (player?.hasInjuryDesignation ?? false)
                || report?.designation != nil
                || (report?.practice != nil && report?.practice != .full)
            guard hasSignal else { continue }
            let slotIndex = team.rawStarters.firstIndex(of: entry.id)
            let slot = slotIndex.flatMap { index -> Slot? in
                index < context.template.starters.count ? context.template.starters[index] : nil
            }
            let nflTeam = context.nflTeam(of: entry.id)
            out.append(
                InjuredPlayer(
                    id: entry.id,
                    name: context.playerName(entry.id) ?? entry.id,
                    position: entry.position,
                    team: nflTeam,
                    isStarter: slotIndex != nil,
                    slotToken: slot?.token,
                    sleeperTag: player?.hasInjuryDesignation == true ? player?.injuryStatus : nil,
                    bodyPart: player?.injuryBodyPart,
                    notes: player?.injuryNotes,
                    report: report,
                    kickoff: context.kickoffs.kickoff(team: nflTeam, week: context.currentWeek),
                    isLocked: context.isLocked(entry.id),
                    tagAsOf: context.players.builtAt,
                    projectedPoints: context.projectedPoints(entry.id),
                    severity: InjurySeverity.from(tag: player?.injuryStatus, report: report)
                )
            )
        }
        return out.sorted { a, b in
            if a.severity != b.severity { return a.severity < b.severity }
            if a.isStarter != b.isStarter { return a.isStarter }
            return (a.kickoff ?? .distantFuture) < (b.kickoff ?? .distantFuture)
        }
    }

    // MARK: - Who benefits

    /// For every rostered player in the league with a game designation, the
    /// next names on his team's official depth chart and what they have been
    /// doing. Absent when no depth chart file is loaded.
    static func buildOpenings(context: LeagueContext, maxBehind: Int = 3) -> [InjuryOpening] {
        guard let depth = context.inSeason.depthCharts else { return [] }
        let gsisBySleeper = context.gsisIDsBySleeper
        var out: [InjuryOpening] = []

        for team in context.teams {
            for entry in team.roster {
                guard let position = entry.position, position != .def else { continue }
                let player = context.players[entry.id]
                let report = context.practiceReport(sleeperID: entry.id)
                let severity = InjurySeverity.from(tag: player?.injuryStatus, report: report)
                guard severity <= .reserve, severity != .other else { continue }
                guard let gsis = gsisBySleeper[entry.id] else { continue }
                let nflTeam = context.nflTeam(of: entry.id)
                let behind = depth.behind(gsisID: gsis, team: nflTeam, position: position).prefix(maxBehind)
                guard !behind.isEmpty else { continue }

                let beneficiaries = behind.enumerated().map { offset, behindGSIS -> Beneficiary in
                    let sleeperID = context.sleeperIDsByGSIS[behindGSIS]
                    let usage = context.inSeason.usage?.recentWeeks(for: behindGSIS, count: 1).last
                    let name = sleeperID.flatMap { context.playerName($0) }
                        ?? context.inSeason.usage?.meta[behindGSIS]?.name
                        ?? behindGSIS
                    return Beneficiary(
                        id: behindGSIS,
                        sleeperID: sleeperID,
                        name: name,
                        position: position,
                        team: nflTeam,
                        availability: sleeperID.map { context.availability(ofSleeperID: $0) } ?? .freeAgent,
                        depthBehind: offset + 1,
                        lastSnapShare: usage?.offensiveSnapShare ?? usage?.defensiveSnapShare,
                        lastExpectedPoints: usage?.expectedPoints,
                        projectedPoints: sleeperID.flatMap { context.projectedPoints($0) },
                        sleeperPointsPerGame: sleeperID.flatMap { context.sleeperPointsPerGame($0) }
                    )
                }

                let injuredHeadline = InjuredPlayer(
                    id: entry.id, name: "", position: position, team: nflTeam, isStarter: false, slotToken: nil,
                    sleeperTag: player?.hasInjuryDesignation == true ? player?.injuryStatus : nil,
                    bodyPart: player?.injuryBodyPart, notes: nil, report: report, kickoff: nil, isLocked: false,
                    tagAsOf: context.players.builtAt, projectedPoints: nil, severity: severity
                ).headline

                out.append(
                    InjuryOpening(
                        id: entry.id,
                        injuredName: context.playerName(entry.id) ?? entry.id,
                        position: position,
                        team: nflTeam,
                        availability: context.availability(ofSleeperID: entry.id),
                        headline: injuredHeadline,
                        severity: severity,
                        beneficiaries: beneficiaries
                    )
                )
            }
        }
        // Yours first, then by severity, then the ones with a free-agent
        // beneficiary — the stash you can still make.
        return out.sorted { a, b in
            let aMine = a.availability == .mine, bMine = b.availability == .mine
            if aMine != bMine { return aMine }
            if a.severity != b.severity { return a.severity < b.severity }
            let aFree = a.beneficiaries.contains { $0.availability == .freeAgent }
            let bFree = b.beneficiaries.contains { $0.availability == .freeAgent }
            if aFree != bFree { return aFree }
            return a.injuredName < b.injuredName
        }
    }

    // MARK: - Rivals

    /// Rivals' tagged starters, flagged when you hold a spare at that position.
    static func buildRivalInjuries(context: LeagueContext) -> [RivalInjury] {
        guard let mine = context.userTeam else { return [] }
        let required = context.template.dedicatedCounts()
        let starting = Set(mine.starterIDs)
        var spareAt: Set<Position> = []
        for entry in mine.roster where !starting.contains(entry.id) {
            guard let position = entry.position else { continue }
            let atPosition = mine.roster.filter { $0.position == position }.count
            if atPosition > (required[position] ?? 0) { spareAt.insert(position) }
        }

        var out: [RivalInjury] = []
        for rival in context.rivals {
            for id in rival.starterIDs {
                let player = context.players[id]
                let report = context.practiceReport(sleeperID: id)
                let severity = InjurySeverity.from(tag: player?.injuryStatus, report: report)
                guard severity <= .questionable else { continue }
                let position = context.position(id)
                let headline = InjuredPlayer(
                    id: id, name: "", position: position, team: nil, isStarter: true, slotToken: nil,
                    sleeperTag: player?.hasInjuryDesignation == true ? player?.injuryStatus : nil,
                    bodyPart: player?.injuryBodyPart, notes: nil, report: report, kickoff: nil, isLocked: false,
                    tagAsOf: context.players.builtAt, projectedPoints: nil, severity: severity
                ).headline
                out.append(
                    RivalInjury(
                        id: id,
                        manager: rival.manager,
                        rosterID: rival.rosterID,
                        playerName: context.playerName(id) ?? id,
                        position: position,
                        headline: headline,
                        severity: severity,
                        youHaveSurplus: position.map { spareAt.contains($0) } ?? false
                    )
                )
            }
        }
        return out.sorted { a, b in
            if a.youHaveSurplus != b.youHaveSurplus { return a.youHaveSurplus }
            if a.severity != b.severity { return a.severity < b.severity }
            return a.playerName < b.playerName
        }
    }

    // MARK: - Replacement Finder

    /// Value of a player on one basis; `nil` means the basis cannot value him.
    func value(of id: String, basis: ReplacementBasis, context: LeagueContext) -> Double? {
        switch basis {
        case .projected:
            return context.projectedPoints(id)
        case .expectedPoints:
            guard let gsis = context.gsisIDsBySleeper[id],
                  let weeks = context.inSeason.usage?.recentWeeks(for: gsis, count: 4) else { return nil }
            let points = weeks.compactMap(\.expectedPoints)
            guard !points.isEmpty else { return nil }
            return points.reduce(0, +) / Double(points.count)
        case .sleeperPointsPerGame:
            return context.sleeperPointsPerGame(id)
        }
    }

    /// Who could fill the injured player's slot this week, ranked on the
    /// current basis: your bench, free agents and rivals' benches, minus
    /// anyone on bye or already locked. Players the basis cannot value are
    /// left out rather than scored as zero.
    public func candidates(for injured: InjuredPlayer, limit: Int = 12) -> [ReplacementCandidate] {
        guard let context, let mine = context.userTeam else { return [] }
        let eligible: Set<Position> = {
            if let token = injured.slotToken,
               let slot = context.template.starters.first(where: { $0.token == token }) {
                return slot.eligible
            }
            return injured.position.map { [$0] } ?? []
        }()
        guard !eligible.isEmpty else { return [] }

        let starting = Set(mine.starterIDs)
        let lines = GameLines.week(context.schedule, week: context.currentWeek)

        struct Scored { let id: String; let value: Double; let availability: Availability }
        var pool: [Scored] = []
        for player in context.players.activePlayers() {
            guard player.id != injured.id, let position = player.position, eligible.contains(position) else { continue }
            let availability = context.availability(ofSleeperID: player.id)
            switch availability {
            case .mine where starting.contains(player.id): continue
            case .rivalStarter: continue
            default: break
            }
            let team = context.nflTeam(of: player.id)
            if context.byeCalendar.isOnBye(team: team, week: context.currentWeek) { continue }
            if context.isLocked(player.id) { continue }
            if InjurySeverity.from(tag: player.injuryStatus, report: context.practiceReport(sleeperID: player.id)) <= .doubtful { continue }
            guard let value = value(of: player.id, basis: basis, context: context) else { continue }
            pool.append(Scored(id: player.id, value: value, availability: availability))
        }
        pool.sort { $0.value > $1.value }

        // Lineup gain: the best legal lineup with him, against the best without
        // — both with the injured player excluded, since that is the question.
        let rosterIDs = mine.roster.map(\.id).filter { $0 != injured.id }
        let locked = Set(rosterIDs.filter { context.isLocked($0) })
        func best(_ ids: [String]) -> Double? {
            LineupOptimizer.optimize(
                currentStarterIDs: mine.rawStarters.map { $0 == injured.id ? "0" : $0 },
                playerIDs: ids,
                template: context.template,
                positions: { context.position($0) },
                valueOf: { self.value(of: $0, basis: self.basis, context: context) },
                locked: locked
            ).proposedTotal
        }
        let baseline = best(rosterIDs)

        return pool.prefix(limit).map { scored in
            let with = best(rosterIDs + [scored.id])
            // A roster nobody on the basis can value has a best lineup worth
            // nothing, so the candidate's whole value is the gain.
            let gain: Double? = {
                guard let with else { return nil }
                return max(0, ((with - (baseline ?? 0)) * 10).rounded() / 10)
            }()
            let team = context.nflTeam(of: scored.id)
            return ReplacementCandidate(
                id: scored.id,
                name: context.playerName(scored.id) ?? scored.id,
                position: context.position(scored.id),
                team: team,
                opponent: team.flatMap { lines[$0]?.opponent },
                availability: scored.availability,
                value: scored.value,
                lineupGain: gain,
                isLocked: false,
                injuryTag: context.injuryStatus(scored.id)
            )
        }
    }

    // MARK: - News

    private func loadNews(for ids: [String], force: Bool) async {
        guard !ids.isEmpty else { news = [:]; return }
        let fetched: [(String, [SleeperPlayerNews])] = await withTaskGroup(of: (String, [SleeperPlayerNews]?).self) { group in
            for id in ids {
                group.addTask { [sleeper] in
                    (id, try? await sleeper.playerNews(playerID: id, force: force).value)
                }
            }
            var out: [(String, [SleeperPlayerNews])] = []
            for await (id, items) in group {
                if let items, !items.isEmpty { out.append((id, items)) }
            }
            return out
        }
        news = Dictionary(fetched, uniquingKeysWith: { first, _ in first })
    }

    /// The freshness line for the whole screen: the league context, then the
    /// in-season sources by name.
    public var sourceNotes: [String] {
        guard let context else { return [] }
        var notes: [String] = []
        if let label = context.inSeason.projectionSourceLabel {
            notes.append("Projections: \(label).")
        }
        if let generated = context.inSeason.depthCharts?.fileMeta?.asOf ?? context.inSeason.depthCharts?.fileMeta?.generated {
            notes.append("Depth charts: official, as of \(generated.prefix(10)).")
        }
        if !context.inSeason.practiceReports.isEmpty {
            notes.append("Practice reports: official NFL injury report via nflverse.")
        } else {
            notes.append("No official injury report for week \(context.currentWeek) yet — Sleeper tags only.")
        }
        if !context.inSeason.unavailable.isEmpty {
            notes.append("Unavailable: " + context.inSeason.unavailable.joined(separator: ", ") + ".")
        }
        return notes
    }
}
