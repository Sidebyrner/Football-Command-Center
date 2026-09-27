/**
 * The Trend panel — a port of `TrendComparePanel` (Panels/PlayerCharts.swift):
 * every player being compared in this link colour, plus whoever was clicked,
 * on one chart — any metric, raw or smoothed.
 */
import { useState } from 'react'
import type { PlayerMetricsIndex } from '@models/player/PlayerMetrics'
import { METRIC } from '@models/player/PlayerMetrics'
import { buildTrend, metricStoredAs, type TrendComparison, type TrendScope } from '@models/player/TrendComparison'
import { updatePanelSettings } from '@models/workspaces/PanelEnvironment'
import { linkGroupName } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { usePanelEnv, type PanelProps } from './PanelEnv'
import { PanelFootnote, PanelMessage, PanelScroll } from './shared'
import { TrendComparisonChart, TrendControls, TrendLegend, TrendSummaryTable, useObserve, type ChartReference } from './chartViews'

export const trendScopeFrom = (stored: string | undefined): TrendScope => (stored === 'player' ? 'player' : 'compare')

/** Toggles an id in a hidden set, returning a new set. */
export function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function TrendComparePanel({ settings, rows }: PanelProps) {
  const { services } = useApp()
  const discovery = useModel(services.discovery)
  if (discovery.metrics) return <TrendContent index={discovery.metrics} settings={settings} rows={rows} />
  if (discovery.errorMessage && !discovery.isLoading) return <PanelMessage style="error" text={discovery.errorMessage} />
  return <PanelMessage style="loading" text="Loading…" />
}

function TrendContent({ index, settings, rows }: PanelProps & { index: PlayerMetricsIndex }) {
  const { services } = useApp()
  const bus = useModel(services.linkBus)
  const env = usePanelEnv()
  const group = env.linkGroup
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const metric = metricStoredAs(settings.extra['metric']) ?? 'fantasyPoints'
  const scope = trendScopeFrom(settings.extra['trendScope'])
  const smoothing = settings.extra['smooth'] === '3' ? 3 : 1
  const focused = bus.selection(group)?.playerID
  const comparison = buildTrend(index, metric, bus.compareList(group), focused, scope, rows, smoothing)

  // One player on fantasy points gets his weekly projection dashed behind.
  const only = metric === 'fantasyPoints' && comparison.lines.length === 1 ? comparison.lines[0] : undefined
  const card = only ? services.playerCard(only.id, index.context) : undefined
  useObserve(card ? [card] : [])
  const projection = new Map<number, number>()
  for (const w of card?.log ?? []) if (w.projected !== undefined && !projection.has(w.week)) projection.set(w.week, w.projected)

  const message = (text: string) => <div className="chart-message">{text}</div>
  let body
  if (group === undefined) {
    body = message('Pick a link colour on this panel, then click or ⌘-click players in panels of the same colour.')
  } else if (comparison.lines.length === 0) {
    body = message(`Click a player in any ${linkGroupName(group).toLowerCase()} panel, or ⌘-click several to compare their trends.`)
  } else if (comparison.lines.every((l) => l.points.length === 0)) {
    body = message(`No ${METRIC[metric].label.toLowerCase()} logged for ${comparison.lines.length === 1 ? 'him' : 'these players'} yet.`)
  } else {
    body = (
      <>
        <TrendComparisonChart comparison={comparison} hidden={hidden} projection={projection} reference={trendReference(comparison)} />
        <TrendLegend comparison={comparison} hidden={hidden} onToggle={(id) => setHidden((h) => toggled(h, id))} />
        <TrendSummaryTable comparison={comparison} />
        <PanelFootnote text={trendFootnote(comparison, rows, smoothing)} />
      </>
    )
  }
  return (
    <div className="chart-panel">
      <TrendControls metric={metric} scope={scope} smoothing={smoothing} onChange={(change) => updatePanelSettings(env.settingsUpdate, change)} />
      <PanelScroll>{body}</PanelScroll>
    </div>
  )
}

/** One player: his position's average as a rule. */
export function trendReference(comparison: TrendComparison): ChartReference | undefined {
  const line = comparison.lines.length === 1 ? comparison.lines[0] : undefined
  const average = line?.summary?.positionAverage
  if (!line || average === undefined) return undefined
  return { label: `${line.position ?? ''} avg`, value: average }
}

export function trendFootnote(comparison: TrendComparison, rows: number, smoothing: number): string {
  const parts = [`Last ${rows} games`]
  if (smoothing > 1) parts.push('3-game rolling average')
  if (comparison.lines.length > 1) parts.push('tap a name to hide its line')
  parts.push(METRIC[comparison.metric].source)
  return parts.join(' · ') + '.'
}
