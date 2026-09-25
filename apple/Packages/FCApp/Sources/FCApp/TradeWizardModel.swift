import Foundation
import FCCore
import FCData

/// The Trade Desk's four steps, in order.
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

/// How the two sides of a deal are compared. Named on screen every time, with
/// its season, and never folded into a verdict (§6).
public enum TradeBasis: String, CaseIterable, Hashable, Sendable, Identifiable {
    /// This season's points per game from Sleeper's own lines, completed weeks
    /// only. Covers every position, DEF and IDP included.
    case thisSeason
    /// This week's projection (Rotowire via Sleeper) in the league's scoring.
    case projectedWeek
    /// The app's own rest-of-season projection: this season's pace regressed
    /// toward last, usage, and the remaining schedule.
    case restOfSeason
    /// The stats season's nflverse production — last season until the current
    /// one has three weeks.
    case production
    /// The stats season's last four games.
    case form
    /// Points per game over a startable player at his position, on the desk's
    /// primary basis, with superflex demand counted.
    case overStartLine

    public var id: String { rawValue }
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

/// A player as the desk shows him.
public struct TradePlayer: Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let position: Position?
    public let team: String?
    /// His value on every basis the desk could value him on.
    public let values: [TradeBasis: Double]
    /// A bench player his team can spare without breaking a lineup.
    public let isSurplus: Bool
    public let isStarter: Bool
    /// Parked in an IR slot: tradeable, but not depth and not a spare.
    public let isReserve: Bool
    public let availability: StartAvailability

    public func value(_ basis: TradeBasis) -> Double? { values[basis] }

    /// "Q", "Out", "IR"… for a badge; `nil` when healthy.
    public var injuryBadge: String? { availability.badge }
}

/// A rival who has what the goal needs, and whether you have something they need.
public struct PartnerFit: Hashable, Sendable, Identifiable {
    public enum Kind: Int, Hashable, Sendable, Comparable {
        case mutual = 0
        case oneWay = 1
        /// Picked by the manager, not matched: shown whatever the fit.
        case chosen = 2

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
    public var grade: TeamGrade?

    public var id: Int { rival.rosterID }
}

/// One week's shortfall before and after a proposed deal.
public struct ShortfallChange: Hashable, Sendable, Identifiable {
    public let week: Int
    public let before: Int
    public let after: Int

    public var id: Int { week }
}

/// One team's side of a deal: its best lineup and roster room, before and after.
public struct DealSide: Hashable, Sendable {
    /// Best lineup this week on the active basis, counting only valued starters.
    public let lineupBefore: Double?
    public let lineupAfter: Double?
    /// Active (non-IR) roster count after the deal, and the league's limit.
    public let rosterAfter: Int
    public let rosterLimit: Int
    /// Playoff weeks with an unfilled slot, before and after.
    public let playoffShortBefore: Int
    public let playoffShortAfter: Int
    public let gradeBefore: TeamGrade?
    public let gradeAfter: TeamGrade?

    public var lineupDelta: Double? {
        guard let before = lineupBefore, let after = lineupAfter else { return nil }
        return ((after - before) * 10).rounded() / 10
    }

    /// Players this team would have to drop to fit.
    public var mustDrop: Int { max(0, rosterAfter - rosterLimit) }

    public static let empty = DealSide(
        lineupBefore: nil, lineupAfter: nil, rosterAfter: 0, rosterLimit: 0,
        playoffShortBefore: 0, playoffShortAfter: 0, gradeBefore: nil, gradeAfter: nil
    )
}

/// What a proposed deal does, stated as facts.
public struct DealEffects: Hashable, Sendable {
    /// Your remaining weeks where either side of the deal leaves a shortfall.
    public let yourWeeks: [ShortfallChange]
    public let theirWeeks: [ShortfallChange]
    public let you: DealSide
    public let them: DealSide
    /// Things the deal fixes for you, and for them. Only the rival's go in
    /// the pitch — your own reasons are your negotiating position.
    public let yourGains: [String]
    public let theirGains: [String]
    public let warnings: [String]

    public var lineupBefore: Double? { you.lineupBefore }
    public var lineupAfter: Double? { you.lineupAfter }

    public static let empty = DealEffects(
        yourWeeks: [], theirWeeks: [], you: .empty, them: .empty,
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

    /// Sleeper's `trade_deadline` is the last week trades are allowed, so the
    /// deadline week itself is open. 0 means no deadline, and so does 99 —
    /// Sleeper's "never" for leagues that set the deadline past the season.
    public static func from(deadline: Int?, currentWeek: Int) -> TradeWindow {
        guard let deadline, deadline > 0, deadline < 99 else { return .noDeadline }
        if currentWeek > deadline { return .closed(deadlineWeek: deadline) }
        return .open(deadlineWeek: deadline, weeksLeft: deadline - currentWeek)
    }
}

/// Where the desk starts when opened from somewhere with context.
public struct TradeWizardPrefill: Hashable, Sendable {
    public var positions: Set<Position>?
    public var weeks: [Int]?
    public var rivalRosterID: Int?
    public var theirPlayerID: String?
    /// One of your players to offer, kept on the "you send" side whichever
    /// partner is picked.
    public var myPlayerID: String?

