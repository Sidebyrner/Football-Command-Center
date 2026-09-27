import SwiftUI
import FCCore

/// A W/L chip per completed week.
struct ResultsStrip: View {
    let results: [WeekResult]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title: "Your season", subtitle: "Every completed week, with the score.")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(results) { result in
                        VStack(spacing: 3) {
                            Text("W\(result.week)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Text(result.outcome.rawValue)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 34, height: 34)
                                .background(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(colour(result.outcome))
                                )
                            Text(String(format: "%.0f–%.0f", result.myPoints, result.opponentPoints))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Week \(result.week): \(result.outcome == .win ? "won" : result.outcome == .loss ? "lost" : "tied") \(Int(result.myPoints)) to \(Int(result.opponentPoints)) against \(result.opponentManager)")
                    }
                }
            }
        }
        .card()
    }

    private func colour(_ outcome: WeekResult.Outcome) -> Color {
        switch outcome {
        case .win: return Palette.start
        case .loss: return Palette.sit
        case .tie: return .secondary
        }
    }
}

/// The next few opponents, and whether byes hurt either side that week.
struct UpcomingOpponentsCard: View {
    let upcoming: [UpcomingOpponent]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Coming up", subtitle: "Your next opponents, and who has a bye problem that week.")
            ForEach(upcoming) { game in
                HStack(spacing: 10) {
                    Text("W\(game.week)")
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(game.manager).font(.subheadline.weight(.semibold)).lineLimit(1)
                        if let record = game.record {
                            Text(record).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        shortfall("You", game.yourShortfall)
                        shortfall("Them", game.theirShortfall)
                    }
                }
            }
        }
        .card()
    }

    private func shortfall(_ who: String, _ count: Int) -> some View {
        Text(count == 0 ? "\(who): full lineup" : "\(who): \(count) short")
            .font(.caption.weight(count == 0 ? .regular : .semibold))
            .foregroundStyle(count == 0 ? Color.secondary : (count >= 2 ? Palette.sit : Palette.caution))
    }
}

/// The rest of your season at a glance: your shortfall each week, over how much
/// of the league is short too. Tapping opens Planning.
struct ByeStripCard: View {
    let weeks: [ByeStripWeek]
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    SectionHeader(
                        title: "Bye weeks ahead",
                        subtitle: problemWeeks == 0
                            ? "No problem weeks left."
                            : "\(problemWeeks) week\(problemWeeks == 1 ? "" : "s") you can't field a full lineup."
                    )
                    Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 3) {
                        ForEach(weeks) { week in
                            VStack(spacing: 3) {
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(colour(week.yourShortfall))
                                    .frame(width: 22, height: 22)
                                    .overlay {
                                        if week.yourShortfall > 0 {
                                            Text("\(week.yourShortfall)")
                                                .font(.caption2.weight(.bold))
                                                .foregroundStyle(.white)
                                        }
                                    }
                                // League share short that week, as a thin bar.
                                Capsule()
                                    .fill(Color.secondary.opacity(0.5))
                                    .frame(width: max(2, 22 * CGFloat(week.teamsShort) / CGFloat(max(1, week.teamCount))), height: 3)
                                    .frame(width: 22, alignment: .leading)
                                Text("\(week.week)")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Text("Squares are your shortfall; the bar under each is how much of the league is short that week.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(PressableCardStyle())
    }

    private var problemWeeks: Int { weeks.filter { $0.yourShortfall > 0 }.count }

    private func colour(_ shortfall: Int) -> Color {
        switch shortfall {
        case 0: return Palette.start.opacity(0.35)
        case 1: return Palette.caution
        default: return Palette.sit
        }
    }
}
