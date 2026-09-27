/**
 * The grid's drag, resize, nudge and drop arithmetic — the view-side half of
 * FCApp `WorkspaceGridView.swift` and `GridDropDelegate` (PanelTray.swift),
 * kept pure so it's unit tested without a browser. The push-and-float
 * geometry itself is `WorkspaceGeometry`.
 */
import { panelMinSize } from '@models/workspaces/PanelKind'
import { sameRect, gridMaxY, type GridRect, type GridSize, type PanelPlacement } from '@models/workspaces/Workspace'
import * as G from '@models/workspaces/WorkspaceGeometry'

/** Space around the canvas, as the Swift grid's padding. */
export const GRID_PADDING = 16
/** The narrowest canvas; a narrower window scrolls sideways rather than squashing panels. */
export const MIN_CANVAS_WIDTH = 320

export type DragMode = 'move' | 'resize'

export interface DragState {
  id: string
  mode: DragMode
  origin: GridRect
  translation: G.PointSize
  candidate: GridRect
  /** Where every panel sits if the drag ended now — the others already pushed out of the way. */
  preview: PanelPlacement[]
}

/** A panel hovering in from the tray. */
export interface InsertState {
  token: string
  panel: PanelPlacement
  /** Every panel with the new one in place and the others pushed aside. */
  preview: PanelPlacement[]
}

export function canvasWidth(containerWidth: number): number {
  return Math.max(containerWidth - GRID_PADDING * 2, MIN_CANVAS_WIDTH)
}

/** Where a drag of `panel` by `translation` would put it, snapped to cells. */
export function dragCandidate(panel: PanelPlacement, mode: DragMode, translation: G.PointSize, cellW: number): GridRect {
  return mode === 'move'
    ? G.snappedMove(panel.frame, translation, cellW)
    : G.snappedResize(panel.frame, translation, cellW, panelMinSize(panel.kind))
}

/**
 * The next drag state. The push is only worked out again when the snapped
 * cell changes, not on every pointer move.
 */
export function dragChanged(
  previous: DragState | undefined, panels: readonly PanelPlacement[], panel: PanelPlacement,
  mode: DragMode, translation: G.PointSize, cellW: number,
): DragState {
  const candidate = dragCandidate(panel, mode, translation, cellW)
  const preview = previous && previous.id === panel.id && sameRect(previous.candidate, candidate)
    ? previous.preview
    : G.layout(panels, panel.id, candidate)
  return { id: panel.id, mode, origin: panel.frame, translation, candidate, preview }
}

/** The layout to save when a drag ends, or `undefined` when nothing moved. */
export function dragEnded(drag: DragState): PanelPlacement[] | undefined {
  return sameRect(drag.candidate, drag.origin) ? undefined : G.settle(drag.preview)
}

/** While resizing, the panel follows the pointer, never smaller than its minimum. */
export function liveSize(frame: G.PointRect, drag: DragState | undefined, panel: PanelPlacement, cellW: number): G.PointSize {
  if (!drag || drag.id !== panel.id || drag.mode !== 'resize') return { width: frame.width, height: frame.height }
  const minimum = panelMinSize(panel.kind)
  const min = G.frame({ x: 0, y: 0, w: minimum.w, h: minimum.h }, cellW)
  return {
    width: Math.max(frame.width + drag.translation.width, min.width),
    height: Math.max(frame.height + drag.translation.height, min.height),
  }
}

/**
 * Keyboard and assistive tech: move or resize by one cell, pushing whatever
 * is in the way. `undefined` when the step goes nowhere or off the grid.
 */
export function nudged(
  panels: readonly PanelPlacement[], panel: PanelPlacement, dx: number, dy: number, dw: number, dh: number,
): PanelPlacement[] | undefined {
  const minimum = panelMinSize(panel.kind)
  const rect: GridRect = {
    x: panel.frame.x + dx,
    y: panel.frame.y + dy,
    w: Math.max(panel.frame.w + dw, minimum.w),
    h: Math.max(panel.frame.h + dh, minimum.h),
  }
  if (sameRect(rect, panel.frame) || !G.fits(rect)) return undefined
  return G.settle(G.layout(panels, panel.id, rect))
}

/** The panel's top-left corner at the cell under the pointer, kept on the grid. */
export function dropRect(location: { x: number; y: number }, size: GridSize, cellW: number): GridRect {
  const cell = G.cellAt(location, cellW)
  const w = Math.min(size.w, G.COLUMNS)
  return { x: Math.min(cell.x, G.COLUMNS - w), y: cell.y, w, h: size.h }
}

/** A panel from the tray, placed where it was dropped with the others pushed aside. */
export function inserted(panel: PanelPlacement, panels: readonly PanelPlacement[]): PanelPlacement[] {
  return G.settle(G.inserting(panel, panel.frame, panels))
}

/** A panel removed, and everything floated up to fill the gap. */
export function removed(panels: readonly PanelPlacement[], id: string): PanelPlacement[] {
  return G.settle(panels.filter((p) => p.id !== id))
}

/** Rows drawn: room below the lowest panel while editing, so there's somewhere to drag to. */
export function shownRows(
  shown: readonly PanelPlacement[], editing: boolean, drag?: DragState, insertion?: InsertState,
): number {
  let rows = G.rows(shown) + (editing ? 2 : 0)
  if (drag) rows = Math.max(rows, gridMaxY(drag.candidate) + 1)
  if (insertion) rows = Math.max(rows, gridMaxY(insertion.panel.frame) + 1)
  return rows
}

export function rowsHeight(rows: number): number {
  return rows * G.ROW_HEIGHT + Math.max(rows - 1, 0) * G.GUTTER
}
