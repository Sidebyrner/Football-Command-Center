import SwiftUI
import FCCore
import FCData

// MARK: - Following the linked player

/// Resolves a panel's linked player to his cached Player Card model and loads
/// it — the Player Card panel's pattern, shared by every Discovery detail panel.
struct LinkedCardGate<Content: View>: View {
    let services: AppServices
    @ViewBuilder let content: (PlayerCardModel, LeagueContext) -> Content
    @EnvironmentObject private var linkBus: LinkBus
    @Environment(\.panelLinkGroup) private var group

    var body: some View {
        LinkedCardGateBody(dashboard: services.dashboard, services: services, group: group,
                           playerID: linkBus.selection(for: group)?.playerID, content: content)
    }
}

private struct LinkedCardGateBody<Content: View>: View {
    @ObservedObject var dashboard: DashboardModel
    let services: AppServices
    let group: LinkGroup?
    let playerID: String?
    let content: (PlayerCardModel, LeagueContext) -> Content

    var body: some View {
        if let group {
            if let playerID, let context = dashboard.context {
                let card = services.playerCard(playerID, context: context)
                content(card, context)
                    .id(playerID)
                    .task(id: playerID) { await card.load() }
            } else if dashboard.context == nil {
                PanelMessage(style: .loading, text: "Loading…")
            } else {
                LinkedEmptyState(group: group)
            }
        } else {
            PanelMessage(style: .empty, text: "Pick a link colour on this panel, then click a player in a panel of the same colour.")
        }
    }
}

