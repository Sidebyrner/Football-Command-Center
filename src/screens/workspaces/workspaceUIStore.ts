/**
 * The workspace screen's passing state — the rest of Swift `AppRouter`'s
 * workspace fields (`selectedPanelID`, `showPanelLibrary`,
 * `panelTrayExpanded`, `trayDrag`). `workspaceEditing` lives on the Router,
 * since opening a workspace changes it.
 */
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { TrayItem } from '@models/workspaces/TrayItem'

interface WorkspaceUIState {
  selectedPanelID?: string
  showPanelLibrary: boolean
  /** The panel tray beside an unlocked workspace: full, or an icon strip. */
  panelTrayExpanded: boolean
  /** What's being dragged out of the tray, so the grid can size its ghost. */
  trayDrag?: TrayItem
  set: (patch: Partial<Omit<WorkspaceUIState, 'set'>>) => void
}

export const useWorkspaceUI = create<WorkspaceUIState>((set) => ({
  selectedPanelID: undefined,
  showPanelLibrary: false,
  panelTrayExpanded: true,
  trayDrag: undefined,
  set: (patch) => set(patch),
}))

/**
 * A store's value, current on the server too — zustand's own hook renders
 * the store's initial state there, which would hide the render specs' state.
 */
export function useLive<S, T>(store: { getState: () => S; subscribe: (listener: () => void) => () => void }, selector: (state: S) => T): T {
  const read = () => selector(store.getState())
  return useSyncExternalStore(store.subscribe, read, read)
}
