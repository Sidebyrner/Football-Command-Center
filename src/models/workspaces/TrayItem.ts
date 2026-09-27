/**
 * Something the panel tray can put on the grid: a panel kind, or a Metric
 * panel already set to one stat — the model half of FCApp `TrayItem`
 * (Views/Workspaces/PanelTray.swift), with the panel library's groups
 * (`PanelLibrarySheet.groups`, Views/Workspaces/WorkspaceScreen.swift).
 */
import { METRIC, PLAYER_METRICS, type PlayerMetric } from '../player/PlayerMetrics'
import { panelConsumesLink, panelPublishesLink, panelSummary, panelSystemImage, panelTitle } from './PanelKind'
import {
  defaultPanelSettings, isPanelKind, makePanelPlacement,
  type GridRect, type LinkGroup, type PanelKind, type PanelPlacement,
} from './Workspace'

export type TrayItem = { kind: 'panel'; panel: PanelKind } | { kind: 'metric'; metric: PlayerMetric }

export const trayPanel = (panel: PanelKind): TrayItem => ({ kind: 'panel', panel })
export const trayMetric = (metric: PlayerMetric): TrayItem => ({ kind: 'metric', metric })

export const sameTrayItem = (a: TrayItem | undefined, b: TrayItem | undefined): boolean =>
  !!a && !!b && trayToken(a) === trayToken(b)

/** What travels in the drag, so a drop from another window still works. */
export function trayToken(item: TrayItem): string {
  return item.kind === 'panel' ? `panel:${item.panel}` : `metric:${item.metric}`
}

export function trayItemFromToken(token: string): TrayItem | undefined {
  // Swift's `split(separator: ":", maxSplits: 1)` drops empty pieces.
  const at = token.indexOf(':')
  const parts = at < 0 ? [token] : [token.slice(0, at), token.slice(at + 1)]
  const pieces = parts.filter((p) => p.length > 0)
  if (pieces.length !== 2) return undefined
  const [head, tail] = pieces as [string, string]
  switch (head) {
    case 'panel': return isPanelKind(tail) ? trayPanel(tail) : undefined
    case 'metric': return (PLAYER_METRICS as readonly string[]).includes(tail) ? trayMetric(tail as PlayerMetric) : undefined
    default: return undefined
  }
}

export function trayItemPanelKind(item: TrayItem): PanelKind {
  return item.kind === 'panel' ? item.panel : 'metric'
}

export function trayItemTitle(item: TrayItem): string {
  return item.kind === 'panel' ? panelTitle(item.panel) : METRIC[item.metric].label
}

/** FCApp `PlayerMetric.systemImage` — not carried by `PlayerMetrics.ts`. */
export const METRIC_SYSTEM_IMAGE: Readonly<Record<PlayerMetric, string>> = {
  fantasyPoints: 'star',
  snapShare: 'stopwatch',
  targets: 'scope',
  targetShare: 'scope',
  receptions: 'hand.raised',
  receivingYards: 'hand.raised',
  airYards: 'hand.raised',
  carries: 'figure.run',
  rushingYards: 'figure.run',
  yardsAfterContact: 'figure.run',
  redZoneTouches: 'flag.checkered',
  expectedPoints: 'sparkles',
  tackles: 'shield.lefthalf.filled',
  sacks: 'shield.lefthalf.filled',
}

export function trayItemSystemImage(item: TrayItem): string {
  return item.kind === 'panel' ? panelSystemImage(item.panel) : METRIC_SYSTEM_IMAGE[item.metric]
}

export function trayItemSummary(item: TrayItem): string {
  if (item.kind === 'panel') return panelSummary(item.panel)
  return `${METRIC[item.metric].label} for the clicked player — switch to your compare list or pinned players inside.`
}

/** A new panel for this item, sized by default and linked Blue when it links. */
export function trayItemPlacement(item: TrayItem, frame: GridRect): PanelPlacement {
  const kind = trayItemPanelKind(item)
  const link: LinkGroup | undefined = panelPublishesLink(kind) || panelConsumesLink(kind) ? 1 : undefined
  const settings = defaultPanelSettings()
  if (item.kind === 'metric') settings.extra = { metric: item.metric, scope: 'player' }
  return makePanelPlacement({ kind, frame, linkGroup: link, settings })
}

/** The panel library's sections, in order. */
export const PANEL_LIBRARY_GROUPS: readonly (readonly [string, readonly PanelKind[]])[] = [
  ['This week', ['lineupReadiness', 'sitStart', 'matchupScore', 'injuries']],
  ['Market', ['waiverTargets', 'tradePartners', 'qbStream', 'rbStream', 'wrStream', 'kStream', 'dstStream', 'idpStream']],
  ['Season', ['byeWeeks', 'standings', 'news']],
  ['Discovery', ['discovery', 'playerProfile', 'playerNews', 'gameLog', 'trendChart', 'schedule', 'compare']],
  ['Metrics', ['metric', 'playerSearch']],
  ['Players', ['playerCard']],
]

/** The tray's sections, in the library's order, with every metric as its own item. */
export const TRAY_SECTIONS: readonly (readonly [string, readonly TrayItem[]])[] = [
  ...PANEL_LIBRARY_GROUPS.map(([title, kinds]) => [title, kinds.map(trayPanel)] as const),
  ['One metric', PLAYER_METRICS.map(trayMetric)] as const,
]
