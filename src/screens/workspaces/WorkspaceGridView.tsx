/**
 * The workspace canvas: panels on a 12-column snap grid — a port of FCApp
 * `WorkspaceGridView.swift` and the tray's `GridDropDelegate`.
 *
 * Locked, it's a dashboard — the panels are live and nothing moves. Unlocked,
 * each panel's title bar drags it and its corner resizes it. The panel goes
 * exactly where it's put: anything in the way slides down to make room while
 * you drag, and everything floats back up to fill the gaps.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { panelDefaultSize } from '@models/workspaces/PanelKind'
import { trayItemFromToken, trayItemPanelKind, trayItemPlacement, trayToken } from '@models/workspaces/TrayItem'
import { sameRect, type GridRect, type LinkGroup, type PanelPlacement, type PanelSettings, type Workspace } from '@models/workspaces/Workspace'
import * as G from '@models/workspaces/WorkspaceGeometry'
import { PanelHost, type PanelActions } from './PanelHost'
import {
  canvasWidth, dragChanged, dragEnded, dropRect, inserted, liveSize, nudged, removed, rowsHeight, shownRows,
  GRID_PADDING, type DragMode, type DragState, type InsertState,
} from './gridDrag'
import { useLive, useWorkspaceUI } from './workspaceUIStore'

/** The data type a tray tile carries, so the grid knows a drag is one of its own. */
export const TRAY_DRAG_TYPE = 'application/x-fcc-tray'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function WorkspaceGridView({ workspace, editing, onUpdate, initialWidth = 1100 }: {
  workspace: Workspace
  editing: boolean
  /** Applies an edit to the workspace (the store saves it). */
  onUpdate: (mutate: (workspace: Workspace) => void) => void
  /** The width to lay out at before the container is measured (and when rendered on a server). */
  initialWidth?: number
}) {
  const selectedPanelID = useLive(useWorkspaceUI, (s) => s.selectedPanelID)
  const trayDrag = useLive(useWorkspaceUI, (s) => s.trayDrag)
  const setUI = useLive(useWorkspaceUI, (s) => s.set)

  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(initialWidth)
  useIsoLayoutEffect(() => {
    const el = container.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const width = canvasWidth(containerWidth)
  const cellW = G.cellWidth(width)

  const [drag, setDrag] = useState<DragState>()
  const [insertion, setInsertion] = useState<InsertState>()

  // The latest values, for handlers made once per panel.
  const latest = useRef({ workspace, onUpdate, cellW, drag, selectedPanelID })
  latest.current = { workspace, onUpdate, cellW, drag, selectedPanelID }

  // A lock while dragging ends the drag where it is.
  useEffect(() => { if (!editing) { setDrag(undefined); setInsertion(undefined) } }, [editing])

  const shown = drag?.preview ?? insertion?.preview ?? workspace.panels
  const rows = shownRows(shown, editing, drag, insertion)
  const height = rowsHeight(rows)

  // MARK: - Editing

  const update = useCallback((mutate: (w: Workspace) => void) => latest.current.onUpdate(mutate), [])

  const remove = useCallback((id: string) => {
    update((ws) => { ws.panels = removed(ws.panels, id) })
    if (useWorkspaceUI.getState().selectedPanelID === id) setUI({ selectedPanelID: undefined })
  }, [update, setUI])

  const beginDrag = useCallback((id: string, mode: DragMode, event: PointerEvent<HTMLElement>) => {
    const start = { x: event.clientX, y: event.clientY }
    const minimum = mode === 'move' ? 3 : 2
    let started = false
    let current: DragState | undefined
    // No text selection while dragging; the title bar still takes focus, so arrow keys work next.
    event.preventDefault()
    if (mode === 'move') event.currentTarget.focus({ preventScroll: true })
    const move = (e: globalThis.PointerEvent) => {
      const translation = { width: e.clientX - start.x, height: e.clientY - start.y }
      if (!started && Math.hypot(translation.width, translation.height) < minimum) return
      const panel = latest.current.workspace.panels.find((p) => p.id === id)
      if (!panel) return
      if (!started) {
        started = true
        document.body.classList.add('ws-dragging')
        if (useWorkspaceUI.getState().selectedPanelID !== id) setUI({ selectedPanelID: id })
      }
      current = dragChanged(current, latest.current.workspace.panels, panel, mode, translation, latest.current.cellW)
      setDrag(current)
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      document.body.classList.remove('ws-dragging')
      if (current && commit) {
        const settled = dragEnded(current)
        if (settled) update((ws) => { ws.panels = settled })
      }
      current = undefined
      setDrag(undefined)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    // Escape mid-drag puts everything back.
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && started) { e.stopPropagation(); e.preventDefault(); finish(false) } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }, [update, setUI])

  const nudge = useCallback((id: string, dx: number, dy: number, dw: number, dh: number) => {
    const panels = latest.current.workspace.panels
    const panel = panels.find((p) => p.id === id)
    if (!panel) return
    const settled = nudged(panels, panel, dx, dy, dw, dh)
    if (settled) update((ws) => { ws.panels = settled })
  }, [update])

  // One set of actions per panel, made once, so a drag doesn't redraw every panel's content.
  const actionCache = useRef(new Map<string, PanelActions>())
  const actionsFor = (id: string): PanelActions => {
    let actions = actionCache.current.get(id)
    if (!actions) {
      const edit = (change: (p: PanelPlacement) => void) =>
        update((ws) => { const p = ws.panels.find((q) => q.id === id); if (p) change(p) })
      actions = {
        select: () => setUI({ selectedPanelID: id }),
        remove: () => remove(id),
        setLinkGroup: (group: LinkGroup | undefined) => edit((p) => {
          if (group === undefined) delete p.linkGroup
          else p.linkGroup = group
        }),
        setSettings: (settings: PanelSettings) => edit((p) => { p.settings = settings }),
        beginDrag: (mode, event) => beginDrag(id, mode, event),
        nudge: (dx, dy, dw, dh) => nudge(id, dx, dy, dw, dh),
      }
      actionCache.current.set(id, actions)
    }
    return actions
  }

  // MARK: - Drops from the tray

  const pointIn = (e: DragEvent) => {
    const r = canvas.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }

  const accepts = (e: DragEvent) =>
    !!trayDrag || e.dataTransfer.types.includes(TRAY_DRAG_TYPE) || e.dataTransfer.types.includes('text/plain')

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!editing || !accepts(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const item = trayDrag
    if (!item) return
    const rect = dropRect(pointIn(e), panelDefaultSize(trayItemPanelKind(item)), cellW)
    const token = trayToken(item)
    if (insertion && insertion.token === token && sameRect(insertion.panel.frame, rect)) return
    const panel = insertion && insertion.token === token
      ? { ...insertion.panel, frame: rect }
      : trayItemPlacement(item, rect)
    setInsertion({ token, panel, preview: G.inserting(panel, rect, workspace.panels) })
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null
    if (next && canvas.current?.contains(next)) return
    setInsertion(undefined)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!editing) return
    e.preventDefault()
    let panel = insertion?.panel
    if (!panel) {
      // A drop we didn't see hovering — read the token.
      const item = trayItemFromToken(e.dataTransfer.getData(TRAY_DRAG_TYPE) || e.dataTransfer.getData('text/plain'))
      if (item) {
        const size = panelDefaultSize(trayItemPanelKind(item))
        const rect = dropRect(pointIn(e), panelDefaultSize('news'), cellW)
        panel = trayItemPlacement(item, { ...rect, w: Math.min(size.w, G.COLUMNS - rect.x), h: size.h })
      }
    }
    setInsertion(undefined)
    if (!panel) return
    const settled = inserted(panel, workspace.panels)
    update((ws) => { ws.panels = settled })
    setUI({ selectedPanelID: panel.id, trayDrag: undefined })
  }

  // MARK: - Drawing

  const byID = useMemo(() => new Map(shown.map((p) => [p.id, p.frame])), [shown])

  return (
    <div ref={container} className={`ws-grid${editing ? ' ws-grid-editing' : ''}`} style={{ padding: GRID_PADDING }} data-testid="workspace.grid">
      <div
        ref={canvas}
        className="ws-canvas"
        style={{ width, height }}
        onDragOver={onDragOver}
        onDragEnter={(e) => { if (editing && accepts(e)) e.preventDefault() }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {editing && <GridBackdrop rows={rows} cellW={cellW} />}
        {workspace.panels.map((panel) => {
          const active = drag?.id === panel.id ? drag : undefined
          // The dragged panel follows the pointer from where it started; the
          // rest sit where the preview has pushed them.
          const rect = active ? panel.frame : (byID.get(panel.id) ?? panel.frame)
          const f = G.frame(rect, cellW)
          const size = liveSize(f, active, panel, cellW)
          const dx = active?.mode === 'move' ? active.translation.width : 0
          const dy = active?.mode === 'move' ? active.translation.height : 0
          return (
            <div key={panel.id} className={`ws-cell${active ? ' ws-cell-active' : ''}`}
              style={{ width: size.width, height: size.height, transform: `translate(${f.x + dx}px, ${f.y + dy}px)` }}>
              <PanelHost placement={panel} editing={editing} isSelected={editing && selectedPanelID === panel.id}
                actions={actionsFor(panel.id)} />
            </div>
          )
        })}
        {drag && <Ghost rect={drag.candidate} cellW={cellW} />}
        {insertion && <Ghost rect={insertion.panel.frame} cellW={cellW} />}
      </div>
    </div>
  )
}

/** Where the panel will land. */
function Ghost({ rect, cellW }: { rect: GridRect; cellW: number }) {
  const f = G.frame(rect, cellW)
  return <div className="ws-ghost" aria-hidden style={{ width: f.width, height: f.height, transform: `translate(${f.x}px, ${f.y}px)` }} />
}

/** Faint cells behind the panels while editing, so the grid you snap to is visible. */
function GridBackdrop({ rows, cellW }: { rows: number; cellW: number }) {
  const cells: GridRect[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < G.COLUMNS; x++) cells.push({ x, y, w: 1, h: 1 })
  const width = G.frame({ x: 0, y: 0, w: G.COLUMNS, h: 1 }, cellW).width
  return (
    <svg className="ws-backdrop" aria-hidden width={width} height={rowsHeight(rows)}>
      {cells.map((c) => {
        const f = G.frame(c, cellW)
        return <rect key={`${c.x}-${c.y}`} x={f.x} y={f.y} width={f.width} height={f.height} rx={8} />
      })}
    </svg>
  )
}
