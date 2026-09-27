import Foundation

/// Where you've been, like a browser's back and forward: every screen change
/// — a tab, a segment, a Board tile, a link, a sidebar click — so an
/// accidental tap is always one step from undone.
public struct NavigationHistory: Hashable, Sendable {
    /// Oldest first; the last is where "back" goes.
    public private(set) var back: [SidebarItem] = []
    /// Oldest first; the last is where "forward" goes.
    public private(set) var forward: [SidebarItem] = []

    /// Steps kept each way; older ones drop off.
    public static let capacity = 30

    public init() {}

    public var canGoBack: Bool { !back.isEmpty }
    public var canGoForward: Bool { !forward.isEmpty }
    public var previous: SidebarItem? { back.last }
    public var next: SidebarItem? { forward.last }

    /// A move from one place to another. Settings is never a step — it has its
    /// own way back. Moving straight back to where you just were counts as
    /// going back, so the trail doesn't ping-pong between two screens.
    public mutating func record(from: SidebarItem, to: SidebarItem) {
        guard from != to, !Self.isSettings(from), !Self.isSettings(to) else { return }
        if back.last == to {
            back.removeLast()
            Self.push(from, onto: &forward)
            return
        }
        Self.push(from, onto: &back)
        forward.removeAll()
    }

    /// One step back from `current`: where to go, with `current` kept for
    /// forward.
    public mutating func goBack(from current: SidebarItem) -> SidebarItem? {
        guard let target = back.popLast() else { return nil }
        if !Self.isSettings(current) { Self.push(current, onto: &forward) }
        return target
    }

    public mutating func goForward(from current: SidebarItem) -> SidebarItem? {
        guard let target = forward.popLast() else { return nil }
        if !Self.isSettings(current) { Self.push(current, onto: &back) }
        return target
    }

    /// Straight back to an earlier step. `index` is into `back`; everything
    /// after it, and `current`, become forward steps.
    public mutating func jumpBack(to index: Int, from current: SidebarItem) -> SidebarItem? {
        guard back.indices.contains(index) else { return nil }
        let target = back[index]
        let skipped = back[(index + 1)...]
        back.removeSubrange(index...)
        if !Self.isSettings(current) { Self.push(current, onto: &forward) }
        for item in skipped.reversed() { Self.push(item, onto: &forward) }
        return target
    }

    /// A deleted workspace is no longer anywhere to go.
    public mutating func forget(workspace id: UUID) {
        back.removeAll { $0 == .workspace(id) }
        forward.removeAll { $0 == .workspace(id) }
        back = Self.collapsed(back)
        forward = Self.collapsed(forward)
    }

    private static func push(_ item: SidebarItem, onto stack: inout [SidebarItem]) {
        if stack.last == item { return }
        stack.append(item)
        if stack.count > Self.capacity { stack.removeFirst(stack.count - Self.capacity) }
    }

    /// Neighbouring duplicates left behind by a removal merge into one.
    private static func collapsed(_ items: [SidebarItem]) -> [SidebarItem] {
        items.reduce(into: []) { out, item in if out.last != item { out.append(item) } }
    }

    private static func isSettings(_ item: SidebarItem) -> Bool { item == .screen(.settings) }
}

extension SidebarItem {
    /// How a step reads in the trail: "Lineup › Injuries", "Board", or a
    /// workspace's name.
    public func trailLabel(workspaceName: (UUID) -> String?) -> String {
        switch self {
        case .screen(let screen):
            let hub = PhoneHub.hub(for: screen)
            if hub.screens.count > 1 {
                return "\(hub.title) › \(PhoneHub.segmentLabel(screen))"
            }
            return screen == .dashboard ? "My Team" : screen.rawValue
        case .workspace(let id):
            return workspaceName(id) ?? "Workspace"
        }
    }

    /// The short form for the back pill: just the segment or screen.
    public func shortLabel(workspaceName: (UUID) -> String?) -> String {
        switch self {
        case .screen(let screen):
            if PhoneHub.hub(for: screen).screens.count > 1, PhoneHub.segmentLabel(screen).count <= 3 {
                return "\(PhoneHub.hub(for: screen).title) \(PhoneHub.segmentLabel(screen))"
            }
            return screen == .dashboard ? "My Team" : screen.rawValue
        case .workspace(let id):
            return workspaceName(id) ?? "Workspace"
        }
    }
}
