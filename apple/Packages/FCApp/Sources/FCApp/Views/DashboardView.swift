import SwiftUI
import FCCore
import FCData

/// Dashboard — "what needs me right now" (§7.1).
///
/// Ordered by urgency: what to fix before kickoff, then this week's game, then
/// who to pick up, then the season so far. This is the screen a notification
/// deep-links into, so the top of it has to answer that notification.
public struct DashboardView: View {
    @ObservedObject var model: DashboardModel
    @Environment(\.openScreen) private var openScreen
    @State private var showAllStandings = false
    @State private var showAllMoves = false
    @Environment(\.openTrade) private var openTrade

    public init(model: DashboardModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let error = model.errorMessage, model.context != nil {
                    InlineErrorBanner(message: error)
                }
                if model.context == nil, model.isLoading || model.errorMessage == nil {
                    LoadingPlaceholder(label: "Loading your league…")
                } else if model.context == nil, let error = model.errorMessage {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Could not load your league", systemImage: "exclamationmark.triangle")
                            .font(.headline)
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } else if let context = model.context {
                    TeamHeroHeader(model: model, context: context)
                        .appear()
                    SlidingPicker(options: MyTeamZoom.allCases, selection: $model.zoom) { $0.rawValue }
                    Group {
                        switch model.zoom {
                        case .thisWeek:
                            if let readiness = model.readiness {
                                ReadinessCard(readiness: readiness) { openScreen(.sitStart) }
                            }
                            alertsSection
                            thisWeekCard
                            waiverTargetsSection
                            newsSection
                        case .season:
                            standingsSection
                            if !model.results.isEmpty {
                                ResultsStrip(results: model.results)
                            }
                            if !model.upcoming.isEmpty {
                                UpcomingOpponentsCard(upcoming: model.upcoming)
                            }
                            if !model.byeStrip.isEmpty {
                                ByeStripCard(weeks: model.byeStrip) { openScreen(.planning) }
                            }
                            StartTradeCard { openTrade() }
                            trendSection
                            benchSection
                            draftSection
                            transactionsSection
                        }
                    }
                    .id(model.zoom)
                    .transition(.opacity.combined(with: .move(edge: model.zoom == .season ? .trailing : .leading)))
                    FreshnessBanner(provenance: context.provenance)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .motion(Motion.snappy, value: model.zoom)
        }
        .refreshable { await model.refresh() }
        .sensoryFeedback(.success, trigger: model.refreshCount)
        .navigationTitle("My Team")
    }

    // MARK: - Alerts