    public init(positions: Set<Position>? = nil, weeks: [Int]? = nil, rivalRosterID: Int? = nil,
                theirPlayerID: String? = nil, myPlayerID: String? = nil) {
        self.positions = positions
        self.weeks = weeks
        self.rivalRosterID = rivalRosterID
        self.theirPlayerID = theirPlayerID
        self.myPlayerID = myPlayerID
    }
}

/// A player on a rival's roster, found by name.
public struct TradeSearchResult: Hashable, Sendable, Identifiable {
    public let player: TradePlayer
    public let rival: LeagueTeam

    public var id: String { player.id }
}

/// The Trade Desk: need → partner → deal → approach.
///
/// Sleeper's API is read-only, so the desk ends with a message to send and a
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
    @Published public var basis: TradeBasis {
        didSet { if basis != oldValue { recomputeGrades(); recomputeEffects() } }
    }
    @Published public private(set) var effects: DealEffects = .empty
    @Published public private(set) var polishedPitch: String?
    @Published public private(set) var isPolishing = false
    @Published public private(set) var polishError: String?
    /// Set when a request to open the desk on a team or player couldn't be
    /// followed exactly, saying what happened instead.
    @Published public private(set) var prefillNote: String?
    /// League-relative grades on the active basis, by roster id.
    @Published public private(set) var grades: [Int: TeamGrade] = [:]
    /// False until the rest-of-season projection has been built.
    @Published public private(set) var restOfSeasonReady = false

    public static let partnerSortRule =
        "Sorted by: both of you have something the other needs, then one-way fits, then their best spare player."

    /// The basis needs, surplus and start lines are measured on: this season
    /// once it has completed weeks, the stats season before that.
    public let primaryBasis: TradeBasis

    private let relay: RelayClient?
    private let secrets: SecretStore
    private let profiles: [String: SeasonProfile]
    private let thisSeason: [String: Double]
    private var restOfSeason: [String: Double] = [:]
    private let startLines: [Position: PositionBaseline]
    private var myNeeds: TeamNeeds
    private var needsByRoster: [Int: TeamNeeds] = [:]
    private var polishGeneration = 0
    /// A player the manager asked to offer, applied to every partner picked.
    private var pendingSend: String?

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
            deadline: context.leagueFacts.tradeDeadlineWeek ?? context.league.settings?.effectiveTradeDeadline,
            currentWeek: context.currentWeek
        )

        let byGSIS = Dictionary(context.seasonProfiles.map { ($0.gsisID, $0) }, uniquingKeysWith: { first, _ in first })
        self.profiles = context.sleeperIDsByGSIS.reduce(into: [:]) { out, pair in
            if let profile = byGSIS[pair.key] { out[pair.value] = profile }
        }
        let (season, games) = Self.thisSeasonValues(context: context)
        self.thisSeason = season
        let primary: TradeBasis = season.isEmpty ? .production : .thisSeason
        self.primaryBasis = primary
        self.basis = primary

        // Start lines on the primary basis, with flex slots charged to the
        // positions managers actually start there (superflex QBs above all).
        let flexDemand = FlexDemand.observed(
            template: context.template,
            lineups: context.teams.map { team in
                team.rawStarters.map { $0 == SleeperRoster.emptyStarterSlot ? nil : context.position($0) }
            }
        )
        var byPosition: [Position: [Double]] = [:]
        if primary == .thisSeason {
            let minimumGames = min(Baselines.minimumGamesForLine, Self.completedWeeks(context).count)
            for (id, value) in season where (games[id] ?? 0) >= max(1, minimumGames) {
                if let position = context.position(id) { byPosition[position, default: []].append(value) }
            }
        } else {
            for profile in context.seasonProfiles where profile.games >= Baselines.minimumGamesForLine {
                byPosition[profile.position, default: []].append(profile.pointsPerGame)
            }
        }
        self.startLines = Baselines.lines(
            byPosition: byPosition, template: context.template,
            teamCount: max(context.teams.count, 1), flexDemand: flexDemand
        )
        self.myNeeds = TeamNeeds(needs: [], surplus: [])

        let primaryValues = valueMap(primary)
        for team in context.teams {
            needsByRoster[team.rosterID] = Self.needs(for: team, context: context, values: primaryValues, lines: startLines)
        }
        myNeeds = needsByRoster[context.userRosterID] ?? TeamNeeds(needs: [], surplus: [])
        goals = buildGoals()
        recomputeGrades()

