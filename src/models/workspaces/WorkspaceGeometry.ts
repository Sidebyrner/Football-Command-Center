/**
 * The workspace grid's arithmetic, kept pure so snapping, collisions and
 * auto-arrange are unit tested without a view — a port of FCApp
 * `WorkspaceGeometry.swift`.
 *
 * Collision policy is push-and-float, the Grafana/gridstack model: the panel
 * being moved or resized goes exactly where it's put, anything in its way is
 * pushed straight down just far enough to clear it, and everything floats back
 * up to fill gaps. Nothing ever overlaps and nothing moves sideways.
 */
import { roundAwayFromZero } from '@core/rounding'
import { panelDefaultSize, panelMinSize } from './PanelKind'
import {
  gridMaxY, gridSize, intersects, makePanelPlacement,
  type GridRect, type GridSize, type LinkGroup, type PanelKind, type PanelPlacement,
} from './Workspace'

export const COLUMNS = 12
export const ROW_HEIGHT = 96
export const GUTTER = 12
/** An empty or short workspace still gets this many rows of grid. */
export const MINIMUM_ROWS = 6

/** A frame in points (Swift's `CGRect`). */
export interface PointRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PointSize {
  width: number
  height: number
}

export function cellWidth(containerWidth: number): number {
  return Math.max((containerWidth - GUTTER * (COLUMNS - 1)) / COLUMNS, 1)
}

/** The panel's frame in points, gutters included between cells. */
export function frame(rect: GridRect, cellW: number): PointRect {
  return {
    x: rect.x * (cellW + GUTTER),
    y: rect.y * (ROW_HEIGHT + GUTTER),
    width: rect.w * cellW + Math.max(rect.w - 1, 0) * GUTTER,
    height: rect.h * ROW_HEIGHT + Math.max(rect.h - 1, 0) * GUTTER,
  }
}

const bottomOf = (panels: readonly PanelPlacement[]) =>
  panels.length === 0 ? 0 : Math.max(...panels.map((p) => gridMaxY(p.frame)))

export function rows(panels: readonly PanelPlacement[]): number {
  return Math.max(bottomOf(panels), MINIMUM_ROWS)
}

export function contentHeight(panels: readonly PanelPlacement[], extraRows = 0): number {
  const r = rows(panels) + extraRows
  return r * ROW_HEIGHT + Math.max(r - 1, 0) * GUTTER
}

/**
 * A drag offset in points turned into a whole number of cells, clamped to the
 * grid's columns and to the top edge.
 */
export function snappedMove(rect: GridRect, offset: PointSize, cellW: number): GridRect {
  const dx = Math.trunc(roundAwayFromZero(offset.width / (cellW + GUTTER)))
  const dy = Math.trunc(roundAwayFromZero(offset.height / (ROW_HEIGHT + GUTTER)))
  return {
    ...rect,
    x: Math.min(Math.max(rect.x + dx, 0), COLUMNS - rect.w),
    y: Math.max(rect.y + dy, 0),
  }
}

/** A resize from the bottom-right corner, never below the panel's minimum and never past the right edge. */
export function snappedResize(rect: GridRect, offset: PointSize, cellW: number, minimum: GridSize): GridRect {
  const dw = Math.trunc(roundAwayFromZero(offset.width / (cellW + GUTTER)))
  const dh = Math.trunc(roundAwayFromZero(offset.height / (ROW_HEIGHT + GUTTER)))
  return {
    ...rect,
    w: Math.min(Math.max(rect.w + dw, minimum.w), COLUMNS - rect.x),
    h: Math.max(rect.h + dh, minimum.h),
  }
}

export function fits(rect: GridRect): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.w >= 1 && rect.h >= 1 && rect.x + rect.w <= COLUMNS
}

export function isFree(rect: GridRect, panels: readonly PanelPlacement[], excluding?: string): boolean {
  return fits(rect) && !panels.some((p) => p.id !== excluding && intersects(p.frame, rect))
}

/**
 * The first free spot for a panel of this size, scanning rows top-down and
 * each row left to right; below everything if the grid is full.
 */
export function firstFreeSlot(size: GridSize, panels: readonly PanelPlacement[]): GridRect {
  const w = Math.min(Math.max(size.w, 1), COLUMNS)
  const h = Math.max(size.h, 1)
  const bottom = bottomOf(panels)
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x <= COLUMNS - w; x++) {
      const candidate = { x, y, w, h }
      if (isFree(candidate, panels)) return candidate
    }
  }
  return { x: 0, y: bottom, w, h }
}

/** Reading order (y, then x, then original index) — Swift's tuple sort. */
function readingOrder(panels: readonly PanelPlacement[]): PanelPlacement[] {
  return panels
    .map((element, offset) => ({ element, offset }))
    .sort((a, b) =>
      a.element.frame.y - b.element.frame.y || a.element.frame.x - b.element.frame.x || a.offset - b.offset)
    .map((e) => e.element)
}

/** Back in the caller's order, so identity and z-order don't shuffle. */
function inCallerOrder(original: readonly PanelPlacement[], placed: readonly PanelPlacement[]): PanelPlacement[] {
  const byID = new Map(placed.map((p) => [p.id, p]))
  return original.flatMap((p) => {
    const found = byID.get(p.id)
    return found ? [found] : []
  })
}

