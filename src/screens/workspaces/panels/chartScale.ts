/**
 * Pure geometry for the panels' inline SVG charts — the parts of Swift
 * Charts the ports lean on: linear scales, "nice" axis ticks, the week domain
 * with half a week of room, monotone curves, and grouped-bar layout.
 */
import { LINK_GROUP_COLOR } from '@models/workspaces/PanelEnvironment'
import type { MetricPoint } from '@models/player/PlayerMetrics'
import type { TrendLine } from '@models/player/TrendComparison'

// MARK: - Palette (Swift `ChartPalette`)

/** One colour per compared player: the link colours, in order. */
export const CHART_SERIES: readonly string[] = [LINK_GROUP_COLOR[1], LINK_GROUP_COLOR[2], LINK_GROUP_COLOR[3], LINK_GROUP_COLOR[4]]

export const chartColor = (index: number) => CHART_SERIES[((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length]!

/** A clicked player who isn't in the compare list. */
export const CHART_FOCUSED = 'var(--text)'

export const lineColor = (line: Pick<TrendLine, 'compareIndex'>) =>
  line.compareIndex === undefined ? CHART_FOCUSED : chartColor(line.compareIndex)

// MARK: - Scales

export type Domain = readonly [number, number]

/** Weeks with half a week of room either side, so the first and last labels and points aren't clipped. */
export function weekDomain(weeks: readonly number[]): Domain {
  const first = weeks.length ? Math.min(...weeks) : 1
  const last = Math.max(weeks.length ? Math.max(...weeks) : 1, first)
  return [first - 0.5, last + 0.5]
}

/** Maps `domain` onto `range` linearly; a zero-width domain maps to the range's middle. */
export function linearScale(domain: Domain, range: Domain): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d1 === d0) return () => (r0 + r1) / 2
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
}

/** A 1, 2, 2.5 or 5 × 10ⁿ step giving about `count` intervals over `span`. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1
  const raw = span / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const f = raw / power
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * power
}

/**
 * The value axis: zero included (as Swift Charts does for bars and lines),
 * widened to whole steps, with the ticks on it.
 */
export function niceDomain(values: readonly number[], count = 4): { domain: Domain; ticks: number[] } {
  const finite = values.filter(Number.isFinite)
  let lo = Math.min(0, ...finite)
  let hi = Math.max(0, ...finite)
  if (lo === hi) hi = lo + 1
  const step = niceStep(hi - lo, count)
  lo = Math.floor(lo / step + 1e-9) * step
  hi = Math.ceil(hi / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step)
  return { domain: [lo, hi], ticks }
}

/** Every `k`th label so labels at least `minGap` apart fit in `width`. */
export function labelStride(count: number, width: number, minGap = 26): number {
  if (count <= 1 || width <= 0) return 1
  return Math.max(1, Math.ceil((count * minGap) / width))
}

// MARK: - Paths

export interface XY { x: number; y: number }

/**
 * A monotone cubic through the points (x ascending) — Swift Charts'
 * `.interpolationMethod(.monotone)`, the same curve as d3's `curveMonotoneX`.
 */
export function monotonePath(points: readonly XY[]): string {
  const n = points.length
  if (n === 0) return ''
  const f = (v: number) => String(Math.round(v * 100) / 100)
  if (n === 1) return `M${f(points[0]!.x)},${f(points[0]!.y)}`
  if (n === 2) return `M${f(points[0]!.x)},${f(points[0]!.y)}L${f(points[1]!.x)},${f(points[1]!.y)}`
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x)
    slope.push(dx[i]! === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx[i]!)
  }
  const tangent: number[] = [slope[0]!]
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!, b = slope[i]!
    tangent.push(a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b))
  }
  tangent.push(slope[n - 2]!)
  let d = `M${f(points[0]!.x)},${f(points[0]!.y)}`
  for (let i = 0; i < n - 1; i++) {
    const p = points[i]!, q = points[i + 1]!, h = dx[i]! / 3
    d += `C${f(p.x + h)},${f(p.y + h * tangent[i]!)},${f(q.x - h)},${f(q.y - h * tangent[i + 1]!)},${f(q.x)},${f(q.y)}`
  }
  return d
}

/** The curve closed down to `baseline` — an area fill. */
export function areaPath(points: readonly XY[], baseline: number): string {
  if (points.length === 0) return ''
  const f = (v: number) => String(Math.round(v * 100) / 100)
  const first = points[0]!, last = points[points.length - 1]!
  return `${monotonePath(points)}L${f(last.x)},${f(baseline)}L${f(first.x)},${f(baseline)}Z`
}

// MARK: - Grouped bars

export interface BarSlot { x: number; width: number }

/**
 * Bars for `count` series in each of `groups` categories across `width`:
 * each category gets an equal band, the bars share 80% of it.
 */
export function groupedBars(groups: number, count: number, width: number, inner = 0.8, gap = 2): BarSlot[][] {
  if (groups <= 0 || count <= 0) return []
  const band = width / groups
  const used = band * inner
  const bar = Math.max(1, (used - gap * (count - 1)) / count)
  return Array.from({ length: groups }, (_, g) => {
    const start = g * band + (band - used) / 2
    return Array.from({ length: count }, (_, i) => ({ x: start + i * (bar + gap), width: bar }))
  })
}

/** The weeks any of the series has, ascending. */
export const seriesWeeks = (series: readonly { points: readonly MetricPoint[] }[]) =>
  [...new Set(series.flatMap((s) => s.points.map((p) => p.week)))].sort((a, b) => a - b)
