/**
 * A workspace: the user's own arrangement of panels, with a lock so a
 * finished layout can't be nudged by accident — a port of FCApp
 * `WorkspaceScreen.swift`. The Mac's window toolbar (Add panel, Edit layout,
 * the Workspace menu) is `WorkspaceToolbar`, drawn in the shell's top bar.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  Copy, Ellipsis, LayoutDashboard, LayoutGrid, Lock, LockOpen, Pencil, RotateCcw, SquareDashed, SquarePlus, Trash2,
} from 'lucide-react'
import { panelConsumesLink, panelDefaultSize, panelPublishesLink } from '@models/workspaces/PanelKind'
import { trayItemPanelKind, trayItemPlacement, trayPanel, type TrayItem } from '@models/workspaces/TrayItem'
import type { PanelKind, Workspace } from '@models/workspaces/Workspace'
import * as G from '@models/workspaces/WorkspaceGeometry'
import { ALL_PRESETS, presetById } from '@models/workspaces/WorkspacePresets'
import { isConfigured } from '@models/settings/AppSettings'
import { useApp, useModel } from '@ui/app/AppContext'
import { NeedsSetup } from '@ui/components/State'
import { useNavigation, useNavigationStore } from '@ui/shell/navigationStore'
import { PanelLibrarySheet } from './PanelLibrarySheet'
import { PanelTray } from './PanelTray'
import { WorkspaceGridView } from './WorkspaceGridView'
import { DeleteWorkspaceDialog, Menu, MenuDivider, MenuItem, MenuSection, RenameDialog } from './WorkspaceUI'
import { symbolIcon } from './symbols'
import { useLive, useWorkspaceUI } from './workspaceUIStore'
import './workspaces.css'

/** The icons a workspace can wear in the sidebar. */
export const WORKSPACE_ICONS = [
  'square.grid.2x2', 'sportscourt', 'tray.and.arrow.down', 'arrow.triangle.swap', 'chart.bar.xaxis',
  'calendar', 'star', 'bolt', 'flame', 'shield.lefthalf.filled', 'list.bullet.rectangle', 'binoculars',
] as const

const WIDE = '(min-width: 900px)'

/** True on a window wide enough for the sidebar — and on the server, where there's no window. */
export function useIsWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = typeof window !== 'undefined' ? window.matchMedia?.(WIDE) : undefined
      query?.addEventListener('change', onChange)
      return () => query?.removeEventListener('change', onChange)
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE).matches : true),
    () => true,
  )
}

export const useWorkspaceEditing = () => useLive(useNavigationStore, (s) => s.router.workspaceEditing)

/**
 * The workspace URL's page. The phone never shows a workspace, as on the
 * native app: a narrow window gets a way back to the Board instead.
 */
export function WorkspaceRoute({ id }: { id: string }) {
  const wide = useIsWide()
  const { services } = useApp()
  const settings = useModel(services.settingsModel).settings
  if (!wide) {
    return (
      <div className="empty-state ws-empty" data-testid="workspace.phone">
        <SquareDashed size={36} className="muted" aria-hidden />
        <h2 className="t-section">Workspaces need a wider window</h2>
        <p className="t-body muted">Open this on an iPad or a computer to see its panels.</p>
        <Link to="/board" className="button primary">Go to the Board</Link>
      </div>
    )
  }
  if (!isConfigured(settings)) return <NeedsSetup />
  return <WorkspaceScreen id={id} />
}

/** Drops a panel in the next free spot and selects it. */
export function addTrayItem(workspace: Workspace, item: TrayItem): { panels: Workspace['panels']; added: string } {
  const frame = G.firstFreeSlot(panelDefaultSize(trayItemPanelKind(item)), workspace.panels)
  const panel = trayItemPlacement(item, frame)
  return { panels: [...workspace.panels, panel], added: panel.id }
}

