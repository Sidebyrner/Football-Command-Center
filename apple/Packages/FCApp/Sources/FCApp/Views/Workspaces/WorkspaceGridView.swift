import SwiftUI

/// The workspace canvas: panels on a 12-column snap grid.
///
/// Locked, it's a dashboard — the panels are live and nothing moves. Unlocked,
/// each panel's title bar drags it and its corner resizes it. The panel goes
/// exactly where it's put: anything in the way slides down to make room while
/// you drag, and everything floats back up to fill the gaps.
struct WorkspaceGridView: View {
    let workspace: Workspace
    let editing: Bool
    let services: AppServices
    @Binding var selectedPanelID: UUID?
    /// Applies an edit to the workspace (the store saves it).
    let onUpdate: ((inout Workspace) -> Void) -> Void

    @State private var drag: DragState?

    private static let padding: CGFloat = 16
    static let coordinateSpace = "workspace-grid"

    struct DragState: Equatable {
        enum Mode { case move, resize }
        let id: UUID
        let mode: Mode
        let origin: GridRect
        var translation: CGSize
        var candidate: GridRect
        /// Where every panel sits if the drag ended now — the others already
        /// pushed out of the way.
        var preview: [PanelPlacement]
    }

    @Environment(\.workspaceStaticWidth) private var staticWidth

    var body: some View {
        Group {
            if let staticWidth {
                canvas(width: staticWidth - Self.padding * 2)
            } else {
                GeometryReader { geometry in
                    ScrollView(.vertical) {
                        canvas(width: max(geometry.size.width - Self.padding * 2, 320))
                    }
                    .scrollDisabled(drag != nil)
                }
            }
        }
        .background(Palette.surface.opacity(0.6))
        .animation(Motion.snappy, value: editing)
        .accessibilityIdentifier("workspace.grid")
    }

    private func canvas(width: CGFloat) -> some View {
        let cellWidth = WorkspaceGeometry.cellWidth(containerWidth: width)
        return ZStack(alignment: .topLeading) {
            if editing {
                GridBackdrop(rows: rows, cellWidth: cellWidth)
                    .transition(.opacity)
            }
            ForEach(workspace.panels) { panel in
                panelCell(panel, cellWidth: cellWidth)
            }
            if let drag {
                ghost(drag.candidate, cellWidth: cellWidth)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .coordinateSpace(name: Self.coordinateSpace)
        .padding(Self.padding)
    }

    // MARK: - Layout

    /// The panels as drawn: the drag's preview while dragging.
    private var shown: [PanelPlacement] { drag?.preview ?? workspace.panels }

    /// Room below the lowest panel while editing, so there's somewhere to drag to.
    private var rows: Int {
        var rows = WorkspaceGeometry.rows(shown) + (editing ? 2 : 0)
        if let drag { rows = max(rows, drag.candidate.maxY + 1) }
        return rows
    }

    private var height: CGFloat {
        CGFloat(rows) * WorkspaceGeometry.rowHeight + CGFloat(max(rows - 1, 0)) * WorkspaceGeometry.gutter
    }

    @ViewBuilder
    private func panelCell(_ panel: PanelPlacement, cellWidth: CGFloat) -> some View {
        let active = drag?.id == panel.id ? drag : nil
        // The dragged panel follows the pointer from where it started; the
        // rest sit where the preview has pushed them.
        let rect = active != nil ? panel.frame : (drag?.preview.first { $0.id == panel.id }?.frame ?? panel.frame)
        let frame = WorkspaceGeometry.frame(rect, cellWidth: cellWidth)
        let size = liveSize(frame: frame, active: active, kind: panel.kind, cellWidth: cellWidth)
        PanelHost(
            placement: panel,
            editing: editing,
            isSelected: editing && selectedPanelID == panel.id,
            services: services,
            actions: PanelHost.Actions(
                select: { selectedPanelID = panel.id },
                remove: { remove(panel.id) },
                setLinkGroup: { group in onUpdate { ws in ws.update(panel.id) { $0.linkGroup = group } } },
                setSettings: { settings in onUpdate { ws in ws.update(panel.id) { $0.settings = settings } } },
                moveChanged: { dragChanged(panel, mode: .move, translation: $0, cellWidth: cellWidth) },
                resizeChanged: { dragChanged(panel, mode: .resize, translation: $0, cellWidth: cellWidth) },
                dragEnded: { dragEnded() },
                nudge: { dx, dy, dw, dh in nudge(panel, dx: dx, dy: dy, dw: dw, dh: dh) }
            )
        )
        .frame(width: size.width, height: size.height)
        .offset(
            x: frame.minX + (active?.mode == .move ? active!.translation.width : 0),
            y: frame.minY + (active?.mode == .move ? active!.translation.height : 0)
        )
        // Pushed panels glide; the one under the pointer tracks it exactly.
        .animation(active != nil ? nil : .snappy(duration: 0.22), value: rect)
        .zIndex(active != nil ? 2 : 0)
        .shadow(color: .black.opacity(active != nil ? 0.18 : 0), radius: 16, y: 8)
    }

    /// While resizing, the panel follows the pointer, never smaller than its minimum.
    private func liveSize(frame: CGRect, active: DragState?, kind: PanelKind, cellWidth: CGFloat) -> CGSize {
        guard let active, active.mode == .resize else { return frame.size }
        let minimum = WorkspaceGeometry.frame(
            GridRect(x: 0, y: 0, w: kind.minSize.w, h: kind.minSize.h), cellWidth: cellWidth
        ).size
        return CGSize(
            width: max(frame.width + active.translation.width, minimum.width),
            height: max(frame.height + active.translation.height, minimum.height)
        )
    }

    /// Where the panel will land.
    func ghost(_ rect: GridRect, cellWidth: CGFloat) -> some View {
        let frame = WorkspaceGeometry.frame(rect, cellWidth: cellWidth)
        return RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.accentColor.opacity(0.10))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(0.8), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
            )
            .frame(width: frame.width, height: frame.height)
            .offset(x: frame.minX, y: frame.minY)
            .zIndex(1)
            .allowsHitTesting(false)
            .animation(.snappy(duration: 0.14), value: rect)
    }

