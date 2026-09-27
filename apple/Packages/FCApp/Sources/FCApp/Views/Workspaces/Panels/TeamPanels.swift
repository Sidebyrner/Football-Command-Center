import SwiftUI
import FCCore
import FCData

/// Is every slot filled with someone who'll play — the readiness ring, then
/// what's wrong, then the next lock.
struct LineupReadinessPanel: View {
    @ObservedObject var model: DashboardModel
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            PanelScroll {
                if let readiness = model.readiness {
                    ReadinessCard(readiness: readiness) { openScreen(.sitStart) }
                }
                if let next = model.nextLock, let context = model.context {
                    TimelineView(.periodic(from: .now, by: 30)) { _ in
                        Label("Next lock in \(LockCountdown.format(next.timeIntervalSince(context.now()))) · \(LockCountdown.kickoffLabel(next))",
                              systemImage: "lock.open")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(model.alerts) { alert in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: Self.icon(alert.kind))
                            .foregroundStyle(Self.colour(alert.kind))
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 1) {
                            if let name = alert.playerName {
                                Text(name).font(.caption.weight(.semibold))
                            }
                            Text(alert.detail)
                                .font(.caption2)
                                .foregroundStyle(Self.colour(alert.kind))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .panelPlayerTap(alert.playerID, context: model.context)
                }
            }
        }
    }

    static func icon(_ kind: LineupAlert.Kind) -> String {
        switch kind {
        case .onBye: return "calendar.badge.minus"
        case .emptySlot: return "square.dashed"
        case .injured: return "cross.case.fill"
        }
    }

    static func colour(_ kind: LineupAlert.Kind) -> Color {
        kind == .onBye ? Palette.sit : Palette.caution
    }
}

/// The recommended lineup: what changes and what it's worth, then the lineup.
struct SitStartPanel: View {
    @ObservedObject var model: SitStartModel

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            PanelScroll {
                summary
                if !model.starts.isEmpty {
                    changeGroup("Start", tint: Palette.start, changes: model.starts)
                }
                if !model.sits.isEmpty {
                    changeGroup("Sit", tint: Palette.sit, changes: model.sits)
                }
                if !model.lineup.isEmpty {
                    Text("Lineup")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.top, 4)
                    ForEach(model.lineup) { slot in
                        HStack(spacing: 8) {
                            Text(Self.slotLabel(slot.slot))
                                .font(.caption2.weight(.bold).monospaced())
                                .foregroundStyle(.secondary)
                                .frame(width: 34, alignment: .leading)
                            PanelPlayerRow(playerID: slot.playerID, name: slot.name ?? "Empty",
                                           position: slot.playerID.flatMap { model.context?.position($0) },
                                           badge: slot.availability.badge,
                                           chip: slot.isLocked ? "locked" : nil) {
                                Text(PanelFormat.points(slot.value))
                                    .font(.caption.monospacedDigit().weight(slot.changed ? .bold : .regular))
                                    .foregroundStyle(slot.changed ? Palette.start : .primary)
                            }
                        }
                        .panelPlayerTap(slot.playerID, context: model.context)
                    }
                }
                PanelFootnote(text: "On \(model.basis.label.lowercased()).")
            }
        }
    }

    @ViewBuilder
    private var summary: some View {
        if let gain = model.gain, gain > 0.05 {
            Label("\(PanelFormat.signed(gain)) pts with \(model.starts.count) change\(model.starts.count == 1 ? "" : "s")",
                  systemImage: "arrow.up.right.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.start)
        } else {
            Label("Your lineup is already the best", systemImage: "checkmark.seal.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.start)
        }
    }

    private func changeGroup(_ title: String, tint: Color, changes: [LineupChange]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(tint)
            ForEach(changes) { change in
                PanelPlayerRow(playerID: change.playerID, name: change.name,
                               position: model.context?.position(change.playerID),
                               detail: Self.slotLabel(change.slot), badge: change.injury) {
                    Text(PanelFormat.points(change.value)).font(.caption.monospacedDigit())
                }
                .panelPlayerTap(change.playerID, context: model.context)
            }
        }
    }

    static func slotLabel(_ token: String) -> String {
        switch token {
        case "SUPER_FLEX": return "SF"
        case "REC_FLEX": return "RWT"
        case "WRRB_FLEX": return "W/R"
        case "IDP_FLEX": return "IDP"
        default: return token
        }
    }
}

