import Foundation
import FCCore

/// The verdict is a weighted blend, so it can be argued with. This argues: the
/// best case for the player the call passed over, built from what the blend
/// leaves out — luck against his expected points, a growing role, a hot
/// stretch, a ceiling, the depth chart, the schedule — plus what could go
/// wrong with the pick. Rules only, every point shown with its number.
public struct CompareGutCheck: Hashable, Sendable {
    public enum Confidence: String, Hashable, Sendable {
        case clear, lean, coinFlip

        public var label: String {
            switch self {
            case .clear: return "Clear call"
            case .lean: return "Lean"
            case .coinFlip: return "Coin flip"
            }
        }
    }

    public struct Point: Hashable, Sendable, Identifiable {
        public let text: String
        /// 0 is context only; 1 a real point; 2 a strong one.
        public let strength: Int
        public var id: String { text }
    }

    public enum Thresholds {
        /// Expected points over actual, per game, that reads as bad luck.
        public static let unlucky = 2.0
        /// Actual over expected that may not last.
        public static let overperforming = 3.0
        /// Snap share moved this much between the latest two games and before.
        public static let roleShift = 0.10
        /// The last three games against the season, as a ratio.
        public static let hotStretch = 1.25
        /// Points the best game has to beat the other's best by.
        public static let ceilingGap = 5.0
        /// This week's floor or ceiling gap worth mentioning.
        public static let rangeGap = 3.0
        /// Schedule multiplier gap that reads as softer.
        public static let scheduleGap = 0.08
        /// Adjusted-score margins: below the first is a coin flip, below the
        /// second a lean.
        public static let coinFlipMargin = 0.05
        public static let leanMargin = 0.12
        /// How recent a headline has to be to mention.
        public static let newsAge: TimeInterval = 3 * 24 * 3600
    }

    public let confidence: Confidence
    public let pickName: String
    public let alternativeName: String
    public let caseForAlternative: [Point]
    public let risksForPick: [Point]
    public let summary: String

    /// `nil` when the verdict didn't weigh two players against each other.
    public static func build(comparison: PlayerComparison, verdict: CompareVerdict, now: Date = Date()) -> CompareGutCheck? {
        guard let pick = comparison.players.first(where: { $0.id == verdict.pickID }),
              let alternative = comparison.players.first(where: { $0.id == verdict.alternativeID }) else { return nil }
        return assess(pick: pick, alternative: alternative, margin: verdict.margin, now: now)
    }

    public static func assess(pick: PlayerComparison.Player, alternative: PlayerComparison.Player,
                              margin: Double?, now: Date = Date()) -> CompareGutCheck {
        let (caseFor, risks, strength) = points(pick: pick, alternative: alternative, lens: .restOfSeason, posture: .unknown, now: now)
        let confidence: Confidence
        let margin = margin ?? Thresholds.leanMargin
        if margin < Thresholds.coinFlipMargin || (strength >= 3 && margin < Thresholds.leanMargin) {
            confidence = .coinFlip
        } else if margin < Thresholds.leanMargin || strength >= 2 {
            confidence = .lean
        } else {
            confidence = .clear
        }
        return finish(pick: pick, alternative: alternative, confidence: confidence, caseFor: caseFor, risks: risks)
    }

    /// The this-week start call argued with: the tally sets the confidence,
    /// and a strong enough case against it takes it down one step.
    public static func build(comparison: PlayerComparison, start verdict: StartVerdict, posture: MatchupPosture,
                             now: Date = Date()) -> CompareGutCheck? {
        guard let pick = comparison.players.first(where: { $0.id == verdict.pickID }),
              let alternative = comparison.players.first(where: { $0.id == verdict.alternativeID }) else { return nil }
        let (caseFor, risks, strength) = points(pick: pick, alternative: alternative, lens: .thisWeek, posture: posture, now: now)
        var confidence = verdict.confidence
        if strength >= 3 {
            confidence = confidence == .clear ? .lean : .coinFlip
        }
        return finish(pick: pick, alternative: alternative, confidence: confidence, caseFor: caseFor, risks: risks)
    }

