import Foundation

/// A panel's place on the workspace grid, in cells: 12 columns across, rows
/// of `WorkspaceGeometry.rowHeight` down.
public struct GridRect: Codable, Hashable, Sendable {
    public var x: Int
    public var y: Int
    public var w: Int
    public var h: Int

    public init(x: Int, y: Int, w: Int, h: Int) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    public var maxX: Int { x + w }
    public var maxY: Int { y + h }
    public var size: GridSize { GridSize(w: w, h: h) }

    public func intersects(_ other: GridRect) -> Bool {
        x < other.maxX && other.x < maxX && y < other.maxY && other.y < maxY
    }
}

public struct GridSize: Codable, Hashable, Sendable {
    public var w: Int
    public var h: Int

    public init(w: Int, h: Int) {
        self.w = w
        self.h = h
    }
}

/// A colour group, like the linking blocks on a trading desk: every panel in
/// the same group follows one selected player.
public enum LinkGroup: Int, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case one = 1, two, three, four

    public var id: Int { rawValue }

    public var name: String {
        switch self {
        case .one: return "Blue"
        case .two: return "Orange"
        case .three: return "Green"
        case .four: return "Purple"
        }
    }
}

/// Every kind of panel a workspace can hold. Each is a compact view of an
/// existing screen, drawn from the same model.
public enum PanelKind: String, Codable, CaseIterable, Hashable, Sendable, Identifiable {
    case lineupReadiness
    case sitStart
    case matchupScore
    case injuries
    case waiverTargets
    case tradePartners
    case byeWeeks
    case idpStream
    case wrStream
    case rbStream
    case news
    case standings
    case playerCard

    public var id: String { rawValue }
}

/// A panel's own options. One struct of optionals rather than one per kind,
/// so decoding stays forgiving and a panel simply ignores what it doesn't use.
public struct PanelSettings: Codable, Hashable, Sendable {
    /// How many rows a list panel shows.
    public var topN: Int?
    /// A position filter, e.g. "RB", applied inside the panel only.
    public var positionFilter: String?
    public var extra: [String: String]

    public init(topN: Int? = nil, positionFilter: String? = nil, extra: [String: String] = [:]) {
        self.topN = topN
        self.positionFilter = positionFilter
        self.extra = extra
    }

    public static let `default` = PanelSettings()

    enum CodingKeys: String, CodingKey { case topN, positionFilter, extra }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        topN = (try? c.decodeIfPresent(Int.self, forKey: .topN)) ?? nil
        positionFilter = (try? c.decodeIfPresent(String.self, forKey: .positionFilter)) ?? nil
        extra = (try? c.decodeIfPresent([String: String].self, forKey: .extra)) ?? [:]
    }
}

public struct PanelPlacement: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var kind: PanelKind
    public var frame: GridRect
    public var linkGroup: LinkGroup?
    public var settings: PanelSettings

    public init(id: UUID = UUID(), kind: PanelKind, frame: GridRect, linkGroup: LinkGroup? = nil,
                settings: PanelSettings = .default) {
        self.id = id
        self.kind = kind
        self.frame = frame
        self.linkGroup = linkGroup
        self.settings = settings
    }

    enum CodingKeys: String, CodingKey { case id, kind, frame, linkGroup, settings }

    /// A panel from a newer version of the app (an unknown kind) fails here
    /// and is dropped by `Workspace`; everything else defaults.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(UUID.self, forKey: .id)) ?? UUID()
        kind = try c.decode(PanelKind.self, forKey: .kind)
        frame = try c.decode(GridRect.self, forKey: .frame)
        linkGroup = (try? c.decodeIfPresent(Int.self, forKey: .linkGroup)).flatMap { $0 }.flatMap(LinkGroup.init(rawValue:))
        settings = (try? c.decodeIfPresent(PanelSettings.self, forKey: .settings)) ?? .default
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(kind, forKey: .kind)
        try c.encode(frame, forKey: .frame)
        try c.encodeIfPresent(linkGroup?.rawValue, forKey: .linkGroup)
        try c.encode(settings, forKey: .settings)
    }
}

public struct Workspace: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var name: String
    /// An SF Symbol for the sidebar row.
    public var icon: String
    public var panels: [PanelPlacement]
    /// The preset this was made from, for "Reset to preset".
    public var presetID: String?

    public init(id: UUID = UUID(), name: String, icon: String = "square.grid.2x2",
                panels: [PanelPlacement] = [], presetID: String? = nil) {
        self.id = id
        self.name = name
        self.icon = icon
        self.panels = panels
        self.presetID = presetID
    }

    enum CodingKeys: String, CodingKey { case id, name, icon, panels, presetID }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(UUID.self, forKey: .id)) ?? UUID()
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? "Workspace"
        icon = (try? c.decodeIfPresent(String.self, forKey: .icon)) ?? "square.grid.2x2"
        let boxes = (try? c.decodeIfPresent([Failable<PanelPlacement>].self, forKey: .panels)) ?? []
        panels = boxes.compactMap(\.value)
        presetID = (try? c.decodeIfPresent(String.self, forKey: .presetID)) ?? nil
    }
}

/// Every workspace the user has, in sidebar order.
public struct WorkspaceLibrary: Codable, Hashable, Sendable {
    public static let currentVersion = 1

    public var version: Int
    public var workspaces: [Workspace]

    public init(version: Int = WorkspaceLibrary.currentVersion, workspaces: [Workspace]) {
        self.version = version
        self.workspaces = workspaces
    }

    enum CodingKeys: String, CodingKey { case version, workspaces }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = (try? c.decodeIfPresent(Int.self, forKey: .version)) ?? Self.currentVersion
        let boxes = try c.decode([Failable<Workspace>].self, forKey: .workspaces)
        workspaces = boxes.compactMap(\.value)
    }
}

/// Decodes an element if it can and yields nil if it can't, so one bad entry
/// never costs the whole array.
struct Failable<T: Decodable>: Decodable {
    let value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}
