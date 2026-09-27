import SwiftUI
import FCCore
import FCData

/// The top of My Team: your team, where it stands, who's in the lineup, and the
/// three sources the app draws on — each saying how fresh it is.
struct TeamHeroHeader: View {
    @ObservedObject var model: DashboardModel
    let context: LeagueContext
    @State private var explained: Pillar?
    @Environment(\.hubTint) private var hubTint
    private var tint: Color { hubTint ?? .accentColor }

    enum Pillar: String, CaseIterable, Identifiable {
        case vegas = "Vegas"
        case news = "News"
        case sleeper = "Sleeper"

        var id: String { rawValue }

        var systemImage: String {
            switch self {
            case .vegas: return "chart.line.uptrend.xyaxis"
            case .news: return "newspaper"
            case .sleeper: return "person.3"
            }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Team · \(context.userTeam?.manager ?? "My Team")", systemImage: "person.crop.square")
                        .textStyle(.micro)
                        .foregroundStyle(tint)
                        .lineLimit(1)
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if let mine = model.standings.first(where: \.isUser) {
                            Text(mine.record)
                                .textStyle(.display)
                        }
                        if let place = model.place {
                            Text("\(ordinal(place.rank)) of \(place.of)")
                                .font(.headline)
                                .foregroundStyle(tint)
                        }
                        if let streak = model.streak {
                            let tone: StatusTone = streak.hasPrefix("W") ? .start : .sit
                            Label(streak, systemImage: streak.hasPrefix("W") ? "arrow.up.right" : "arrow.down.right")
                                .font(.caption.weight(.bold).monospacedDigit())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(tone.color.opacity(0.14)))
                                .foregroundStyle(tone.color)
                        }
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("Week \(context.currentWeek)")
                            .textStyle(.micro)
                            .foregroundStyle(.secondary)
                        if starterIDs.contains(where: { context.isLive($0) }) {
                            LiveBadge()
                        }
                    }
                    if let mine = model.standings.first(where: \.isUser) {
                        Text(String(format: "%.1f pts for", mine.pointsFor))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }

            starterStrip

            HStack(spacing: 6) {
                ForEach(Pillar.allCases) { pillar in
                    Button {
                        explained = explained == pillar ? nil : pillar
                    } label: {
                        Label(chipText(pillar), systemImage: pillar.systemImage)
                            .font(.caption2.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .frame(maxWidth: .infinity)
                            .background(Capsule().fill(explained == pillar ? tint.opacity(0.22) : Surface.inset))
                            .foregroundStyle(chipTint(pillar))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(pillar.rawValue): \(chipText(pillar))")
                }
            }
            if let pillar = explained {
                Text(explanation(pillar))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(Space.l + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScreenHeroBackground(tint: tint))
        .motion(Motion.snappy, value: explained)
        .accessibilityIdentifier("myteam.hero")
    }

    private var starterIDs: [String] {
        (context.userTeam?.rawStarters ?? []).filter { $0 != SleeperRoster.emptyStarterSlot }
    }

    private var starterStrip: some View {
        HStack(spacing: -8) {
            ForEach(starterIDs.prefix(11), id: \.self) { id in
                PlayerAvatar(
                    sleeperID: id,
                    name: context.playerName(id),
                    position: context.position(id),
                    size: 34
                )
                .overlay(alignment: .bottomTrailing) {
                    if context.isLive(id) {
                        Circle().fill(Palette.sit).frame(width: 9, height: 9)
                            .overlay(Circle().strokeBorder(Color(white: 1, opacity: 0.9), lineWidth: 1.5))
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(starterIDs.count) starters")
    }

    // MARK: - Pillars

    private func chipText(_ pillar: Pillar) -> String {
        switch pillar {
        case .vegas:
            let lines = GameLines.week(context.schedule, week: context.currentWeek).values.filter { $0.impliedTotal != nil }
            return lines.isEmpty ? "No lines" : "Lines wk \(context.currentWeek)"
        case .news:
            return model.hasRelay ? "Relay on" : "Not connected"
        case .sleeper:
            if case .live = context.sleeperProvenance { return "Synced" }
            if case .staleCache = context.sleeperProvenance { return "Offline" }
            return context.sleeperProvenance.age.map { "\(Freshness.relative($0).replacingOccurrences(of: " ago", with: ""))" } ?? "Synced"
        }
    }

    private func chipTint(_ pillar: Pillar) -> Color {
        switch pillar {
        case .sleeper: return Freshness.isDegraded(context.sleeperProvenance) ? Palette.caution : .primary
        case .news: return model.hasRelay ? .primary : .secondary
        case .vegas: return .primary
        }
    }

    private func explanation(_ pillar: Pillar) -> String {
        switch pillar {
        case .vegas:
            let source = Freshness.label(for: context.staticProvenance).map { " (\($0.lowercased()))" } ?? ""
            return "Implied team totals from Vegas's recorded closing lines in the schedule file\(source) — not live odds."
        case .news:
            return model.hasRelay
                ? "News comes through your relay. Team briefings written on your own machine appear here."
                : "Connect your relay in Settings to get news and team briefings written on your own machine."
        case .sleeper:
            return (Freshness.explanation(for: context.sleeperProvenance) ?? "Live from Sleeper just now.")
                + " Your league, rosters, lineup and injury tags come straight from Sleeper."
        }
    }

    private func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 100, n % 10) {
        case (11...13, _): suffix = "th"
        case (_, 1): suffix = "st"
        case (_, 2): suffix = "nd"
        case (_, 3): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}
