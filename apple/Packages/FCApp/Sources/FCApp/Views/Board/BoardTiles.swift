import SwiftUI
import Charts
import FCCore
import FCData

/// One tile, dispatched to its view. Each tile observes only the model it
/// shows, so a live score tick redraws the score and nothing else.
struct BoardTileView: View {
    let tile: BoardTile
    let services: AppServices

    var body: some View {
        switch tile {
        case .liveMatchup: LiveMatchupTile(matchup: services.matchup, gameDay: services.gameDay)
        case .games: GamesTile(gameDay: services.gameDay, matchup: services.matchup)
        case .readiness: ReadinessTile(dashboard: services.dashboard, sitStart: services.sitStart)
        case .injuries: InjuriesTile(model: services.injuries)
        case .topPickup: TopPickupTile(model: services.waivers)
        case .streams: StreamsTile(services: services, dashboard: services.dashboard)
        case .standings: StandingsTile(model: services.dashboard)
        case .scoringTrend: ScoringTrendTile(model: services.dashboard)
        case .news: NewsTile(model: services.dashboard)
        case .byeWeeks: ByesTile(model: services.dashboard)
        }
    }
}

/// The chrome every tile shares: icon and title, a chevron, and the whole
/// card as one tap target opening the tile's screen.
struct BoardTileCard<Content: View>: View {
    let tile: BoardTile
    var accessory: AnyView? = nil
    var destination: RootView.Screen? = nil
    @ViewBuilder let content: Content
    @Environment(\.openScreen) private var openScreen
    @Environment(\.colorScheme) private var colorScheme

    /// The hue of the tab the tile opens, so the Board previews where it leads.
    private var hue: Color { HubStyle.tint(for: destination ?? tile.destination) }

    var body: some View {
        Button {
            openScreen(destination ?? tile.destination)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: tile.systemImage)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(hue)
                    Text(tile.title)
                        .textStyle(.micro)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let accessory { accessory }
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
                content
            }
            .padding(Space.m)
            .padding(.top, 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                let shape = RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                shape.fill(Surface.card)
                    .overlay(alignment: .top) { Rectangle().fill(hue).frame(height: 3) }
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(Surface.stroke, lineWidth: 0.5))
                    .shadow(color: .black.opacity(colorScheme == .light ? 0.06 : 0), radius: 3, y: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("board.tile.\(tile.rawValue)")
    }
}

/// A quiet line for a tile with nothing to show yet.
private struct TileNote: View {
    let text: String
    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Matchup

private struct LiveMatchupTile: View {
    @ObservedObject var matchup: MatchupModel
    @ObservedObject var gameDay: GameDayModel

