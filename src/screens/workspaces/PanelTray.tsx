/**
 * The panel tray: docked beside the grid while the layout is unlocked, and
 * it stays open. Click an item to drop it in the next free spot, or drag it
 * onto the grid exactly where you want it — a port of FCApp `PanelTray.swift`.
 */
import { LayoutGrid, PanelRightClose, Plus } from 'lucide-react'
import {
  TRAY_SECTIONS, trayItemSummary, trayItemSystemImage, trayItemTitle, trayToken, type TrayItem,
} from '@models/workspaces/TrayItem'
import { symbolIcon } from './symbols'
import { TRAY_DRAG_TYPE } from './WorkspaceGridView'
import { useLive, useWorkspaceUI } from './workspaceUIStore'

export function PanelTray({ onAdd }: { onAdd: (item: TrayItem) => void }) {
  const expanded = useLive(useWorkspaceUI, (s) => s.panelTrayExpanded)
  const set = useLive(useWorkspaceUI, (s) => s.set)
  return (
    <aside className={`ws-tray${expanded ? '' : ' ws-tray-collapsed'}`} aria-label="Panels" data-testid="workspace.tray">
      <div className="ws-tray-header">
        {expanded && <span className="t-body ws-tray-title">Panels</span>}
        <button type="button" className="ws-icon-button" onClick={() => set({ panelTrayExpanded: !expanded })}
          title={expanded ? 'Collapse the tray' : 'Show the panel tray'}
          aria-label={expanded ? 'Collapse the panel tray' : 'Show the panel tray'}>
          {expanded ? <PanelRightClose size={17} aria-hidden /> : <LayoutGrid size={17} aria-hidden />}
        </button>
      </div>
      <div className="ws-tray-scroll">
        {expanded && <p className="t-meta muted ws-tray-hint">Click to add, or drag onto the grid.</p>}
        {TRAY_SECTIONS.map(([title, items]) => (
          <div key={title} className="ws-tray-section" role="group" aria-label={title}>
            {expanded && <div className="t-micro muted ws-tray-heading">{title}</div>}
            {items.map((item) => <Tile key={trayToken(item)} item={item} expanded={expanded} onAdd={onAdd} />)}
          </div>
        ))}
      </div>
    </aside>
  )
}

function Tile({ item, expanded, onAdd }: { item: TrayItem; expanded: boolean; onAdd: (item: TrayItem) => void }) {
  const set = useLive(useWorkspaceUI, (s) => s.set)
  const Icon = symbolIcon(trayItemSystemImage(item))
  const title = trayItemTitle(item)
  return (
    <button
      type="button"
      className="ws-tray-tile"
      draggable
      title={trayItemSummary(item)}
      aria-label={`Add ${title}`}
      data-token={trayToken(item)}
      onClick={() => onAdd(item)}
      onDragStart={(e) => {
        const token = trayToken(item)
        e.dataTransfer.effectAllowed = 'copy'
        e.dataTransfer.setData(TRAY_DRAG_TYPE, token)
        e.dataTransfer.setData('text/plain', token)
        set({ trayDrag: item })
      }}
      onDragEnd={() => set({ trayDrag: undefined })}
    >
      <span className="ws-tray-icon" aria-hidden><Icon size={15} /></span>
      {expanded && (
        <>
          <span className="ws-tray-name t-meta">{title}</span>
          <Plus size={12} className="ws-tray-plus" aria-hidden />
        </>
      )}
    </button>
  )
}