/// "Click a player in any blue panel" — until the link group has a player.
struct LinkedEmptyState: View {
    let group: LinkGroup

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "hand.point.up.left")
                .font(.title2)
                .foregroundStyle(group.color)
            Text("Click a player in any \(group.name.lowercased()) panel")
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.center)
            Text("This panel follows your clicks.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

/// Avatar, name, position and team — the line every detail panel opens with.
struct PanelPlayerHeader: View {
    @ObservedObject var card: PlayerCardModel
    var detail: String? = nil
    @Environment(\.panelInline) private var inline

    var body: some View {
        if !inline { header }
    }

    private var header: some View {
        HStack(spacing: 8) {
            PlayerAvatar(sleeperID: card.id, name: card.name, position: card.position, size: 30)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(card.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    PositionChip(position: card.position)
                    if let badge = StartAvailability.of(card.id, context: card.context).badge {
                        InjuryBadge(label: badge)
                    }
                }
                Text(detail ?? subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private var subtitle: String {
        [card.team, card.status?.opponent.map { "vs \($0) this week" }, card.status?.availability.label]
            .compactMap { $0 }.joined(separator: " · ")
    }
}

// MARK: - Discovery list

/// Every free agent at the positions you start: search, position, sort, and
/// a click sends the player to the linked panels.
struct DiscoveryListPanel: View {
    @ObservedObject var model: DiscoveryModel
    let settings: PanelSettings
    let rows: Int
    @Environment(\.panelCompare) private var compare

    private var panelPosition: Position? { settings.positionFilter.flatMap(Position.init(rawValue:)) }
    private var panelSort: DiscoverySort? { settings.extra["sort"].flatMap(DiscoverySort.init(storageKey:)) }
    private var sort: DiscoverySort { panelSort ?? model.sort }

    var body: some View {
        PanelGate(hasContext: model.context != nil, isLoading: model.isLoading, error: model.errorMessage) {
            VStack(alignment: .leading, spacing: 8) {
                controls
                let all = model.rows(position: panelPosition, sort: panelSort)
                if all.isEmpty {
                    PanelMessage(style: .empty, text: model.query.isEmpty
                                 ? "No free agents at the positions your league starts."
                                 : "Nobody matches “\(model.query)”.")
                } else {
                    PanelScroll {
                        ForEach(all.prefix(rows)) { row in
                            listRow(row)
                        }
                        PanelFootnote(text: footnote(shown: min(rows, all.count), of: all))
                    }
                }
            }
            .padding(.top, 8)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 6) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { search; benches }
                VStack(alignment: .leading, spacing: 6) { search; benches }
            }
            HStack(spacing: 6) {
                if panelPosition == nil {
                    positionMenu
                }
                if panelSort == nil {
                    sortMenu
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 10)
    }

    private var search: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Search players or teams", text: $model.query)
                .textFieldStyle(.plain)
                .font(.caption)
            if !model.query.isEmpty {
                Button { model.query = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
    }

    private var benches: some View {
        Toggle(isOn: $model.includeRivalBenches) {
            Text("Rival benches").font(.caption2)
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        .fixedSize()
    }

    private var positionMenu: some View {
        Menu {
            Button("All positions") { model.positionFilter = nil }
            ForEach(model.filterablePositions, id: \.self) { position in
                Button(position.rawValue) { model.positionFilter = position }
            }
        } label: {
            chip(model.positionFilter?.rawValue ?? "All positions", systemImage: "line.3.horizontal.decrease")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private var sortMenu: some View {
        Menu {
            ForEach(DiscoverySort.all) { option in
                Button {
                    model.sort = option
                } label: {
                    if option == model.sort { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
                }
            }
        } label: {
            chip(model.sort.label, systemImage: "arrow.up.arrow.down")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func chip(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Palette.surface))
    }

    private func listRow(_ row: WaiverRow) -> some View {
        PanelPlayerRow(
            playerID: row.id, name: row.name, position: row.position,
            detail: [row.position.rawValue, row.team, row.opponent].compactMap { $0 }.joined(separator: " · "),
            badge: row.injuryTag.flatMap(WaiverTargetsPanel.badge),
            chip: row.availability == .freeAgent ? nil : row.availability.label
        ) {
            trailing(row)
        }
        .panelPlayerTap(row.id, context: model.context)
    }

    @ViewBuilder
    private func trailing(_ row: WaiverRow) -> some View {
        switch sort {
        case .name:
            Text(PanelFormat.points(row.projected))
                .font(.caption.monospacedDigit())
                .foregroundStyle(row.projected == nil ? .tertiary : .secondary)
        case .column(let column):
            let value = row.value(column)
            VStack(alignment: .trailing, spacing: 0) {
                Text(format(value, column))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(value == nil ? .tertiary : .primary)
                Text(column.unit).font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private func format(_ value: Double?, _ column: WaiverSort) -> String {
        guard let value else { return "—" }
        if column.isPercent { return "\(Int((value * 100).rounded()))%" }
        if column == .trending { return "\(Int(value))" }
        if column == .projectedOverLine { return PanelFormat.signed(value) }
        return PanelFormat.points(value)
    }

    private func footnote(shown: Int, of all: [WaiverRow]) -> String {
        var parts = ["\(shown) of \(all.count) shown"]
        if case .column(let column) = sort {
            let blank = all.filter { $0.value(column) == nil }.count
            if blank > 0 { parts.append("\(blank) without this number") }
        }
        parts.append("ranked by \(sort.label.lowercased())")
        if compare.isAvailable { parts.append("⌘-click to compare") }
        return parts.joined(separator: " · ") + "."
    }
}

// MARK: - Profile

/// Who he is and where he stands: bio, status, depth chart, bye, grade.
struct PlayerProfilePanel: View {
    @ObservedObject var card: PlayerCardModel

    var body: some View {
        PanelScroll {
            PanelPlayerHeader(card: card)
            if let bio = bioLine {
                Text(bio).font(.caption).foregroundStyle(.secondary)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    statusRows.frame(minWidth: 220, alignment: .topLeading)
                    gradeBlock.frame(minWidth: 180, alignment: .topLeading)
                }
                VStack(alignment: .leading, spacing: 10) {
                    statusRows
                    gradeBlock
                }
            }
        }
    }

    private var bioLine: String? {
        guard let player = card.context.players[card.id] else { return nil }
        var parts: [String] = []
        if let age = player.age { parts.append("Age \(age)") }
        if let years = player.yearsExperience { parts.append(years == 0 ? "Rookie" : "\(Self.ordinal(years + 1)) yr") }
        if let college = player.college { parts.append(college) }
        if let height = player.heightLabel { parts.append(height) }
        if let weight = player.weightPounds { parts.append("\(weight) lb") }
        if let number = player.jerseyNumber { parts.append("#\(number)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 10, n % 100) {
        case (1, let t) where t != 11: suffix = "st"
        case (2, let t) where t != 12: suffix = "nd"
        case (3, let t) where t != 13: suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }

    @ViewBuilder
    private var statusRows: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let status = card.status {
                row("Status", status.availability.label)
                row("Injury", injuryText(status), tint: status.sleeperTag == nil && status.report?.designation == nil ? .primary : Palette.caution)
                row("Depth", status.depthRank.map { "#\($0 + 1) at \(card.position?.rawValue ?? "")" } ?? "not listed")
                row("Bye", status.byeWeek.map { "Week \($0)" } ?? "—")
                if let opponent = status.opponent {
                    row("This week", "vs \(opponent)" + (status.impliedTotal.map { String(format: " · %.1f implied", $0) } ?? ""))
                }
            }
            if let ppg = card.context.sleeperPointsPerGame(card.id) {
                row("Pts/gm", PanelFormat.points(ppg))
            }
            if let projected = card.rotowireThisWeek {
                row("Projected", PanelFormat.points(projected))
            }
        }
    }

    @ViewBuilder
    private var gradeBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("Grade").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                if let grade = card.grade, let score = grade.score {
                    Text("\(score)")
                        .font(.headline.monospacedDigit())
                        .foregroundStyle(score >= 68 ? Palette.start : score >= 40 ? .primary : Palette.sit)
                    if let tier = grade.tier { Text(tier).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                    if grade.isThin { Text("thin").font(.caption2).foregroundStyle(Palette.caution) }
                } else {
                    Text("not enough data yet").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            if !card.chips.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
                    ForEach(card.chips) { chip in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(chip.metric.label).font(.caption2.weight(.semibold)).lineLimit(1)
                            Text(chip.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                        .padding(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Palette.surface))
                    }
                }
            }
        }
    }

    private func row(_ label: String, _ value: String, tint: Color = .primary) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label).font(.caption2).foregroundStyle(.secondary).frame(width: 64, alignment: .leading)
            Text(value).font(.caption).foregroundStyle(tint).lineLimit(2)
        }
    }

    private func injuryText(_ status: PlayerStatus) -> String {
        var parts: [String] = []
        if let designation = status.report?.designation { parts.append(designation.rawValue) }
        else if let tag = status.sleeperTag { parts.append(tag) }
        if let injury = status.report?.injury ?? status.bodyPart { parts.append(injury) }
        if let practice = status.report?.practice { parts.append(practice.phrase) }
        return parts.isEmpty ? "None" : parts.joined(separator: " · ")
    }
}

// MARK: - News

/// Sleeper's news on the linked player.
struct PlayerNewsPanel: View {
    @ObservedObject var card: PlayerCardModel
    let rows: Int

    var body: some View {
        PanelScroll {
            PanelPlayerHeader(card: card)
            if card.news.isEmpty {
                Text(card.newsUnavailable ? "News couldn't be loaded." : "No recent news on \(card.name).")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(card.news.prefix(rows)) { item in
                newsRow(item)
            }
        }
    }

    @ViewBuilder
    private func newsRow(_ item: SleeperPlayerNews) -> some View {
        let content = VStack(alignment: .leading, spacing: 2) {
            if let title = item.title {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.primary).multilineTextAlignment(.leading)
            }
            if let body = item.metadata?.description {
                Text(body).font(.caption2).foregroundStyle(.secondary).lineLimit(4).multilineTextAlignment(.leading)
            }
            Text([item.sourceLabel, item.publishedAt?.formatted(.relative(presentation: .named))].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        if let url = item.metadata?.url.flatMap(URL.init(string:)) {
            Link(destination: url) { content }.buttonStyle(PanelRowStyle())
        } else {
            content.padding(.horizontal, 6)
        }
    }
}

// MARK: - Game log

/// His last game, then the last N as a table.
struct GameLogPanel: View {
    @ObservedObject var card: PlayerCardModel
    let rows: Int

    private var weeks: [PlayerLogWeek] { Array(card.log.prefix(rows)) }

    var body: some View {
        PanelScroll {
            PanelPlayerHeader(card: card)
            if let last = card.log.first(where: \.played) {
                lastGame(last)
            }
            if card.log.isEmpty {
                Text("No games logged this season.").font(.caption).foregroundStyle(.secondary)
            } else {
                ViewThatFits(in: .horizontal) {
                    table(wide: true)
                    table(wide: false)
                }
                PanelFootnote(text: "Points in your scoring from Sleeper's lines; projections Rotowire via Sleeper; xFP ffopportunity.")
            }
        }
    }

    private func lastGame(_ week: PlayerLogWeek) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Last game").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Text("Week \(week.week)" + (week.opponent.map { " vs \($0)" } ?? ""))
                    .font(.caption)
            }
            Spacer()
            Text(PanelFormat.points(week.points))
                .font(.title3.weight(.bold).monospacedDigit())
            if let projected = week.projected, let points = week.points {
                Text(PanelFormat.signed(points - projected) + " vs proj")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(points >= projected ? Palette.start : Palette.sit)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.surface))
    }

    private func table(wide: Bool) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 4) {
            GridRow {
                header("Wk", leading: true)
                header("Opp", leading: true)
                header("Pts")
                header("Proj")
                if wide {
                    header("Snap")
                    header("Tgt")
                    header("Att")
                    header("xFP")
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(weeks) { week in
                GridRow {
                    Text("\(week.week)").gridColumnAlignment(.leading)
                    Text(week.played ? (week.opponent ?? "—") : "DNP").gridColumnAlignment(.leading)
                    Text(PanelFormat.points(week.points)).fontWeight(.semibold)
                    Text(PanelFormat.points(week.projected)).foregroundStyle(.secondary)
                    if wide {
                        Text(week.snapShare.map { "\(Int(($0 * 100).rounded()))%" } ?? "—")
                        Text(week.targets.map { "\(Int($0))" } ?? "—")
                        Text(week.rushAttempts.map { "\(Int($0))" } ?? "—")
                        Text(PanelFormat.points(week.expectedPoints))
                    }
                }
                .font(.caption.monospacedDigit())
                .foregroundStyle(week.played ? .primary : .tertiary)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func header(_ text: String, leading: Bool = false) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(.secondary)
            .gridColumnAlignment(leading ? .leading : .trailing)
    }
}

// MARK: - Schedule

/// The rest of his season: opponents, the recorded lines, and how soft each
/// defense has been against his position.
struct SchedulePanel: View {
    @ObservedObject var card: PlayerCardModel
    let context: LeagueContext
    @ObservedObject var discovery: DiscoveryModel

    private var schedule: PlayerSchedule {
        PlayerSchedule.build(playerID: card.id, context: context, defense: discovery.defense)
    }

    var body: some View {
        let schedule = self.schedule
        PanelScroll {
            PanelPlayerHeader(card: card)
            if schedule.weeks.isEmpty {
                Text("The regular season is over.").font(.caption).foregroundStyle(.secondary)
            } else {
                strength(schedule)
                ViewThatFits(in: .horizontal) {
                    table(schedule, wide: true)
                    table(schedule, wide: false)
                }
                PanelFootnote(text: footnote(schedule))
            }
        }
    }

    private func strength(_ schedule: PlayerSchedule) -> some View {
        HStack(spacing: 8) {
            if let sos = schedule.strengthOfSchedule {
                let tint: Color = sos >= 1.05 ? Palette.start : sos <= 0.95 ? Palette.sit : .primary
                VStack(alignment: .leading, spacing: 0) {
                    Text(String(format: "%.2f×", sos))
                        .font(.title3.weight(.bold).monospacedDigit())
                        .foregroundStyle(tint)
                    Text("rest-of-season SoS").font(.caption2).foregroundStyle(.secondary)
                }
                Text(sos >= 1.05 ? "Softer than average" : sos <= 0.95 ? "Tougher than average" : "About average")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                Spacer()
                Text("\(schedule.strengthOfScheduleGames) games").font(.caption2).foregroundStyle(.tertiary)
            } else {
                Text("Not enough defense data yet for a strength of schedule.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.surface))
    }

    private func table(_ schedule: PlayerSchedule, wide: Bool) -> some View {
        Grid(alignment: .trailing, horizontalSpacing: 10, verticalSpacing: 4) {
            GridRow {
                header("Wk", leading: true)
                header("Opp", leading: true)
                if wide {
                    header("Spread")
                    header("Total")
                }
                header("Implied")
                header("Def rank")
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(schedule.weeks) { week in
                GridRow {
                    Text("\(week.week)").gridColumnAlignment(.leading)
                    if week.isBye {
                        Text("BYE").foregroundStyle(.tertiary).gridColumnAlignment(.leading)
                        if wide { Text(""); Text("") }
                        Text("")
                        Text("")
                    } else {
                        Text(week.opponent.map { (week.isHome == false ? "@" : "") + $0 } ?? "—").gridColumnAlignment(.leading)
                        if wide {
                            Text(week.spread.map { String(format: "%+.1f", $0) } ?? "—").foregroundStyle(.secondary)
                            Text(week.total.map { String(format: "%.1f", $0) } ?? "—").foregroundStyle(.secondary)
                        }
                        Text(week.impliedTotal.map { String(format: "%.1f", $0) } ?? "—")
                        rankCell(week)
                    }
                }
                .font(.caption.monospacedDigit().weight(week.week == schedule.currentWeek ? .bold : .regular))
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder
    private func rankCell(_ week: PlayerSchedule.Week) -> some View {
        if let rank = week.defenseRank {
            let tint: Color = (week.defenseVsAverage ?? 0) >= 0 ? Palette.start : Palette.sit
            Text("#\(rank)").foregroundStyle(tint)
        } else {
            Text("—").foregroundStyle(.tertiary)
        }
    }

    private func header(_ text: String, leading: Bool = false) -> some View {
        Text(text)
            .font(.caption2.weight(.bold))
            .foregroundStyle(.secondary)
            .gridColumnAlignment(leading ? .leading : .trailing)
    }

    private func footnote(_ schedule: PlayerSchedule) -> String {
        var parts: [String] = []
        if let last = schedule.coveredWeeks.last {
            let final = schedule.weeks.last?.week ?? last
            parts.append(last >= final
                         ? "\(PlayerSchedule.linesLabel)"
                         : "\(PlayerSchedule.linesLabel) through week \(last); later weeks have no line yet")
        } else {
            parts.append("No recorded lines for his remaining games yet")
        }
        parts.append("Def rank: 1 is the softest vs \(schedule.position?.rawValue ?? "his position")")
        if let source = schedule.defenseSource { parts.append(source.label) }
        return parts.joined(separator: ". ") + "."
    }
}
