import { create } from 'zustand'
import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Router } from '@models/navigation/Router'
import { samePlace, screenPlace, type Place } from '@models/navigation/NavigationHistory'
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

function pathForPlace(place: Place): string {
  return place.kind === 'screen' ? pathFor(place.screen) : `/workspaces/${place.id}`
}

/** Keeps the store in step with the URL. Mount once, inside the router. */
export function useNavigationSync(): Screen | undefined {
  const { pathname } = useLocation()
  const screen = screenForPath(pathname)
  useEffect(() => {
    if (!screen) return
    const { router, started, set } = useNavigationStore.getState()
    const place = screenPlace(screen)
    // The page you land on (a link, a bookmark, a reload) starts the trail;
    // nothing before it is somewhere you've been.
    if (!started) set(Router.at(place))
    else if (!samePlace(router.selection, place)) set(router.go(place))
  }, [screen])
  return screen
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
  }
}
