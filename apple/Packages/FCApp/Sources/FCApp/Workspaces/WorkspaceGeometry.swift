import Foundation
import CoreGraphics

/// The workspace grid's arithmetic, kept pure so snapping, collisions and
/// auto-arrange are unit tested without a view.
///
/// Collision policy is push-and-float, the Grafana/gridstack model: the panel
/// being moved or resized goes exactly where it's put, anything in its way is
/// pushed straight down just far enough to clear it, and everything floats
/// back up to fill gaps. Nothing ever overlaps and nothing moves sideways.
public enum WorkspaceGeometry {
    public static let columns = 12
    public static let rowHeight: CGFloat = 96
    public static let gutter: CGFloat = 12
    /// An empty or short workspace still gets this many rows of grid.
    public static let minimumRows = 6

    public static func cellWidth(containerWidth: CGFloat) -> CGFloat {
        max((containerWidth - gutter * CGFloat(columns - 1)) / CGFloat(columns), 1)
    }

    /// The panel's frame in points, gutters included between cells.
    public static func frame(_ rect: GridRect, cellWidth: CGFloat) -> CGRect {
        CGRect(
            x: CGFloat(rect.x) * (cellWidth + gutter),
            y: CGFloat(rect.y) * (rowHeight + gutter),
            width: CGFloat(rect.w) * cellWidth + CGFloat(max(rect.w - 1, 0)) * gutter,
            height: CGFloat(rect.h) * rowHeight + CGFloat(max(rect.h - 1, 0)) * gutter
        )
    }

    public static func rows(_ panels: [PanelPlacement]) -> Int {
        max(panels.map(\.frame.maxY).max() ?? 0, minimumRows)
    }

    public static func contentHeight(_ panels: [PanelPlacement], extraRows: Int = 0) -> CGFloat {
        let rows = rows(panels) + extraRows
        return CGFloat(rows) * rowHeight + CGFloat(max(rows - 1, 0)) * gutter
    }

    /// A drag offset in points turned into a whole number of cells, clamped to
    /// the grid's columns and to the top edge.
    public static func snappedMove(_ rect: GridRect, by offset: CGSize, cellWidth: CGFloat) -> GridRect {
        let dx = Int((offset.width / (cellWidth + gutter)).rounded())
        let dy = Int((offset.height / (rowHeight + gutter)).rounded())
        var moved = rect
        moved.x = min(max(rect.x + dx, 0), columns - rect.w)
        moved.y = max(rect.y + dy, 0)
        return moved
    }

    /// A resize from the bottom-right corner, never below the panel's minimum
    /// and never past the right edge.
    public static func snappedResize(_ rect: GridRect, by offset: CGSize, cellWidth: CGFloat, min minimum: GridSize) -> GridRect {
        let dw = Int((offset.width / (cellWidth + gutter)).rounded())
        let dh = Int((offset.height / (rowHeight + gutter)).rounded())
        var resized = rect
        resized.w = min(max(rect.w + dw, minimum.w), columns - rect.x)
        resized.h = max(rect.h + dh, minimum.h)
        return resized
    }

    public static func fits(_ rect: GridRect) -> Bool {
        rect.x >= 0 && rect.y >= 0 && rect.w >= 1 && rect.h >= 1 && rect.maxX <= columns
    }

    public static func isFree(_ rect: GridRect, in panels: [PanelPlacement], excluding id: UUID? = nil) -> Bool {
        fits(rect) && !panels.contains { $0.id != id && $0.frame.intersects(rect) }
    }

    /// The first free spot for a panel of this size, scanning rows top-down and
    /// each row left to right; below everything if the grid is full.
    public static func firstFreeSlot(size: GridSize, in panels: [PanelPlacement]) -> GridRect {
        let w = min(max(size.w, 1), columns)
        let h = max(size.h, 1)
        let bottom = panels.map(\.frame.maxY).max() ?? 0
        for y in 0...bottom {
            for x in 0...(columns - w) {
                let candidate = GridRect(x: x, y: y, w: w, h: h)
                if isFree(candidate, in: panels) { return candidate }
            }
        }
        return GridRect(x: 0, y: bottom, w: w, h: h)
    }

    /// Auto-arrange: every panel slides straight up as far as it can, keeping
    /// its column and size. Stable in reading order, and idempotent.
    public static func compacted(_ panels: [PanelPlacement]) -> [PanelPlacement] {
        let ordered = panels.enumerated().sorted {
            ($0.element.frame.y, $0.element.frame.x, $0.offset) < ($1.element.frame.y, $1.element.frame.x, $1.offset)
        }
        var placed: [PanelPlacement] = []
        for (_, panel) in ordered {
            var moved = panel
            while moved.frame.y > 0 {
                var up = moved.frame
                up.y -= 1
                guard isFree(up, in: placed) else { break }
                moved.frame = up
            }
            placed.append(moved)
        }
        // Back in the caller's order, so identity and z-order don't shuffle.
        let byID = Dictionary(uniqueKeysWithValues: placed.map { ($0.id, $0) })
        return panels.compactMap { byID[$0.id] }
    }

