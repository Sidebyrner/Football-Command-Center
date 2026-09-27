/**
 * The non-view parts of FCApp `Workspaces/PanelEnvironment.swift`: the actions
 * a panel is handed by its host (publish to the link group, change the
 * compare list, change its own settings), the link-group colours, and what a
 * click on a player row does. The SwiftUI environment keys, button style and
 * view modifier stay in the UI layer.
 */
import type { LinkChange } from './LinkBus'
import { defaultPanelSettings, type LinkGroup, type PanelSettings } from './Workspace'

/** Sends a click in a panel to the panel's link group. */
export interface LinkPublishAction {
  group?: LinkGroup
  handler: (change: LinkChange) => void
}

/** The environment default: unlinked, and a publish goes nowhere. */
export const NO_LINK_PUBLISH: LinkPublishAction = { group: undefined, handler: () => {} }

/** True when the panel is linked, so the click went somewhere. */
export const linkPublishIsLinked = (a: LinkPublishAction) => a.group !== undefined

/** Swift `callAsFunction`. */
export const publishLink = (a: LinkPublishAction, change: LinkChange) => a.handler(change)

/**
 * The panel's compare list: read at the moment it's needed and changed in
 * place, so rows never observe the link bus just to offer "Add to compare".
 */
export interface PanelCompareAction {
  group?: LinkGroup
  isComparing: (id: string) => boolean
  canAdd: () => boolean
  toggle: (id: string) => void
}

export const NO_PANEL_COMPARE: PanelCompareAction = {
  group: undefined, isComparing: () => false, canAdd: () => false, toggle: () => {},
}

export const panelCompareIsAvailable = (a: PanelCompareAction) => a.group !== undefined

/**
 * Lets a panel change its own options from inside — a Metric panel's metric,
 * scope and pinned players.
 */
export interface PanelSettingsUpdate {
  settings: PanelSettings
  apply: (settings: PanelSettings) => void
}

export const NO_PANEL_SETTINGS_UPDATE: PanelSettingsUpdate = { settings: defaultPanelSettings(), apply: () => {} }

/** Swift `callAsFunction`: edits a copy (Swift's value semantics) and applies it. */
export function updatePanelSettings(update: PanelSettingsUpdate, change: (next: PanelSettings) => void): void {
  const next: PanelSettings = { ...update.settings, extra: { ...update.settings.extra } }
  change(next)
  update.apply(next)
}

/** Swift `LinkGroup.color`, as the hex the `Color(hex:)` calls use. */
export const LINK_GROUP_COLOR: Readonly<Record<LinkGroup, string>> = {
  1: '#3B82F6',
  2: '#F59E0B',
  3: '#10B981',
  4: '#A855F7',
}

/**
 * What a click on a player row does (Swift `PanelPlayerTap`): toggle compare
 * on ⌘-click when the panel compares, follow the link when the panel has a
 * colour, open the Player Card when it doesn't — so a row always does
 * something. `none` only when there's no league to open the card in.
 */
export type PanelPlayerTapOutcome = 'toggleCompare' | 'publish' | 'openCard' | 'none'

export function panelPlayerTapOutcome(
  publish: LinkPublishAction, compare: PanelCompareAction, hasContext: boolean, commandHeld: boolean,
): PanelPlayerTapOutcome {
  if (panelCompareIsAvailable(compare) && commandHeld) return 'toggleCompare'
  if (linkPublishIsLinked(publish)) return 'publish'
  if (hasContext) return 'openCard'
  return 'none'
}

/** The row's tooltip. */
export function panelPlayerTapHelp(publish: LinkPublishAction, compare: PanelCompareAction): string {
  return linkPublishIsLinked(publish)
    ? (panelCompareIsAvailable(compare) ? 'Show in linked panels · ⌘-click to compare' : 'Show in linked panels')
    : 'Open Player Card'
}
