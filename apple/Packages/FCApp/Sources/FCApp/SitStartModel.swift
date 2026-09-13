import Foundation
import FCCore
import FCData

/// One way of valuing a player for this week. Each is a **different question**,
/// not a better answer to the same one — the optimizer takes exactly one at a
/// time and the screen always names which (§6, §7.3).
public enum LineupBasis: String, CaseIterable, Hashable, Sendable, Identifiable {
    case seasonAverage
    case form
    case floor
    case ceiling
    /// The only basis that knows nothing about the player. A replacement-level
    /// body in a shootout outranks a stud in a slog — which is the point of
    /// running it *against* the others, not instead of them.
    case environment

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .seasonAverage: return "Season pts/gm"
        case .form: return "Last 4 pts/gm"
        case .floor: return "Floor"
        case .ceiling: return "Ceiling"
        case .environment: return "Game environment"
        }
    }

    public var hint: String {
        switch self {
        case .seasonAverage: return "what he averaged, in your scoring"
        case .form: return "recent form only"
        case .floor: return "his bad week — protect a lead"
        case .ceiling: return "his big week — you need a blowup"
        case .environment: return "his team's implied total — nothing about him"
        }
    }

    /// Whether this basis reads the weekly production file, and so cannot value
    /// DEF or IDP at all.
    public var needsProductionData: Bool { self != .environment }
}

/// Why players could not be valued, split by cause because the causes mean
/// different things: one is a data limit nothing will fix, one resolves once a
/// player has games, and one is about this week only.
public struct UnrankedBreakdown: Hashable, Sendable {
    /// DEF and IDP on a production basis — the weekly file does not cover them.
    public let noProductionData: [String]
    /// A covered position with no line in the stats season: rookies, a missed
    /// year, or a player the crosswalk could not join.
    public let noSeasonLine: [String]
    /// On bye this week. Excluded on every basis, because starting him scores 0.
    public let onBye: [String]
    /// Environment basis only: his team has no recorded line this week.
    public let noGameLine: [String]

    public var total: Int {
        noProductionData.count + noSeasonLine.count + onBye.count + noGameLine.count
    }
}

/// A proposed change, with names attached.
public struct SwapRow: Hashable, Sendable, Identifiable {
    public let slot: String
    public let outName: String?
    public let inName: String
    public let delta: Double

    public var id: String { "\(slot)-\(inName)" }
}

/// A player coming into, or going out of, the starting lineup.
public struct LineupChange: Hashable, Sendable, Identifiable {
    public let playerID: String
    public let name: String
    /// The slot he takes (for a start) or leaves (for a sit).
    public let slot: String
    /// His value on the active basis; `nil` when the basis can't value him.
    public let value: Double?

    public var id: String { playerID }
}

/// A player who starts either way but changes slot — a flex shuffle.
public struct SlotMove: Hashable, Sendable, Identifiable {
    public let playerID: String
    public let name: String
    public let from: String
    public let to: String

    public var id: String { playerID }
}

/// One slot of the proposed lineup.
public struct ProposedSlot: Hashable, Sendable, Identifiable {
    public let index: Int
    public let slot: String
    public let playerID: String?
    public let name: String?
    public let value: Double?
    /// True when the basis could value nobody for this slot, so the current
    /// starter is shown as kept rather than the slot drawn as empty. A DEF slot
    /// on a production basis is the usual case.
    public let keptBecauseUnvalued: Bool
    public let changed: Bool

    public var id: Int { index }
}

/// Sit/Start — "who do I actually play" (§7.3).
@MainActor
public final class SitStartModel: ObservableObject {
    @Published public private(set) var context: LeagueContext?
    @Published public private(set) var isLoading = false
    @Published public private(set) var errorMessage: String?

    @Published public var basis: LineupBasis = .seasonAverage {
        didSet { recompute() }
    }

