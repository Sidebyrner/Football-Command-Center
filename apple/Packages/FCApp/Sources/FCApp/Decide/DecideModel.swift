import Foundation
import FCCore
import FCData

/// One lineup slot as a start decision: who could fill it and the call.
public struct DecideSlot: Hashable, Sendable, Identifiable {
    public let index: Int
    public let token: String
    public let eligible: Set<Position>
    public let incumbentID: String?
    /// Incumbent first, then eligible bench players by projection.
    public let candidateIDs: [String]
    public let verdict: StartVerdict
    public let isLocked: Bool
    /// Said when Sit/Start's active basis fills this slot differently.
    public let sitStartNote: String?

    public var id: Int { index }

    /// Someone on your bench could take the slot.
    public var hasBenchOption: Bool { candidateIDs.count >= 2 }

    /// Can still change — worth opening even with nobody on the bench, to
    /// look at free agents.
    public var canDecide: Bool { !isLocked }

    /// A real contest the numbers don't settle on their own.
    public var isCloseCall: Bool { canDecide && hasBenchOption && verdict.confidence != .clear }
}

/// Decide — one slot, this week, a firm call. Derived on demand from what
/// Sit/Start, the Waiver Board and Matchup have already loaded, so it is never
/// stale and never fetches anything itself.
@MainActor
public final class DecideModel {
    /// The compare view's column limit.
    public static let columnLimit = LinkBus.compareLimit
    public static let suggestionLimit = 3
    /// Free agents valued for suggestions, best first by the board's numbers.
    static let poolLimit = 40

    private let sitStart: SitStartModel
    private let waivers: WaiverBoardModel
    private let matchup: MatchupModel
    private let discovery: DiscoveryModel

    public init(sitStart: SitStartModel, waivers: WaiverBoardModel, matchup: MatchupModel, discovery: DiscoveryModel) {
        self.sitStart = sitStart
        self.waivers = waivers
        self.matchup = matchup
        self.discovery = discovery
    }

    public var context: LeagueContext? { sitStart.context }

    public var posture: MatchupPosture {
        MatchupPosture.from(mine: matchup.mySide?.projectedTotal, theirs: matchup.opponentSide?.projectedTotal)
    }

    // MARK: - Signals

    /// This week's numbers for a player, each exactly as Sit/Start values it.
    /// Empty for a player who can't start — Sit/Start values nobody on bye or
    /// ruled out.
    public func signals(for id: String) -> [StartSignal: Double] {
        guard let context else { return [:] }
        var out: [StartSignal: Double] = [:]
        out[.projected] = sitStart.value(of: id, basis: .projected, context: context)
        out[.commandCenter] = sitStart.value(of: id, basis: .commandCenter, context: context)
        out[.thisSeason] = sitStart.value(of: id, basis: .thisSeason, context: context)
            ?? sitStart.value(of: id, basis: .seasonAverage, context: context)
        out[.form] = sitStart.value(of: id, basis: .form, context: context)
        out[.environment] = sitStart.value(of: id, basis: .environment, context: context)
        out[.floor] = sitStart.value(of: id, basis: .floor, context: context)
        out[.ceiling] = sitStart.value(of: id, basis: .ceiling, context: context)
        if !out.isEmpty { out[.usage] = discovery.row(for: id)?.expectedPoints }
        return out
    }

    public func input(for id: String, incumbentID: String?) -> StartVerdict.Input {
        guard let context else { return StartVerdict.Input(id: id, name: id) }
        var rival: String?
        switch context.availability(ofSleeperID: id) {
        case .rivalBench(_, let manager), .rivalStarter(_, let manager): rival = manager
        case .freeAgent, .mine: rival = nil
        }
        let team = context.nflTeam(of: id)
        return StartVerdict.Input(
            id: id, name: context.playerName(id) ?? id, position: context.position(id),
            isFreeAgent: context.availability(ofSleeperID: id) == .freeAgent, rivalManager: rival,
            isIncumbent: id == incumbentID, availability: StartAvailability.of(id, context: context),
            onBye: team.map { context.byeCalendar.isOnBye(team: $0, week: context.currentWeek) } ?? false,
            isLocked: context.isLocked(id), practice: context.practiceReport(sleeperID: id)?.practice,
            kickoff: context.kickoffs.kickoff(team: team, week: context.currentWeek),
            signals: signals(for: id)
        )
    }

