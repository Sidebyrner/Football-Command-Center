import Foundation

/// A ready-made workspace for a common job. The library starts with all three;
/// "Reset to preset" rebuilds one from here.
public struct WorkspacePreset: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let icon: String
    public let panels: @Sendable () -> [PanelPlacement]

    public func makeWorkspace() -> Workspace {
        Workspace(name: name, icon: icon, panels: panels(), presetID: id)
    }
}

public enum WorkspacePresets {
    private static func panel(_ kind: PanelKind, _ x: Int, _ y: Int, _ w: Int, _ h: Int,
                              link: LinkGroup? = nil, topN: Int? = nil) -> PanelPlacement {
        PanelPlacement(kind: kind, frame: GridRect(x: x, y: y, w: w, h: h), linkGroup: link,
                       settings: PanelSettings(topN: topN))
    }

    /// Sunday: the score, whether the lineup is ready, and who's hurt.
    public static let gameDay = WorkspacePreset(id: "game-day", name: "Game day", icon: "sportscourt") {
        [
            panel(.matchupScore, 0, 0, 6, 3, link: .one),
            panel(.lineupReadiness, 6, 0, 6, 3),
            panel(.sitStart, 0, 3, 6, 4, link: .one),
            panel(.injuries, 6, 3, 3, 4, link: .one),
            panel(.news, 9, 3, 3, 4),
            panel(.playerCard, 0, 7, 6, 5, link: .one),
            panel(.standings, 6, 7, 6, 5),
        ]
    }

    /// Waiver day: every pickup list side by side, and a card for whoever you click.
    public static let waiverTuesday = WorkspacePreset(id: "waiver-tuesday", name: "Waiver Tuesday", icon: "tray.and.arrow.down") {
        [
            panel(.waiverTargets, 0, 0, 4, 5, link: .one, topN: 8),
            panel(.wrStream, 4, 0, 4, 5, link: .one, topN: 5),
            panel(.rbStream, 8, 0, 4, 5, link: .one, topN: 5),
            panel(.idpStream, 0, 5, 4, 4, link: .one, topN: 5),
            panel(.byeWeeks, 4, 5, 4, 2),
            panel(.injuries, 4, 7, 4, 2, link: .one),
            panel(.playerCard, 8, 5, 4, 4, link: .one),
        ]
    }

    /// Dealing: who fits, what they're worth, and the table.
    public static let tradeDesk = WorkspacePreset(id: "trade-desk", name: "Trade desk", icon: "arrow.triangle.swap") {
        [
            panel(.tradePartners, 0, 0, 5, 6, link: .one),
            panel(.playerCard, 5, 0, 4, 6, link: .one),
            panel(.standings, 9, 0, 3, 6, link: .one),
            panel(.byeWeeks, 0, 6, 6, 2),
            panel(.injuries, 6, 6, 6, 3, link: .one),
        ]
    }

    /// Research: every free agent, and everything about whoever you click.
    public static let discovery = WorkspacePreset(id: "discovery", name: "Discovery", icon: "binoculars") {
        [
            panel(.discovery, 0, 0, 4, 9, link: .one, topN: 20),
            panel(.playerProfile, 4, 0, 4, 4, link: .one),
            panel(.schedule, 8, 0, 4, 4, link: .one),
            panel(.trendChart, 4, 4, 4, 5, link: .one, topN: 6),
            panel(.playerNews, 8, 4, 4, 5, link: .one, topN: 5),
            panel(.gameLog, 0, 9, 6, 4, link: .one, topN: 6),
            panel(.compare, 6, 9, 6, 4, link: .one, topN: 6),
        ]
    }

    public static let all: [WorkspacePreset] = [gameDay, waiverTuesday, tradeDesk, discovery]

    public static func preset(id: String) -> WorkspacePreset? {
        all.first { $0.id == id }
    }

    public static func defaultLibrary() -> WorkspaceLibrary {
        WorkspaceLibrary(workspaces: all.map { $0.makeWorkspace() })
    }
}
