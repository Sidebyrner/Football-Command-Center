import Foundation

/// A named, separately-reported reason a player is worth acquiring.
///
/// Four signals, never averaged into one. A composite score that mixes
/// production, opportunity, form and market sentiment hides *which* claim you
/// are betting on, and those claims have different shelf lives and different
/// failure modes (§6).
public enum AcquisitionSignal: String, CaseIterable, Hashable, Sendable {
    /// Season pace at or above the position's start line.
    case startable
    /// At or above replacement, but below the start line. Mutually exclusive
    /// with `startable`.
    case aboveReplacement = "above-replacement"
    /// Recent usage running ahead of scoring — the buy-low, and the only
    /// forward-leaning signal in the app that is still a **reported fact**
    /// (the usage already happened) rather than a forecast.
    case opportunity
    /// Last four games well ahead of the season pace.
    case form

    public var label: String {
        switch self {
        case .startable: return "Startable production"
        case .aboveReplacement: return "Above replacement"
        case .opportunity: return "Opportunity ahead of production"
        case .form: return "Heating up"
        }
    }
}

/// A player worth acquiring, with the named signals that flagged him.
///
/// Ownership — free agent (a claim) against on a rival's bench (a trade) — is
/// deliberately not here. It needs league rosters, which are I/O, so the app
/// layer attaches it. The signals themselves are pure and testable without it.
public struct AcquisitionCandidate: Hashable, Sendable {
    public let player: SeasonProfile
    public let signals: [SignalHit]
    /// Points per game above this position's start line. Negative for a player
    /// flagged only by `opportunity` or `form`.
    public let valueOverStartLine: Double
}

/// One signal that fired, with the numbers that fired it.
public struct SignalHit: Hashable, Sendable {
    public let signal: AcquisitionSignal
    public let label: String
    /// Plain-language statement of the fact, for the UI to show verbatim.
    public let detail: String
}

public enum AcquisitionSignals {
    /// Recent target share at or above this fires `opportunity`.
    public static let opportunityTargetShare: Double = 0.20
    /// Last-four pace must exceed the season pace by this multiple to fire `form`.
    public static let formMultiplier: Double = 1.25

    /// Which signals a player trips against his position's baselines.
    ///
    /// A position with no baseline produces no signals — not a bogus one.
    public static func signals(
        for player: SeasonProfile,
        baselines: [Position: PositionBaseline],
        formWeeks: Int = SeasonScan.formWeeks
    ) -> [SignalHit] {
        guard let baseline = baselines[player.position] else { return [] }
        var out: [SignalHit] = []

        let perGame = display(player.pointsPerGame)
        if player.pointsPerGame >= baseline.startLine {
            out.append(
                SignalHit(
                    signal: .startable,
                    label: AcquisitionSignal.startable.label,
                    detail: "\(perGame) pts/gm vs a \(display(baseline.startLine)) start line"
                )
            )
        } else if let replacement = baseline.replacementLine,
                  player.pointsPerGame >= replacement {
            out.append(
                SignalHit(
                    signal: .aboveReplacement,
                    label: AcquisitionSignal.aboveReplacement.label,
                    detail: "\(perGame) pts/gm vs \(display(replacement)) replacement"
                )
            )
        }

        if let share = player.recentTargetShare,
           share >= opportunityTargetShare,
           player.pointsPerGame < baseline.startLine {
            let percent = Int(roundHalfUp(share * 100, places: 0))
            out.append(
                SignalHit(
                    signal: .opportunity,
                    label: AcquisitionSignal.opportunity.label,
                    detail: "\(percent)% target share, still under the start line"
                )
            )
        }

        if let form = player.formPointsPerGame,
           player.games >= formWeeks,
           form > player.pointsPerGame * formMultiplier {
            out.append(
                SignalHit(
                    signal: .form,
                    label: AcquisitionSignal.form.label,
                    detail: "\(display(form)) over the last \(formWeeks) vs "
                        + "\(perGame) on the season"
                )
            )
        }

        return out
    }

    /// How far above the position's start line a player is producing.
    ///
    /// Rank on this, never on raw points per game. A quarterback outscores every
    /// running back in absolute terms, so a raw sort just lists quarterbacks and
    /// buries exactly the undervalued players the board exists to surface
    /// (§5.8).
    public static func valueOverStartLine(
        _ player: SeasonProfile,
        baselines: [Position: PositionBaseline]
    ) -> Double? {
        guard let baseline = baselines[player.position] else { return nil }
        return player.pointsPerGame - baseline.startLine
    }

    /// Players that tripped at least one signal, ranked by value over their own
    /// position's start line.
    public static func board(
        players: [SeasonProfile],
        baselines: [Position: PositionBaseline],
        formWeeks: Int = SeasonScan.formWeeks
    ) -> [AcquisitionCandidate] {
        players
            .compactMap { player -> AcquisitionCandidate? in
                let hits = Self.signals(
                    for: player, baselines: baselines, formWeeks: formWeeks
                )
                guard !hits.isEmpty,
                      let value = Self.valueOverStartLine(player, baselines: baselines)
                else { return nil }
                return AcquisitionCandidate(
                    player: player, signals: hits, valueOverStartLine: value
                )
            }
            .sorted { lhs, rhs in
                lhs.valueOverStartLine == rhs.valueOverStartLine
                    ? lhs.player.gsisID < rhs.player.gsisID
                    : lhs.valueOverStartLine > rhs.valueOverStartLine
            }
    }

    /// One decimal place, for the human-readable `detail` strings only. The
    /// comparisons above all run at full precision.
    static func display(_ value: Double) -> String {
        String(format: "%.1f", roundHalfUp(value, places: 1))
    }
}