/**
 * Auto-arrange: every panel slides straight up as far as it can, keeping its
 * column and size. Stable in reading order, and idempotent.
 */
export function compacted(panels: readonly PanelPlacement[]): PanelPlacement[] {
  const placed: PanelPlacement[] = []
  for (const panel of readingOrder(panels)) {
    let rect = { ...panel.frame }
    while (rect.y > 0) {
      const up = { ...rect, y: rect.y - 1 }
      if (!isFree(up, placed)) break
      rect = up
    }
    placed.push({ ...panel, frame: rect })
  }
  return inCallerOrder(panels, placed)
}

// MARK: - Push and float

/**
 * The layout with one panel placed exactly at `rect`: every other panel, in
 * reading order, floats up as far as it can and is then pushed down below
 * anything it would overlap. Always collision-free.
 */
export function layout(panels: readonly PanelPlacement[], pinning: string, rect: GridRect): PanelPlacement[] {
  const pinned = panels.find((p) => p.id === pinning)
  if (!pinned) return [...panels]
  const placed: PanelPlacement[] = [{ ...pinned, frame: { ...rect } }]
  const others = readingOrder(panels.filter((p) => p.id !== pinning))
  for (const panel of others) {
    placed.push({ ...panel, frame: settled(panel.frame, placed) })
  }
  return inCallerOrder(panels, placed)
}

/** `layout` with a panel that isn't on the grid yet — a drop from the tray. */
export function inserting(panel: PanelPlacement, rect: GridRect, panels: readonly PanelPlacement[]): PanelPlacement[] {
  const added = { ...panel, frame: { ...rect } }
  return layout([...panels, added], added.id, rect)
}

/** Gravity after a drop: everything, the dropped panel included, floats up. */
export function settle(panels: readonly PanelPlacement[]): PanelPlacement[] {
  return compacted(panels)
}

/** Floats a frame up as far as it's free, then pushes it down below any panel it still overlaps. */
function settled(start: GridRect, placed: readonly PanelPlacement[]): GridRect {
  let rect = { ...start }
  while (rect.y > 0) {
    const up = { ...rect, y: rect.y - 1 }
    if (placed.some((p) => intersects(p.frame, up))) break
    rect = up
  }
  for (;;) {
    const blockers = placed.filter((p) => intersects(p.frame, rect))
    if (blockers.length === 0) break
    rect = { ...rect, y: Math.max(...blockers.map((b) => gridMaxY(b.frame))) }
  }
  return rect
}

/** The grid cell under a point in the canvas, clamped to the grid. */
export function cellAt(point: { x: number; y: number }, cellW: number): { x: number; y: number } {
  const x = Math.trunc(Math.floor(point.x / (cellW + GUTTER)))
  const y = Math.trunc(Math.floor(point.y / (ROW_HEIGHT + GUTTER)))
  return { x: Math.min(Math.max(x, 0), COLUMNS - 1), y: Math.max(y, 0) }
}

/** Several new panels at their default sizes, each in the first free slot. */
export function appending(
  kinds: readonly PanelKind[],
  panels: readonly PanelPlacement[],
  link: (kind: PanelKind) => LinkGroup | undefined,
): PanelPlacement[] {
  const out = [...panels]
  for (const kind of kinds) {
    out.push(makePanelPlacement({ kind, frame: firstFreeSlot(panelDefaultSize(kind), out), linkGroup: link(kind) }))
  }
  return out
}

export type GeometryIssue =
  | { kind: 'outOfBounds'; id: string }
  | { kind: 'overlap'; id: string; other: string }
  | { kind: 'belowMinimum'; id: string }

export function validate(panels: readonly PanelPlacement[]): GeometryIssue[] {
  const issues: GeometryIssue[] = []
  panels.forEach((panel, i) => {
    if (!fits(panel.frame)) issues.push({ kind: 'outOfBounds', id: panel.id })
    const minimum = panelMinSize(panel.kind)
    if (panel.frame.w < minimum.w || panel.frame.h < minimum.h) issues.push({ kind: 'belowMinimum', id: panel.id })
    for (const other of panels.slice(i + 1)) {
      if (intersects(panel.frame, other.frame)) issues.push({ kind: 'overlap', id: panel.id, other: other.id })
    }
  })
  return issues
}

/**
 * A layout made valid: sizes clamped to each panel's minimum and the grid,
 * then any panel that still collides re-placed in the first free slot. Used
 * when a saved file was edited by hand or came from another version.
 */
export function repaired(panels: readonly PanelPlacement[]): PanelPlacement[] {
  if (validate(panels).length === 0) return [...panels]
  const placed: PanelPlacement[] = []
  for (const original of panels) {
    const minimum = panelMinSize(original.kind)
    const f = { ...original.frame }
    f.w = Math.min(Math.max(f.w, minimum.w), COLUMNS)
    f.h = Math.max(f.h, minimum.h)
    f.x = Math.min(Math.max(f.x, 0), COLUMNS - f.w)
    f.y = Math.max(f.y, 0)
    const frame = isFree(f, placed) ? f : firstFreeSlot(gridSize(f), placed)
    placed.push({ ...original, frame })
  }
  return placed
}
