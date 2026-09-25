import Foundation
import FCCore
import FCData

/// The wizard's four steps, in order.
public enum TradeStep: Int, CaseIterable, Hashable, Sendable, Identifiable {
    case goal
    case partner
    case deal
    case approach

    public var id: Int { rawValue }

    public var title: String {
        switch self {
        case .goal: return "What you need"
        case .partner: return "Who has it"
        case .deal: return "Build the deal"
        case .approach: return "Approach"
        }
    }
}

/// How the two sides of a deal are compared. Named on screen every time, and
/// never folded into a verdict (§6): the wizard shows both totals on one basis
/// and lets the manager judge.
public enum TradeBasis: String, CaseIterable, Hashable, Sendable, Identifiable {
    case season
    case form
    case overStartLine

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .season: return "Season pts/gm"
        case .form: return "Last 4 pts/gm"
        case .overStartLine: return "Over start line"
        }
    }

    public var hint: String {
        switch self {
        case .season: return "what each player averaged, in your scoring"
        case .form: return "recent form only"
        case .overStartLine: return "points per game above a startable player at his position"
        }
    }
}

/// Something the manager could trade for, drawn from their own needs.
public struct TradeGoal: Hashable, Sendable, Identifiable {
    public let id: String
    public let positions: Set<Position>
    /// The weeks the goal is about. Empty means every week — an upgrade.
    public let weeks: [Int]
    public let title: String
    public let detail: String
    /// The starter an upgrade goal would replace, whose value a target must beat.
    public let upgradeOverID: String?

    public var positionLabel: String {
        positions.map(\.rawValue).sorted().joined(separator: "/")
    }
}

/// A player as the wizard shows him.
public struct TradePlayer: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: Position?
    public let team: String?
    public let pointsPerGame: Double?
    public let formPointsPerGame: Double?
    public let overStartLine: Double?
    /// A bench player his team can spare without breaking a lineup.
    public let isSurplus: Bool
    public let isStarter: Bool
    public let injuryStatus: String?

    public func value(_ basis: TradeBasis) -> Double? {
        switch basis {
        case .season: return pointsPerGame
        case .form: return formPointsPerGame
        case .overStartLine: return overStartLine
        }
    }
}

/// A rival who has what the goal needs, and whether you have something they need.
public struct PartnerFit: Hashable, Sendable, Identifiable {
    public enum Kind: Int, Hashable, Sendable, Comparable {
        case mutual = 0
        case oneWay = 1

        public static func < (lhs: Kind, rhs: Kind) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    public let rival: LeagueTeam
    public let kind: Kind
    /// Their players that meet the goal, surplus first.
    public let theirOffer: [TradePlayer]
    /// Your spare players at a position they need.
    public let yourOffer: [TradePlayer]
    /// Named reasons, both directions.
    public let facts: [String]

    public var id: Int { rival.rosterID }
}

/// One week's shortfall before and after a proposed deal.
public struct ShortfallChange: Hashable, Sendable, Identifiable {
    public let week: Int
    public let before: Int
    public let after: Int

    public var id: Int { week }
}

/// What a proposed deal does, stated as facts.
public struct DealEffects: Hashable, Sendable {
    /// Your remaining weeks where either side of the deal leaves a shortfall.
    public let yourWeeks: [ShortfallChange]
    public let theirWeeks: [ShortfallChange]
    /// Your best lineup this week on season points per game, counting only the
    /// starters with stats. `nil` when nobody could be valued.
    public let lineupBefore: Double?
    public let lineupAfter: Double?
    /// Things the deal fixes, for you and for them — the pitch is built from
    /// these.
    public let yourGains: [String]
    public let theirGains: [String]
    public let warnings: [String]

    public static let empty = DealEffects(
        yourWeeks: [], theirWeeks: [], lineupBefore: nil, lineupAfter: nil,
        yourGains: [], theirGains: [], warnings: []
    )
}

/// Whether trades are still allowed, from the league's own setting.
public enum TradeWindow: Hashable, Sendable {
    case noDeadline
    case open(deadlineWeek: Int, weeksLeft: Int)
    case closed(deadlineWeek: Int)