    // MARK: - Push and float

    /// The layout with one panel placed exactly at `rect`: every other panel,
    /// in reading order, floats up as far as it can and is then pushed down
    /// below anything it would overlap. Always collision-free.
    public static func layout(_ panels: [PanelPlacement], pinning id: UUID, at rect: GridRect) -> [PanelPlacement] {
        guard let pinned = panels.first(where: { $0.id == id }) else { return panels }
        var moved = pinned
        moved.frame = rect
        var placed: [PanelPlacement] = [moved]
        let others = panels.enumerated()
            .filter { $0.element.id != id }
            .sorted { ($0.element.frame.y, $0.element.frame.x, $0.offset) < ($1.element.frame.y, $1.element.frame.x, $1.offset) }
            .map(\.element)
        for var panel in others {
            panel.frame = settled(panel.frame, among: placed)
            placed.append(panel)
        }
        let byID = Dictionary(uniqueKeysWithValues: placed.map { ($0.id, $0) })
        return panels.compactMap { byID[$0.id] }
    }

    /// `layout` with a panel that isn't on the grid yet — a drop from the tray.
    public static func inserting(_ panel: PanelPlacement, at rect: GridRect, into panels: [PanelPlacement]) -> [PanelPlacement] {
        var added = panel
        added.frame = rect
        return layout(panels + [added], pinning: added.id, at: rect)
    }

    /// Gravity after a drop: everything, the dropped panel included, floats up.
    public static func settle(_ panels: [PanelPlacement]) -> [PanelPlacement] {
        compacted(panels)
    }

    /// Floats a frame up as far as it's free, then pushes it down below any
    /// panel it still overlaps.
    private static func settled(_ frame: GridRect, among placed: [PanelPlacement]) -> GridRect {
        var rect = frame
        while rect.y > 0 {
            var up = rect
            up.y -= 1
            guard !placed.contains(where: { $0.frame.intersects(up) }) else { break }
            rect = up
        }
        while let blocker = placed.filter({ $0.frame.intersects(rect) }).max(by: { $0.frame.maxY < $1.frame.maxY }) {
            rect.y = blocker.frame.maxY
        }
        return rect
    }

    /// The grid cell under a point in the canvas, clamped to the grid.
    public static func cell(at point: CGPoint, cellWidth: CGFloat) -> (x: Int, y: Int) {
        let x = Int((point.x / (cellWidth + gutter)).rounded(.down))
        let y = Int((point.y / (rowHeight + gutter)).rounded(.down))
        return (min(max(x, 0), columns - 1), max(y, 0))
    }

    /// Several new panels at their default sizes, each in the first free slot.
    public static func appending(_ kinds: [PanelKind], into panels: [PanelPlacement],
                                 link: (PanelKind) -> LinkGroup?) -> [PanelPlacement] {
        var out = panels
        for kind in kinds {
            out.append(PanelPlacement(kind: kind, frame: firstFreeSlot(size: kind.defaultSize, in: out), linkGroup: link(kind)))
        }
        return out
    }

    public enum Issue: Hashable, Sendable {
        case outOfBounds(UUID)
        case overlap(UUID, UUID)
        case belowMinimum(UUID)
    }

    public static func validate(_ panels: [PanelPlacement]) -> [Issue] {
        var issues: [Issue] = []
        for (i, panel) in panels.enumerated() {
            if !fits(panel.frame) { issues.append(.outOfBounds(panel.id)) }
            let minimum = panel.kind.minSize
            if panel.frame.w < minimum.w || panel.frame.h < minimum.h { issues.append(.belowMinimum(panel.id)) }
            for other in panels[(i + 1)...] where panel.frame.intersects(other.frame) {
                issues.append(.overlap(panel.id, other.id))
            }
        }
        return issues
    }

    /// A layout made valid: sizes clamped to each panel's minimum and the grid,
    /// then any panel that still collides re-placed in the first free slot.
    /// Used when a saved file was edited by hand or came from another version.
    public static func repaired(_ panels: [PanelPlacement]) -> [PanelPlacement] {
        guard !validate(panels).isEmpty else { return panels }
        var placed: [PanelPlacement] = []
        for var panel in panels {
            let minimum = panel.kind.minSize
            panel.frame.w = min(max(panel.frame.w, minimum.w), columns)
            panel.frame.h = max(panel.frame.h, minimum.h)
            panel.frame.x = min(max(panel.frame.x, 0), columns - panel.frame.w)
            panel.frame.y = max(panel.frame.y, 0)
            if !isFree(panel.frame, in: placed) {
                panel.frame = firstFreeSlot(size: panel.frame.size, in: placed)
            }
            placed.append(panel)
        }
        return placed
    }
}