    private static func points(pick: PlayerComparison.Player, alternative: PlayerComparison.Player, lens: CompareLens,
                               posture: MatchupPosture, now: Date) -> (caseFor: [Point], risks: [Point], strength: Int) {
        let caseFor = Array(caseFor(alternative, against: pick, lens: lens, posture: posture, now: now)
            .sorted { $0.strength > $1.strength }.prefix(3))
        let risks = Array(risks(pick, lens: lens).sorted { $0.strength > $1.strength }.prefix(2))
        return (caseFor, risks, caseFor.map(\.strength).reduce(0, +) + risks.map(\.strength).reduce(0, +))
    }

    private static func finish(pick: PlayerComparison.Player, alternative: PlayerComparison.Player, confidence: Confidence,
                               caseFor: [Point], risks: [Point]) -> CompareGutCheck {
        let hasCase = caseFor.contains { $0.strength > 0 }
        let summary: String
        switch confidence {
        case .clear:
            summary = hasCase
                ? "The numbers back \(pick.name); the case for \(alternative.name) is real but thin."
                : "Paper and gut agree — nothing here argues for \(alternative.name)."
        case .lean:
            summary = "\(pick.name) on paper, but \(alternative.name) has a case."
        case .coinFlip:
            summary = "Close enough that the numbers can't settle it — go with your read on \(pick.name) vs \(alternative.name)."
        }
        return CompareGutCheck(confidence: confidence, pickName: pick.name, alternativeName: alternative.name,
                               caseForAlternative: caseFor, risksForPick: risks, summary: summary)
    }

    // MARK: - Signals

    private static func caseFor(_ player: PlayerComparison.Player, against pick: PlayerComparison.Player,
                                lens: CompareLens, posture: MatchupPosture, now: Date) -> [Point] {
        var out: [Point] = []
        if let luck = luck(player), luck >= Thresholds.unlucky {
            out.append(Point(text: "Scoring \(one(luck)) pts/gm under his expected points — the volume says more is coming.",
                             strength: luck >= Thresholds.unlucky * 2 ? 2 : 1))
        }
        if let (before, after) = snapShift(player), after - before >= Thresholds.roleShift {
            out.append(Point(text: "Snap share up from \(percent(before)) to \(percent(after)) — his role is growing.",
                             strength: after - before >= Thresholds.roleShift * 2 ? 2 : 1))
        }
        if let (recent, season) = stretch(player), season > 0, recent >= season * Thresholds.hotStretch {
            out.append(Point(text: "Averaging \(one(recent)) over his last 3, up from \(one(season)) on the season.", strength: 1))
        }
        if lens == .thisWeek {
            out += range(player, against: pick, posture: posture)
        } else if let best = player.ceiling, best >= (pick.ceiling ?? 0) + Thresholds.ceilingGap {
            out.append(Point(text: "Best game \(one(best)) vs \(one(pick.ceiling ?? 0)) — the higher ceiling.", strength: 1))
        }
        if player.values[.depthRank] == 1, let theirs = pick.values[.depthRank], theirs > 1 {
            out.append(Point(text: "First on his depth chart; \(pick.name) is No. \(Int(theirs)).", strength: 1))
        }
        if lens == .thisWeek {
            // Next week's schedule says nothing about who starts this one.
        } else if let mine = player.strengthOfSchedule, let theirs = pick.strengthOfSchedule, mine - theirs >= Thresholds.scheduleGap {
            out.append(Point(text: "Softer schedule ahead (\(two(mine))× vs \(two(theirs))×).", strength: 1))
        } else if let mine = player.values[.playoffMatchups], let theirs = pick.values[.playoffMatchups],
                  mine - theirs >= Thresholds.scheduleGap {
            out.append(Point(text: "Softer playoff matchups (\(two(mine))× vs \(two(theirs))×).", strength: 1))
        }
        if let headline = player.headline, let published = headline.published,
           now.timeIntervalSince(published) <= Thresholds.newsAge, !headline.title.isEmpty {
            out.append(Point(text: "Latest: \(headline.title)", strength: 0))
        }
        return out
    }