    public var isClosed: Bool {
        if case .closed = self { return true }
        return false
    }

    public var label: String? {
        switch self {
        case .noDeadline: return nil
        case .open(let week, 0): return "Trade deadline is this week (week \(week))"
        case .open(let week, 1): return "1 week until the trade deadline (week \(week))"
        case .open(let week, let left): return "\(left) weeks until the trade deadline (week \(week))"
        case .closed(let week): return "Your league's trade deadline was week \(week). Trades are closed."
        }
    }

    public static func from(deadline: Int?, currentWeek: Int) -> TradeWindow {
        guard let deadline else { return .noDeadline }
        if currentWeek > deadline { return .closed(deadlineWeek: deadline) }
        return .open(deadlineWeek: deadline, weeksLeft: deadline - currentWeek)
    }
}

/// Where the wizard starts when opened from somewhere with context.
public struct TradeWizardPrefill: Hashable, Sendable {
    public var positions: Set<Position>?
    public var weeks: [Int]?
    public var rivalRosterID: Int?
    public var theirPlayerID: String?

    public init(positions: Set<Position>? = nil, weeks: [Int]? = nil, rivalRosterID: Int? = nil, theirPlayerID: String? = nil) {
        self.positions = positions
        self.weeks = weeks
        self.rivalRosterID = rivalRosterID
        self.theirPlayerID = theirPlayerID
    }
}

/// The trade wizard: need → partner → deal → approach.
///
/// Sleeper's API is read-only, so the wizard ends with a message to send and a
/// link into Sleeper, never with a trade proposed on anyone's behalf.
@MainActor
public final class TradeWizardModel: ObservableObject {
    public let context: LeagueContext
    public let window: TradeWindow

    @Published public var step: TradeStep = .goal
    @Published public private(set) var goals: [TradeGoal] = []
    @Published public private(set) var goal: TradeGoal?
    @Published public private(set) var partners: [PartnerFit] = []
    @Published public private(set) var partner: PartnerFit?
    @Published public private(set) var sending: Set<String> = []
    @Published public private(set) var receiving: Set<String> = []
    @Published public var basis: TradeBasis = .season
    @Published public private(set) var effects: DealEffects = .empty
    @Published public private(set) var polishedPitch: String?
    @Published public private(set) var isPolishing = false
    @Published public private(set) var polishError: String?

    public static let partnerSortRule =
        "Sorted by: both of you have something the other needs, then one-way fits, then their best spare player's season points per game."

    private let relay: RelayClient?
    private let secrets: SecretStore
    private let profiles: [String: SeasonProfile]
    private let values: [String: Double]
    private let myNeeds: TeamNeeds
    private var needsByRoster: [Int: TeamNeeds] = [:]

    public init(
        context: LeagueContext,
        relay: RelayClient? = nil,
        secrets: SecretStore = KeychainSecretStore(),
        prefill: TradeWizardPrefill? = nil
    ) {
        self.context = context
        self.relay = relay
        self.secrets = secrets
        self.window = TradeWindow.from(
            deadline: context.league.settings?.effectiveTradeDeadline, currentWeek: context.currentWeek
        )

        let byGSIS = Dictionary(context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
        let profiles: [String: SeasonProfile] = context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
            if let profile = byGSIS[pair.key] { out[pair.value] = profile }
        }
        self.profiles = profiles
        self.values = profiles.mapValues(\.pointsPerGame)

        var byRoster: [Int: TeamNeeds] = [:]
        for team in context.teams {
            byRoster[team.rosterID] = Self.needs(for: team, context: context, values: profiles.mapValues(\.pointsPerGame))
        }
        self.needsByRoster = byRoster
        self.myNeeds = byRoster[context.userRosterID] ?? TeamNeeds(needs: [], surplus: [])
        self.goals = buildGoals()

        if let prefill { apply(prefill) }
    }

