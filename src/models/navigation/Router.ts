import { NavigationHistory, samePlace, screenPlace, type Place } from './NavigationHistory'
import { hubFor, hubScreens, type Hub, type Screen } from './screens'

/**
 * Where the app is: the open place, the segment each hub was last on, and the
 * history behind the back pill — a port of `AppRouter` without its SwiftUI
 * publishing. Immutable: every move returns a new router.
 */
export class Router {
  private constructor(
    readonly selection: Place,
    /** The segment each hub was last on, so coming back to a hub returns there. */
    readonly hubSegments: Readonly<Partial<Record<Hub, Screen>>>,
    readonly history: NavigationHistory,
  ) {}

  static at(selection: Place): Router {
    return new Router(selection, remember({}, selection), NavigationHistory.empty())
  }

  /** The screen the phone shows; a workspace falls back to My Team. */
  get phoneScreen(): Screen {
    return this.selection.kind === 'screen' ? this.selection.screen : 'dashboard'
  }

  get phoneHub(): Hub {
    return hubFor(this.phoneScreen)
  }

  /** The segment a hub shows: the current screen if it's in the hub, else the one it was last on, else its first. */
  segment(hub: Hub): Screen {
    const screens = hubScreens[hub]
    if (this.selection.kind === 'screen' && screens.includes(this.selection.screen)) return this.selection.screen
    return this.hubSegments[hub] ?? screens[0]!
  }

  get canGoBack(): boolean { return this.history.canGoBack }
  get canGoForward(): boolean { return this.history.canGoForward }

  /** Any move — a link, a tile, a segment, a sidebar click — recorded as a step. */
  go(place: Place): Router {
    if (samePlace(place, this.selection)) return this
    return new Router(place, remember(this.hubSegments, place), this.history.record(this.selection, place))
  }

  open(screen: Screen): Router {
    return this.go(screenPlace(screen))
  }

  /** A tab tap: the hub's remembered segment, else its first. */
  selectHub(hub: Hub): Router {
    if (hub === this.phoneHub) return this
    return this.open(this.segment(hub))
  }

  goBack(): Router {
    const move = this.history.goBack(this.selection)
    return move ? this.restore(move.target, move.history) : this
  }

  goForward(): Router {
    const move = this.history.goForward(this.selection)
    return move ? this.restore(move.target, move.history) : this
  }

  /** Straight back to an earlier step, from the trail. `index` is into `history.back`. */
  goBackTo(index: number): Router {
    const move = this.history.jumpBack(index, this.selection)
    return move ? this.restore(move.target, move.history) : this
  }

  forget(workspaceId: string): Router {
    return new Router(this.selection, this.hubSegments, this.history.forget(workspaceId))
  }

  /** A back or forward move isn't recorded as a new step. */
  private restore(target: Place, history: NavigationHistory): Router {
    return new Router(target, remember(this.hubSegments, target), history)
  }
}

function remember(segments: Readonly<Partial<Record<Hub, Screen>>>, place: Place): Partial<Record<Hub, Screen>> {
  if (place.kind !== 'screen' || place.screen === 'settings') return { ...segments }
  return { ...segments, [hubFor(place.screen)]: place.screen }
}
