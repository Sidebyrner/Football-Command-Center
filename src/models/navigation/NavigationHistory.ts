import { hubFor, hubScreens, hubTitle, segmentLabel, screenTitle, type Screen } from './screens'

/**
 * A place in the app: one of the fixed screens, or a workspace — the port of
 * `SidebarItem` (apple/…/App/AppRouter.swift).
 */
export type Place = { kind: 'screen'; screen: Screen } | { kind: 'workspace'; id: string }

export const screenPlace = (screen: Screen): Place => ({ kind: 'screen', screen })
export const workspacePlace = (id: string): Place => ({ kind: 'workspace', id })

export function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'screen' && b.kind === 'screen') return a.screen === b.screen
  if (a.kind === 'workspace' && b.kind === 'workspace') return a.id === b.id
  return false
}

const isSettings = (p: Place) => p.kind === 'screen' && p.screen === 'settings'

/**
 * Where you've been, like a browser's back and forward: every screen change —
 * a tab, a segment, a Board tile, a link — so an accidental tap is always one
 * step from undone. A port of `NavigationHistory.swift`; immutable, so each
 * move returns a new history.
 */
export class NavigationHistory {
  /** Steps kept each way; older ones drop off. */
  static readonly capacity = 30

  private constructor(
    /** Oldest first; the last is where "back" goes. */
    readonly back: readonly Place[] = [],
    /** Oldest first; the last is where "forward" goes. */
    readonly forward: readonly Place[] = [],
  ) {}

  static empty(): NavigationHistory {
    return new NavigationHistory()
  }

  get canGoBack(): boolean { return this.back.length > 0 }
  get canGoForward(): boolean { return this.forward.length > 0 }
  get previous(): Place | undefined { return this.back[this.back.length - 1] }
  get next(): Place | undefined { return this.forward[this.forward.length - 1] }

  /**
   * A move from one place to another. Settings is never a step — it has its
   * own way back. Moving straight back to where you just were counts as going
   * back, so the trail doesn't ping-pong between two screens.
   */
  record(from: Place, to: Place): NavigationHistory {
    if (samePlace(from, to) || isSettings(from) || isSettings(to)) return this
    if (samePlace(this.previous, to)) {
      return new NavigationHistory(this.back.slice(0, -1), push(this.forward, from))
    }
    return new NavigationHistory(push(this.back, from), [])
  }

  /** One step back from `current`: where to go, and the history after it. */
  goBack(current: Place): { target: Place; history: NavigationHistory } | undefined {
    const target = this.previous
    if (!target) return undefined
    const forward = isSettings(current) ? this.forward : push(this.forward, current)
    return { target, history: new NavigationHistory(this.back.slice(0, -1), forward) }
  }

  goForward(current: Place): { target: Place; history: NavigationHistory } | undefined {
    const target = this.next
    if (!target) return undefined
    const back = isSettings(current) ? this.back : push(this.back, current)
    return { target, history: new NavigationHistory(back, this.forward.slice(0, -1)) }
  }

  /**
   * Straight back to an earlier step. `index` is into `back`; everything after
   * it, and `current`, become forward steps.
   */
  jumpBack(index: number, current: Place): { target: Place; history: NavigationHistory } | undefined {
    const target = this.back[index]
    if (!target) return undefined
    const skipped = this.back.slice(index + 1)
    let forward = isSettings(current) ? this.forward : push(this.forward, current)
    for (const item of [...skipped].reverse()) forward = push(forward, item)
    return { target, history: new NavigationHistory(this.back.slice(0, index), forward) }
  }

  /** A deleted workspace is no longer anywhere to go. */
  forget(workspaceId: string): NavigationHistory {
    const keep = (p: Place) => !(p.kind === 'workspace' && p.id === workspaceId)
    return new NavigationHistory(collapsed(this.back.filter(keep)), collapsed(this.forward.filter(keep)))
  }
}

function push(stack: readonly Place[], item: Place): Place[] {
  if (samePlace(stack[stack.length - 1], item)) return [...stack]
  const out = [...stack, item]
  return out.length > NavigationHistory.capacity ? out.slice(out.length - NavigationHistory.capacity) : out
}

/** Neighbouring duplicates left behind by a removal merge into one. */
function collapsed(items: readonly Place[]): Place[] {
  return items.reduce<Place[]>((out, item) => (samePlace(out[out.length - 1], item) ? out : [...out, item]), [])
}

/** How a step reads in the trail: "Lineup › Injuries", "Board", or a workspace's name. */
export function trailLabel(place: Place, workspaceName: (id: string) => string | undefined = () => undefined): string {
  if (place.kind === 'workspace') return workspaceName(place.id) ?? 'Workspace'
  const hub = hubFor(place.screen)
  if (hubScreens[hub].length > 1) return `${hubTitle[hub]} › ${segmentLabel(place.screen)}`
  return screenTitle[place.screen]
}

/** The short form for the back pill: just the segment or screen. */
export function shortLabel(place: Place, workspaceName: (id: string) => string | undefined = () => undefined): string {
  if (place.kind === 'workspace') return workspaceName(place.id) ?? 'Workspace'
  const hub = hubFor(place.screen)
  if (hubScreens[hub].length > 1 && segmentLabel(place.screen).length <= 3) {
    return `${hubTitle[hub]} ${segmentLabel(place.screen)}`
  }
  return screenTitle[place.screen]
}