    static func needs(for team: LeagueTeam, context: LeagueContext, values: [String: Double]) -> TeamNeeds {
        TeamNeedsBuilder.build(
            roster: team.roster,
            starters: team.rawStarters,
            template: context.template,
            values: values,
            baselines: context.baselines,
            calendar: context.byeCalendar,
            weeks: context.remainingWeeks
        )
    }

    // MARK: - Step 1: goals

    /// Positions the manager can pick directly, in template order.
    public var pickablePositions: [Position] {
        var seen: Set<Position> = []
        var out: [Position] = []
        for slot in context.template.starters {
            for position in slot.eligible.sorted(by: { $0.rawValue < $1.rawValue }) where seen.insert(position).inserted {
                out.append(position)
            }
        }
        return out
    }

    /// Soonest problem week first; within a week, a dedicated slot before a
    /// flex, and positions with production data before DEF and IDP, whose
    /// spare players can only be offered as depth. Upgrades come after every
    /// short week, weakest starter first.
    func buildGoals() -> [TradeGoal] {
        let ordered = myNeeds.needs.sorted { a, b in
            func key(_ need: Need) -> (Int, Int, Int, Double) {
                let covered = need.positions.contains { $0.hasWeeklyProductionData } ? 0 : 1
                switch need.kind {
                case .shortWeeks(let weeks):
                    return (weeks.min() ?? Int.max, need.viaFlex ? 1 : 0, covered, 0)
                case .weakStarter(_, let gap):
                    return (Int.max, 0, covered, -gap)
                }
            }
            let (ka, kb) = (key(a), key(b))
            if ka.0 != kb.0 { return ka.0 < kb.0 }
            if ka.1 != kb.1 { return ka.1 < kb.1 }
            if ka.2 != kb.2 { return ka.2 < kb.2 }
            return ka.3 < kb.3
        }
        return ordered.map { need in
            let label = need.positions.map(\.rawValue).sorted().joined(separator: "/")
            switch need.kind {
            case .shortWeeks(let weeks):
                let weekText = Self.weekList(weeks)
                if need.viaFlex {
                    return TradeGoal(
                        id: need.id, positions: need.positions, weeks: weeks,
                        title: "Flex depth (\(label)) for \(weekText)",
                        detail: "You can't fill a flex spot in \(weekText).",
                        upgradeOverID: nil
                    )
                }
                return TradeGoal(
                    id: need.id, positions: need.positions, weeks: weeks,
                    title: "\(label) depth for \(weekText)",
                    detail: "You can't fill every \(label) slot in \(weekText).",
                    upgradeOverID: nil
                )
            case .weakStarter(let id, let gap):
                let name = context.playerName(id) ?? id
                return TradeGoal(
                    id: need.id, positions: need.positions, weeks: [],
                    title: "Upgrade \(label)",
                    detail: "Your starter \(name) is \(Self.oneDecimal(gap)) pts/gm below the start line.",
                    upgradeOverID: id
                )
            }
        }
    }

    public func choose(goal: TradeGoal) {
        self.goal = goal
        partners = buildPartners(for: goal)
        partner = nil
        sending = []
        receiving = []
        polishedPitch = nil
        step = .partner
    }

    /// A goal the manager picked by position rather than from their needs.
    public func choose(position: Position) {
        let existing = goals.first { $0.positions == [position] && !$0.weeks.isEmpty }
        choose(goal: existing ?? TradeGoal(
            id: "pick-\(position.rawValue)", positions: [position], weeks: [],
            title: "Any \(position.rawValue)",
            detail: "You picked \(position.rawValue) yourself.",
            upgradeOverID: nil
        ))
    }

    // MARK: - Step 2: partners

