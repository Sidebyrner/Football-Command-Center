/**
 * The panel registry — the port of `PanelBody`: each kind drawn from the same
 * model its full screen uses, so a panel never loads anything on its own.
 */
import type { ComponentType } from 'react'
import type { PanelKind, PanelSettings } from '@models/workspaces/Workspace'
import type { PanelProps } from './PanelEnv'
import { DiscoveryListPanel, GameLogPanel, PlayerNewsPanel, PlayerProfilePanel, PlayerSearchPanel, SchedulePanel } from './DiscoveryPanels'
import { ComparePanel, MetricPanel, TrendComparePanel } from './ChartPanels'
import { DSTStreamPanel, IDPStreamPanel, KStreamPanel, PlayerCardPanel, QBStreamPanel, RBStreamPanel, TradePartnersPanel, WaiverTargetsPanel, WRStreamPanel } from './MarketPanels'
import { ByeWeeksPanel, InjuriesPanel, LineupReadinessPanel, MatchupScorePanel, NewsPanel, SitStartPanel, StandingsPanel } from './TeamPanels'

export function defaultRows(kind: PanelKind): number {
  switch (kind) {
    case 'waiverTargets': return 8
    case 'standings': return 12
    case 'news': return 6
    case 'discovery': return 12
    case 'gameLog': case 'trendChart': case 'compare': case 'metric': return 6
    case 'playerSearch': return 12
    default: return 5
  }
}

const REGISTRY: Record<PanelKind, ComponentType<PanelProps>> = {
  lineupReadiness: LineupReadinessPanel,
  sitStart: SitStartPanel,
  matchupScore: MatchupScorePanel,
  injuries: InjuriesPanel,
  waiverTargets: WaiverTargetsPanel,
  tradePartners: TradePartnersPanel,
  byeWeeks: ByeWeeksPanel,
  idpStream: IDPStreamPanel,
  wrStream: WRStreamPanel,
  rbStream: RBStreamPanel,
  qbStream: QBStreamPanel,
  dstStream: DSTStreamPanel,
  kStream: KStreamPanel,
  news: NewsPanel,
  standings: StandingsPanel,
  playerCard: PlayerCardPanel,
  discovery: DiscoveryListPanel,
  playerProfile: PlayerProfilePanel,
  playerNews: PlayerNewsPanel,
  gameLog: GameLogPanel,
  trendChart: TrendComparePanel,
  schedule: SchedulePanel,
  compare: ComparePanel,
  metric: MetricPanel,
  playerSearch: PlayerSearchPanel,
}

export function PanelBody({ kind, settings }: { kind: PanelKind; settings: PanelSettings }) {
  const Panel = REGISTRY[kind]
  return <Panel settings={settings} rows={settings.topN ?? defaultRows(kind)} />
}