export function WorkspaceScreen({ id, initialWidth }: { id: string; initialWidth?: number }) {
  const { services } = useApp()
  const store = useModel(services.workspaces)
  const workspace = store.workspace(id)
  const editing = useWorkspaceEditing()
  const { setWorkspaceEditing } = useNavigation()
  const showLibrary = useLive(useWorkspaceUI, (s) => s.showPanelLibrary)
  const setUI = useLive(useWorkspaceUI, (s) => s.set)

  // Opening a workspace starts with nothing selected; leaving saves any pending edit.
  useEffect(() => {
    setUI({ selectedPanelID: undefined })
    return () => store.flush()
  }, [id, store, setUI])

  // Escape locks the layout; Delete removes the selected panel; ⌘E / ⇧⌘A as in the toolbar's help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      const editingNow = useNavigationStore.getState().router.workspaceEditing
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        toggleEditing(!editingNow)
        return
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a' && editingNow) {
        e.preventDefault()
        setUI({ showPanelLibrary: true })
        return
      }
      if (typing || !editingNow) return
      if (e.key === 'Escape') {
        e.preventDefault()
        toggleEditing(false)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && target?.closest('.ws-panel-title') == null) {
        const selected = useWorkspaceUI.getState().selectedPanelID
        if (!selected) return
        e.preventDefault()
        store.update(id, (w) => { w.panels = G.settle(w.panels.filter((p) => p.id !== selected)) })
        setUI({ selectedPanelID: undefined })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function toggleEditing(next: boolean) {
    setWorkspaceEditing(next)
    if (!next) {
      setUI({ selectedPanelID: undefined })
      store.flush()
    }
  }

  if (!workspace) {
    return (
      <div className="empty-state ws-empty">
        <SquareDashed size={36} className="muted" aria-hidden />
        <h2 className="t-section">Workspace removed</h2>
        <p className="t-body muted">Pick another from the sidebar, or make a new one.</p>
      </div>
    )
  }

  const add = (item: TrayItem) => {
    let added: string | undefined
    store.update(id, (w) => { const next = addTrayItem(w, item); w.panels = next.panels; added = next.added })
    setUI({ selectedPanelID: added })
  }
  const addMany = (kinds: PanelKind[]) => {
    store.update(id, (w) => {
      w.panels = G.appending(kinds, w.panels, (k) => (panelPublishesLink(k) || panelConsumesLink(k) ? 1 : undefined))
    })
    setUI({ selectedPanelID: undefined })
  }

  return (
    <div className={`ws-screen${editing ? ' ws-screen-editing' : ''}`} data-testid="workspace.screen">
      <div className="ws-main">
        {workspace.panels.length === 0 && !editing ? (
          <EmptyWorkspace workspace={workspace} onAddPanel={() => { setWorkspaceEditing(true); setUI({ showPanelLibrary: true }) }} />
        ) : (
          <WorkspaceGridView workspace={workspace} editing={editing} initialWidth={initialWidth}
            onUpdate={(mutate) => store.update(id, mutate)} />
        )}
      </div>
      {editing && <PanelTray onAdd={add} />}
      {showLibrary && (
        <PanelLibrarySheet
          existing={new Set(workspace.panels.map((p) => p.kind))}
          onAdd={(kind) => add(trayPanel(kind))}
          onAddMany={addMany}
          onClose={() => setUI({ showPanelLibrary: false })}
        />
      )}
    </div>
  )
}

function EmptyWorkspace({ workspace, onAddPanel }: { workspace: Workspace; onAddPanel: () => void }) {
  const { services } = useApp()
  return (
    <div className="empty-state ws-empty">
      <LayoutDashboardIcon />
      <h2 className="t-section">An empty workspace</h2>
      <p className="t-body muted">Add the panels you want to watch together — your lineup, a stream, the Player Card — and arrange them your way.</p>
      <div className="ws-empty-actions">
        <button type="button" className="button primary" onClick={onAddPanel}>
          <SquarePlus size={16} aria-hidden /> Add a panel
        </button>
        <Menu title="Start from a preset" className="button" align="start" label={<>Start from a preset</>}>
          {(close) => ALL_PRESETS.map((preset) => {
            const Icon = symbolIcon(preset.icon)
            return (
              <MenuItem key={preset.id} icon={<Icon size={15} />} onSelect={() => {
                close()
                services.workspaces.update(workspace.id, (w) => { w.panels = preset.panels(); w.presetID = preset.id })
              }}>
                {preset.name}
              </MenuItem>
            )
          })}
        </Menu>
      </div>
    </div>
  )
}