    @Published public private(set) var proposal: LineupProposal?
    @Published public private(set) var lineup: [ProposedSlot] = []
    @Published public private(set) var swaps: [SwapRow] = []
    @Published public private(set) var unranked = UnrankedBreakdown(
        noProductionData: [], noSeasonLine: [], onBye: [], noGameLine: []
    )
    /// Who comes in, who goes out, and who just changes slot.
    ///
    /// The optimizer reports changes slot by slot, which is exact but reads
    /// badly: moving a flex starter into an RB slot showed as that player being
    /// benched ("RB: Barkley → McCaffrey", then "FLEX: McCaffrey → Smith-Njigba
    /// −6.6") when he starts either way. These three lists say what a manager
    /// actually has to do.
    @Published public private(set) var starts: [LineupChange] = []
    @Published public private(set) var sits: [LineupChange] = []
    @Published public private(set) var moves: [SlotMove] = []

    /// Other bases that reach a *different* lineup. The honest signal: when the
    /// measures disagree, this is a judgement call, not a calculation.
    @Published public private(set) var disagreeingBases: [LineupBasis] = []

    /// Said on screen so its absence is not a mystery: the web app's 0–100 model
    /// score depends on a season-scoring system this port does not have yet.
    public static let modelBasisNote = "The web app's model-score basis is not available here yet."

    private let loader: LeagueContextLoader
    private var profilesBySleeperID: [String: SeasonProfile] = [:]
    private var lines: [String: TeamGameLine] = [:]

    public init(loader: LeagueContextLoader) {
        self.loader = loader
    }

    public var gain: Double? { proposal?.gain }

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