    public func verdict(ids: [String], incumbentID: String?, slot: String?) -> StartVerdict {
        StartVerdict.compute(ids.map { input(for: $0, incumbentID: incumbentID) }, posture: posture, slot: slot)
    }

    // MARK: - Slots

    public func slots() -> [DecideSlot] {
        guard let context, let team = context.userTeam else { return [] }
        let starters = team.rawStarters
        let startingSet = Set(starters.filter { $0 != SleeperRoster.emptyStarterSlot })
        let reserve = Set(team.reserveIDs)
        let bench = team.roster.map(\.id).filter { !startingSet.contains($0) && !reserve.contains($0) }
        let posture = self.posture

        return context.template.starters.enumerated().map { index, slot in
            let raw = starters.indices.contains(index) ? starters[index] : nil
            let incumbent = raw == SleeperRoster.emptyStarterSlot ? nil : raw
            let others = bench
                .filter { slot.accepts(context.position($0)) && !context.isLocked($0) }
                .sorted { projection($0) > projection($1) }
            let ids = (incumbent.map { [$0] } ?? []) + others
            let inputs = ids.map { input(for: $0, incumbentID: incumbent) }
            let verdict = StartVerdict.compute(inputs, posture: posture, slot: slot.token)
            return DecideSlot(
                index: index, token: slot.token, eligible: slot.eligible, incumbentID: incumbent,
                candidateIDs: ids, verdict: verdict, isLocked: incumbent.map { context.isLocked($0) } ?? false,
                sitStartNote: sitStartNote(index: index, pickID: verdict.pickID, candidates: Set(ids), context: context)
            )
        }
    }

    public func slot(_ index: Int) -> DecideSlot? {
        slots().first { $0.index == index }
    }

    /// Close calls first, then other contests, then slots with nobody on the
    /// bench, then locked slots.
    public func orderedSlots() -> [DecideSlot] {
        let all = slots()
        return all.filter(\.isCloseCall)
            + all.filter { $0.canDecide && $0.hasBenchOption && !$0.isCloseCall }
            + all.filter { $0.canDecide && !$0.hasBenchOption }
            + all.filter { !$0.canDecide }
    }

