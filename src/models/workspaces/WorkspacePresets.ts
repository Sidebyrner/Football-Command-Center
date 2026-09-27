/**
 * Ready-made workspaces for common jobs — a port of FCApp
 * `WorkspacePresets.swift`. The library starts with all of them; "Reset to
 * preset" rebuilds one from here.
 */
import type { PlayerMetric } from '../player/PlayerMetrics'
import {
  WORKSPACE_LIBRARY_CURRENT_VERSION, makePanelPlacement, makeWorkspace,
  type LinkGroup, type PanelKind, type PanelPlacement, type Workspace, type WorkspaceLibrary,
} from './Workspace'

/** Whose numbers a Metric panel shows — FCApp `MetricScope` (Views/Workspaces/Panels/MetricPanel.swift). */
export type MetricScope = 'player' | 'compare' | 'pinned' | 'roster'

export const METRIC_SCOPES: readonly MetricScope[] = ['player', 'compare', 'pinned', 'roster']

export function metricScopeLabel(scope: MetricScope): string {
  switch (scope) {
    case 'player': return 'Clicked player'
    case 'compare': return 'Compare list'
    case 'pinned': return 'Pinned players'
    case 'roster': return 'My roster'
  }
}

export function metricScopeSystemImage(scope: MetricScope): string {
  switch (scope) {
    case 'player': return 'person'
    case 'compare': return 'person.2'
    case 'pinned': return 'pin'
    case 'roster': return 'person.3'
  }
}

export interface WorkspacePreset {
  readonly id: string
  readonly name: string
  readonly icon: string
  /** Fresh panels (fresh ids) on every call. */
  readonly panels: () => PanelPlacement[]
}

export function makePresetWorkspace(preset: WorkspacePreset): Workspace {
  return makeWorkspace({ name: preset.name, icon: preset.icon, panels: preset.panels(), presetID: preset.id })
}

function panel(
  kind: PanelKind, x: number, y: number, w: number, h: number,
  opts: { link?: LinkGroup; topN?: number; extra?: Record<string, string> } = {},
): PanelPlacement {
  const settings: PanelPlacement['settings'] = { extra: { ...(opts.extra ?? {}) } }
  if (opts.topN !== undefined) settings.topN = opts.topN
  return makePanelPlacement({ kind, frame: { x, y, w, h }, linkGroup: opts.link, settings })
}

function metric(m: PlayerMetric, x: number, y: number, w: number, h: number, scope: MetricScope = 'compare'): PanelPlacement {
  return panel('metric', x, y, w, h, { link: 1, topN: 6, extra: { metric: m, scope } })
}

/** Sunday: the score, whether the lineup is ready, and who's hurt. */
export const gameDay: WorkspacePreset = {
  id: 'game-day', name: 'Game day', icon: 'sportscourt',
  panels: () => [
    panel('matchupScore', 0, 0, 6, 3, { link: 1 }),
    panel('lineupReadiness', 6, 0, 6, 3),
    panel('sitStart', 0, 3, 6, 4, { link: 1 }),
    panel('injuries', 6, 3, 3, 4, { link: 1 }),
    panel('news', 9, 3, 3, 4),
    panel('playerCard', 0, 7, 6, 5, { link: 1 }),
    panel('standings', 6, 7, 6, 5),
  ],
}

/** Waiver day: every pickup list side by side, and a card for whoever you click. */
export const waiverTuesday: WorkspacePreset = {
  id: 'waiver-tuesday', name: 'Waiver Tuesday', icon: 'tray.and.arrow.down',
  panels: () => [
    panel('waiverTargets', 0, 0, 4, 5, { link: 1, topN: 8 }),
    panel('wrStream', 4, 0, 4, 5, { link: 1, topN: 5 }),
    panel('rbStream', 8, 0, 4, 5, { link: 1, topN: 5 }),
    panel('idpStream', 0, 5, 4, 4, { link: 1, topN: 5 }),
    panel('byeWeeks', 4, 5, 4, 2),
    panel('injuries', 4, 7, 4, 2, { link: 1 }),
    panel('playerCard', 8, 5, 4, 4, { link: 1 }),
    panel('qbStream', 0, 9, 4, 4, { link: 1, topN: 5 }),
    panel('kStream', 4, 9, 4, 4, { link: 1, topN: 5 }),
    panel('dstStream', 8, 9, 4, 4, { link: 1, topN: 5 }),
  ],
}

/** Dealing: who fits, what they're worth, and the table. */
export const tradeDesk: WorkspacePreset = {
  id: 'trade-desk', name: 'Trade desk', icon: 'arrow.triangle.swap',
  panels: () => [
    panel('tradePartners', 0, 0, 5, 6, { link: 1 }),
    panel('playerCard', 5, 0, 4, 6, { link: 1 }),
    panel('standings', 9, 0, 3, 6, { link: 1 }),
    panel('byeWeeks', 0, 6, 6, 2),
    panel('injuries', 6, 6, 6, 3, { link: 1 }),
  ],
}

/** Research: every free agent, and everything about whoever you click. */
export const discovery: WorkspacePreset = {
  id: 'discovery', name: 'Discovery', icon: 'binoculars',
  panels: () => [
    panel('discovery', 0, 0, 4, 9, { link: 1, topN: 20 }),
    panel('playerProfile', 4, 0, 4, 4, { link: 1 }),
    panel('schedule', 8, 0, 4, 4, { link: 1 }),
    panel('trendChart', 4, 4, 4, 5, { link: 1, topN: 6 }),
    panel('playerNews', 8, 4, 4, 5, { link: 1, topN: 5 }),
    panel('gameLog', 0, 9, 6, 4, { link: 1, topN: 6 }),
    panel('compare', 6, 9, 6, 4, { link: 1, topN: 6 }),
  ],
}

/** Your own comparison board: a slim search, a metric per panel, and Compare. */
export const comparisonLab: WorkspacePreset = {
  id: 'comparison-lab', name: 'Comparison lab', icon: 'chart.bar.xaxis',
  panels: () => [
    panel('playerSearch', 0, 0, 2, 10, { link: 1, topN: 12 }),
    metric('fantasyPoints', 2, 0, 5, 4),
    metric('targets', 7, 0, 5, 4),
    metric('snapShare', 2, 4, 5, 3),
    metric('expectedPoints', 7, 4, 5, 3),
    panel('compare', 2, 7, 10, 5, { link: 1, topN: 6 }),
  ],
}

export const ALL_PRESETS: readonly WorkspacePreset[] = [gameDay, waiverTuesday, tradeDesk, discovery, comparisonLab]

export function presetById(id: string): WorkspacePreset | undefined {
  return ALL_PRESETS.find((p) => p.id === id)
}

export function defaultLibrary(): WorkspaceLibrary {
  return { version: WORKSPACE_LIBRARY_CURRENT_VERSION, workspaces: ALL_PRESETS.map(makePresetWorkspace) }
}