    var body: some View {
        let mine = matchup.mySide, theirs = matchup.opponentSide
        let live = (mine?.hasLiveGame ?? false) || (theirs?.hasLiveGame ?? false)
        BoardTileCard(tile: .liveMatchup, accessory: live ? AnyView(LiveBadge()) : nil) {
            if let mine {
                HStack(alignment: .firstTextBaseline) {
                    side(mine.manager, mine.livePoints, leading: true, ahead: ahead(mine, theirs))
                    Spacer(minLength: 8)
                    Text("vs").font(.caption).foregroundStyle(.tertiary)
                    Spacer(minLength: 8)
                    if let theirs {
                        side(theirs.manager, theirs.livePoints, leading: false, ahead: ahead(theirs, mine))
                    } else {
                        Text(matchup.noOpponentReason ?? "No opponent").font(.caption).foregroundStyle(.secondary)
                    }
                }
                shareBar(mine.livePoints, theirs?.livePoints)
                HStack {
                    Text(leftText(mine, theirs)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if let updated = matchup.lastLiveUpdate ?? gameDay.lastUpdate, live {
                        // Measured on the league's clock, which a demo or test fixes.
                        TimelineView(.periodic(from: .now, by: 10)) { _ in
                            Text("updated \(ago(updated, now: matchup.context?.now() ?? Date()))")
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                }
            } else if matchup.isLoading {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                TileNote(text: matchup.errorMessage == nil ? "No matchup this week." : "Couldn't load the matchup.")
            }
        }
        .sensoryFeedback(.increase, trigger: mine?.livePoints ?? 0)
    }

    private func ahead(_ a: MatchupSide?, _ b: MatchupSide?) -> Bool {
        (a?.livePoints ?? 0) > (b?.livePoints ?? 0)
    }

    private func side(_ name: String, _ points: Double?, leading: Bool, ahead: Bool) -> some View {
        VStack(alignment: leading ? .leading : .trailing, spacing: 0) {
            Text(points.map(StreamFormat.one) ?? "–")
                .textStyle(.display)
                .foregroundStyle(ahead ? Color.primary : .secondary)
                .contentTransition(.numericText())
                .motion(Motion.number, value: points ?? 0)
            Text(name).font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private func shareBar(_ mine: Double?, _ theirs: Double?) -> some View {
        let total = max(0, mine ?? 0) + max(0, theirs ?? 0)
        let share = total > 0 ? max(0, mine ?? 0) / total : 0.5
        return GeometryReader { geo in
            HStack(spacing: 2) {
                Capsule().fill(Color.accentColor).frame(width: max(4, geo.size.width * share - 1))
                Capsule().fill(Palette.surfaceRaised)
            }
        }
        .frame(height: 6)
        .animation(Motion.number, value: share)
    }

    private func leftText(_ mine: MatchupSide, _ theirs: MatchupSide?) -> String {
        var parts = ["You: \(mine.leftToPlay) to play"]
        if let theirs { parts.append("Them: \(theirs.leftToPlay)") }
        return parts.joined(separator: " · ")
    }

    private func ago(_ date: Date, now: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        return seconds < 60 ? "\(seconds)s ago" : "\(seconds / 60)m ago"
    }
}

// MARK: - Games

private struct GamesTile: View {
    @ObservedObject var gameDay: GameDayModel
    @ObservedObject var matchup: MatchupModel

    var body: some View {
        let games = GameDay.pair(games: gameDay.games, mine: matchup.mySide?.rows ?? [], theirs: matchup.opponentSide?.rows ?? [])
        BoardTileCard(tile: .games, accessory: gameDay.anyLive ? AnyView(LiveBadge()) : nil) {
            if games.isEmpty {
                TileNote(text: gameDay.unavailable
                    ? "Live game states aren't available right now — scores still come from your matchup."
                    : "None of this week's games involve your starters yet.")
            } else {
                VStack(spacing: 8) {
                    ForEach(games.prefix(6)) { item in
                        GameRow(item: item)
                        if item.id != games.prefix(6).last?.id { Divider() }
                    }
                }
                Text(GameDayModel.source).font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }
}

private struct GameRow: View {
    let item: GameWithPlayers

    var body: some View {
        let game = item.game
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                team(game.away, score: game.awayScore, game: game)
                Text("@").font(.caption2).foregroundStyle(.tertiary)
                team(game.home, score: game.homeScore, game: game)
                Spacer(minLength: 4)
                if game.isRedZone {
                    Text("RED ZONE")
                        .font(.caption2.weight(.heavy))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Capsule().fill(Palette.sit))
                }
                Text(GameDay.clock(game))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(game.status == .inProgress ? Palette.sit : .secondary)
            }
            HStack(spacing: 6) {
                if let down = game.downAndDistance, game.status == .inProgress {
                    Text(down + (game.yardLine.map { " at \(game.yardLineTerritory.map { "\($0) " } ?? "")\($0)" } ?? ""))
                        .font(.caption2).foregroundStyle(.secondary)
                } else if game.status == .pregame, !pregameLine(game).isEmpty {
                    Text(pregameLine(game)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            players
        }
        .accessibilityElement(children: .combine)
    }

    private func team(_ code: String, score: Int?, game: SleeperGameScore) -> some View {
        HStack(spacing: 3) {
            if game.possession == code, game.status == .inProgress {
                Image(systemName: "football.fill").font(.caption2).foregroundStyle(.secondary)
                    .accessibilityLabel("has the ball")
            }
            Text(code).font(.subheadline.weight(.semibold))
            if let score { Text("\(score)").font(.subheadline.monospacedDigit()) }
        }
    }

    private var players: some View {
        let mine = item.mine.map { chip($0, mine: true) }
        let theirs = item.theirs.map { chip($0, mine: false) }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { ForEach(Array((mine + theirs).enumerated()), id: \.offset) { $0.element } }
            VStack(alignment: .leading, spacing: 2) { ForEach(Array((mine + theirs).enumerated()), id: \.offset) { $0.element } }
        }
    }

    private func chip(_ row: MatchupRow, mine: Bool) -> some View {
        HStack(spacing: 3) {
            Circle().fill(mine ? Color.accentColor : Color.secondary.opacity(0.5)).frame(width: 5, height: 5)
            Text(StreamFormat.shortName(row.name ?? "")).font(.caption2.weight(mine ? .semibold : .regular))
            if let points = row.livePoints {
                Text(StreamFormat.one(points)).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(mine ? Color.primary : .secondary)
    }

    private func pregameLine(_ game: SleeperGameScore) -> String {
        // The kickoff is already on the right of the row.
        var parts: [String] = []
        if let channel = game.channel { parts.append(channel) }
        if let favourite = game.spread.min(by: { $0.value < $1.value }), favourite.value < 0 {
            parts.append("\(favourite.key) \(StreamFormat.one(favourite.value))")
        }
        if let wind = game.forecastWindMph, wind >= 15 { parts.append("wind \(Int(wind)) mph") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Lineup

private struct ReadinessTile: View {
    @ObservedObject var dashboard: DashboardModel
    @ObservedObject var sitStart: SitStartModel

    var body: some View {
        BoardTileCard(tile: .readiness) {
            if let readiness = dashboard.readiness {
                HStack(spacing: 10) {
                    ReadinessRing(readiness: readiness, size: 52, lineWidth: 7)
                    VStack(alignment: .leading, spacing: 2) {
                        if readiness.isAllClear, sitStart.starts.isEmpty {
                            StatusLabel(tone: .start, text: "Set")
                        } else {
                            if readiness.problems > 0 {
                                Text("\(readiness.problems) to fix").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.sit)
                            }
                            if readiness.caution > 0 {
                                Text("\(readiness.caution) questionable").font(.caption).foregroundStyle(Palette.caution)
                            }
                            if !sitStart.starts.isEmpty {
                                Text("\(sitStart.starts.count) swap\(sitStart.starts.count == 1 ? "" : "s") suggested")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                TileNote(text: "Lineup loading…")
            }
        }
    }
}

private struct InjuriesTile: View {
    @ObservedObject var model: InjuryCenterModel

    var body: some View {
        BoardTileCard(tile: .injuries) {
            if let context = model.context {
                let starters = model.roster.filter(\.isStarter)
                let blocked = starters.filter { StartAvailability.of($0.id, context: context).blocksStart }
                let questionable = starters.filter { StartAvailability.of($0.id, context: context) == .questionable }
                if blocked.isEmpty, questionable.isEmpty {
                    StatusLabel(tone: .start, text: "All clear")
                    Text("No starter is hurt.").font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 12) {
                        count(blocked.count, "out", Palette.sit)
                        count(questionable.count, "Q", Palette.caution)
                    }
                    if let top = blocked.first ?? questionable.first {
                        Text("\(StreamFormat.shortName(top.name)) · \(StartAvailability.of(top.id, context: context).badge ?? "")")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } else {
                TileNote(text: "Injuries loading…")
            }
        }
    }

    private func count(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(n)").textStyle(.title).foregroundStyle(n > 0 ? color : .secondary)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Market

private struct TopPickupTile: View {
    @ObservedObject var model: WaiverBoardModel

    var body: some View {
        BoardTileCard(tile: .topPickup) {
            if let row = model.rows.first {
                HStack(spacing: 8) {
                    PlayerAvatar(sleeperID: row.id, name: row.name, position: row.position, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(StreamFormat.shortName(row.name)).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text([row.position.rawValue, row.team].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if row.value(model.sort) != nil {
                    Text("\(value(row)) \(model.sort.unit)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Palette.start)
                } else {
                    Text("Top by \(model.sort.label.lowercased())").font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                TileNote(text: model.isLoading ? "Ranking free agents…" : "Nobody on the Waiver Board.")
            }
        }
    }

    private func value(_ row: WaiverRow) -> String {
        guard let value = row.value(model.sort) else { return "—" }
        if model.sort.isPercent { return "\(Int((value * 100).rounded()))%" }
        if model.sort == .projectedOverLine { return PanelFormat.signed(value) }
        return PanelFormat.points(value)
    }
}

/// The best stream this week at each position the league starts.
private struct StreamsTile: View {
    let services: AppServices
    @ObservedObject var dashboard: DashboardModel

    private var started: Set<Position> {
        Set(dashboard.context?.template.starters.flatMap(\.eligible) ?? [])
    }

    var body: some View {
        let started = self.started
        BoardTileCard(tile: .streams) {
            VStack(spacing: 6) {
                if started.contains(.qb) { StreamLine(label: "QB", model: services.qbStream, screen: .qbStream) }
                if started.contains(.rb) { StreamLine(label: "RB", model: services.rbStream, screen: .rbStream) }
                if started.contains(.wr) { StreamLine(label: "WR", model: services.wrStream, screen: .wrStream) }
                if started.contains(.k) { StreamLine(label: "K", model: services.kStream, screen: .kStream) }
                if started.contains(.def) { StreamLine(label: "D/ST", model: services.dstStream, screen: .dstStream) }
                if !started.isDisjoint(with: Position.idp) {
                    StreamLine(label: "IDP", model: services.idpStream, screen: .idpStream)
                }
            }
        }
    }
}

private struct StreamLine<Kind: StreamKind>: View {
    let label: String
    @ObservedObject var model: StreamScreenModel<Kind>
    let screen: RootView.Screen
    @Environment(\.openScreen) private var openScreen

    var body: some View {
        Button { openScreen(screen) } label: {
            HStack(spacing: 8) {
                Text(label)
                    .font(.caption2.weight(.bold))
                    .frame(width: 34, alignment: .leading)
                    .foregroundStyle(.secondary)
                if let best = model.report?.ranked.first {
                    Text(StreamFormat.shortName(best.name)).font(.caption.weight(.semibold)).lineLimit(1)
                    Text(best.opponent).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 4)
                    if let incumbent = model.report?.incumbent, incumbent.id != best.id {
                        let gain = best.expPts - incumbent.expPts
                        Text(PanelFormat.signed(gain))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(gain > 0 ? Palette.start : .secondary)
                    }
                    Text(StreamFormat.one(best.expPts)).font(.caption.weight(.semibold).monospacedDigit())
                } else {
                    Text(model.isLoading ? "Ranking…" : "No stream").font(.caption).foregroundStyle(.tertiary)
                    Spacer()
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Season

private struct StandingsTile: View {
    @ObservedObject var model: DashboardModel

    var body: some View {
        BoardTileCard(tile: .standings) {
            if let index = model.standings.firstIndex(where: \.isUser) {
                let row = model.standings[index]
                Text(ordinal(index + 1))
                    .textStyle(.title)
                Text("of \(model.standings.count) · \(row.wins)-\(row.losses)\(row.ties > 0 ? "-\(row.ties)" : "")")
                    .font(.caption).foregroundStyle(.secondary)
                Text("\(StreamFormat.one(row.pointsFor)) PF").font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
            } else {
                TileNote(text: model.context == nil ? "Standings loading…" : "No games played yet.")
            }
        }
    }

    private func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 10, n % 100) {
        case (_, 11...13): suffix = "th"
        case (1, _): suffix = "st"
        case (2, _): suffix = "nd"
        case (3, _): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }
}

private struct ScoringTrendTile: View {
    @ObservedObject var model: DashboardModel

    var body: some View {
        let points = model.trend.filter { $0.mine != nil }
        BoardTileCard(tile: .scoringTrend) {
            if points.isEmpty {
                TileNote(text: "No finished weeks yet.")
            } else {
                Chart {
                    ForEach(points) { p in
                        if let avg = p.leagueAverage {
                            LineMark(x: .value("Week", p.week), y: .value("Points", avg), series: .value("Line", "League"))
                                .foregroundStyle(Color.secondary.opacity(0.6))
                                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                        }
                        if let mine = p.mine {
                            LineMark(x: .value("Week", p.week), y: .value("Points", mine), series: .value("Line", "You"))
                                .foregroundStyle(Color.accentColor)
                                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round))
                            PointMark(x: .value("Week", p.week), y: .value("Points", mine))
                                .foregroundStyle(Color.accentColor).symbolSize(20)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: points.map(\.week)) { value in
                        AxisValueLabel { if let w = value.as(Int.self) { Text("W\(w)") } }
                    }
                }
                .chartYAxis { AxisMarks(position: .leading) }
                .frame(height: 110)
                HStack(spacing: 10) {
                    legend(Color.accentColor, "You")
                    legend(Color.secondary, "League avg")
                }
            }
        }
    }

    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(color).frame(width: 12, height: 3)
            Text(text).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

private struct NewsTile: View {
    @ObservedObject var model: DashboardModel

    var body: some View {
        BoardTileCard(tile: .news) {
            if !model.hasRelay {
                TileNote(text: "News about your players comes through your relay — add one in Settings.")
            } else if model.news.isEmpty {
                TileNote(text: "Nothing new on your players.")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(model.news.prefix(3).enumerated()), id: \.offset) { _, item in
                        Text(item.title).font(.caption.weight(.medium)).lineLimit(2)
                    }
                }
            }
        }
    }
}

private struct ByesTile: View {
    @ObservedObject var model: DashboardModel

    var body: some View {
        BoardTileCard(tile: .byeWeeks) {
            if let week = model.byeStrip.first(where: { $0.yourShortfall > 0 }) {
                Text("Week \(week.week)").font(.headline)
                Text("\(week.yourShortfall) starter\(week.yourShortfall == 1 ? "" : "s") short")
                    .font(.caption).foregroundStyle(Palette.caution)
            } else if model.context != nil {
                StatusLabel(tone: .start, text: "Covered")
                Text("No bye leaves a hole.").font(.caption).foregroundStyle(.secondary)
            } else {
                TileNote(text: "Byes loading…")
            }
        }
    }
}
