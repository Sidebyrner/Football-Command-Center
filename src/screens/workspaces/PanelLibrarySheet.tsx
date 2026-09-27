/**
 * Every panel, what it shows, and Add. Panels already on the workspace are
 * marked but can be added again — two stream panels on different filters is
 * fine. A port of `PanelLibrarySheet` (WorkspaceScreen.swift); the sheet is a
 * modal dialog on the web.
 */
import { useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { panelSummary, panelSystemImage, panelTitle } from '@models/workspaces/PanelKind'
import { PANEL_LIBRARY_GROUPS } from '@models/workspaces/TrayItem'
import type { PanelKind } from '@models/workspaces/Workspace'
import { Dialog } from './WorkspaceUI'
import { symbolIcon } from './symbols'

export function PanelLibrarySheet({ existing, onAdd, onAddMany, onClose }: {
  existing: ReadonlySet<PanelKind>
  onAdd: (kind: PanelKind) => void
  onAddMany: (kinds: PanelKind[]) => void
  onClose: () => void
}) {
  /** Ticked panels, in the order ticked. */
  const [picked, setPicked] = useState<PanelKind[]>([])
  const toggle = (kind: PanelKind) =>
    setPicked((p) => (p.includes(kind) ? p.filter((k) => k !== kind) : [...p, kind]))
  const addPicked = () => { onAddMany(picked); onClose() }

  return (
    <Dialog title="Add a panel" onClose={onClose} wide
      footer={<>
        <button type="button" className="button" onClick={onClose}>Done</button>
        <button type="button" className="button primary" disabled={picked.length === 0} onClick={addPicked}
          data-testid="library.addPicked">
          {picked.length === 0 ? 'Add' : `Add ${picked.length} panel${picked.length === 1 ? '' : 's'}`}
        </button>
      </>}>
      <div className="ws-library">
        {PANEL_LIBRARY_GROUPS.map(([title, kinds]) => (
          <section key={title} className="ws-library-group" aria-label={title}>
            <div className="t-micro muted ws-library-heading">{title}</div>
            <div className="ws-library-list card">
              {kinds.map((kind) => {
                const on = picked.includes(kind)
                const Icon = symbolIcon(panelSystemImage(kind))
                return (
                  <div key={kind} className="ws-library-row">
                    <button type="button" className={`ws-tick${on ? ' ws-tick-on' : ''}`} aria-pressed={on}
                      aria-label={on ? `Untick ${panelTitle(kind)}` : `Tick ${panelTitle(kind)}`} onClick={() => toggle(kind)}
                      data-autofocus={kind === PANEL_LIBRARY_GROUPS[0]![1][0] ? true : undefined}>
                      {on ? <Check size={14} strokeWidth={3} aria-hidden /> : <Circle size={20} aria-hidden />}
                    </button>
                    <span className="ws-library-icon" aria-hidden><Icon size={18} /></span>
                    <div className="ws-library-text">
                      <div className="ws-library-title">
                        <span className="t-body">{panelTitle(kind)}</span>
                        {existing.has(kind) && <span className="t-meta muted">On this workspace</span>}
                      </div>
                      <div className="t-meta muted">{panelSummary(kind)}</div>
                    </div>
                    <button type="button" className="button" aria-label={`Add ${panelTitle(kind)}`}
                      onClick={() => { onAdd(kind); onClose() }}>
                      Add
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
