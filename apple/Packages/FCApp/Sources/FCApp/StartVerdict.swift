import Foundation
import FCCore

/// One of the separate, named numbers a start decision is argued over. Each is
/// a Sit/Start basis or a usage measure — the same values, so Decide and
/// Sit/Start never disagree about what a player is worth.
public enum StartSignal: String, CaseIterable, Hashable, Sendable, Identifiable {
    case projected, commandCenter, thisSeason, form, usage, environment, floor, ceiling

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .projected: return "Projected"
        case .commandCenter: return "Command Center"
        case .thisSeason: return "This season"
        case .form: return "Last 4"
        case .usage: return "Usage (xFP)"
        case .environment: return "Game environment"
        case .floor: return "Floor"
        case .ceiling: return "Ceiling"
        }
    }

    public var source: String {
        switch self {
        case .projected: return "Rotowire's line via Sleeper, in your scoring"
        case .commandCenter: return "our own: regressed production, usage trend and the matchup"
        case .thisSeason: return "Sleeper's lines this season, else last season's average"
        case .form: return "points per game over his last 4"
        case .usage: return "ffopportunity expected points, last 4"
        case .environment: return "his team's implied total, from the schedule file's lines"
        case .floor: return "his bad week (20th percentile)"
        case .ceiling: return "his big week (80th percentile)"
        }
    }

    /// How far apart two values must be before one counts as ahead.
    public var tieBand: Double { self == .environment ? 1.0 : 0.5 }
}

/// Whether the user is expected to win this week, which decides whether a
/// safe floor or a big ceiling matters. Only ever chooses which of the two
/// counts — it never adjusts a number.
public enum MatchupPosture: Hashable, Sendable {
    case favourite(Double)
    case underdog(Double)
    case close(Double)
    case unknown

    /// Projected points either side of zero that make a side a favourite.
    public static let margin = 8.0

    public static func from(mine: Double?, theirs: Double?) -> MatchupPosture {
        guard let mine, let theirs else { return .unknown }
        let gap = mine - theirs
        if gap >= margin { return .favourite(gap) }
        if gap <= -margin { return .underdog(gap) }
        return .close(gap)
    }

    /// Floor, ceiling, or neither.
    public var votingRangeSignal: StartSignal? {
        switch self {
        case .favourite: return .floor
        case .underdog: return .ceiling
        case .close, .unknown: return nil
        }
    }

    public var line: String {
        switch self {
        case .favourite(let gap):
            return "You're projected +\(StartVerdict.one(gap)), so Floor counts — protect the lead."
        case .underdog(let gap):
            return "You're projected −\(StartVerdict.one(-gap)), so Ceiling counts — you need a big week."
        case .close:
            return "Your matchup projects within \(Int(Self.margin)) points, so floor and ceiling are context only."
        case .unknown:
            return "No matchup projection, so floor and ceiling are context only."
        }
    }
}

/// The call for one lineup slot this week: who starts, over whom, and how
/// sure. Not a blended score — every candidate meets every other on each named
/// signal, and the one who wins the most head-to-heads starts. Pure, so the
/// rules are tested on plain inputs.
public struct StartVerdict: Hashable, Sendable {
    public struct Input: Hashable, Sendable {
        public var id: String
        public var name: String
        public var position: Position?
        public var isFreeAgent = false
        /// On a rival's roster — shown, but he can't start for you.
        public var rivalManager: String?
        /// Holds this slot now.
        public var isIncumbent = false
        public var availability: StartAvailability = .clear
        public var onBye = false
        /// His game has kicked off.
        public var isLocked = false
        public var practice: PracticeStatus?
        public var kickoff: Date?
        public var signals: [StartSignal: Double] = [:]

        public init(id: String, name: String, position: Position? = nil, isFreeAgent: Bool = false,
                    rivalManager: String? = nil, isIncumbent: Bool = false, availability: StartAvailability = .clear,
                    onBye: Bool = false, isLocked: Bool = false, practice: PracticeStatus? = nil, kickoff: Date? = nil,
                    signals: [StartSignal: Double] = [:]) {
            self.id = id
            self.name = name
            self.position = position
            self.isFreeAgent = isFreeAgent
            self.rivalManager = rivalManager
            self.isIncumbent = isIncumbent
            self.availability = availability
            self.onBye = onBye
            self.isLocked = isLocked
            self.practice = practice
            self.kickoff = kickoff
            self.signals = signals
        }

        /// Why he can't start this week, or `nil` when he can.
        var blocker: String? {
            if let rivalManager { return "On \(rivalManager)'s roster" }
            if onBye { return "On bye" }
            if case .unavailable(let label) = availability { return label }
            if isLocked { return "Game has started" }
            return nil
        }
    }