            let byGSIS = Dictionary(
                context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first }
            )
            profilesBySleeperID = context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
                if let profile = byGSIS[pair.key] { out[pair.value] = profile }
            }
            lines = GameLines.week(context.schedule, week: context.currentWeek)
            recompute()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    // MARK: - Valuing

    private func team(of id: String, in context: LeagueContext) -> String? {
        let player = context.players[id]
        return player?.nflverseTeam ?? player?.team ?? (player?.position == .def ? id : nil)
    }

    /// THE BASIS, as a function the optimizer calls. `nil` means "cannot value",
    /// which the optimizer reports and never scores as zero.
    func value(of id: String, basis: LineupBasis, context: LeagueContext) -> Double? {
        // A player on bye scores exactly zero whatever he is worth, so no basis
        // may recommend starting him. The web app did not check this.
        if let team = team(of: id, in: context),
           context.byeCalendar.isOnBye(team: team, week: context.currentWeek) {
            return nil
        }
        switch basis {
        case .seasonAverage: return profilesBySleeperID[id]?.pointsPerGame
        case .form: return profilesBySleeperID[id]?.formPointsPerGame
        case .floor: return profilesBySleeperID[id]?.floor
        case .ceiling: return profilesBySleeperID[id]?.ceiling
        case .environment: return team(of: id, in: context).flatMap { lines[$0]?.impliedTotal }
        }
    }

    func optimize(_ basis: LineupBasis, context: LeagueContext) -> LineupProposal {
        guard let team = context.userTeam else { return .empty }
        return LineupOptimizer.optimize(
            currentStarterIDs: team.rawStarters,
            playerIDs: team.roster.map(\.id),
            template: context.template,
            positions: { context.position($0) },
            valueOf: { self.value(of: $0, basis: basis, context: context) }
        )
    }

    /// What would actually take the field under a proposal: the proposed player
    /// where the basis picked one, otherwise whoever starts now. Comparing
    /// these — rather than raw proposals — stops an unvalued DEF slot from
    /// reading as a disagreement between bases.
    func effectiveLineup(_ proposal: LineupProposal, context: LeagueContext) -> Set<String> {
        let current = context.userTeam?.rawStarters ?? []
        var out: Set<String> = []
        for index in proposal.proposedIDs.indices {
            let chosen = proposal.proposedIDs[index]
                ?? (current.indices.contains(index) ? current[index] : nil)
            if let chosen, chosen != SleeperRoster.emptyStarterSlot { out.insert(chosen) }
        }
        return out
    }

    func recompute() {
        guard let context, let team = context.userTeam else { return }
        let active = optimize(basis, context: context)
        proposal = active

        let name: (String?) -> String? = { id in id.flatMap { context.playerName($0) ?? $0 } }
        let current = team.rawStarters

        lineup = context.template.starters.indices.map { index in
            let proposed = active.proposedIDs.indices.contains(index) ? active.proposedIDs[index] : nil
            let incumbent = current.indices.contains(index) ? current[index] : nil
            let incumbentID = incumbent == SleeperRoster.emptyStarterSlot ? nil : incumbent
            let shown = proposed ?? incumbentID
            return ProposedSlot(
                index: index,
                slot: context.template.starters[index].token,
                playerID: shown,
                name: name(shown),
                value: shown.flatMap { value(of: $0, basis: basis, context: context) },
                keptBecauseUnvalued: proposed == nil && incumbentID != nil,
                changed: proposed != nil && proposed != incumbentID
            )
        }

        swaps = active.swaps.map { swap in
            SwapRow(
                slot: swap.slot.token,
                outName: name(swap.outID),
                inName: name(swap.inID) ?? swap.inID,
                delta: swap.delta
            )
        }

        buildChanges(current: current, context: context)

        unranked = breakdown(active.unranked, context: context)

        let mine = effectiveLineup(active, context: context)
        disagreeingBases = LineupBasis.allCases
            .filter { $0 != basis }
            .filter { effectiveLineup(optimize($0, context: context), context: context) != mine }
    }

    /// Compares the lineup as it stands with the lineup that would take the field.
    private func buildChanges(current: [String], context: LeagueContext) {
        var currentSlot: [String: String] = [:]
        for (index, id) in current.enumerated()
        where id != SleeperRoster.emptyStarterSlot && context.template.starters.indices.contains(index) {
            currentSlot[id] = context.template.starters[index].token
        }
        var proposedSlot: [String: String] = [:]
        for slot in lineup {
            if let id = slot.playerID { proposedSlot[id] = slot.slot }
        }

        func change(_ id: String, slot: String) -> LineupChange {
            LineupChange(
                playerID: id,
                name: context.playerName(id) ?? id,
                slot: slot,
                value: value(of: id, basis: basis, context: context)
            )
        }

        starts = lineup.compactMap { slot in
            guard let id = slot.playerID, currentSlot[id] == nil else { return nil }
            return change(id, slot: slot.slot)
        }
        sits = current.enumerated().compactMap { index, id in
            guard id != SleeperRoster.emptyStarterSlot, proposedSlot[id] == nil,
                  context.template.starters.indices.contains(index) else { return nil }
            return change(id, slot: context.template.starters[index].token)
        }
        moves = lineup.compactMap { slot in
            guard let id = slot.playerID, let from = currentSlot[id], from != slot.slot else { return nil }
            return SlotMove(playerID: id, name: context.playerName(id) ?? id, from: from, to: slot.slot)
        }
    }

    private func breakdown(_ ids: [String], context: LeagueContext) -> UnrankedBreakdown {
        var noProduction: [String] = []
        var noSeason: [String] = []
        var bye: [String] = []
        var noLine: [String] = []

        for id in ids {
            let label = context.playerName(id) ?? id
            if let team = team(of: id, in: context),
               context.byeCalendar.isOnBye(team: team, week: context.currentWeek) {
                bye.append(label)
            } else if basis == .environment {
                noLine.append(label)
            } else if !(context.position(id)?.hasWeeklyProductionData ?? false) {
                noProduction.append(label)
            } else {
                noSeason.append(label)
            }
        }
        return UnrankedBreakdown(
            noProductionData: noProduction.sorted(),
            noSeasonLine: noSeason.sorted(),
            onBye: bye.sorted(),
            noGameLine: noLine.sorted()
        )
    }
}
