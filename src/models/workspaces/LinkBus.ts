/**
 * Colour-group linking, as on a trading desk: a panel publishes a click to its
 * group, and every panel in that group that follows selections updates — a
 * port of FCApp `LinkBus.swift`.
 */
import { Observable } from '../Observable'
import type { LinkGroup } from './Workspace'

/**
 * What a link group is following. A player, a team, a week — each set
 * independently, so clicking a team in Standings doesn't clear the player.
 */
export interface LinkedSelection {
  playerID?: string
  rosterID?: number
  week?: number
}

export const sameSelection = (a: LinkedSelection | undefined, b: LinkedSelection | undefined): boolean =>
  a === b || (!!a && !!b && a.playerID === b.playerID && a.rosterID === b.rosterID && a.week === b.week)

export type LinkChange =
  | { kind: 'player'; playerID: string }
  | { kind: 'team'; rosterID: number }
  | { kind: 'week'; week: number }
  /** Adds a player to the group's compare list (at most `LinkBus.compareLimit`). */
  | { kind: 'addCompare'; playerID: string }
  | { kind: 'removeCompare'; playerID: string }
  | { kind: 'clearCompare' }

export class LinkBus extends Observable {
  static readonly compareLimit = 4

  /** Replaced, never mutated, on every change. */
  selections: ReadonlyMap<LinkGroup, LinkedSelection> = new Map()
  /** The players each group is comparing, in the order they were added. */
  compare: ReadonlyMap<LinkGroup, readonly string[]> = new Map()

  publish(change: LinkChange, group: LinkGroup): void {
    switch (change.kind) {
      case 'addCompare': {
        const list = this.compare.get(group) ?? []
        if (list.includes(change.playerID) || list.length >= LinkBus.compareLimit) return
        this.compare = withEntry(this.compare, group, [...list, change.playerID])
        this.changed()
        return
      }
      case 'removeCompare': {
        const list = this.compare.get(group)
        if (!list || !list.includes(change.playerID)) return
        const remaining = list.filter((id) => id !== change.playerID)
        this.compare = withEntry(this.compare, group, remaining.length === 0 ? undefined : remaining)
        this.changed()
        return
      }
      case 'clearCompare': {
        if (!this.compare.has(group)) return
        this.compare = withEntry(this.compare, group, undefined)
        this.changed()
        return
      }
      case 'player': case 'team': case 'week':
        break
    }
    const selection: LinkedSelection = { ...(this.selections.get(group) ?? {}) }
    switch (change.kind) {
      case 'player': selection.playerID = change.playerID; break
      case 'team': selection.rosterID = change.rosterID; break
      case 'week': selection.week = change.week; break
    }
    if (sameSelection(this.selections.get(group), selection)) return
    this.selections = withEntry(this.selections, group, selection)
    this.changed()
  }

  compareList(group: LinkGroup | undefined): readonly string[] {
    return (group === undefined ? undefined : this.compare.get(group)) ?? []
  }

  isComparing(id: string, group: LinkGroup | undefined): boolean {
    return this.compareList(group).includes(id)
  }

  canAddToCompare(group: LinkGroup | undefined): boolean {
    return group !== undefined && this.compareList(group).length < LinkBus.compareLimit
  }

  selection(group: LinkGroup | undefined): LinkedSelection | undefined {
    return group === undefined ? undefined : this.selections.get(group)
  }

  clear(group: LinkGroup): void {
    this.selections = withEntry(this.selections, group, undefined)
    this.compare = withEntry(this.compare, group, undefined)
    this.changed()
  }
}

function withEntry<V>(map: ReadonlyMap<LinkGroup, V>, key: LinkGroup, value: V | undefined): Map<LinkGroup, V> {
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}