    func buildPartners(for goal: TradeGoal) -> [PartnerFit] {
        let bar = goal.upgradeOverID.flatMap { values[$0] }

        return context.rivals.compactMap { rival -> PartnerFit? in
            guard let theirNeeds = needsByRoster[rival.rosterID] else { return nil }
            let surplusIDs = Set(theirNeeds.surplus.map(\.playerID))
            let starters = Set(rival.starterIDs)

            let offer = rival.roster.compactMap { entry -> TradePlayer? in
                guard let position = entry.position, goal.positions.contains(position) else { return nil }
                if !goal.weeks.isEmpty {
                    // Must play at least one of the weeks, and be spare.
                    guard surplusIDs.contains(entry.id),
                          goal.weeks.contains(where: { !context.byeCalendar.isOnBye(team: entry.team, week: $0) })
                    else { return nil }
                } else if let bar {
                    // An upgrade must beat the starter it replaces.
                    guard let value = values[entry.id], value > bar else { return nil }
                } else {
                    guard surplusIDs.contains(entry.id) else { return nil }
                }
                return player(entry.id, surplus: surplusIDs.contains(entry.id), starter: starters.contains(entry.id))
            }
            .sorted(by: Self.surplusFirst)
            guard !offer.isEmpty else { return nil }

            // What you could send back: your spare players at positions they need.
            var yourOffer: [TradePlayer] = []
            var needFacts: [String] = []
            for need in theirNeeds.needs {
                let matches = myNeeds.surplus.filter { spare in
                    guard need.positions.contains(spare.position) else { return false }
                    if let weeks = need.weeks { return weeks.contains(where: spare.playsWeeks.contains) }
                    if case .weakStarter(let id, _) = need.kind, let theirs = values[id] {
                        return (spare.value ?? -1) > theirs
                    }
                    return false
                }
                guard let best = matches.first else { continue }
                let label = need.positions.map(\.rawValue).sorted().joined(separator: "/")
                let bestName = context.playerName(best.playerID) ?? best.playerID
                switch need.kind {
                case .shortWeeks(let weeks):
                    needFacts.append("Short at \(label) in \(Self.weekList(weeks)) — you have a spare \(best.position.rawValue) (\(bestName))")
                case .weakStarter:
                    needFacts.append("Their \(label) starter is below the start line — \(bestName) would start for them")
                }
                for match in matches where !yourOffer.contains(where: { $0.id == match.playerID }) {
                    yourOffer.append(player(match.playerID, surplus: true, starter: false))
                }
            }

            var facts: [String] = []
            let spareCount = offer.filter(\.isSurplus).count
            if spareCount > 0 {
                let positions = goal.positionLabel
                let verb = spareCount == 1 ? "plays" : "play"
                let weeks = goal.weeks.isEmpty ? "" : " who \(verb) \(Self.weekList(goal.weeks))"
                facts.append("Has \(spareCount) spare \(positions)\(spareCount == 1 ? "" : "s")\(weeks)")
            }
            if let bar, let best = offer.first, let value = best.pointsPerGame {
                facts.append("\(best.name) averages \(Self.oneDecimal(value - bar)) more pts/gm than your starter")
            }
            facts.append(contentsOf: needFacts)

            return PartnerFit(
                rival: rival,
                kind: yourOffer.isEmpty ? .oneWay : .mutual,
                theirOffer: offer,
                // Sending a player at the position you're trading for makes the
                // hole worse, so those come last.
                yourOffer: yourOffer.sorted { a, b in
                    let aHurts = a.position.map(goal.positions.contains) ?? false
                    let bHurts = b.position.map(goal.positions.contains) ?? false
                    if aHurts != bHurts { return !aHurts }
                    return Self.surplusFirst(a, b)
                },
                facts: facts
            )
        }
        .sorted {
            if $0.kind != $1.kind { return $0.kind < $1.kind }
            return ($0.theirOffer.first?.pointsPerGame ?? -1) > ($1.theirOffer.first?.pointsPerGame ?? -1)
        }
    }

    public func choose(partner: PartnerFit) {
        self.partner = partner
        // Start from the most obvious deal: their best fit for your best fit.
        receiving = partner.theirOffer.first.map { [$0.id] } ?? []
        sending = partner.yourOffer.first.map { [$0.id] } ?? []
        polishedPitch = nil
        recomputeEffects()
        step = .deal
    }

    // MARK: - Step 3: the deal

