import SwiftUI
import FCCore

/// ☆ / ★ — puts a player on the watchlist, or takes him off.
struct WatchButton: View {
    @ObservedObject var watchlist: WatchlistModel
    let playerID: String
    var name: String?

    var body: some View {
        let watched = watchlist.isWatched(playerID)
        Button {
            withAnimation(Motion.snappy) { watchlist.toggleWatched(playerID) }
        } label: {
            Image(systemName: watched ? "star.fill" : "star")
                .font(.body.weight(.semibold))
                .foregroundStyle(watched ? Palette.caution : Color.secondary)
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: watched)
        .accessibilityLabel(watched ? "Remove \(name ?? "player") from watchlist" : "Add \(name ?? "player") to watchlist")
        .accessibilityIdentifier("watch.\(playerID)")
    }
}

/// Where a compared player stands: a claim, a trade, or already yours — and
/// whether a rival took him after he went on the list.
struct AvailabilityBadge: View {
    let availability: Availability?
    var isBaseline = false
    var wasClaimed = false
    /// Holds the slot being decided.
    var isIncumbent = false

    var body: some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(tint)
            .background(Capsule().fill(tint.opacity(0.14)))
    }

    private var text: String {
        if isIncumbent { return "STARTING" }
        if isBaseline { return "YOURS" }
        guard let availability else { return "—" }
        switch availability {
        case .freeAgent: return "Free agent"
        case .rivalBench(_, let manager): return wasClaimed ? "Claimed · \(manager)" : "\(manager)'s bench"
        case .rivalStarter(_, let manager): return wasClaimed ? "Claimed · \(manager)" : "\(manager)'s starter"
        case .mine: return "Yours"
        }
    }

    private var tint: Color {
        if isBaseline || isIncumbent { return .accentColor }
        switch availability {
        case .freeAgent: return Palette.start
        case .rivalBench, .rivalStarter: return Palette.caution
        case .mine: return .accentColor
        case nil: return .secondary
        }
    }
}

/// The call on a comparison: who first, whether he's worth the move, and a
/// bid only where the league bids.
struct VerdictCard: View {
    let verdict: CompareVerdict
    var gutCheck: CompareGutCheck?
    var compact = false

    init(verdict: CompareVerdict, gutCheck: CompareGutCheck? = nil, compact: Bool = false) {
        self.verdict = verdict
        self.gutCheck = gutCheck
        self.compact = compact
    }

    /// The verdict and its gut check for a built comparison.
    init(comparison: PlayerComparison, context: LeagueContext, compact: Bool = false) {
        let verdict = CompareVerdict.compute(
            CompareVerdict.inputs(from: comparison),
            league: CompareVerdict.League(facts: context.leagueFacts, currentWeek: context.currentWeek)
        )
        self.init(verdict: verdict, gutCheck: CompareGutCheck.build(comparison: comparison, verdict: verdict), compact: compact)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.accentColor)
                Text(verdict.headline)
                    .font(compact ? .subheadline.weight(.semibold) : .headline)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Label {
                Text(verdict.priority.text).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: priorityIcon).foregroundStyle(priorityTint)
            }
            .font(.caption)
            if let bid = verdict.faab {
                Label {
                    Text("Bid $\(bid.low)–$\(bid.high). \(bid.note)")
                } icon: {
                    Image(systemName: "dollarsign.circle").foregroundStyle(Palette.caution)
                }
                .font(.caption)
            }
            if !verdict.ranked.isEmpty {
                // Only worth saying when it tells players apart — a league
                // with no projections at all leaves everyone thin.
                let flagThin = !verdict.ranked.allSatisfy(\.thinData)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(verdict.ranked.prefix(4).enumerated()), id: \.element.id) { index, ranked in
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(index + 1).").monospacedDigit().foregroundStyle(.secondary)
                            Text(ranked.name).fontWeight(.semibold)
                            if ranked.isMine {
                                Text("YOURS").font(.system(size: 9).weight(.bold)).foregroundStyle(Color.accentColor)
                            }
                            Text(ranked.reasons.joined(separator: " · ")).foregroundStyle(.secondary).lineLimit(1)
                            if flagThin, ranked.thinData {
                                Text("thin data").foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
                .font(.caption2)
            }
            if let gutCheck {
                GutCheckSection(check: gutCheck)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("compare.verdict")
    }

    private var priorityIcon: String {
        switch verdict.priority {
        case .spend: return "arrow.up.circle.fill"
        case .hold: return "pause.circle.fill"
        case .keep: return "hand.raised.fill"
        case .notAClaim: return "arrow.triangle.swap"
        case .nothing: return "minus.circle"
        }
    }

    private var priorityTint: Color {
        switch verdict.priority {
        case .spend: return Palette.start
        case .hold: return Palette.caution
        case .keep: return .accentColor
        case .notAClaim, .nothing: return .secondary
        }
    }
}

/// The case the numbers leave out, so the call can be second-guessed.
struct GutCheckSection: View {
    let check: CompareGutCheck
    @State private var showsGutCheck = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(Motion.snappy) { showsGutCheck.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Text("Gut check").font(.caption.weight(.semibold))
                    Text(check.confidence.label)
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .foregroundStyle(confidenceTint(check.confidence))
                        .background(Capsule().fill(confidenceTint(check.confidence).opacity(0.14)))
                    Spacer(minLength: 0)
                    Image(systemName: showsGutCheck ? "chevron.up" : "chevron.down")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("compare.gutcheck")
            if showsGutCheck {
                Text(check.summary).font(.caption).fixedSize(horizontal: false, vertical: true)
                if !check.caseForAlternative.isEmpty {
                    points("Case for \(check.alternativeName)", check.caseForAlternative)
                }
                if !check.risksForPick.isEmpty {
                    points("Risks for \(check.pickName)", check.risksForPick)
                }
            }
        }
        .padding(.top, 4)
    }

    private func points(_ title: String, _ points: [CompareGutCheck.Point]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(points) { point in
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("•").foregroundStyle(.secondary)
                    Text(point.text).fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(point.strength == 0 ? .secondary : .primary)
                }
                .font(.caption2)
            }
        }
    }

    private func confidenceTint(_ confidence: CompareGutCheck.Confidence) -> Color {
        ConfidenceTint.color(confidence)
    }
}

enum ConfidenceTint {
    static func color(_ confidence: CompareGutCheck.Confidence) -> Color {
        switch confidence {
        case .clear: return Palette.start
        case .lean: return Palette.caution
        case .coinFlip: return .orange
        }
    }
}

enum InjuryTint {
    static func color(_ designation: String?) -> Color {
        switch designation?.lowercased() {
        case nil: return .secondary
        case "questionable", "q": return Palette.caution
        default: return Palette.sit
        }
    }
}
