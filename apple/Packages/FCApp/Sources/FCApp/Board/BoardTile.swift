import Foundation

/// One tile on the iPhone Board: a glance at one part of the week, opening
/// the full screen behind it.
public enum BoardTile: String, CaseIterable, Identifiable, Hashable, Sendable {
    case liveMatchup, games, readiness, injuries, topPickup, streams, standings, scoringTrend, news, byeWeeks

    public var id: String { rawValue }

    public enum Width: Sendable { case full, half }

    public var title: String {
        switch self {
        case .liveMatchup: return "Matchup"
        case .games: return "Your games"
        case .readiness: return "Lineup"
        case .injuries: return "Injuries"
        case .topPickup: return "Top pickup"
        case .streams: return "Best streams"
        case .standings: return "Standings"
        case .scoringTrend: return "Weekly scoring"
        case .news: return "News"
        case .byeWeeks: return "Byes"
        }
    }

    public var systemImage: String {
        switch self {
        case .liveMatchup: return "person.2"
        case .games: return "sportscourt"
        case .readiness: return "checklist"
        case .injuries: return "cross.case"
        case .topPickup: return "tray.and.arrow.down"
        case .streams: return "figure.run"
        case .standings: return "list.number"
        case .scoringTrend: return "chart.xyaxis.line"
        case .news: return "newspaper"
        case .byeWeeks: return "calendar.badge.exclamationmark"
        }
    }

    /// What the tile is for, in the edit sheet.
    public var blurb: String {
        switch self {
        case .liveMatchup: return "Your score against theirs, live during games"
        case .games: return "Quarter, clock and red zone for your players' games"
        case .readiness: return "Slots set, questionable and needing a fix"
        case .injuries: return "Starters who are out or questionable"
        case .topPickup: return "The Waiver Board's number one"
        case .streams: return "The best stream at each position this week"
        case .standings: return "Your rank, record and points"
        case .scoringTrend: return "Your weekly points against the league average"
        case .news: return "Headlines on your players"
        case .byeWeeks: return "Your next bye crunch"
        }
    }

    public var width: Width {
        switch self {
        case .readiness, .injuries, .topPickup, .standings, .byeWeeks: return .half
        default: return .full
        }
    }

    /// The screen a tap opens.
    public var destination: RootView.Screen {
        switch self {
        case .liveMatchup, .games: return .matchup
        case .readiness: return .sitStart
        case .injuries: return .injuries
        case .topPickup: return .waivers
        case .streams: return .wrStream
        case .standings, .scoringTrend, .news: return .dashboard
        case .byeWeeks: return .planning
        }
    }
}

/// Which tiles the Board shows, in what order. Kept on the device as a short
/// string (`liveMatchup,games,-news,…`, a leading `-` for a hidden tile).
public struct BoardLayout: Hashable, Sendable {
    public var order: [BoardTile]
    public var hidden: Set<BoardTile>

    public init(order: [BoardTile], hidden: Set<BoardTile> = []) {
        self.order = order
        self.hidden = hidden
    }

    /// Game day up top, the week's decisions next, the season last.
    public static let standard = BoardLayout(
        order: [.liveMatchup, .games, .readiness, .injuries, .streams, .topPickup, .standings,
                .scoringTrend, .byeWeeks, .news]
    )

    public var visible: [BoardTile] { order.filter { !hidden.contains($0) } }

    /// Reads a stored layout. Unknown tiles are dropped; tiles added in a
    /// later version go on the end, shown. Unset is the standard layout.
    public static func decode(_ stored: String?) -> BoardLayout {
        guard let stored, !stored.isEmpty else { return standard }
        var order: [BoardTile] = []
        var hidden: Set<BoardTile> = []
        for item in stored.split(separator: ",") {
            let isHidden = item.hasPrefix("-")
            guard let tile = BoardTile(rawValue: String(isHidden ? item.dropFirst() : item)),
                  !order.contains(tile) else { continue }
            order.append(tile)
            if isHidden { hidden.insert(tile) }
        }
        for tile in standard.order where !order.contains(tile) { order.append(tile) }
        return BoardLayout(order: order, hidden: hidden)
    }

    public var encoded: String {
        order.map { hidden.contains($0) ? "-\($0.rawValue)" : $0.rawValue }.joined(separator: ",")
    }

    /// Rows for a two-column grid: a full tile alone, half tiles in pairs
    /// (a half tile with no partner sits alone).
    public static func rows(_ tiles: [BoardTile]) -> [[BoardTile]] {
        var rows: [[BoardTile]] = []
        var pending: BoardTile?
        for tile in tiles {
            if tile.width == .full {
                if let half = pending { rows.append([half]); pending = nil }
                rows.append([tile])
            } else if let half = pending {
                rows.append([half, tile])
                pending = nil
            } else {
                pending = tile
            }
        }
        if let half = pending { rows.append([half]) }
        return rows
    }
}
