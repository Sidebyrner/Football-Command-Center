import SwiftUI
import FCCore

/// The watchlist's compared players on a phone: the verdict on top, then a
/// spreadsheet — metric names pinned on the left, one column per player that
/// scrolls sideways, about two and a half in view.
struct PhoneCompareView: View {
    let services: AppServices
    @ObservedObject var discovery: DiscoveryModel
    @ObservedObject var watchlist: WatchlistModel
    @Environment(\.dismiss) private var dismiss
    /// The Player Card opens over this sheet, not from the shell — which is
    /// already presenting this.
    @State private var card: PlayerCardModel?
    /// Bumped when the cards finish loading, so the comparison is rebuilt
    /// with their news and projections.
    @State private var loadedGeneration = 0

    static let labelWidth: CGFloat = 112

    var body: some View {
        Group {
            if let context = services.dashboard.context {
                content(context)
            } else {
                LoadingPlaceholder(label: "Loading…")
            }
        }
        .navigationTitle("Compare")
        .sheet(item: $card) { PlayerCardSheet(model: $0) }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            ToolbarItem(placement: .primaryAction) {
                NavigationLink {
                    WatchlistListView(services: services, watchlist: watchlist)
                } label: {
                    Label("Watchlist", systemImage: "star.square.on.square")
                }
                .accessibilityIdentifier("compare.phone.watchlist")
            }
        }
    }

    @ViewBuilder
    private func content(_ context: LeagueContext) -> some View {
        let ids = watchlist.comparingIDs
        let cards = ids.map { services.playerCard($0, context: context) }
        let _ = loadedGeneration
        let comparison = PlayerComparison.build(cards: cards, rows: discovery.row(for:), defense: discovery.defense,
                                                lastN: 4, baselineID: watchlist.baselineID)
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if comparison.players.isEmpty {
                    emptyState
                } else {
                    VerdictCard(verdict: CompareVerdict.compute(
                        CompareVerdict.inputs(from: comparison),
                        league: CompareVerdict.League(facts: context.leagueFacts, currentWeek: context.currentWeek)
                    ))
                    .card()
                    .accessibilityIdentifier("compare.phone.verdict")
                    grid(comparison, context: context)
                    Text("Best on each row in green; your baseline isn't ranked. Swipe the columns sideways.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .task(id: ids.joined(separator: ",")) {
            await withTaskGroup(of: Void.self) { tasks in
                for card in cards { tasks.addTask { await card.load() } }
            }
            loadedGeneration += 1
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("Nothing to compare", systemImage: "person.2.crop.square.stack")
        } description: {
            Text("Star players on the Waiver Board or in Discover. Up to four go side by side.")
        }
    }

    // MARK: - Grid

    private func rows(_ comparison: PlayerComparison) -> [PhoneCompareRow] {
        PhoneCompareRow.allCases.filter { row in
            switch row {
            case .news: return comparison.players.contains { $0.headline != nil }
            case .playoffs: return comparison.players.contains { !$0.playoffSchedule.isEmpty }
            case .bye: return comparison.players.contains { $0.byeWeek != nil }
            default:
                guard let metric = row.metric else { return true }
                return comparison.values(metric).contains { $0 != nil }
            }
        }
    }

    private func grid(_ comparison: PlayerComparison, context: LeagueContext) -> some View {
        let rows = rows(comparison)
        return HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element) { index, row in
                    Text(row.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .frame(width: Self.labelWidth, height: row.height, alignment: .leading)
                        .padding(.leading, 8)
                        .background(stripe(index))
                }
            }
            .frame(width: Self.labelWidth + 8)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("compare.phone.labels")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 0) {
                    ForEach(comparison.players) { player in
                        column(player, comparison: comparison, rows: rows, context: context)
                            .containerRelativeFrame(.horizontal, count: 5, span: 2, spacing: 0)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .accessibilityIdentifier("compare.phone.grid")
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.surfaceRaised))
    }

    private func stripe(_ index: Int) -> Color {
        index.isMultiple(of: 2) ? Palette.surface : .clear
    }

    private func column(_ player: PlayerComparison.Player, comparison: PlayerComparison, rows: [PhoneCompareRow],
                        context: LeagueContext) -> some View {
        let index = comparison.players.firstIndex { $0.id == player.id } ?? 0
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element) { rowIndex, row in
                cell(row, player: player, index: index, comparison: comparison, context: context)
                    .frame(maxWidth: .infinity)
                    .frame(height: row.height)
                    .padding(.horizontal, 4)
                    .background(stripe(rowIndex))
            }
        }
        .background(player.isBaseline ? Color.accentColor.opacity(0.06) : Color.clear)
        .overlay(alignment: .leading) {
            Rectangle().fill(Palette.surfaceRaised).frame(width: 1)
        }
        .overlay {
            if player.isBaseline {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
                    .padding(2)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("compare.phone.column.\(player.id)")
    }

    @ViewBuilder
    private func cell(_ row: PhoneCompareRow, player: PlayerComparison.Player, index: Int,
                      comparison: PlayerComparison, context: LeagueContext) -> some View {
        switch row {
        case .header:
            header(player, context: context)
        case .availability:
            AvailabilityBadge(availability: player.availability, isBaseline: player.isBaseline,
                              wasClaimed: watchlist.wasClaimed(player.id))
        case .injury:
            VStack(spacing: 1) {
                Text(player.injuryDesignation ?? "Healthy")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(player.injuryDesignation == nil ? Palette.start : InjuryTint.color(player.injuryDesignation))
                if let practice = player.practice {
                    Text(practice.rawValue).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
        case .news:
            if let headline = player.headline {
                VStack(alignment: .leading, spacing: 1) {
                    Text(headline.title).font(.caption2).lineLimit(3)
                    if let date = headline.published {
                        Text(date, format: .relative(presentation: .named)).font(.system(size: 9)).foregroundStyle(.tertiary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("—").font(.caption).foregroundStyle(.tertiary)
            }
        case .bye:
            let inPlayoffs = player.byeWeek.map { context.leagueFacts.playoffWeeks.contains($0) } ?? false
            Text(player.byeWeek.map { "W\($0)" } ?? "—")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(inPlayoffs ? Palette.sit : .primary)
        case .playoffs:
            HStack(spacing: 2) {
                ForEach(player.playoffSchedule) { week in
                    playoffCell(week)
                }
            }
        default:
            if let metric = row.metric {
                let value = player.values[metric]
                let best = comparison.bestIndex(metric) == index
                Text(value.map(metric.format) ?? "—")
                    .font(.subheadline.monospacedDigit().weight(best ? .bold : .regular))
                    .foregroundStyle(best ? Palette.start : value == nil ? Color.secondary : Color.primary)
            }
        }
    }

    private func header(_ player: PlayerComparison.Player, context: LeagueContext) -> some View {
        Button {
            card = services.playerCard(player.id, context: context)
        } label: {
            VStack(spacing: 3) {
                PlayerAvatar(sleeperID: player.id, name: player.name, position: player.position, size: 36)
                    .overlay(Circle().stroke(ChartPalette.color(player.seriesIndex), lineWidth: 2))
                Text(StreamFormat.shortName(player.name))
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Text([player.position?.rawValue, player.team].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button {
                card = services.playerCard(player.id, context: context)
            } label: {
                Label("Open Player Card", systemImage: "person.text.rectangle")
            }
            if player.availability == .mine {
                if player.isBaseline {
                    Button { watchlist.clearBaseline() } label: { Label("Stop using as baseline", systemImage: "ruler") }
                } else {
                    Button { watchlist.setBaseline(player.id) } label: { Label("Use as baseline", systemImage: "ruler") }
                }
            }
            Button {
                watchlist.toggleCompare(player.id)
            } label: {
                Label("Remove from compare", systemImage: "person.2.slash")
            }
        }
    }

    private func playoffCell(_ week: PlayerSchedule.Week) -> some View {
        VStack(spacing: 0) {
            Text("W\(week.week)").font(.system(size: 8).weight(.bold)).foregroundStyle(.secondary)
            Text(week.isBye ? "BYE" : (week.isHome == false ? "@" : "") + (week.opponent ?? "—"))
                .font(.system(size: 10).weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: 34)
        .background(RoundedRectangle(cornerRadius: 5, style: .continuous)
            .fill(week.isBye ? Palette.sit.opacity(0.18) : CompareScheduleCard.tint(week.defenseVsAverage)))
    }
}

/// The phone grid's rows, each a fixed height so the pinned labels and the
/// scrolling columns line up without measuring.
enum PhoneCompareRow: String, CaseIterable, Hashable {
    case header, availability, injury, news
    case projected, restOfSeason, pointsPerGame, expectedPoints, trendingAdds
    case snapShare, targetShare, redZone, grade
    case opponent, teamTotal, schedule, bye, playoffs, depth

    var metric: PlayerComparison.Metric? {
        switch self {
        case .projected: return .projectedThisWeek
        case .restOfSeason: return .restOfSeason
        case .pointsPerGame: return .pointsPerGame
        case .expectedPoints: return .expectedPointsLast4
        case .trendingAdds: return .trendingAdds
        case .snapShare: return .snapShare
        case .targetShare: return .targetShare
        case .redZone: return .redZoneTouches
        case .grade: return .gradeScore
        case .opponent: return .opponentRank
        case .teamTotal: return .impliedTeamTotal
        case .schedule: return .strengthOfSchedule
        case .depth: return .depthRank
        case .playoffs: return .playoffMatchups
        case .header, .availability, .injury, .news, .bye: return nil
        }
    }

    var label: String {
        switch self {
        case .header: return ""
        case .availability: return "Availability"
        case .injury: return "Injury / practice"
        case .news: return "Latest news"
        case .projected: return "Projected this week"
        case .restOfSeason: return "Rest of season /gm"
        case .pointsPerGame: return "Pts/gm"
        case .expectedPoints: return "xFP, last 4"
        case .trendingAdds: return "Sleeper adds (24h)"
        case .snapShare: return "Snap share"
        case .targetShare: return "Target share"
        case .redZone: return "Red zone touches"
        case .grade: return "Grade"
        case .opponent: return "Opponent vs pos."
        case .teamTotal: return "Team total"
        case .schedule: return "Schedule ahead"
        case .bye: return "Bye"
        case .playoffs: return "Playoff weeks"
        case .depth: return "Depth chart"
        }
    }

    var height: CGFloat {
        switch self {
        case .header: return 88
        case .news: return 66
        case .playoffs: return 48
        case .injury: return 42
        default: return 36
        }
    }
}