    /// Your players, spare ones first, for the "you send" picker.
    public var yourPlayers: [TradePlayer] {
        guard let team = context.userTeam else { return [] }
        let spare = Set(myNeeds.surplus.map(\.playerID))
        let starters = Set(team.starterIDs)
        return team.roster
            .map { player($0.id, surplus: spare.contains($0.id), starter: starters.contains($0.id)) }
            .sorted(by: Self.surplusFirst)
    }

    /// Their players, spare ones first.
    public var theirPlayers: [TradePlayer] {
        guard let partner, let theirNeeds = needsByRoster[partner.rival.rosterID] else { return [] }
        let spare = Set(theirNeeds.surplus.map(\.playerID))
        let starters = Set(partner.rival.starterIDs)
        return partner.rival.roster
            .map { player($0.id, surplus: spare.contains($0.id), starter: starters.contains($0.id)) }
            .sorted(by: Self.surplusFirst)
    }

    public func toggleSending(_ id: String) {
        if sending.contains(id) { sending.remove(id) } else { sending.insert(id) }
        polishedPitch = nil
        recomputeEffects()
    }

    public func toggleReceiving(_ id: String) {
        if receiving.contains(id) { receiving.remove(id) } else { receiving.insert(id) }
        polishedPitch = nil
        recomputeEffects()
    }

    public var canApproach: Bool {
        partner != nil && !sending.isEmpty && !receiving.isEmpty && !window.isClosed
    }

    /// Both sides' totals on the active basis, counting only players it can
    /// value. `nil` when it can value nobody on that side.
    public func total(_ ids: Set<String>) -> (value: Double, counted: Int, of: Int)? {
        let valued = ids.compactMap { player($0, surplus: false, starter: false).value(basis) }
        guard !valued.isEmpty else { return nil }
        return (valued.reduce(0, +), valued.count, ids.count)
    }

    func recomputeEffects() {
        guard let partner, let me = context.userTeam else {
            effects = .empty
            return
        }
        effects = Self.effects(
            context: context, me: me, rival: partner.rival,
            sending: sending, receiving: receiving, values: values
        )
    }