    @ViewBuilder
    private var alertsSection: some View {
        if model.alerts.isEmpty {
            Label("Lineup looks clean for this week.", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.start)
                .card(fill: Palette.start.opacity(0.10))
                .appear()
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label("Before kickoff", systemImage: "exclamationmark.triangle.fill")
                        .font(.headline)
                        .foregroundStyle(Palette.caution)
                        .symbolEffect(.bounce, value: model.alerts.count)
                    Spacer()
                    Button {
                        openScreen(.sitStart)
                    } label: {
                        Label("Fix in Sit/Start", systemImage: "arrow.right")
                            .labelStyle(.titleAndIcon)
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
                if let next = model.nextLock, let context = model.context {
                    TimelineView(.periodic(from: .now, by: 30)) { _ in
                        Label("Next lineup lock in \(LockCountdown.format(next.timeIntervalSince(context.now()))) (\(LockCountdown.kickoffLabel(next)))", systemImage: "lock.open")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(Array(model.alerts.enumerated()), id: \.element.id) { offset, alert in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: icon(for: alert.kind))
                            .foregroundStyle(colour(for: alert.kind))
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            if let name = alert.playerName {
                                Text(name).font(.subheadline.weight(.semibold))
                            }
                            Text(alert.detail)
                                .font(.caption)
                                .foregroundStyle(colour(for: alert.kind))
                                .fixedSize(horizontal: false, vertical: true)
                            if let asOf = alert.asOf {
                                Text("as of \(asOf.formatted(.dateTime.weekday(.abbreviated).hour().minute()))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .appear(index: offset)
                }
                if let url = model.context.flatMap({ SleeperLinks.team(leagueID: $0.league.leagueID) }) {
                    Link(destination: url) {
                        Label("Open in Sleeper", systemImage: "arrow.up.forward.app")
                            .font(.caption.weight(.semibold))
                    }
                }
            }
            .card(fill: Palette.caution.opacity(0.10))
        }
    }

    private func icon(for kind: LineupAlert.Kind) -> String {
        switch kind {
        case .onBye: return "calendar.badge.minus"
        case .emptySlot: return "square.dashed"
        case .injured: return "cross.case.fill"
        }
    }

    private func colour(for kind: LineupAlert.Kind) -> Color {
        switch kind {
        case .onBye: return Palette.sit
        case .emptySlot, .injured: return Palette.caution
        }
    }

    // MARK: - This week

    @ViewBuilder
    private var thisWeekCard: some View {
        if let week = model.thisWeek {
            Button {
                openScreen(.matchup)
            } label: {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("WEEK \(week.week)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .kerning(1.2)
                        Spacer()
                        HStack(spacing: 3) {
                            Text("Matchup")
                            Image(systemName: "chevron.right")
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                    }
                    HStack(alignment: .firstTextBaseline) {
                        score(week.myManager, week.myPoints, week.myAverageTeamTotal, alignment: .leading)
                        if let opponent = week.opponentManager {
                            score(opponent, week.opponentPoints, week.opponentAverageTeamTotal, alignment: .trailing)
                        }
                    }
                    HStack {
                        Text(week.status)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(week.opponentLeftToPlay.map { "\(week.myLeftToPlay) vs \($0) left to play" }
                             ?? "\(week.myLeftToPlay) left to play")
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(PressableCardStyle())
            .appear(index: 1)
        }
    }

    private func score(_ manager: String, _ points: Double?, _ average: Double?, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(manager)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(points.map { String(format: "%.1f", $0) } ?? "—")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(.primary)
                .contentTransition(.numericText())
            if let average {
                Text(String(format: "teams avg %.1f pts", average))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    // MARK: - Waiver targets

    @ViewBuilder
    private var waiverTargetsSection: some View {
        if !model.waiverTargets.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    title: "Waiver targets",
                    subtitle: "Trending adds nobody in your league has. Popularity only."
                )
                ForEach(model.waiverTargets) { target in
                    HStack(spacing: 8) {
                        PositionChip(position: target.position)
                            .frame(width: 40, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            HStack(spacing: 4) {
                                Text(target.name).font(.subheadline).lineLimit(1)
                                if let team = target.team {
                                    Text(team).font(.caption2).foregroundStyle(.secondary)
                                }
                            }
                            if target.fillsNeedThisWeek {
                                Label("Fills a hole this week", systemImage: "checkmark.circle.fill")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Palette.start)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(target.adds.formatted(.number.notation(.compactName)) + " adds")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                }
                Button {
                    openScreen(.planning)
                } label: {
                    Label("Plan waivers for the weeks ahead", systemImage: "arrow.right")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderless)
                .padding(.top, 2)
            }
            .card()
        }
    }

    // MARK: - Standings

    @ViewBuilder
    private var standingsSection: some View {
        if !model.standings.isEmpty {
            let shown = showAllStandings ? model.standings : Array(model.standings.prefix(5))
            VStack(alignment: .leading, spacing: 4) {
                SectionHeader(title: "Standings")
                    .padding(.bottom, 4)
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, row in
                    HStack(spacing: 8) {
                        Text("\(index + 1)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.tertiary)
                            .frame(width: 18, alignment: .trailing)
                        Text(row.isUser ? "\(row.manager) (you)" : row.manager)
                            .font(.subheadline)
                            .lineLimit(1)
                            .fontWeight(row.isUser ? .semibold : .regular)
                        Spacer()
                        Text(row.record).font(.subheadline.monospacedDigit())
                        Text(String(format: "%.1f", row.pointsFor))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 58, alignment: .trailing)
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 6)
                    .background(row.isUser ? Color.accentColor.opacity(0.12) : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                if model.standings.count > 5 {
                    Button(showAllStandings ? "Show top 5" : "Show all \(model.standings.count)") {
                        showAllStandings.toggle()
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                    .padding(.top, 4)
                }
            }
            .card()
            .motion(Motion.snappy, value: showAllStandings)
        }
    }

    // MARK: - Bench points

    @ViewBuilder
    private var benchSection: some View {
        if !model.benchWeeks.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(
                    title: "Left on your bench",
                    subtitle: "What your lineup scored against the best one you had."
                )
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(String(format: "%.1f", model.totalLeftOnBench))
                        .font(.system(size: 32, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    Text("pts across \(model.benchWeeks.count) week\(model.benchWeeks.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                let worst = model.benchWeeks.filter { $0.left > 0 }.sorted { $0.left > $1.left }.prefix(3)
                if worst.isEmpty {
                    Text("Perfect lineups every week so far.")
                        .font(.caption)
                        .foregroundStyle(Palette.start)
                } else {
                    ForEach(worst) { week in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Week \(week.week)").font(.caption.weight(.semibold))
                                if let hero = week.shouldHaveStarted.first {
                                    Text("should have started \(hero.name) (\(String(format: "%.1f", hero.points)))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                            Text(String(format: "−%.1f", week.left))
                                .font(.caption.weight(.semibold).monospacedDigit())
                                .foregroundStyle(Palette.sit)
                        }
                    }
                }
            }
            .card()
        }
    }

    // MARK: - Trend

    @ViewBuilder
    private var trendSection: some View {
        if !model.trend.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Weekly scoring", subtitle: "You against the league average — real results only.")
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
                        Text(point.rank.map { "#\($0)" } ?? "")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .frame(width: 28, alignment: .trailing)
                    }
                }
            }
            .card()
        }
    }

    private func bar(_ point: TrendPoint) -> some View {
        GeometryReader { geometry in
            let maximum = max(
                model.trend.compactMap(\.mine).max() ?? 1,
                model.trend.compactMap(\.leagueAverage).max() ?? 1
            )
            let width = geometry.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surfaceRaised)
                if let mine = point.mine, maximum > 0 {
                    Capsule()
                        .fill(Color.accentColor)
                        .frame(width: width * mine / maximum, height: 8)
                }
                if let average = point.leagueAverage, maximum > 0 {
                    Rectangle()
                        .fill(Color.primary.opacity(0.6))
                        .frame(width: 2, height: 12)
                        .offset(x: width * average / maximum - 1)
                }
            }
        }
        .frame(height: 12)
    }

    // MARK: - Draft

    private var draftSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(
                title: "Draft value realized",
                subtitle: "Each pick against what that pick number actually returned league-wide."
            )
            if let unavailable = model.draftUnavailable {
                Text(unavailable).font(.caption).foregroundStyle(.secondary)
            } else if model.draftResults.isEmpty {
                Text("No graded picks yet.").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(model.draftResults.prefix(6)) { pick in
                    HStack(spacing: 8) {
                        PositionChip(position: pick.position)
                            .frame(width: 40, alignment: .leading)
                        Text(pick.name).font(.subheadline).lineLimit(1)
                        Text("#\(pick.pickNo)").font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Text(String(format: "%+.1f", pick.surplus))
                            .font(.caption.weight(.semibold).monospacedDigit())
                            .foregroundStyle(Palette.delta(pick.surplus))
                    }
                }
            }
        }
        .card()
    }

    // MARK: - News and transactions

    @ViewBuilder
    private var newsSection: some View {
        if !model.news.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeader(title: "Your players in the news")
                ForEach(model.news.prefix(6), id: \.title) { item in
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.title).font(.caption).lineLimit(2)
                        if let published = item.publishedAt {
                            Text(published).font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            }
            .card()
        }
    }

    @ViewBuilder
    private var transactionsSection: some View {
        if !model.transactions.isEmpty {
            let shown = showAllMoves ? model.transactions : Array(model.transactions.prefix(5))
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: "Recent league moves")
                ForEach(shown) { transaction in
                    VStack(alignment: .leading, spacing: 1) {
                        HStack {
                            Text(transaction.manager).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(transaction.type.replacingOccurrences(of: "_", with: " "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("W\(transaction.week)").font(.caption2).foregroundStyle(.tertiary)
                        }
                        if !transaction.addedNames.isEmpty {
                            Text("+ \(transaction.addedNames.joined(separator: ", "))")
                                .font(.caption2)
                                .foregroundStyle(Palette.start)
                                .lineLimit(1)
                        }
                        if !transaction.droppedNames.isEmpty {
                            Text("− \(transaction.droppedNames.joined(separator: ", "))")
                                .font(.caption2)
                                .foregroundStyle(Palette.sit)
                                .lineLimit(1)
                        }
                    }
                }
                if model.transactions.count > 5 {
                    Button(showAllMoves ? "Show fewer" : "Show all \(model.transactions.count)") {
                        showAllMoves.toggle()
                    }
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                }
            }
            .card()
            .motion(Motion.snappy, value: showAllMoves)
        }
    }
}
