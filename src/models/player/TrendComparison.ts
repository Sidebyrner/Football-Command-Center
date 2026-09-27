/**
 * Several players' weekly trend on one metric, overlaid on one chart — a port
 * of FCApp `TrendComparison` and `TrendChartSpec`.
 */
import type { Position } from '@core/Position'
import { metricApplies, PLAYER_METRICS, type MetricPoint, type MetricSummary, type PlayerMetric, type PlayerMetricsIndex } from './PlayerMetrics'

export interface TrendLine {
  id: string
  name: string
  position?: Position
  /** Index in the compare list — the chart colour — or none for a clicked extra. */
  compareIndex?: number
  isFocused: boolean
  /** Weeks he played, oldest first, the last N — smoothed when asked. */
  points: MetricPoint[]
  summary?: MetricSummary
  /** False when the metric doesn't apply to his position. */
  applies: boolean
}

/** The compare list plus the clicked player, or the clicked player only. */
export type TrendScope = 'compare' | 'player'
export const TREND_SCOPE_LABEL: Readonly<Record<TrendScope, string>> = { compare: 'Compare list + clicked', player: 'Clicked player only' }

export interface TrendComparison {
  metric: PlayerMetric
  lines: TrendLine[]
}

/** Every week any line has, ascending. */
export const trendWeeks = (t: TrendComparison) => [...new Set(t.lines.flatMap((l) => l.points.map((p) => p.week)))].sort((a, b) => a - b)

export function buildTrend(index: PlayerMetricsIndex, metric: PlayerMetric, compareIDs: readonly string[], focusedID: string | undefined, scope: TrendScope, lastN: number, smoothing = 1): TrendComparison {
  const ids: { id: string; compareIndex?: number }[] = scope === 'compare' ? compareIDs.map((id, i) => ({ id, compareIndex: i })) : []
  if (focusedID !== undefined && !ids.some((e) => e.id === focusedID)) ids.push({ id: focusedID })
  const context = index.context
  const lines = ids.map(({ id, compareIndex }): TrendLine => {
    const position = context.position(id)
    const applies = metricApplies(metric, position)
    const raw = applies ? index.series(metric, id) : []
    const window = raw.slice(-Math.max(lastN, 1))
    return {
      id, name: context.playerName(id) ?? id, position, compareIndex, isFocused: id === focusedID,
      points: smoothed(window, smoothing, raw),
      summary: applies ? index.summary(metric, id) : undefined,
      applies,
    }
  })
  return { metric, lines }
}

/** A rolling average looking back into the full history, so the first point is averaged too. */
export function smoothed(points: readonly MetricPoint[], window: number, history: readonly MetricPoint[]): MetricPoint[] {
  if (window <= 1) return [...points]
  return points.map((point) => {
    const upTo = history.filter((h) => h.week <= point.week).slice(-window)
    return { week: point.week, value: upTo.reduce((s, h) => s + h.value, 0) / Math.max(upTo.length, 1) }
  })
}

/** The metric a stored setting names, reading older keys. */
export function metricStoredAs(key: string | undefined): PlayerMetric | undefined {
  if (key === undefined) return undefined
  if (key === 'points') return 'fantasyPoints'
  return (PLAYER_METRICS as readonly string[]).includes(key) ? (key as PlayerMetric) : undefined
}

/** One chart on a Compare panel: a metric, raw (1) or a 3-game rolling average. */
export interface TrendChartSpec {
  metric: PlayerMetric
  smoothing: number
}

export const MAX_CHARTS = 6
export const DEFAULT_CHARTS: readonly TrendChartSpec[] = [{ metric: 'fantasyPoints', smoothing: 1 }]

/** The stored list (`metric` or `metric:3`, comma-separated); unset is the default. */
export function chartSpecsFrom(stored: string | undefined): TrendChartSpec[] {
  if (stored === undefined) return [...DEFAULT_CHARTS]
  const specs: TrendChartSpec[] = []
  for (const item of stored.split(',').filter(Boolean)) {
    const parts = item.split(':').filter(Boolean)
    const metric = metricStoredAs(parts[0])
    if (!metric) continue
    specs.push({ metric, smoothing: parts.length > 1 && parts[1] === '3' ? 3 : 1 })
  }
  return specs.slice(0, MAX_CHARTS)
}

export function encodeChartSpecs(specs: readonly TrendChartSpec[]): string {
  return specs.slice(0, MAX_CHARTS).map((s) => (s.smoothing > 1 ? `${s.metric}:${s.smoothing}` : s.metric)).join(',')
}
