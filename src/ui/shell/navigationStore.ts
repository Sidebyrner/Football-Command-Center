import { create } from 'zustand'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Router } from '@models/navigation/Router'
import { samePlace, screenPlace, workspacePlace, type Place } from '@models/navigation/NavigationHistory'
import { parseUUID } from '@models/workspaces/Workspace'
import { pathFor, screenForPath, type Hub, type Screen } from '@models/navigation/screens'

/**
 * The router behind the shell. The URL is the source of where you are; the
 * store keeps the history and each hub's remembered segment. A link or the
 * browser's own back button changes the URL and is recorded as a step; the
 * back pill moves the store first, so its move isn't.
 */
interface NavigationState {
  router: Router
  /** False until the first page the visitor lands on — which starts the trail. */
  started: boolean
  set: (router: Router) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  router: Router.at(screenPlace('board')),
  started: false,
  set: (router) => set({ router, started: true }),
}))

export function pathForPlace(place: Place): string {
  return place.kind === 'screen' ? pathFor(place.screen) : `/workspaces/${place.id}`
}

/** The place a path shows: a screen, or a workspace at `/workspaces/:id`. */
export function placeForPath(pathname: string): Place | undefined {
  const workspace = /^\/workspaces\/([^/]+)\/*$/.exec(pathname)
  if (workspace) {
    const raw = decodeURIComponent(workspace[1]!)
    return workspacePlace(parseUUID(raw) ?? raw)
  }
  const screen = screenForPath(pathname)
  return screen ? screenPlace(screen) : undefined
}

/** Keeps the store in step with the URL. Mount once, inside the router. */
export function useNavigationPlaceSync(): Place | undefined {
  const { pathname } = useLocation()
  const found = placeForPath(pathname)
  const key = found ? (found.kind === 'screen' ? `s:${found.screen}` : `w:${found.id}`) : ''
  useEffect(() => {
    const place = placeForPath(pathname)
    if (!place) return
    const { router, started, set } = useNavigationStore.getState()
    // The page you land on (a link, a bookmark, a reload) starts the trail;
    // nothing before it is somewhere you've been.
    if (!started) set(Router.at(place))
    else if (!samePlace(router.selection, place)) set(router.go(place))
  }, [key])
  return found
}

/** The screen the URL shows; `undefined` on a workspace. */
export function useNavigationSync(): Screen | undefined {
  const place = useNavigationPlaceSync()
  return place?.kind === 'screen' ? place.screen : undefined
}

/** Moves: open a screen, pick a tab, go back or forward through the trail. */
export function useNavigation() {
  const navigate = useNavigate()
  const router = useNavigationStore((s) => s.router)
  const set = useNavigationStore((s) => s.set)

  const restore = useCallback(
    (next: Router) => {
      if (next === router) return
      set(next)
      navigate(pathForPlace(next.selection))
    },
    [router, set, navigate],
  )

  return {
    router,
    open: useCallback((screen: Screen) => navigate(pathFor(screen)), [navigate]),
    selectHub: useCallback((hub: Hub) => navigate(pathFor(router.segment(hub))), [navigate, router]),
    goBack: useCallback(() => restore(router.goBack()), [restore, router]),
    goForward: useCallback(() => restore(router.goForward()), [restore, router]),
    goBackTo: useCallback((index: number) => restore(router.goBackTo(index)), [restore, router]),
    /**
     * Swift `open(workspace:)`: another workspace opens locked; the open one
     * keeps its state. `editing` unlocks it straight away (a new, empty one).
     */
    openWorkspace: useCallback((id: string, options: { editing?: boolean } = {}) => {
      const { router: current, set: save } = useNavigationStore.getState()
      let next = current.openWorkspace(id)
      if (options.editing) next = next.withWorkspaceEditing(true)
      save(next)
      navigate(pathForPlace(next.selection))
    }, [navigate]),
    setWorkspaceEditing: useCallback((editing: boolean) => {
      const { router: current, set: save } = useNavigationStore.getState()
      save(current.withWorkspaceEditing(editing))
    }, []),
    /**
     * A deleted workspace: leave it for My Team if it's open, then drop it
     * from the trail.
     */
    forgetWorkspace: useCallback((id: string) => {
      const { router: current, set: save } = useNavigationStore.getState()
      const open = current.selection.kind === 'workspace' && current.selection.id === id
      const next = (open ? current.open('dashboard') : current).forget(id)
      save(next)
      if (open) navigate(pathFor('dashboard'))
    }, [navigate]),
  }
}