    /// The deal's consequences, computed on the proposed rosters.
    static func effects(
        context: LeagueContext,
        me: LeagueTeam,
        rival: LeagueTeam,
        sending: Set<String>,
        receiving: Set<String>,
        values: [String: Double]
    ) -> DealEffects {
        let weeks = context.remainingWeeks
        let myOut = me.roster.filter { sending.contains($0.id) }
        let theirOut = rival.roster.filter { receiving.contains($0.id) }
        let myAfter = me.roster.filter { !sending.contains($0.id) } + theirOut
        let theirAfter = rival.roster.filter { !receiving.contains($0.id) } + myOut

        func outlook(_ roster: [RosterEntry]) -> [Int: CrunchReport] {
            ByeCrunch.outlook(roster: roster, template: context.template, calendar: context.byeCalendar, weeks: weeks)
        }
        let myBefore = outlook(me.roster), myAfterReport = outlook(myAfter)
        let theirBefore = outlook(rival.roster), theirAfterReport = outlook(theirAfter)

        func changes(_ before: [Int: CrunchReport], _ after: [Int: CrunchReport]) -> [ShortfallChange] {
            weeks.compactMap { week in
                let b = before[week]?.totalShortfall ?? 0
                let a = after[week]?.totalShortfall ?? 0
                return (a > 0 || b > 0) ? ShortfallChange(week: week, before: b, after: a) : nil
            }
        }
        let yourWeeks = changes(myBefore, myAfterReport)
        let theirWeeks = changes(theirBefore, theirAfterReport)

        func positions(_ report: CrunchReport?) -> String {
            guard let report else { return "" }
            let dedicated = report.shortDedicatedPositions.map(\.rawValue).sorted()
            let names = dedicated.isEmpty ? ["FLEX"] : dedicated
            return names.joined(separator: "/")
        }

        var yourGains: [String] = []
        var theirGains: [String] = []
        var warnings: [String] = []

        for change in yourWeeks {
            if change.after < change.before {
                let what = positions(myBefore[change.week])
                yourGains.append(change.after == 0
                    ? "Fixes my \(what) hole in week \(change.week)"
                    : "Narrows my week \(change.week) shortfall from \(change.before) to \(change.after)")
            } else if change.after > change.before {
                warnings.append("Leaves you short at \(positions(myAfterReport[change.week])) in week \(change.week)")
            }
        }
        for change in theirWeeks {
            if change.after < change.before {
                let what = positions(theirBefore[change.week])
                theirGains.append(change.after == 0
                    ? "Covers your \(what) hole in week \(change.week)"
                    : "Narrows your week \(change.week) shortfall from \(change.before) to \(change.after)")
            } else if change.after > change.before {
                warnings.append("Leaves \(rival.manager) short at \(positions(theirAfterReport[change.week])) in week \(change.week) — a harder ask")
            }
        }

        for id in receiving.sorted() {
            if let status = context.injuryStatus(id) {
                warnings.append("\(context.playerName(id) ?? id) is listed \(status)")
            }
        }
        if receiving.count > sending.count {
            let extra = receiving.count - sending.count
            warnings.append("You receive \(extra) more player\(extra == 1 ? "" : "s") than you send — you'd need to drop \(extra == 1 ? "one" : "\(extra)")")
        }

        // Your best lineup this week, before and after, on season pts/gm.
        func value(_ id: String) -> Double? {
            if context.byeCalendar.isOnBye(team: context.nflTeam(of: id) ?? rival.roster.first(where: { $0.id == id })?.team, week: context.currentWeek) {
                return nil
            }
            // Out, Doubtful and IR players don't play this week — the same
            // rule Sit/Start uses — so they add nothing to this week's lineup.
            if StartAvailability.of(id, context: context).blocksStart {
                return nil
            }
            return values[id]
        }
        func bestLineup(ids: [String], starters: [String], positionOf: @escaping (String) -> Position?) -> Double? {
            let locked = Set(ids.filter { context.isLocked($0) })
            let proposal = LineupOptimizer.optimize(
                currentStarterIDs: starters, playerIDs: ids, template: context.template,
                positions: positionOf, valueOf: value, locked: locked
            )
            var total = 0.0
            var counted = 0
            for (index, proposed) in proposal.proposedIDs.enumerated() {
                let chosen = proposed ?? (starters.indices.contains(index) ? starters[index] : nil)
                guard let chosen, chosen != SleeperRoster.emptyStarterSlot, let v = value(chosen) else { continue }
                total += v
                counted += 1
            }
            return counted > 0 ? (total * 10).rounded() / 10 : nil
        }
        let positionByID = Dictionary((me.roster + rival.roster).map { ($0.id, $0.position) }, uniquingKeysWith: { first, _ in first })
        let positionOf: (String) -> Position? = { positionByID[$0] ?? context.position($0) }
        let lineupBefore = bestLineup(ids: me.roster.map(\.id), starters: me.rawStarters, positionOf: positionOf)
        let startersAfter = me.rawStarters.map { sending.contains($0) ? SleeperRoster.emptyStarterSlot : $0 }
        let lineupAfter = bestLineup(ids: myAfter.map(\.id), starters: startersAfter, positionOf: positionOf)
        if let before = lineupBefore, let after = lineupAfter, after < before {
            warnings.append("Your best lineup this week drops from \(oneDecimal(before)) to \(oneDecimal(after)) pts/gm")
        }

        return DealEffects(
            yourWeeks: yourWeeks, theirWeeks: theirWeeks,
            lineupBefore: lineupBefore, lineupAfter: lineupAfter,
            yourGains: yourGains, theirGains: theirGains, warnings: warnings
        )
    }

    // MARK: - Step 4: approach