    /// Bench players each slot, on its own, would start — when one is the
    /// pick in more than one slot. He can only fill one; Sit/Start sets the
    /// whole lineup at once.
    public static func sharedPicks(_ slots: [DecideSlot]) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for slot in slots where slot.canDecide {
            guard let pick = slot.verdict.pickID, pick != slot.incumbentID else { continue }
            out[pick, default: []].append(slot.token)
        }
        return out.filter { $0.value.count > 1 }
    }

    private func sitStartNote(index: Int, pickID: String?, candidates: Set<String>, context: LeagueContext) -> String? {
        guard sitStart.lineup.indices.contains(index), let theirs = sitStart.lineup[index].playerID,
              theirs != pickID, candidates.contains(theirs) else { return nil }
        return "Sit/Start by \(sitStart.basis.label) starts \(context.playerName(theirs) ?? theirs) here."
    }

    private func projection(_ id: String) -> Double {
        let values = signals(for: id)
        return values[.projected] ?? values[.commandCenter] ?? -.infinity
    }

    // MARK: - Free agents

    /// Up to three free agents who play this week and beat the weakest
    /// startable candidate on the same measure — projected, else Command
    /// Center. Each comes with the reason.
    public func suggestions(for slot: DecideSlot, excluding: Set<String> = []) -> [Suggestion] {
        guard let context else { return [] }
        let measure: (String) -> (StartSignal, Double)? = { id in
            if let value = self.sitStart.value(of: id, basis: .projected, context: context) { return (.projected, value) }
            return self.sitStart.value(of: id, basis: .commandCenter, context: context).map { (.commandCenter, $0) }
        }
        let startable = slot.candidateIDs.filter { input(for: $0, incumbentID: slot.incumbentID).blocker == nil }
        let weakest = startable.compactMap { id in measure(id).map { (id, $0) } }.min { $0.1.1 < $1.1.1 }
        let skip = excluding.union(slot.candidateIDs)
        // Only the likeliest few dozen are worth valuing; the long tail of
        // the pool never beats a rostered player.
        let pool = waivers.freeAgents(eligible: slot.eligible)
            .filter { $0.playsThisWeek && !$0.isLocked && !skip.contains($0.id) }
            .filter { !StartAvailability.of($0.id, context: context).blocksStart }
            .sorted { ($0.projected ?? $0.sleeperPointsPerGame ?? -1) > ($1.projected ?? $1.sleeperPointsPerGame ?? -1) }
            .prefix(Self.poolLimit)
        return pool
            .compactMap { row -> Suggestion? in
                guard let (signal, value) = measure(row.id) else { return nil }
                if let weakest {
                    guard value > weakest.1.1 else { return nil }
                    let name = context.playerName(weakest.0) ?? weakest.0
                    return Suggestion(row: row, value: value,
                                      reason: "Beats \(StreamFormat.shortName(name)) on \(signal.label) this week")
                }
                return Suggestion(row: row, value: value, reason: "\(signal.label) \(StartVerdict.one(value)) this week")
            }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.row.name < $1.row.name }
            .prefix(Self.suggestionLimit)
            .map { $0 }
    }

    public struct Suggestion: Hashable, Sendable, Identifiable {
        public let row: WaiverRow
        public let value: Double
        public let reason: String
        public var id: String { row.id }
    }

    /// Free agents at the slot's positions matching a search.
    public func searchFreeAgents(_ query: String, slot: DecideSlot, excluding: [String]) -> [IndexedPlayer] {
        guard let context else { return [] }
        return PlayerLookup.matches(query, in: context, excluding: excluding, limit: 40)
            .filter { player in
                context.availability(ofSleeperID: player.id) == .freeAgent
                    && context.position(player.id).map(slot.eligible.contains) == true
            }
            .prefix(6).map { $0 }
    }

    // MARK: - Sessions

    /// A short-lived compare set for one slot. Never touches the watchlist.
    public func session(for slot: DecideSlot) -> DecideSession {
        let hasSuggestion = !suggestions(for: slot).isEmpty
        let room = hasSuggestion ? Self.columnLimit - 1 : Self.columnLimit
        return DecideSession(slot: slot, ids: Array(slot.candidateIDs.prefix(room)))
    }
}

/// The players in one Decide sheet. Lives as long as the sheet; nothing is
/// saved, and nothing reaches the watchlist.
@MainActor
public final class DecideSession: ObservableObject, Identifiable {
    public let slot: DecideSlot
    @Published public private(set) var ids: [String]

    public nonisolated var id: Int { slot.index }

    public init(slot: DecideSlot, ids: [String]) {
        self.slot = slot
        self.ids = ids
    }

    public var isFull: Bool { ids.count >= DecideModel.columnLimit }

    /// Adds a player; when full, `replacing` names the column to give up.
    public func add(_ id: String, replacing: String? = nil) {
        guard !ids.contains(id) else { return }
        if let replacing, canRemoveFromCompare(replacing) { ids.removeAll { $0 == replacing } }
        guard !isFull else { return }
        ids.append(id)
    }
}

extension DecideSession: CompareSource {
    public var compareIDs: [String] { ids }
    public var compareBaselineID: String? { nil }
    public var incumbentID: String? { slot.incumbentID }
    public var slotToken: String? { slot.token }
    public var supportsBaseline: Bool { false }
    public func setCompareBaseline(_ id: String?) {}
    /// The incumbent stays: the call is always against him.
    public func canRemoveFromCompare(_ id: String) -> Bool { id != slot.incumbentID }
    public func removeFromCompare(_ id: String) {
        guard canRemoveFromCompare(id) else { return }
        ids.removeAll { $0 == id }
    }
    public func compareWasClaimed(_ id: String) -> Bool { false }
}