/// This week's score: live when games are on, projected before.
struct MatchupScorePanel: View {
    @ObservedObject var model: MatchupModel

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            PanelScroll {
                if let mine = model.mySide, let theirs = model.opponentSide {
                    scoreboard(mine, theirs)
                    starters(mine)
                } else if let mine = model.mySide {
                    Text(model.noOpponentReason ?? "No opponent this week.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    starters(mine)
                } else {
                    PanelMessage(style: .empty, text: model.noOpponentReason ?? "No matchup this week.")
                }
            }
        }
    }

    private func total(_ side: MatchupSide) -> Double? {
        if let live = side.livePoints, model.comparisonBasis == .livePoints { return live }
        let projected = side.rows.compactMap(\.projected)
        return projected.isEmpty ? side.livePoints : projected.reduce(0, +)
    }

    private var showingLive: Bool { model.comparisonBasis == .livePoints }

    private func scoreboard(_ mine: MatchupSide, _ theirs: MatchupSide) -> some View {
        let my = total(mine) ?? 0
        let their = total(theirs) ?? 0
        let share = my + their > 0 ? my / (my + their) : 0.5
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                side("You", my, leading: true, winning: my >= their)
                Spacer()
                if model.anyGameLive {
                    Label("Live", systemImage: "dot.radiowaves.left.and.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Palette.sit)
                } else {
                    Text(showingLive ? "Final so far" : "Projected")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                side(theirs.manager, their, leading: false, winning: their > my)
            }
            GeometryReader { bar in
                HStack(spacing: 2) {
                    Capsule().fill(Color.accentColor).frame(width: max(bar.size.width * share - 1, 4))
                    Capsule().fill(Color.secondary.opacity(0.35))
                }
            }
            .frame(height: 6)
            .accessibilityHidden(true)
            Text("\(mine.leftToPlay) left to play · they have \(theirs.leftToPlay)")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private func side(_ name: String, _ points: Double, leading: Bool, winning: Bool) -> some View {
        VStack(alignment: leading ? .leading : .trailing, spacing: 0) {
            Text(PanelFormat.points(points))
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(winning ? .primary : .secondary)
                .contentTransition(.numericText())
            Text(name)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private func starters(_ side: MatchupSide) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Your starters")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.top, 4)
            ForEach(side.rows) { row in
                HStack(spacing: 8) {
                    Text(SitStartPanel.slotLabel(row.slot))
                        .font(.caption2.weight(.bold).monospaced())
                        .foregroundStyle(.secondary)
                        .frame(width: 34, alignment: .leading)
                    PanelPlayerRow(playerID: row.playerID, name: row.name ?? "Empty", position: row.position,
                                   detail: row.onBye ? "Bye" : [row.nflTeam, row.opponent].compactMap { $0 }.joined(separator: " "),
                                   chip: row.isLive ? "live" : nil) {
                        Text(PanelFormat.points(showingLive ? row.livePoints : row.projected))
                            .font(.caption.monospacedDigit())
                    }
                }
                .panelPlayerTap(row.playerID, context: model.context)
            }
        }
    }
}

/// Your injured players, worst first.
struct InjuriesPanel: View {
    @ObservedObject var model: InjuryCenterModel
    let rows: Int

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            if model.roster.isEmpty {
                PanelMessage(style: .empty, text: "No injury designations on your roster.")
            } else {
                PanelScroll {
                    ForEach(model.roster.prefix(rows)) { player in
                        PanelPlayerRow(playerID: player.id, name: player.name, position: player.position,
                                       detail: player.headline,
                                       badge: model.context.map { StartAvailability.of(player.id, context: $0) }?.badge,
                                       chip: player.isStarter ? "starter" : nil) {
                            if let projected = player.projectedPoints {
                                Text(PanelFormat.points(projected)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            }
                        }
                        .panelPlayerTap(player.id, context: model.context)
                    }
                    if model.roster.count > rows {
                        PanelFootnote(text: "\(model.roster.count - rows) more in the Injury Center.")
                    }
                }
            }
        }
    }
}