const LayoutDashboardIcon = () => <LayoutGrid size={36} className="muted" aria-hidden />

/**
 * The workspace's toolbar: Add panel while unlocked, the lock, and the
 * Workspace menu — Swift's `toolbar(_:)`.
 */
export function WorkspaceToolbar({ id }: { id: string }) {
  const { services } = useApp()
  const store = useModel(services.workspaces)
  const workspace = store.workspace(id)
  const editing = useWorkspaceEditing()
  const { setWorkspaceEditing, openWorkspace, forgetWorkspace } = useNavigation()
  const setUI = useLive(useWorkspaceUI, (s) => s.set)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (!workspace) return null
  const preset = workspace.presetID ? presetById(workspace.presetID) : undefined

  const toggle = () => {
    const next = !editing
    setWorkspaceEditing(next)
    if (!next) {
      setUI({ selectedPanelID: undefined })
      store.flush()
    }
  }

  return (
    <div className="ws-toolbar">
      {editing && (
        <button type="button" className="ws-tool" onClick={() => setUI({ showPanelLibrary: true })}
          title="Add a panel (⇧⌘A)" data-testid="workspace.addPanel">
          <SquarePlus size={16} aria-hidden /> <span>Add panel</span>
        </button>
      )}
      <button type="button" className={`ws-tool${editing ? ' ws-tool-on' : ''}`} onClick={toggle}
        title={editing ? 'Lock the layout (⌘E)' : 'Unlock to move, resize and add panels (⌘E)'} aria-pressed={editing}
        data-testid="workspace.edit">
        {editing ? <LockOpen size={16} aria-hidden /> : <Lock size={16} aria-hidden />}
        <span>{editing ? 'Done' : 'Edit layout'}</span>
      </button>
      <Menu title="Workspace" label={<Ellipsis size={18} aria-hidden />}>
        {(close) => (
          <>
            <MenuItem icon={<LayoutDashboard size={15} />} disabled={workspace.panels.length === 0}
              onSelect={() => { close(); store.update(id, (w) => { w.panels = G.compacted(w.panels) }) }}>
              Tidy up
            </MenuItem>
            {preset && (
              <MenuItem icon={<RotateCcw size={15} />} onSelect={() => { close(); store.resetToPreset(id) }}>
                {`Reset to “${preset.name}” layout`}
              </MenuItem>
            )}
            <MenuDivider />
            <MenuItem icon={<Pencil size={15} />} onSelect={() => { close(); setRenaming(true) }}>Rename…</MenuItem>
            <MenuSection title="Icon">
              <div className="ws-icon-grid">
                {WORKSPACE_ICONS.map((icon) => {
                  const Icon = symbolIcon(icon)
                  const current = icon === workspace.icon
                  return (
                    <button key={icon} type="button" role="menuitemradio" aria-checked={current}
                      aria-label={current ? `Current: ${icon}` : icon} title={current ? 'Current' : undefined}
                      className={`ws-icon-choice${current ? ' ws-icon-choice-on' : ''}`}
                      onClick={() => { store.setIcon(id, icon); close() }}>
                      <Icon size={16} aria-hidden />
                    </button>
                  )
                })}
              </div>
            </MenuSection>
            <MenuItem icon={<Copy size={15} />} onSelect={() => {
              close()
              const copy = store.duplicate(id)
              if (copy) openWorkspace(copy.id)
            }}>
              Duplicate
            </MenuItem>
            <MenuDivider />
            <MenuItem destructive icon={<Trash2 size={15} />} onSelect={() => { close(); setDeleting(true) }}>Delete…</MenuItem>
          </>
        )}
      </Menu>
      {renaming && <RenameDialog initial={workspace.name} onRename={(name) => store.rename(id, name)} onClose={() => setRenaming(false)} />}
      {deleting && (
        <DeleteWorkspaceDialog name={workspace.name} onClose={() => setDeleting(false)}
          onDelete={() => { forgetWorkspace(id); store.delete(id) }} />
      )}
    </div>
  )
}