    public struct Ranked: Hashable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let isIncumbent: Bool
        public let isFreeAgent: Bool
        /// Head-to-heads won: 1 per candidate beaten, ½ per draw.
        public let wins: Double
        /// Signals he is outright best on.
        public let topOn: [StartSignal]
        public let badge: String?
    }

    public struct Blocked: Hashable, Sendable, Identifiable {
        public let id: String
        public let name: String
        public let reason: String
    }

    public enum Thresholds {
        /// Share of the deciding signals the pick must win to be clear…
        public static let clearShare = 0.75
        /// …on at least this many of them…
        public static let clearDecisive = 3
        /// …and this far ahead on the projection, when both have one.
        public static let clearProjectionGap = 1.5
        /// At or under this share, a coin flip.
        public static let coinFlipShare = 0.55
        /// Under this projection gap, without a clear signal edge, a coin flip.
        public static let coinFlipProjectionGap = 0.75
        /// Fewer usable signals than this is thin data.
        public static let minimumSignals = 3
    }

    public let ranked: [Ranked]
    public let blocked: [Blocked]
    public let headline: String
    public let pickID: String?
    public let alternativeID: String?
    public let confidence: CompareGutCheck.Confidence
    public let thinData: Bool
    /// "Beats Pittman on 5 of 7 signals."
    public let edgeLine: String?
    public let postureLine: String
    /// The signals that decided it, in display order.
    public let votingSignals: [StartSignal]
    /// Per signal, the candidate with the best value — `nil` when tied or
    /// fewer than two have one.
    public let signalLeaders: [StartSignal: String]
    /// What to do if a Questionable pick is ruled out.
    public let contingency: String?
    /// Waivers, mixed positions — said once, under the call.
    public let notes: [String]

    public var pickIsFreeAgent: Bool { ranked.first { $0.id == pickID }?.isFreeAgent ?? false }

    // MARK: - Computing

    /// - Parameter slot: the slot being filled, "FLEX" or "RB"; `nil` when
    ///   comparing outside a lineup.
    public static func compute(_ inputs: [Input], posture: MatchupPosture, slot: String? = nil) -> StartVerdict {
        let voting = votingSignals(posture)
        let blocked = inputs.compactMap { input in
            input.blocker.map { Blocked(id: input.id, name: input.name, reason: $0) }
        }
        let eligible = inputs.filter { $0.blocker == nil }
        let leaders = Dictionary(uniqueKeysWithValues: StartSignal.allCases.compactMap { signal in
            leader(signal, among: eligible).map { (signal, $0) }
        })

        guard !eligible.isEmpty else {
            return StartVerdict(ranked: [], blocked: blocked, headline: "Nobody here can start this week",
                                pickID: nil, alternativeID: nil, confidence: .coinFlip, thinData: true, edgeLine: nil,
                                postureLine: posture.line, votingSignals: voting, signalLeaders: leaders,
                                contingency: nil, notes: [])
        }

        var wins: [String: Double] = [:]
        for (i, a) in eligible.enumerated() {
            for b in eligible[(i + 1)...] {
                let (aAhead, bAhead) = headToHead(a, b, signals: voting)
                if aAhead > bAhead { wins[a.id, default: 0] += 1 } else if bAhead > aAhead { wins[b.id, default: 0] += 1 } else {
                    wins[a.id, default: 0] += 0.5
                    wins[b.id, default: 0] += 0.5
                }
            }
        }
        let order = eligible.sorted { a, b in
            let wa = wins[a.id] ?? 0, wb = wins[b.id] ?? 0
            if wa != wb { return wa > wb }
            for signal in [StartSignal.projected, .commandCenter] {
                let va = a.signals[signal] ?? -.infinity, vb = b.signals[signal] ?? -.infinity
                if va != vb { return va > vb }
            }
            return a.name < b.name
        }
        let ranked = order.map { input in
            Ranked(id: input.id, name: input.name, isIncumbent: input.isIncumbent, isFreeAgent: input.isFreeAgent,
                   wins: wins[input.id] ?? 0,
                   topOn: voting.filter { leaders[$0] == input.id },
                   badge: input.availability.badge)
        }

        let pick = order[0]
        let incumbent = inputs.first(where: \.isIncumbent)
        let alternative: Input? = {
            if let incumbent, incumbent.id != pick.id { return incumbent }
            return order.count > 1 ? order[1] : nil
        }()

        // How sure: the pick against the alternative, signal by signal.
        var confidence: CompareGutCheck.Confidence = .clear
        var thin = true
        var edgeLine: String?
        if let alternative, alternative.blocker == nil {
            let shared = voting.filter { pick.signals[$0] != nil && alternative.signals[$0] != nil }
            thin = shared.count < Thresholds.minimumSignals
            let (pickAhead, altAhead) = headToHead(pick, alternative, signals: voting)
            let decisive = pickAhead + altAhead
            let share = decisive > 0 ? Double(pickAhead) / Double(decisive) : 0
            let gap: Double? = pick.signals[.projected].flatMap { p in alternative.signals[.projected].map { p - $0 } }
            if share <= Thresholds.coinFlipShare || decisive < 2
                || (gap.map { $0 < Thresholds.coinFlipProjectionGap } ?? false && share < Thresholds.clearShare) {
                confidence = .coinFlip
            } else if share >= Thresholds.clearShare && decisive >= Thresholds.clearDecisive
                        && (gap.map { $0 >= Thresholds.clearProjectionGap } ?? true) {
                confidence = .clear
            } else {
                confidence = .lean
            }
            edgeLine = "Beats \(alternative.name) on \(pickAhead) of \(shared.count) signal\(shared.count == 1 ? "" : "s")"
                + (altAhead > 0 ? ", trails on \(altAhead)." : ".")
        } else {
            // Nobody else can start — the call is forced, and clear for it.
            thin = voting.filter { pick.signals[$0] != nil }.count < Thresholds.minimumSignals
            confidence = .clear
        }
        if thin, confidence == .clear { confidence = .lean }
        if pick.availability == .questionable, pick.practice == .didNotParticipate, confidence == .clear {
            confidence = .lean
        }

        var notes: [String] = []
        if pick.isFreeAgent {
            notes.append("Check \(pick.name) can be added before his kickoff — he may still be on waivers.")
        }
        if Set(eligible.compactMap(\.position)).count > 1 {
            notes.append("Mixed positions: usage (xFP) compares less well across positions than points do.")
        }

        return StartVerdict(
            ranked: ranked, blocked: blocked,
            headline: headline(pick: pick, incumbent: incumbent, runnerUp: order.count > 1 ? order[1] : nil, slot: slot),
            pickID: pick.id, alternativeID: alternative?.id, confidence: confidence, thinData: thin,
            edgeLine: edgeLine, postureLine: posture.line, votingSignals: voting, signalLeaders: leaders,
            contingency: contingency(pick: pick, others: Array(order.dropFirst())), notes: notes
        )
    }

    /// The signals that count: always the six point measures, plus floor or
    /// ceiling as the matchup says.
    public static func votingSignals(_ posture: MatchupPosture) -> [StartSignal] {
        var out: [StartSignal] = [.projected, .commandCenter, .thisSeason, .form, .usage, .environment]
        if let range = posture.votingRangeSignal { out.append(range) }
        return out
    }

    /// Signals each is ahead on, by more than the signal's tie band.
    static func headToHead(_ a: Input, _ b: Input, signals: [StartSignal]) -> (Int, Int) {
        var aAhead = 0, bAhead = 0
        for signal in signals {
            guard let va = a.signals[signal], let vb = b.signals[signal] else { continue }
            if va - vb > signal.tieBand { aAhead += 1 } else if vb - va > signal.tieBand { bAhead += 1 }
        }
        return (aAhead, bAhead)
    }

    static func leader(_ signal: StartSignal, among inputs: [Input]) -> String? {
        let present = inputs.compactMap { input in input.signals[signal].map { (input.id, $0) } }
        guard present.count >= 2 else { return nil }
        let sorted = present.sorted { $0.1 > $1.1 }
        return sorted[0].1 > sorted[1].1 ? sorted[0].0 : nil
    }

    static func headline(pick: Input, incumbent: Input?, runnerUp: Input?, slot: String?) -> String {
        let at = slot.map { " at \($0)" } ?? ""
        if let incumbent {
            if incumbent.id == pick.id { return "Keep \(pick.name) in\(at)" }
            return pick.isFreeAgent ? "Add \(pick.name), start over \(incumbent.name)" : "Start \(pick.name) over \(incumbent.name)"
        }
        if slot == nil, let runnerUp {
            return pick.isFreeAgent ? "Add \(pick.name), start over \(runnerUp.name)" : "Start \(pick.name) over \(runnerUp.name)"
        }
        return pick.isFreeAgent ? "Add \(pick.name), start\(at)" : "Start \(pick.name)\(at)"
    }

    /// A Questionable pick: a later-kicking pivot if there is one, else the
    /// honest warning that there isn't.
    static func contingency(pick: Input, others: [Input]) -> String? {
        guard pick.availability == .questionable, !others.isEmpty else { return nil }
        guard let kickoff = pick.kickoff else {
            return "\(pick.name) is questionable — check inactives about 90 minutes before his kickoff."
        }
        if let pivot = others.first(where: { ($0.kickoff ?? .distantPast) > kickoff }) {
            return "\(pick.name) is questionable. Inactives come out about 90 minutes before his kickoff — if he's out, swap to \(pivot.name), who plays later."
        }
        return "\(pick.name) is questionable and there's no later pivot — \(others[0].name) doesn't play after him. If you can't wait on him, start \(others[0].name)."
    }

    static func one(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(1))) }
}