        if let prefill { apply(prefill) }
    }

    /// Builds the rest-of-season projection off the main thread. The desk
    /// works without it; the basis just says it isn't ready.
    public func prepare() async {
        guard !restOfSeasonReady else { return }
        let context = self.context
        let ids = Set(context.teams.flatMap { $0.roster.map(\.id) })
        let values = await Task.detached(priority: .userInitiated) { () -> [String: Double] in
            let projector = CommandCenterProjector(context: context, defense: DefenseLookup.build(context: context))
            var out: [String: Double] = [:]
            for id in ids {
                if let value = projector.project(id)?.restOfSeasonPerGame { out[id] = value }
            }
            return out
        }.value
        restOfSeason = values
        restOfSeasonReady = true
        if basis == .restOfSeason { recomputeGrades(); recomputeEffects() }
    }

    // MARK: - Values

    static func completedWeeks(_ context: LeagueContext) -> [Int] {
        context.inSeason.weekStats.keys.filter { $0 < context.currentWeek }.sorted()
    }

    /// This season's points per game from completed weeks only, so a game in
    /// progress can't swing a trade value.
    static func thisSeasonValues(context: LeagueContext) -> (values: [String: Double], games: [String: Int]) {
        let scoring = context.league.scoringSettings ?? [:]
        var total: [String: Double] = [:], games: [String: Int] = [:]
        for week in completedWeeks(context) {
            for (id, line) in context.inSeason.weekStats[week] ?? [:] where line.played {
                total[id, default: 0] += line.score(scoring: scoring).points
                games[id, default: 0] += 1
            }
        }
        return (total.reduce(into: [:]) { out, pair in out[pair.key] = pair.value / Double(games[pair.key] ?? 1) }, games)
    }

    /// A player's value on one basis; `nil` means "can't value", never zero.
    public func value(_ id: String, _ basis: TradeBasis) -> Double? {
        switch basis {
        case .thisSeason: return thisSeason[id]
        case .projectedWeek: return context.projectedPoints(id)
        case .restOfSeason: return restOfSeason[id]
        case .production: return profiles[id]?.pointsPerGame
        case .form: return profiles[id]?.formPointsPerGame
        case .overStartLine:
            guard let value = value(id, primaryBasis), let position = context.position(id) ?? profiles[id]?.position,
                  let line = startLines[position]?.startLine else { return nil }
            return value - line
        }
    }

    func valueMap(_ basis: TradeBasis) -> [String: Double] {
        var out: [String: Double] = [:]
        for team in context.teams {
            for entry in team.roster {
                if let value = value(entry.id, basis) { out[entry.id] = value }
            }
        }
        return out
    }

    /// What the basis is, in words, with its season — shown with every number.
    public func label(_ basis: TradeBasis) -> String {
        switch basis {
        case .thisSeason: return "\(context.scheduleSeason) pts/gm"
        case .projectedWeek: return "Week \(context.currentWeek) projection"
        case .restOfSeason: return "Rest of season"
        case .production: return "\(context.statsSeason) season pts/gm"
        case .form: return "Last 4 of \(context.statsSeason)"
        case .overStartLine: return "Over start line"
        }
    }

    public func hint(_ basis: TradeBasis) -> String {
        switch basis {
        case .thisSeason:
            let weeks = Self.completedWeeks(context)
            let span = weeks.isEmpty ? "no completed weeks yet" : weeks.count == 1 ? "week \(weeks[0])" : "weeks \(weeks.first!)–\(weeks.last!)"
            return "Sleeper's own \(context.scheduleSeason) lines in your scoring, \(span) — covers DEF and IDP"
        case .projectedWeek: return "Rotowire's week \(context.currentWeek) stat line via Sleeper, in your scoring"
        case .restOfSeason:
            return restOfSeasonReady
                ? "our own: this season regressed toward last, usage, and the remaining schedule"
                : "still being built — a moment"
        case .production: return "nflverse production from \(context.statsSeason), in your scoring — no DEF or IDP"
        case .form: return "the last four games of \(context.statsSeason)"
        case .overStartLine:
            return "\(label(primaryBasis).lowercased()) above a startable player at his position — superflex QBs counted"
        }
    }

    /// Bases worth offering: those that can value someone right now.
    public var availableBases: [TradeBasis] {
        TradeBasis.allCases.filter { basis in
            switch basis {
            case .thisSeason: return !thisSeason.isEmpty
            case .projectedWeek: return context.inSeason.hasProjections
            case .restOfSeason: return true
            case .production, .form: return !profiles.isEmpty
            case .overStartLine: return !startLines.isEmpty
            }
        }
    }

    // MARK: - Rosters

    /// A team's roster without its IR slots — the players who count as depth.
    static func activeRoster(_ team: LeagueTeam) -> [RosterEntry] {
        let reserve = Set(team.reserveIDs)
        return team.roster.filter { !reserve.contains($0.id) }
    }

    static func needs(for team: LeagueTeam, context: LeagueContext, values: [String: Double],
                      lines: [Position: PositionBaseline]) -> TeamNeeds {
        TeamNeedsBuilder.build(
            roster: activeRoster(team),
            starters: team.rawStarters,
            template: context.template,
            values: values,
            baselines: lines,
            calendar: context.byeCalendar,
            weeks: context.remainingWeeks,
            includeFlexStarters: true
        )
    }

    /// Active roster spots a team can hold: every starting slot plus the bench.
    var rosterLimit: Int { context.template.totalStarterSlots + context.template.benchCount }

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
    /// flex. Upgrades come after every short week, weakest starter first.
    func buildGoals() -> [TradeGoal] {
        let ordered = myNeeds.needs.sorted { a, b in
            func key(_ need: Need) -> (Int, Int, Double) {
                switch need.kind {
                case .shortWeeks(let weeks): return (weeks.min() ?? Int.max, need.viaFlex ? 1 : 0, 0)
                case .weakStarter(_, let gap): return (Int.max, 0, -gap)
                }
            }
            let (ka, kb) = (key(a), key(b))
            if ka.0 != kb.0 { return ka.0 < kb.0 }
            if ka.1 != kb.1 { return ka.1 < kb.1 }
            return ka.2 < kb.2
        }
        let unit = primaryBasis == .thisSeason ? "pts/gm this season" : "pts/gm in \(context.statsSeason)"
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
                let position = context.position(id)?.rawValue ?? label
                return TradeGoal(
                    id: need.id, positions: need.positions, weeks: [],
                    title: need.viaFlex ? "Upgrade your flex \(position)" : "Upgrade \(label)",
                    detail: "Your starter \(name) is \(Self.oneDecimal(gap)) \(unit) below the \(position) start line.",
                    upgradeOverID: id
                )
            }
        }
    }

    /// Picks a goal. Choosing the goal already in progress keeps the deal.
    public func choose(goal: TradeGoal) {
        guard goal != self.goal else {
            step = .partner
            return
        }
        self.goal = goal
        partners = buildPartners(for: goal)
        partner = nil
        sending = []
        receiving = []
        dealEdited()
        step = .partner
    }

    /// A goal the manager picked by position rather than from their needs.
    public func choose(position: Position) {
        let existing = goals.first { $0.positions == [position] && !$0.weeks.isEmpty }
        choose(goal: existing ?? anyGoal(position))
    }

    private func anyGoal(_ position: Position) -> TradeGoal {
        TradeGoal(
            id: "pick-\(position.rawValue)", positions: [position], weeks: [],
            title: "Any \(position.rawValue)",
            detail: "You picked \(position.rawValue) yourself.",
            upgradeOverID: nil
        )
    }

    // MARK: - Step 2: partners

    func buildPartners(for goal: TradeGoal) -> [PartnerFit] {
        let bar = goal.upgradeOverID.flatMap { value($0, primaryBasis) }

        return context.rivals.compactMap { rival -> PartnerFit? in
            guard let theirNeeds = needsByRoster[rival.rosterID] else { return nil }
            let surplusIDs = Set(theirNeeds.surplus.map(\.playerID))
            let starters = Set(rival.starterIDs)

            let offer = Self.activeRoster(rival).compactMap { entry -> TradePlayer? in
                guard let position = entry.position, goal.positions.contains(position) else { return nil }
                if StartAvailability.of(entry.id, context: context).blocksStart { return nil }
                if !goal.weeks.isEmpty {
                    // Must play at least one of the weeks, and be spare.
                    guard surplusIDs.contains(entry.id),
                          goal.weeks.contains(where: { !context.byeCalendar.isOnBye(team: entry.team, week: $0) })
                    else { return nil }
                } else if let bar {
                    // An upgrade must beat the starter it replaces.
                    guard let value = value(entry.id, primaryBasis), value > bar else { return nil }
                } else {
                    guard surplusIDs.contains(entry.id) else { return nil }
                }
                return player(entry.id, surplus: surplusIDs.contains(entry.id), starter: starters.contains(entry.id))
            }
            .sorted(by: surplusFirst)
            guard !offer.isEmpty else { return nil }

            let (yourOffer, needFacts) = yourOffer(for: rival, goal: goal)

            var facts: [String] = []
            let spareCount = offer.filter(\.isSurplus).count
            if spareCount > 0 {
                let positions = goal.positionLabel
                let verb = spareCount == 1 ? "plays" : "play"
                let weeks = goal.weeks.isEmpty ? "" : " who \(verb) \(Self.weekList(goal.weeks))"
                facts.append("Has \(spareCount) spare \(positions)\(spareCount == 1 ? "" : "s")\(weeks)")
            }
            if let bar, let best = offer.first, let value = best.value(primaryBasis) {
                facts.append("\(best.name) averages \(Self.oneDecimal(value - bar)) more \(unitPhrase) than your starter")
            }
            facts.append(contentsOf: needFacts)

            var fit = PartnerFit(
                rival: rival,
                kind: yourOffer.isEmpty ? .oneWay : .mutual,
                theirOffer: offer,
                yourOffer: yourOffer,
                facts: facts
            )
            fit.grade = grades[rival.rosterID]
            return fit
        }
        .sorted {
            if $0.kind != $1.kind { return $0.kind < $1.kind }
            return ($0.theirOffer.first?.value(primaryBasis) ?? -1) > ($1.theirOffer.first?.value(primaryBasis) ?? -1)
        }
    }

    /// Your spare, healthy players at positions a rival needs, with the reasons.
    private func yourOffer(for rival: LeagueTeam, goal: TradeGoal?) -> ([TradePlayer], [String]) {
        guard let theirNeeds = needsByRoster[rival.rosterID] else { return ([], []) }
        var offer: [TradePlayer] = []
        var facts: [String] = []
        for need in theirNeeds.needs {
            let matches = myNeeds.surplus.filter { spare in
                guard need.positions.contains(spare.position),
                      !StartAvailability.of(spare.playerID, context: context).blocksStart else { return false }
                if let weeks = need.weeks { return weeks.contains(where: spare.playsWeeks.contains) }
                if case .weakStarter(let id, _) = need.kind, let theirs = value(id, primaryBasis) {
                    return (spare.value ?? -1) > theirs
                }
                return false
            }
            guard let best = matches.first else { continue }
            let label = need.positions.map(\.rawValue).sorted().joined(separator: "/")
            let bestName = context.playerName(best.playerID) ?? best.playerID
            switch need.kind {
            case .shortWeeks(let weeks):
                facts.append("Short at \(label) in \(Self.weekList(weeks)) — you have a spare \(best.position.rawValue) (\(bestName))")
            case .weakStarter:
                facts.append("Their \(label) starter is below the start line — \(bestName) would start for them")
            }
            for match in matches where !offer.contains(where: { $0.id == match.playerID }) {
                offer.append(player(match.playerID, surplus: true, starter: false))
            }
        }
        // Sending a player at the position you're trading for makes the hole
        // worse, so those come last.
        let positions = goal?.positions ?? []
        let sorted = offer.sorted { a, b in
            let aHurts = a.position.map(positions.contains) ?? false
            let bHurts = b.position.map(positions.contains) ?? false
            if aHurts != bHurts { return !aHurts }
            return surplusFirst(a, b)
        }
        return (sorted, facts)
    }

    /// Any rival as a partner, whatever the fit — for a team or player the
    /// manager picked directly.
    func chosenFit(for rival: LeagueTeam, goal: TradeGoal?) -> PartnerFit {
        let surplusIDs = Set(needsByRoster[rival.rosterID]?.surplus.map(\.playerID) ?? [])
        let starters = Set(rival.starterIDs)
        let offer = rival.roster
            .filter { entry in goal.map { g in entry.position.map(g.positions.contains) ?? false } ?? true }
            .map { player($0.id, surplus: surplusIDs.contains($0.id), starter: starters.contains($0.id)) }
            .sorted(by: surplusFirst)
        let (yourOffer, facts) = yourOffer(for: rival, goal: goal)
        var fit = PartnerFit(rival: rival, kind: .chosen, theirOffer: offer, yourOffer: yourOffer,
                             facts: ["You picked \(rival.manager)."] + facts)
        fit.grade = grades[rival.rosterID]
        return fit
    }

    /// Picks a partner. Choosing the partner already in progress keeps the deal.
    public func choose(partner: PartnerFit) {
        guard partner.rival.rosterID != self.partner?.rival.rosterID else {
            step = .deal
            return
        }
        self.partner = partner
        // Start from the most obvious deal: their best healthy fit for yours.
        receiving = partner.theirOffer.first { !$0.isReserve }.map { [$0.id] } ?? []
        sending = pendingSend.map { [$0] } ?? partner.yourOffer.first.map { [$0.id] } ?? []
        dealEdited()
        step = .deal
    }

    // MARK: - Finding a player

    /// Any player on any rival's roster, by forgiving name search.
    public func search(_ query: String, limit: Int = 20) -> [TradeSearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return [] }
        var scored: [(TradeSearchResult, Int)] = []
        for rival in context.rivals {
            let starters = Set(rival.starterIDs)
            for entry in rival.roster {
                guard let name = context.playerName(entry.id) else { continue }
                let team = entry.team.flatMap { NFLTeams.nflverse($0) }
                let extra = [team, NFLTeams.name(abbreviation: team), rival.manager].compactMap { $0 }
                guard let score = FuzzyNameMatch.score(query: trimmed, name: name, extra: extra) else { continue }
                scored.append((TradeSearchResult(player: player(entry.id, surplus: false, starter: starters.contains(entry.id)), rival: rival), score))
            }
        }
        return scored
            .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : ($0.0.player.value(primaryBasis) ?? -1) > ($1.0.player.value(primaryBasis) ?? -1) }
            .prefix(limit)
            .map(\.0)
    }

    /// Jumps straight to a deal for one rival's player.
    public func target(_ result: TradeSearchResult) {
        let position = result.player.position
        let goal = position.flatMap { p in goals.first { $0.positions.contains(p) } } ?? position.map(anyGoal)
        if let goal, goal != self.goal {
            self.goal = goal
            partners = buildPartners(for: goal)
        }
        let fit = partners.first { $0.rival.rosterID == result.rival.rosterID } ?? chosenFit(for: result.rival, goal: nil)
        partner = nil
        choose(partner: fit)
        receiving = [result.player.id]
        dealEdited()
    }

    // MARK: - Step 3: the deal

    /// Your players, spare ones first, IR last.
    public var yourPlayers: [TradePlayer] {
        guard let team = context.userTeam else { return [] }
        let spare = Set(myNeeds.surplus.map(\.playerID))
        let starters = Set(team.starterIDs)
        return team.roster
            .map { player($0.id, surplus: spare.contains($0.id), starter: starters.contains($0.id)) }
            .sorted(by: surplusFirst)
    }

    /// Their players, spare ones first, IR last.
    public var theirPlayers: [TradePlayer] {
        guard let partner else { return [] }
        let spare = Set(needsByRoster[partner.rival.rosterID]?.surplus.map(\.playerID) ?? [])
        let starters = Set(partner.rival.starterIDs)
        return partner.rival.roster
            .map { player($0.id, surplus: spare.contains($0.id), starter: starters.contains($0.id)) }
            .sorted(by: surplusFirst)
    }

    public func toggleSending(_ id: String) {
        if sending.contains(id) { sending.remove(id) } else { sending.insert(id) }
        dealEdited()
    }

    public func toggleReceiving(_ id: String) {
        if receiving.contains(id) { receiving.remove(id) } else { receiving.insert(id) }
        dealEdited()
    }

    /// Any change to the deal voids a pitch written for the old one — and any
    /// rewrite still in flight for it.
    private func dealEdited() {
        polishGeneration += 1
        polishedPitch = nil
        polishError = nil
        isPolishing = false
        recomputeEffects()
    }

    public var canApproach: Bool {
        partner != nil && !sending.isEmpty && !receiving.isEmpty && !window.isClosed
    }

    /// One side's total on the active basis, counting only players it can
    /// value. `nil` when it can value nobody on that side. Context for the
    /// lineup change, not a verdict: two bench players don't add up to a
    /// starter.
    public func total(_ ids: Set<String>) -> (value: Double, counted: Int, of: Int)? {
        let valued = ids.compactMap { value($0, basis) }
        guard !valued.isEmpty else { return nil }
        return (valued.reduce(0, +), valued.count, ids.count)
    }

    func recomputeEffects() {
        guard let partner, let me = context.userTeam else {
            effects = .empty
            return
        }
        effects = effects(me: me, rival: partner.rival)
    }

    // MARK: - Lineups and grades

    /// A player's value in this week's lineup on the active basis: nothing if
    /// his team is on bye or he can't start.
    private func lineupValue(_ id: String, team: String?) -> Double? {
        if context.byeCalendar.isOnBye(team: context.nflTeam(of: id) ?? team, week: context.currentWeek) { return nil }
        if StartAvailability.of(id, context: context).blocksStart { return nil }
        return value(id, basis)
    }

    /// Best lineup points from a set of players, counting only valued starters.
    func bestLineup(ids: [String], starters: [String], teamOf: [String: String]) -> Double? {
        let positionOf: (String) -> Position? = { self.context.position($0) ?? self.profiles[$0]?.position }
        let proposal = LineupOptimizer.optimize(
            currentStarterIDs: starters, playerIDs: ids, template: context.template,
            positions: positionOf, valueOf: { self.lineupValue($0, team: teamOf[$0]) },
            locked: Set(ids.filter { context.isLocked($0) })
        )
        var total = 0.0
        var counted = 0
        for (index, proposed) in proposal.proposedIDs.enumerated() {
            let chosen = proposed ?? (starters.indices.contains(index) ? starters[index] : nil)
            guard let chosen, chosen != SleeperRoster.emptyStarterSlot, ids.contains(chosen),
                  let v = lineupValue(chosen, team: teamOf[chosen]) else { continue }
            total += v
            counted += 1
        }
        return counted > 0 ? (total * 10).rounded() / 10 : nil
    }

    private func shortWeeks(_ roster: [RosterEntry], weeks: [Int]) -> Int {
        ByeCrunch.outlook(roster: roster, template: context.template, calendar: context.byeCalendar, weeks: weeks)
            .values.filter { $0.totalShortfall > 0 }.count
    }

    /// Grades every team on the active basis.
    func recomputeGrades() {
        grades = gradeLeague(swapping: nil)
    }

    /// League grades, optionally with a deal applied to two rosters.
    private func gradeLeague(swapping deal: (me: Int, rival: Int, sending: Set<String>, receiving: Set<String>)?) -> [Int: TeamGrade] {
        let weeks = context.remainingWeeks
        let inputs = context.teams.map { team -> TeamGrades.Input in
            var roster = Self.activeRoster(team)
            var starters = team.rawStarters
            if let deal {
                let allEntries = context.teams.flatMap(\.roster)
                if team.rosterID == deal.me {
                    roster = roster.filter { !deal.sending.contains($0.id) } + allEntries.filter { deal.receiving.contains($0.id) }
                    starters = starters.map { deal.sending.contains($0) ? SleeperRoster.emptyStarterSlot : $0 }
                } else if team.rosterID == deal.rival {
                    roster = roster.filter { !deal.receiving.contains($0.id) } + allEntries.filter { deal.sending.contains($0.id) }
                    starters = starters.map { deal.receiving.contains($0) ? SleeperRoster.emptyStarterSlot : $0 }
                }
            }
            let teamOf = Dictionary(roster.map { ($0.id, $0.team ?? "") }, uniquingKeysWith: { first, _ in first })
            return TeamGrades.Input(
                rosterID: team.rosterID,
                lineupPoints: bestLineup(ids: roster.map(\.id), starters: starters, teamOf: teamOf),
                shortWeeks: shortWeeks(roster, weeks: weeks),
                remainingWeeks: weeks.count
            )
        }
        return Dictionary(uniqueKeysWithValues: TeamGrades.grade(inputs).map { ($0.rosterID, $0) })
    }

    /// The deal's consequences, computed on the proposed rosters.
    func effects(me: LeagueTeam, rival: LeagueTeam) -> DealEffects {
        let weeks = context.remainingWeeks
        let playoffWeeks = context.leagueFacts.playoffWeeks.filter { weeks.contains($0) }
        let myActive = Self.activeRoster(me), theirActive = Self.activeRoster(rival)
        let myOut = me.roster.filter { sending.contains($0.id) }
        let theirOut = rival.roster.filter { receiving.contains($0.id) }
        let myAfter = myActive.filter { !sending.contains($0.id) } + theirOut
        let theirAfter = theirActive.filter { !receiving.contains($0.id) } + myOut

        func outlook(_ roster: [RosterEntry]) -> [Int: CrunchReport] {
            ByeCrunch.outlook(roster: roster, template: context.template, calendar: context.byeCalendar, weeks: weeks)
        }
        let myBefore = outlook(myActive), myAfterReport = outlook(myAfter)
        let theirBefore = outlook(theirActive), theirAfterReport = outlook(theirAfter)

        func changes(_ before: [Int: CrunchReport], _ after: [Int: CrunchReport]) -> [ShortfallChange] {
            weeks.compactMap { week in
                let b = before[week]?.totalShortfall ?? 0
                let a = after[week]?.totalShortfall ?? 0
                return (a > 0 || b > 0) ? ShortfallChange(week: week, before: b, after: a) : nil
            }
        }
        func shortIn(_ report: [Int: CrunchReport], _ weeks: [Int]) -> Int {
            weeks.filter { (report[$0]?.totalShortfall ?? 0) > 0 }.count
        }
        let yourWeeks = changes(myBefore, myAfterReport)
        let theirWeeks = changes(theirBefore, theirAfterReport)

        func positions(_ report: CrunchReport?) -> String {
            guard let report else { return "" }
            let dedicated = report.shortDedicatedPositions.map(\.rawValue).sorted()
            return (dedicated.isEmpty ? ["FLEX"] : dedicated).joined(separator: "/")
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
                    ? "Covers their \(what) hole in week \(change.week)"
                    : "Narrows their week \(change.week) shortfall from \(change.before) to \(change.after)")
            } else if change.after > change.before {
                warnings.append("Leaves \(rival.manager) short at \(positions(theirAfterReport[change.week])) in week \(change.week) — a harder ask")
            }
        }

        for id in receiving.sorted() {
            if case .unavailable(let status) = StartAvailability.of(id, context: context) {
                warnings.append("\(context.playerName(id) ?? id) is listed \(status)")
            } else if StartAvailability.of(id, context: context) == .questionable {
                warnings.append("\(context.playerName(id) ?? id) is listed Questionable")
            }
        }

        // Roster room, both sides, counting open spots and ignoring IR slots.
        let limit = rosterLimit
        let myCount = myAfter.count, theirCount = theirAfter.count
        if receiving.count > sending.count {
            let extra = receiving.count - sending.count
            let drop = max(0, myCount - limit)
            warnings.append(drop > 0
                ? "You receive \(extra) more player\(extra == 1 ? "" : "s") than you send — you'd need to drop \(drop)"
                : "You receive \(extra) more player\(extra == 1 ? "" : "s") than you send — you have room")
        } else if sending.count > receiving.count {
            let drop = max(0, theirCount - limit)
            if drop > 0 {
                warnings.append("\(rival.manager) would need to drop \(drop) to take \(sending.count - receiving.count) extra player\(sending.count - receiving.count == 1 ? "" : "s")")
            }
        }

        // This week's lineups. Locked players' points stay with their current
        // team this week, so the trade only moves players whose games are ahead.
        let locked = Set((me.roster + rival.roster).map(\.id).filter { context.isLocked($0) })
        let movingOut = sending.subtracting(locked), movingIn = receiving.subtracting(locked)
        let teamOf = Dictionary((me.roster + rival.roster).map { ($0.id, $0.team ?? "") }, uniquingKeysWith: { first, _ in first })
        let myIDs = me.roster.map(\.id), theirIDs = rival.roster.map(\.id)
        let myIDsAfter = myIDs.filter { !movingOut.contains($0) } + movingIn.sorted()
        let theirIDsAfter = theirIDs.filter { !movingIn.contains($0) } + movingOut.sorted()
        let myLineupBefore = bestLineup(ids: myIDs, starters: me.rawStarters, teamOf: teamOf)
        let myLineupAfter = bestLineup(ids: myIDsAfter,
                                       starters: me.rawStarters.map { movingOut.contains($0) ? SleeperRoster.emptyStarterSlot : $0 },
                                       teamOf: teamOf)
        let theirLineupBefore = bestLineup(ids: theirIDs, starters: rival.rawStarters, teamOf: teamOf)
        let theirLineupAfter = bestLineup(ids: theirIDsAfter,
                                          starters: rival.rawStarters.map { movingIn.contains($0) ? SleeperRoster.emptyStarterSlot : $0 },
                                          teamOf: teamOf)
        if let before = myLineupBefore, let after = myLineupAfter, after < before {
            warnings.append("Your best lineup this week drops from \(Self.oneDecimal(before)) to \(Self.oneDecimal(after)) (\(label(basis).lowercased()))")
        }
        if !sending.intersection(locked).isEmpty || !receiving.intersection(locked).isEmpty {
            warnings.append("Players whose games have started score for their current team this week")
        }

        let after = gradeLeague(swapping: (me.rosterID, rival.rosterID, sending, receiving))
        return DealEffects(
            yourWeeks: yourWeeks, theirWeeks: theirWeeks,
            you: DealSide(
                lineupBefore: myLineupBefore, lineupAfter: myLineupAfter,
                rosterAfter: myCount, rosterLimit: limit,
                playoffShortBefore: shortIn(myBefore, playoffWeeks), playoffShortAfter: shortIn(myAfterReport, playoffWeeks),
                gradeBefore: grades[me.rosterID], gradeAfter: after[me.rosterID]
            ),
            them: DealSide(
                lineupBefore: theirLineupBefore, lineupAfter: theirLineupAfter,
                rosterAfter: theirCount, rosterLimit: limit,
                playoffShortBefore: shortIn(theirBefore, playoffWeeks), playoffShortAfter: shortIn(theirAfterReport, playoffWeeks),
                gradeBefore: grades[rival.rosterID], gradeAfter: after[rival.rosterID]
            ),
            yourGains: yourGains, theirGains: theirGains, warnings: warnings
        )
    }

    // MARK: - Step 4: approach

    private var unitPhrase: String {
        primaryBasis == .thisSeason ? "pts/gm this season" : "pts/gm in \(context.statsSeason)"
    }

    /// The deal's own facts, in the order the pitch uses them. These are also
    /// what the local model is given, and all it is allowed to use. Only facts
    /// that help the rival: your own reasons are your negotiating position.
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
            let name = context.playerName(id) ?? id
            if primaryBasis == .thisSeason, let ppg = value(id, .thisSeason) {
                facts.append("\(name) is averaging \(Self.oneDecimal(ppg)) pts/gm this season in our scoring.")
            } else if let ppg = value(id, .production) {
                facts.append("\(name) averaged \(Self.oneDecimal(ppg)) pts/gm in \(context.statsSeason) in our scoring.")
            }
        }
        if let delta = effects.them.lineupDelta, delta > 0 {
            facts.append("It adds about \(Self.oneDecimal(delta)) points to your best lineup this week.")
        }
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
        let token = secrets.load()
        guard let token, !token.isEmpty else {
            polishError = "Add your relay token in Settings to use your AI."
            return
        }
        polishGeneration += 1
        let generation = polishGeneration
        isPolishing = true
        polishError = nil
        let request = RelayClient.TradePitchRequest(facts: pitchFacts, draft: pitch)
        let result = await relay.polishTradePitchResult(request, token: token)
        // The deal changed while the model was writing: this rewrite is for
        // a deal that no longer exists.
        guard generation == polishGeneration else { return }
        isPolishing = false
        switch result {
        case .success(let polished): polishedPitch = polished
        case .failure(.unauthorized): polishError = "Your relay turned down the token. Check it in Settings."
        case .failure(.unreachable): polishError = "Your relay didn't answer in time. The pitch above still works."
        case .failure(.server(let status)): polishError = "Your relay hit an error (\(status)). The pitch above still works."
        case .failure(.emptyResponse): polishError = "Your AI came back empty. The pitch above still works."
        }
    }

    public var sleeperLink: URL? {
        SleeperLinks.team(leagueID: context.league.leagueID)
    }

    // MARK: - Navigation

    /// Steps back without losing the goal, partner or deal.
    public func back() {
        guard let previous = TradeStep(rawValue: step.rawValue - 1) else { return }
        step = previous
    }

    public func advanceToApproach() {
        guard canApproach else { return }
        step = .approach
    }

    private func apply(_ prefill: TradeWizardPrefill) {
        var notes: [String] = []
        if let mine = prefill.myPlayerID {
            if context.userTeam?.roster.contains(where: { $0.id == mine }) == true {
                pendingSend = mine
                if prefill.rivalRosterID == nil {
                    notes.append("\(context.playerName(mine) ?? "Your player") is set to go out — pick what you need and a partner.")
                }
            } else {
                notes.append("\(context.playerName(mine) ?? "That player") is no longer on your roster.")
            }
        }
        if let positions = prefill.positions {
            let weeks = prefill.weeks ?? []
            let match = goals.first { !$0.positions.isDisjoint(with: positions) && (weeks.isEmpty || !Set($0.weeks).isDisjoint(with: weeks)) }
            if let match {
                choose(goal: match)
            } else if let position = positions.sorted(by: { $0.rawValue < $1.rawValue }).first {
                choose(position: position)
            }
        }
        if let rosterID = prefill.rivalRosterID, let rival = context.rivals.first(where: { $0.rosterID == rosterID }) {
            let fit = partners.first { $0.rival.rosterID == rosterID } ?? {
                notes.append("\(rival.manager) isn't a matched partner for this need, so their whole roster is shown.")
                return chosenFit(for: rival, goal: nil)
            }()
            choose(partner: fit)
            if let id = prefill.theirPlayerID {
                if rival.roster.contains(where: { $0.id == id }) {
                    receiving = [id]
                    dealEdited()
                } else {
                    notes.append("\(context.playerName(id) ?? "That player") is no longer on \(rival.manager)'s roster.")
                }
            }
        } else if prefill.rivalRosterID != nil {
            notes.append("That team couldn't be found in your league.")
        }
        prefillNote = notes.isEmpty ? nil : notes.joined(separator: " ")
    }

    // MARK: - Helpers

    func player(_ id: String, surplus: Bool, starter: Bool) -> TradePlayer {
        let profile = profiles[id]
        var values: [TradeBasis: Double] = [:]
        for basis in TradeBasis.allCases {
            if let v = value(id, basis) { values[basis] = v }
        }
        let reserve = context.teams.contains { $0.reserveIDs.contains(id) }
        return TradePlayer(
            id: id,
            name: context.playerName(id) ?? profile?.name ?? id,
            position: context.position(id) ?? profile?.position,
            team: context.nflTeam(of: id) ?? profile?.team,
            values: values,
            isSurplus: surplus && !reserve,
            isStarter: starter,
            isReserve: reserve,
            availability: StartAvailability.of(id, context: context)
        )
    }

    /// Spare first, IR last, then by value on the primary basis.
    func surplusFirst(_ a: TradePlayer, _ b: TradePlayer) -> Bool {
        if a.isReserve != b.isReserve { return !a.isReserve }
        if a.isSurplus != b.isSurplus { return a.isSurplus }
        return (a.value(primaryBasis) ?? -1) > (b.value(primaryBasis) ?? -1)
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
