import SwiftUI
import FCCore

/// The this-week start call: who starts over whom, how sure, why, and what to
/// do if a Questionable pick sits.
struct StartVerdictCard: View {
    let verdict: StartVerdict
    var gutCheck: CompareGutCheck?
    var compact = false
    /// Shown when a free agent wins — the claim happens on the Waiver Board.
    var openWaivers: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.accentColor)
                Text(verdict.headline)
                    .font(compact ? .subheadline.weight(.semibold) : .headline)
                    .fixedSize(horizontal: false, vertical: true)
                if gutCheck == nil {
                    Spacer(minLength: 0)
                    ConfidenceChip(confidence: verdict.confidence)
                }
            }
            if let edge = verdict.edgeLine {
                Text(edge).font(.caption).foregroundStyle(.secondary)
            }
            if !verdict.ranked.isEmpty && !compact {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(verdict.ranked.prefix(4).enumerated()), id: \.element.id) { index, ranked in
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(index + 1).").monospacedDigit().foregroundStyle(.secondary)
                            Text(ranked.name).fontWeight(.semibold)
                            if ranked.isIncumbent {
                                Text("STARTING").font(.system(size: 9).weight(.bold)).foregroundStyle(Color.accentColor)
                            } else if ranked.isFreeAgent {
                                Text("FA").font(.system(size: 9).weight(.bold)).foregroundStyle(Palette.start)
                            }
                            if let badge = ranked.badge { InjuryBadge(label: badge) }
                            if !ranked.topOn.isEmpty {
                                Text("best on " + ranked.topOn.map(\.label).joined(separator: ", "))
                                    .foregroundStyle(.secondary).lineLimit(1)
                            }
                        }
                    }
                }
                .font(.caption2)
            }
            if !verdict.blocked.isEmpty {
                Text("Can't start: " + verdict.blocked.map { "\($0.name) (\($0.reason))" }.joined(separator: ", "))
                    .font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let contingency = verdict.contingency {
                Label {
                    Text(contingency).fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "clock.badge.exclamationmark").foregroundStyle(Palette.caution)
                }
                .font(.caption)
            }
            if !compact {
                Text(verdict.postureLine).font(.caption2).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(verdict.notes, id: \.self) { note in
                    Text(note).font(.caption2).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
                }
            }
            if let openWaivers {
                Button(action: openWaivers) {
                    Label("Open Waivers", systemImage: "tray.and.arrow.down")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .accessibilityIdentifier("decide.openWaivers")
            }
            if let gutCheck {
                GutCheckSection(check: gutCheck)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("decide.verdict")
    }
}

struct ConfidenceChip: View {
    let confidence: CompareGutCheck.Confidence

    var body: some View {
        Text(confidence.label)
            .font(.caption2.weight(.bold))
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(ConfidenceTint.color(confidence))
            .background(Capsule().fill(ConfidenceTint.color(confidence).opacity(0.14)))
    }
}
