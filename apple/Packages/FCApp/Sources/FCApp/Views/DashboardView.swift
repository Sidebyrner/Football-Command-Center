import SwiftUI
import FCCore
import FCData

/// Dashboard — "what needs me right now" (§7.1).
///
/// Alerts pinned at the top, everything else scrolling below. This is the
/// screen a notification deep-links into, so whatever the notification was
/// about has to be answerable without scrolling.
public struct DashboardView: View {
    @ObservedObject var model: DashboardModel

    public init(model: DashboardModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if model.isLoading {
                    ProgressView("Loading your league…")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if let error = model.errorMessage {
                    errorBlock(error)
                } else if let context = model.context {
                    FreshnessBanner(provenance: context.provenance)
                    alertsSection
                    standingsSection
                    benchSection
                    trendSection
                    draftSection
                    newsSection
                    transactionsSection
                }
            }
            .padding()
        }
        .navigationTitle("Dashboard")
    }

    private func errorBlock(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Could not load your league", systemImage: "exclamationmark.triangle")
                .font(.headline)
            Text(error).font(.footnote).foregroundStyle(.secondary)
        }
    }

    // MARK: - Alerts

    @ViewBuilder
    private var alertsSection: some View {
        if model.alerts.isEmpty {
            Label("Lineup looks clean for this week.", systemImage: "checkmark.circle")
                .font(.subheadline)
                .foregroundStyle(Palette.start)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(model.alerts) { alert in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: icon(for: alert.kind))
                            .foregroundStyle(colour(for: alert.kind))
                            .imageScale(.small)
                        VStack(alignment: .leading, spacing: 1) {
                            if let name = alert.playerName {
                                Text(name).font(.subheadline.weight(.semibold))
                            }
                            Text(alert.detail)
                                .font(.caption)
                                .foregroundStyle(colour(for: alert.kind))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Palette.caution.opacity(0.10)))
        }
    }

    private func icon(for kind: LineupAlert.Kind) -> String {
        switch kind {
        case .onBye: return "calendar.badge.minus"
        case .emptySlot: return "exclamationmark.triangle.fill"
        case .injured: return "cross.case"
        }
    }

    private func colour(for kind: LineupAlert.Kind) -> Color {
        switch kind {
        case .onBye: return Palette.sit
        case .emptySlot: return Palette.caution
        case .injured: return Palette.caution
        }
    }

    // MARK: - Standings

    @ViewBuilder
    private var standingsSection: some View {
        if !model.standings.isEmpty {
            Section(header: sectionTitle("Standings")) {
                VStack(spacing: 2) {
                    ForEach(Array(model.standings.enumerated()), id: \.element.id) { index, row in
                        HStack(spacing: 8) {
                            Text("\(index + 1)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .frame(width: 18, alignment: .trailing)
                            Text(row.isUser ? "\(row.manager) (you)" : row.manager)
                                .font(.caption)
                                .lineLimit(1)
                                .fontWeight(row.isUser ? .semibold : .regular)
                            Spacer()
                            Text(row.record).font(.caption.monospacedDigit())
                            Text(String(format: "%.1f", row.pointsFor))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 56, alignment: .trailing)
                        }
                        .padding(.vertical, 3)
                        .padding(.horizontal, 6)
                        .background(row.isUser ? Color.accentColor.opacity(0.10) : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }
            }
        }
    }

    // MARK: - Bench points

    @ViewBuilder
    private var benchSection: some View {
        if !model.benchWeeks.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Left on your bench")

                Text(String(format: "%.1f", model.totalLeftOnBench))
                    .font(.system(size: 30, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text("total across \(model.benchWeeks.count) completed week\(model.benchWeeks.count == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                let worst = model.benchWeeks.filter { $0.left > 0 }.sorted { $0.left > $1.left }.prefix(5)
                if worst.isEmpty {
                    Text("Perfect lineups every week so far.")
                        .font(.caption)
                        .foregroundStyle(Palette.start)
                } else {
                    ForEach(worst) { week in
                        VStack(alignment: .leading, spacing: 1) {
                            HStack {
                                Text("Week \(week.week)").font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Text(String(format: "−%.1f", week.left))
                                    .font(.caption.weight(.semibold).monospacedDigit())
                                    .foregroundStyle(Palette.sit)
                            }
                            if let hero = week.shouldHaveStarted.first {
                                Text("should have started \(hero.name) (\(String(format: "%.1f", hero.points)))")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }

                Text("\"Best available\" runs the same optimizer as Sit/Start, with points actually scored as the basis — so overlapping flex slots are handled properly and equal-value shuffles are not reported as missed moves.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Trend

    @ViewBuilder
    private var trendSection: some View {
        if !model.trend.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle("Weekly scoring")
                ForEach(model.trend) { point in
                    HStack(spacing: 8) {
                        Text("W\(point.week)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 26, alignment: .leading)
                        bar(point)
                        Text(point.mine.map { String(format: "%.1f", $0) } ?? "—")
                            .font(.caption.monospacedDigit())
                            .frame(width: 48, alignment: .trailing)
                        if let rank = point.rank {
                            Text("#\(rank)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 28, alignment: .trailing)
                        }
                    }
                }
                Text("Real results only — the rank each week is against the field you actually played.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    /// Mine against the league average that week, which is the comparison that
    /// makes a raw total mean anything.
    private func bar(_ point: TrendPoint) -> some View {
        GeometryReader { geometry in
            let maximum = max(
                model.trend.compactMap(\.mine).max() ?? 1,
                model.trend.compactMap(\.leagueAverage).max() ?? 1
            )
            let width = geometry.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.12))
                if let average = point.leagueAverage, maximum > 0 {
                    Capsule()
                        .fill(Color.secondary.opacity(0.35))
                        .frame(width: width * average / maximum, height: 3)
                }
                if let mine = point.mine, maximum > 0 {
                    Capsule()
                        .fill(Color.accentColor)
                        .frame(width: width * mine / maximum, height: 8)
                }
            }
        }
        .frame(height: 10)
    }

    // MARK: - Draft

    @ViewBuilder
    private var draftSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle("Draft value realized")

            if let unavailable = model.draftUnavailable {
                Text(unavailable).font(.caption).foregroundStyle(.secondary)
            } else if model.draftResults.isEmpty {
                Text("No graded picks yet.").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(model.draftResults.prefix(8)) { pick in
                    HStack {
                        PositionChip(position: pick.position)
                            .frame(width: 38, alignment: .leading)
                        Text(pick.name).font(.caption).lineLimit(1)
                        Text("pick \(pick.pickNo)").font(.caption2).foregroundStyle(.tertiary)
                        Spacer()
                        Text(String(format: "%+.1f", pick.surplus))
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(pick.surplus >= 0 ? Palette.start : Palette.sit)
                    }
                }
                Text("Against what that pick number actually returned league-wide this season — not against anyone's preseason ranking.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - News and transactions

    @ViewBuilder
    private var newsSection: some View {
        if !model.news.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle("Your players in the news")
                ForEach(model.news.prefix(6), id: \.title) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title).font(.caption).lineLimit(2)
                        if let published = item.publishedAt {
                            Text(published).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var transactionsSection: some View {
        if !model.transactions.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                sectionTitle("Recent league moves")
                ForEach(model.transactions.prefix(10)) { transaction in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(transaction.manager).font(.caption.weight(.semibold))
                            Text(transaction.type).font(.caption2).foregroundStyle(.secondary)
                            Spacer()
                            Text("W\(transaction.week)").font(.caption2).foregroundStyle(.tertiary)
                        }
                        if !transaction.addedNames.isEmpty {
                            Text("+ \(transaction.addedNames.joined(separator: ", "))")
                                .font(.caption2).foregroundStyle(Palette.start).lineLimit(1)
                        }
                        if !transaction.droppedNames.isEmpty {
                            Text("− \(transaction.droppedNames.joined(separator: ", "))")
                                .font(.caption2).foregroundStyle(Palette.sit).lineLimit(1)
                        }
                    }
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(.headline)
    }
}
