import SwiftUI
import FCCore

/// The Lineup tab's header: its three sections — Sit/Start, Matchup,
/// Injuries — as status cards that are also the section switcher, so each
/// section's state is visible from the others.
struct LineupHubHeader: View {
    let current: RootView.Screen
    let open: (RootView.Screen) -> Void
    @Environment(\.appServices) private var services

    var body: some View {
        Group {
            if let services {
                LineupStatusCards(current: current, open: open, sitStart: services.sitStart,
                                  matchup: services.matchup, injuries: services.injuries)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(.bar)
        .sensoryFeedback(.selection, trigger: current)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("hub.segments")
    }
}

/// What each Lineup section says on its card, worked out from the models.
enum LineupStatus {
    struct Card: Equatable {
        let text: String
        let tone: Tone
        var isLive = false
    }

    enum Tone: Equatable { case good, caution, bad, neutral }

    static func sitStart(swaps: Int) -> Card {
        swaps == 0 ? Card(text: "Lineup set", tone: .good)
            : Card(text: "\(swaps) swap\(swaps == 1 ? "" : "s")", tone: .caution)
    }

    static func matchup(mine: Double?, theirs: Double?, live: Bool, nextKickoff: Date?) -> Card {
        if let mine, let theirs, mine + theirs > 0 || live {
            let tone: Tone = mine > theirs ? .good : mine < theirs ? .bad : .neutral
            return Card(text: "\(StreamFormat.one(mine))–\(StreamFormat.one(theirs))", tone: tone, isLive: live)
        }
        if let nextKickoff { return Card(text: LockCountdown.kickoffLabel(nextKickoff), tone: .neutral) }
        return Card(text: "This week", tone: .neutral)
    }

    static func injuries(out: Int, questionable: Int) -> Card {
        if out > 0 { return Card(text: "\(out) out", tone: .bad) }
        if questionable > 0 { return Card(text: "\(questionable) Q", tone: .caution) }
        return Card(text: "All clear", tone: .good)
    }
}

private struct LineupStatusCards: View {
    let current: RootView.Screen
    let open: (RootView.Screen) -> Void
    @ObservedObject var sitStart: SitStartModel
    @ObservedObject var matchup: MatchupModel
    @ObservedObject var injuries: InjuryCenterModel

    var body: some View {
        HStack(spacing: 8) {
            card(.sitStart, title: "Sit/Start", icon: "arrow.left.arrow.right",
                 status: LineupStatus.sitStart(swaps: sitStart.starts.count))
            card(.matchup, title: "Matchup", icon: "person.2", status: matchupStatus)
            card(.injuries, title: "Injuries", icon: "cross.case", status: injuryStatus)
        }
    }

    private var matchupStatus: LineupStatus.Card {
        let mine = matchup.mySide, theirs = matchup.opponentSide
        let now = matchup.context?.now() ?? Date()
        let next = mine?.rows.compactMap(\.kickoff).filter { $0 > now }.min()
        return LineupStatus.matchup(mine: mine?.livePoints, theirs: theirs?.livePoints,
                                    live: (mine?.hasLiveGame ?? false) || (theirs?.hasLiveGame ?? false),
                                    nextKickoff: next)
    }

    private var injuryStatus: LineupStatus.Card {
        guard let context = injuries.context else { return .init(text: "…", tone: .neutral) }
        let starters = injuries.roster.filter(\.isStarter)
        let out = starters.filter { StartAvailability.of($0.id, context: context).blocksStart }.count
        let q = starters.filter { StartAvailability.of($0.id, context: context) == .questionable }.count
        return LineupStatus.injuries(out: out, questionable: q)
    }

    private func card(_ screen: RootView.Screen, title: String, icon: String, status: LineupStatus.Card) -> some View {
        let selected = screen == current
        return Button {
            withAnimation(Motion.snappy) { open(screen) }
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 4) {
                    Image(systemName: icon).font(.caption2.weight(.semibold))
                    Text(title).font(.caption.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 0)
                    if status.isLive { LiveDot(size: 6) }
                }
                .foregroundStyle(selected ? Color.accentColor : .secondary)
                Text(status.text)
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(color(status.tone))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .contentTransition(.numericText())
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(selected ? Color.accentColor.opacity(0.12) : Palette.surface))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(selected ? Color.accentColor.opacity(0.6) : .clear, lineWidth: 1.5))
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(status.text)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func color(_ tone: LineupStatus.Tone) -> Color {
        switch tone {
        case .good: return Palette.start
        case .caution: return Palette.caution
        case .bad: return Palette.sit
        case .neutral: return .primary
        }
    }
}