    /// This week's range against the pick's. A range the tally already
    /// counted is context; one it left out is a real point.
    private static func range(_ player: PlayerComparison.Player, against pick: PlayerComparison.Player,
                              posture: MatchupPosture) -> [Point] {
        var out: [Point] = []
        let counted = posture.votingRangeSignal
        if let mine = player.values[.ceilingThisWeek], let theirs = pick.values[.ceilingThisWeek],
           mine - theirs >= Thresholds.rangeGap {
            out.append(Point(text: "Bigger ceiling this week (\(one(mine)) vs \(one(theirs))).", strength: counted == nil ? 1 : 0))
        }
        if let mine = player.values[.floorThisWeek], let theirs = pick.values[.floorThisWeek],
           mine - theirs >= Thresholds.rangeGap {
            out.append(Point(text: "Safer floor this week (\(one(mine)) vs \(one(theirs))).", strength: counted == nil ? 1 : 0))
        }
        return out
    }

    private static func risks(_ pick: PlayerComparison.Player, lens: CompareLens) -> [Point] {
        var out: [Point] = []
        // This week a Questionable player is ranked on his full value, as in
        // Sit/Start; what his practice week says is the real risk.
        if lens == .thisWeek, let practice = pick.practice, practice != .full {
            out.append(Point(text: "\(pick.name): \(practice.label.lowercased()) in the latest practice report.",
                             strength: practice == .didNotParticipate ? 2 : 1))
        }
        let penalty = CompareVerdict.injuryPenalty(pick.injuryDesignation)
        if lens == .thisWeek {
            // Covered above, or by the "can't start" list.
        } else if let designation = pick.injuryDesignation, penalty > 0 {
            out.append(Point(text: "\(pick.name) is listed \(designation).", strength: penalty >= 0.25 ? 2 : 1))
        } else if let practice = pick.practice, practice != .full {
            out.append(Point(text: "\(pick.name): \(practice.label.lowercased()) in practice.", strength: 1))
        }
        if let luck = luck(pick), -luck >= Thresholds.overperforming {
            out.append(Point(text: "\(pick.name) is scoring \(one(-luck)) pts/gm over his expected points — some of that may not last.",
                             strength: 1))
        }
        if let (before, after) = snapShift(pick), before - after >= Thresholds.roleShift {
            out.append(Point(text: "\(pick.name)'s snap share is down from \(percent(before)) to \(percent(after)).", strength: 1))
        }
        return out
    }

    /// Expected minus actual per game over the window — positive is unlucky.
    /// Falls back to xFP over the last 4 against his season average.
    static func luck(_ player: PlayerComparison.Player) -> Double? {
        let weeks = player.log.filter { $0.points != nil && $0.expectedPoints != nil }
        if weeks.count >= 2 {
            let expected = weeks.compactMap(\.expectedPoints).reduce(0, +)
            let actual = weeks.compactMap(\.points).reduce(0, +)
            return (expected - actual) / Double(weeks.count)
        }
        guard let expected = player.values[.expectedPointsLast4], let actual = player.values[.pointsPerGame] else { return nil }
        return expected - actual
    }

    /// Mean snap share of the earlier window against the latest two games.
    static func snapShift(_ player: PlayerComparison.Player) -> (before: Double, after: Double)? {
        let shares = player.log.sorted { $0.week < $1.week }.compactMap(\.snapShare)
        guard shares.count >= 3 else { return nil }
        let after = shares.suffix(2), before = shares.dropLast(2)
        return (before.reduce(0, +) / Double(before.count), after.reduce(0, +) / Double(after.count))
    }

    /// The last three games' average against the season's.
    static func stretch(_ player: PlayerComparison.Player) -> (recent: Double, season: Double)? {
        let points = player.log.sorted { $0.week < $1.week }.compactMap(\.points)
        guard points.count >= 3, let season = player.values[.pointsPerGame] else { return nil }
        let recent = points.suffix(3)
        return (recent.reduce(0, +) / Double(recent.count), season)
    }

    private static func one(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(1))) }
    private static func two(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(2))) }
    private static func percent(_ value: Double) -> String { "\(Int((value * 100).rounded()))%" }
}