    // MARK: - Editing

    private func dragChanged(_ panel: PanelPlacement, mode: DragState.Mode, translation: CGSize, cellWidth: CGFloat) {
        let candidate: GridRect
        switch mode {
        case .move:
            candidate = WorkspaceGeometry.snappedMove(panel.frame, by: translation, cellWidth: cellWidth)
        case .resize:
            candidate = WorkspaceGeometry.snappedResize(panel.frame, by: translation, cellWidth: cellWidth, min: panel.kind.minSize)
        }
        if drag?.id != panel.id { selectedPanelID = panel.id }
        // The push is only worked out again when the snapped cell changes,
        // not on every pointer move.
        let preview = drag?.id == panel.id && drag?.candidate == candidate
            ? drag!.preview
            : WorkspaceGeometry.layout(workspace.panels, pinning: panel.id, at: candidate)
        drag = DragState(id: panel.id, mode: mode, origin: panel.frame, translation: translation,
                         candidate: candidate, preview: preview)
    }

    private func dragEnded() {
        guard let drag else { return }
        withAnimation(Motion.snappy) {
            if drag.candidate != drag.origin {
                let settled = WorkspaceGeometry.settle(drag.preview)
                onUpdate { ws in ws.panels = settled }
            }
            self.drag = nil
        }
    }

    /// Keyboard and VoiceOver: move or resize by one cell, pushing whatever
    /// is in the way.
    private func nudge(_ panel: PanelPlacement, dx: Int, dy: Int, dw: Int, dh: Int) {
        var rect = panel.frame
        rect.x += dx
        rect.y += dy
        rect.w = max(rect.w + dw, panel.kind.minSize.w)
        rect.h = max(rect.h + dh, panel.kind.minSize.h)
        guard rect != panel.frame, WorkspaceGeometry.fits(rect) else { return }
        let settled = WorkspaceGeometry.settle(WorkspaceGeometry.layout(workspace.panels, pinning: panel.id, at: rect))
        withAnimation(Motion.snappy) {
            onUpdate { ws in ws.panels = settled }
        }
    }

    private func remove(_ id: UUID) {
        withAnimation(Motion.snappy) {
            onUpdate { ws in
                ws.panels.removeAll { $0.id == id }
                ws.panels = WorkspaceGeometry.settle(ws.panels)
            }
            if selectedPanelID == id { selectedPanelID = nil }
        }
    }
}

extension Workspace {
    mutating func update(_ panelID: UUID, _ mutate: (inout PanelPlacement) -> Void) {
        guard let index = panels.firstIndex(where: { $0.id == panelID }) else { return }
        mutate(&panels[index])
    }
}

/// Faint cells behind the panels while editing, so the grid you snap to is visible.
private struct GridBackdrop: View {
    let rows: Int
    let cellWidth: CGFloat

    var body: some View {
        Canvas { context, _ in
            for row in 0..<rows {
                for column in 0..<WorkspaceGeometry.columns {
                    let rect = WorkspaceGeometry.frame(GridRect(x: column, y: row, w: 1, h: 1), cellWidth: cellWidth)
                    context.fill(Path(roundedRect: rect, cornerRadius: 8), with: .color(Color.secondary.opacity(0.07)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
