import SwiftUI

/// The lineup readiness ring: counts of slots, never a grade.
struct ReadinessCard: View {
    let readiness: LineupReadiness
    let onFix: () -> Void

    var body: some View {
        Button(action: onFix) {
            HStack(spacing: 16) {
                ring
                VStack(alignment: .leading, spacing: 4) {
                    if readiness.isAllClear {
                        Label("Lineup set", systemImage: "checkmark.seal.fill")
                            .font(.headline)
                            .foregroundStyle(Palette.start)
                            .symbolEffect(.bounce, value: readiness.isAllClear)
                        Text("Nothing to fix before kickoff.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Lineup readiness")
                            .font(.headline)
                        legend
                        Text("Fix in Sit/Start →")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.accentColor)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(PressableCardStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var ring: some View {
        let segments: [(Int, Color)] = [
            (readiness.ready, Palette.start),
            (readiness.settled, Color.secondary.opacity(0.45)),
            (readiness.caution, Palette.caution),
            (readiness.problems, Palette.sit),
        ]
        let total = max(1, readiness.slots)
        return ZStack {
            Circle().stroke(Palette.surfaceRaised, lineWidth: 9)
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                let start = segments.prefix(index).reduce(0) { $0 + $1.0 }
                Circle()
                    .trim(from: CGFloat(start) / CGFloat(total), to: CGFloat(start + segment.0) / CGFloat(total))
                    .stroke(segment.1, style: StrokeStyle(lineWidth: 9, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 0) {
                Text("\(readiness.ready + readiness.settled)")
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("of \(readiness.slots)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 72, height: 72)
        .motion(Motion.number, value: readiness)
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 2) {
            if readiness.problems > 0 {
                legendRow(Palette.sit, "\(readiness.problems) need fixing — empty, bye or out")
            }
            if readiness.caution > 0 {
                legendRow(Palette.caution, "\(readiness.caution) questionable")
            }
            if readiness.settled > 0 {
                legendRow(Color.secondary.opacity(0.6), "\(readiness.settled) already kicked off")
            }
        }
    }

    private func legendRow(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(text).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var accessibilitySummary: String {
        if readiness.isAllClear { return "Lineup set. Nothing to fix before kickoff." }
        return "\(readiness.ready + readiness.settled) of \(readiness.slots) slots set. \(readiness.problems) need fixing, \(readiness.caution) questionable. Opens Sit/Start."
    }
}
