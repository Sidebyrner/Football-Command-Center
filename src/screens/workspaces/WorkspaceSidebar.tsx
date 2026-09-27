/**
 * The sidebar's Workspaces section: the user's workspaces, each one a row,
 * like a saved layout tab on a trading desk — the workspace half of FCApp
 * `SidebarView.swift`. New from empty or a preset, rename, duplicate, reset,
 * delete, and reorder by dragging (or Alt+↑/↓ on a focused row).
 */
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { Ellipsis, Plus, SquareDashed, SquarePlus } from 'lucide-react'
import { ALL_PRESETS, presetById } from '@models/workspaces/WorkspacePresets'
import type { Workspace } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { useNavigation } from '@ui/shell/navigationStore'
import { DeleteWorkspaceDialog, Menu, MenuDivider, MenuItem, MenuSection, RenameDialog } from './WorkspaceUI'
import { symbolIcon } from './symbols'
import { useLive, useWorkspaceUI } from './workspaceUIStore'
import './workspaces.css'

const REORDER_TYPE = 'application/x-fcc-workspace'

export function WorkspaceSidebarSection({ currentID }: { currentID?: string }) {
  const { services } = useApp()
  const store = useModel(services.workspaces)
  const { openWorkspace, forgetWorkspace } = useNavigation()
  const setUI = useLive(useWorkspaceUI, (s) => s.set)
  const [renaming, setRenaming] = useState<Workspace>()
  const [deleting, setDeleting] = useState<Workspace>()
  const [dropAt, setDropAt] = useState<number>()
  const dragging = useRef<number | undefined>(undefined)

  const newEmpty = () => {
    const workspace = store.addEmpty()
    openWorkspace(workspace.id, { editing: true })
    setUI({ showPanelLibrary: true, selectedPanelID: undefined })
  }

  const newWorkspaceItems = (close: () => void) => (
    <>
      <MenuItem icon={<SquareDashed size={15} />} onSelect={() => { close(); newEmpty() }}>Empty workspace</MenuItem>
      <MenuSection title="From a preset">
        {ALL_PRESETS.map((preset) => {
          const Icon = symbolIcon(preset.icon)
          return (
            <MenuItem key={preset.id} icon={<Icon size={15} />} onSelect={() => {
              close()
              const workspace = store.add(preset)
              openWorkspace(workspace.id)
            }}>
              {preset.name}
            </MenuItem>
          )
        })}
      </MenuSection>
    </>
  )

  function onRowKey(e: KeyboardEvent, index: number, id: string) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = e.key === 'ArrowUp' ? index - 1 : index + 2
    if (to < 0 || to > store.workspaces.length) return
    store.move([index], to)
    // Keep focus on the moved row.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-workspace-row="${id}"]`)?.focus())
  }

  function onDragOver(e: DragEvent<HTMLElement>, index: number) {
    if (dragging.current === undefined || !e.dataTransfer.types.includes(REORDER_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1)
  }

  function onDrop(e: DragEvent<HTMLElement>) {
    const from = dragging.current
    if (from === undefined || dropAt === undefined) return
    e.preventDefault()
    store.move([from], dropAt)
    dragging.current = undefined
    setDropAt(undefined)
  }

  return (
    <div className="sidebar-group" data-testid="sidebar.workspaces">
      <div className="ws-sidebar-heading">
        <div className="t-micro muted sidebar-heading">Workspaces</div>
        <Menu title="New workspace" className="ws-icon-button ws-sidebar-add" align="start" label={<Plus size={14} strokeWidth={2.6} aria-hidden />}>
          {newWorkspaceItems}
        </Menu>
      </div>
      <div role="list" aria-label="Workspaces" onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(undefined)
      }}>
        {store.workspaces.map((workspace, index) => {
          const Icon = symbolIcon(workspace.icon)
          const on = workspace.id === currentID
          const preset = workspace.presetID ? presetById(workspace.presetID) : undefined
          return (
            <div key={workspace.id} role="listitem"
              className={`ws-sidebar-item${dropAt === index ? ' ws-drop-before' : ''}${dropAt === index + 1 && index === store.workspaces.length - 1 ? ' ws-drop-after' : ''}`}
              onDragOver={(e) => onDragOver(e, index)} onDrop={onDrop}
              onContextMenu={(e) => {
                e.preventDefault()
                e.currentTarget.querySelector<HTMLButtonElement>('.ws-row-more')?.click()
              }}>
              <button type="button" className={`sidebar-row t-body ws-sidebar-row${on ? ' sidebar-row-on' : ''}`}
                aria-current={on ? 'page' : undefined} data-workspace-row={workspace.id}
                title="Drag to reorder (or Alt+↑/↓)"
                draggable
                onDragStart={(e) => {
                  dragging.current = index
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData(REORDER_TYPE, workspace.id)
                }}
                onDragEnd={() => { dragging.current = undefined; setDropAt(undefined) }}
                onKeyDown={(e) => onRowKey(e, index, workspace.id)}
                onClick={() => openWorkspace(workspace.id)}>
                <Icon size={17} color={on ? '#fff' : 'var(--accent)'} aria-hidden />
                <span className="ws-sidebar-name">{workspace.name}</span>
              </button>
              <Menu title={`${workspace.name} options`} className="ws-icon-button ws-row-more" label={<Ellipsis size={15} aria-hidden />}>
                {(close) => (
                  <>
                    <MenuItem onSelect={() => { close(); setRenaming(workspace) }}>Rename…</MenuItem>
                    <MenuItem onSelect={() => {
                      close()
                      const copy = store.duplicate(workspace.id)
                      if (copy) openWorkspace(copy.id)
                    }}>Duplicate</MenuItem>
                    {preset && (
                      <MenuItem onSelect={() => { close(); store.resetToPreset(workspace.id) }}>{`Reset to “${preset.name}” layout`}</MenuItem>
                    )}
                    <MenuDivider />
                    <MenuItem destructive onSelect={() => { close(); setDeleting(workspace) }}>Delete…</MenuItem>
                  </>
                )}
              </Menu>
            </div>
          )
        })}
      </div>
      {store.workspaces.length === 0 && (
        <Menu title="Add a workspace" className="sidebar-row t-body muted ws-sidebar-empty" align="start"
          label={<><SquarePlus size={17} aria-hidden /> Add a workspace</>}>
          {newWorkspaceItems}
        </Menu>
      )}
      {renaming && (
        <RenameDialog initial={renaming.name} onRename={(name) => store.rename(renaming.id, name)} onClose={() => setRenaming(undefined)} />
      )}
      {deleting && (
        <DeleteWorkspaceDialog name={deleting.name} onClose={() => setDeleting(undefined)}
          onDelete={() => { forgetWorkspace(deleting.id); store.delete(deleting.id) }} />
      )}
    </div>
  )
}