    /// The deal's own facts, in the order the pitch uses them. These are also
    /// what the local model is given, and all it is allowed to use.
    public var pitchFacts: [String] {
        guard partner != nil else { return [] }
        let names: (Set<String>) -> String = { ids in
            ids.map { id -> String in
                let p = self.player(id, surplus: false, starter: false)
                return "\(p.name) (\(p.position?.rawValue ?? "?"))"
            }
            .sorted()
            .joined(separator: " and ")
        }
        var facts = ["I'd send \(names(sending)) for \(names(receiving))."]
        facts.append(contentsOf: effects.theirGains.map { $0 + "." })
        for id in sending.sorted() {
            let p = player(id, surplus: false, starter: false)
            if let ppg = p.pointsPerGame {
                facts.append("\(p.name) is averaging \(Self.oneDecimal(ppg)) pts/gm in our scoring.")
            }
        }
        facts.append(contentsOf: effects.yourGains.map { $0 + "." })
        return facts
    }

    /// The template pitch: a greeting, the facts, a sign-off. Nothing else.
    public var pitch: String {
        guard let partner else { return "" }
        return (["Hey \(partner.rival.manager) — trade idea."] + pitchFacts + ["Open to it?"])
            .joined(separator: " ")
    }

    public var hasRelay: Bool { relay != nil }

    public func polishPitch() async {
        guard let relay else { return }
        isPolishing = true
        polishError = nil
        defer { isPolishing = false }
        let request = RelayClient.TradePitchRequest(facts: pitchFacts, draft: pitch)
        if let polished = await relay.polishTradePitch(request, token: secrets.load()) {
            polishedPitch = polished
        } else {
            polishError = secrets.load() == nil
                ? "Add your relay token in Settings to use your AI."
                : "Your relay didn't answer. The pitch above still works."
        }
    }

    public var sleeperLink: URL? {
        SleeperLinks.team(leagueID: context.league.leagueID)
    }

    // MARK: - Navigation

    public func back() {
        guard let previous = TradeStep(rawValue: step.rawValue - 1) else { return }
        step = previous
    }

    public func advanceToApproach() {
        guard canApproach else { return }
        step = .approach
    }

    private func apply(_ prefill: TradeWizardPrefill) {
        if let positions = prefill.positions {
            let weeks = prefill.weeks ?? []
            let match = goals.first { !$0.positions.isDisjoint(with: positions) && (weeks.isEmpty || !Set($0.weeks).isDisjoint(with: weeks)) }
            if let match {
                choose(goal: match)
            } else if let position = positions.sorted(by: { $0.rawValue < $1.rawValue }).first {
                choose(position: position)
            }
        }
        if let rosterID = prefill.rivalRosterID, let fit = partners.first(where: { $0.rival.rosterID == rosterID }) {
            choose(partner: fit)
            if let id = prefill.theirPlayerID, fit.rival.roster.contains(where: { $0.id == id }) {
                receiving = [id]
                recomputeEffects()
            }
        }
    }

    // MARK: - Helpers

    func player(_ id: String, surplus: Bool, starter: Bool) -> TradePlayer {
        let profile = profiles[id]
        let position = context.position(id) ?? profile?.position
        return TradePlayer(
            id: id,
            name: context.playerName(id) ?? profile?.name ?? id,
            position: position,
            team: context.nflTeam(of: id) ?? profile?.team,
            pointsPerGame: profile?.pointsPerGame,
            formPointsPerGame: profile?.formPointsPerGame,
            overStartLine: profile.flatMap { AcquisitionSignals.valueOverStartLine($0, baselines: context.baselines) },
            isSurplus: surplus,
            isStarter: starter,
            injuryStatus: context.injuryStatus(id)
        )
    }

    static func surplusFirst(_ a: TradePlayer, _ b: TradePlayer) -> Bool {
        if a.isSurplus != b.isSurplus { return a.isSurplus }
        return (a.pointsPerGame ?? -1) > (b.pointsPerGame ?? -1)
    }

    static func weekList(_ weeks: [Int]) -> String {
        let sorted = weeks.sorted()
        switch sorted.count {
        case 0: return "no weeks"
        case 1: return "week \(sorted[0])"
        case 2: return "weeks \(sorted[0]) and \(sorted[1])"
        default:
            return "weeks " + sorted.dropLast().map(String.init).joined(separator: ", ") + " and \(sorted.last!)"
        }
    }

    static func oneDecimal(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}