/// Upcoming weeks as a strip of squares — how many slots you'd be short, over
/// how much of the league is short too — then which positions.
struct ByeWeeksPanel: View {
    @ObservedObject var dashboard: DashboardModel
    @ObservedObject var planning: PlanningModel
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        PanelGate(hasContext: dashboard.context != nil, isLoading: dashboard.isLoading, error: dashboard.errorMessage) {
            PanelScroll {
                if dashboard.byeStrip.isEmpty {
                    PanelMessage(style: .empty, text: "No bye weeks left.")
                } else {
                    strip
                    let short = planning.userShortWeeks()
                    if short.isEmpty {
                        Label("You can field a full lineup every week.", systemImage: "checkmark.seal.fill")
                            .font(.caption)
                            .foregroundStyle(Palette.start)
                    } else {
                        ForEach(short.prefix(4)) { cell in
                            Button { openScreen(.planning) } label: {
                                HStack {
                                    Text("Week \(cell.week)").font(.caption.weight(.semibold))
                                    Spacer()
                                    Text("short \(cell.shortPositions.map(\.rawValue).joined(separator: ", "))")
                                        .font(.caption2)
                                        .foregroundStyle(Palette.caution)
                                }
                                .foregroundStyle(.primary)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(PanelRowStyle())
                        }
                    }
                }
            }
        }
    }

    private var strip: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 22, maximum: 30), spacing: 4)], alignment: .leading, spacing: 6) {
            ForEach(dashboard.byeStrip) { week in
                VStack(spacing: 2) {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(colour(week.yourShortfall))
                        .frame(height: 20)
                        .overlay {
                            if week.yourShortfall > 0 {
                                Text("\(week.yourShortfall)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                            }
                        }
                    Capsule()
                        .fill(Color.secondary.opacity(0.45))
                        .frame(height: 2)
                        .scaleEffect(x: max(0.08, CGFloat(week.teamsShort) / CGFloat(max(1, week.teamCount))), anchor: .leading)
                    Text("\(week.week)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(week.yourShortfall == 0
                    ? "Week \(week.week): full lineup"
                    : "Week \(week.week): \(week.yourShortfall) short, \(week.teamsShort) of \(week.teamCount) teams short")
            }
        }
    }

    private func colour(_ shortfall: Int) -> Color {
        switch shortfall {
        case 0: return Palette.start.opacity(0.35)
        case 1: return Palette.caution
        default: return Palette.sit
        }
    }
}

/// Your players in the news.
struct NewsPanel: View {
    @ObservedObject var model: DashboardModel
    let rows: Int

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            if !model.hasRelay {
                PanelMessage(style: .empty, text: "News comes through your relay. Add it in Settings.")
            } else if model.news.isEmpty {
                PanelMessage(style: .empty, text: "Nothing new on your players.")
            } else {
                PanelScroll {
                    ForEach(model.news.prefix(rows), id: \.title) { item in
                        newsRow(item)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func newsRow(_ item: NewsItem) -> some View {
        let content = VStack(alignment: .leading, spacing: 1) {
            Text(item.title)
                .font(.caption)
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            if let published = item.publishedAt {
                Text(published).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let url = item.url.flatMap(URL.init(string:)) {
            Link(destination: url) { content }
                .buttonStyle(PanelRowStyle())
        } else {
            content
        }
    }
}

/// The league table. Clicking a team links it — the Trade partners panel
/// picks it out.
struct StandingsPanel: View {
    @ObservedObject var model: DashboardModel
    let rows: Int
    @Environment(\.linkPublish) private var publish

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            if model.standings.isEmpty {
                PanelMessage(style: .empty, text: "The table fills in once games are played.")
            } else {
                standings
            }
        }
    }

    private var standings: some View {
        Group {
            PanelScroll {
                ForEach(Array(model.standings.prefix(rows).enumerated()), id: \.element.id) { index, row in
                    Button {
                        publish(.team(row.rosterID))
                    } label: {
                        HStack(spacing: 8) {
                            Text("\(index + 1)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.tertiary)
                                .frame(width: 16, alignment: .trailing)
                            Text(row.isUser ? "\(row.manager) (you)" : row.manager)
                                .font(.caption.weight(row.isUser ? .semibold : .regular))
                                .lineLimit(1)
                            Spacer()
                            Text(row.record).font(.caption.monospacedDigit())
                            Text(PanelFormat.points(row.pointsFor))
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                                .frame(width: 48, alignment: .trailing)
                        }
                        .foregroundStyle(.primary)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(PanelRowStyle())
                    .background(row.isUser ? Color.accentColor.opacity(0.10) : .clear,
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
        }
    }
}
