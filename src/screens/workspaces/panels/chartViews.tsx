/**
 * The chart views the Trend, Compare and Metric panels share — ports of
 * `TrendComparisonChart`, `TrendLegend`, `TrendSummaryTable`, `TrendControls`
 * (Panels/PlayerCharts.swift), `MetricChart` (Panels/MetricPanel.swift) and
 * `MetricPicker` / `MetricPickerList` (Panels/CompareCharts.swift). Swift
 * Charts becomes inline SVG drawn from `chartScale.ts`.
 */
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import type { Observable } from '@models/Observable'
import {
  ArrowDownRight, ArrowUpRight, Check, ChevronDown, Crosshair, Flag, Hand, PersonStanding, ShieldHalf,
  Sparkles, Star, Timer, User, Users, AudioWaveform, type LucideIcon,
} from 'lucide-react'
import type { Position } from '@core/Position'
import { formatMetric, METRIC, metricApplies, PLAYER_METRICS, type MetricPoint, type PlayerMetric } from '@models/player/PlayerMetrics'
import { TREND_SCOPE_LABEL, trendWeeks, type TrendComparison, type TrendScope } from '@models/player/TrendComparison'
import type { PanelSettings } from '@models/workspaces/Workspace'
import { PlayerAvatar } from '@ui/components/Player'
import { MenuButton } from '../../streams/parts'
import { StreamFormat } from '../../streams/format'
import {
  areaPath, groupedBars, labelStride, lineColor, linearScale, monotonePath, niceDomain, seriesWeeks, weekDomain, type XY,
} from './chartScale'
import '../../streams/streams.css'
import './chartPanels.css'

export const shortName = StreamFormat.shortName

// MARK: - Metric presentation (Swift `PlayerMetric.systemImage`, `.group`, `.blurb`)

export const METRIC_ICON: Readonly<Record<PlayerMetric, LucideIcon>> = {
  fantasyPoints: Star,
  snapShare: Timer,
  targets: Crosshair, targetShare: Crosshair,
  receptions: Hand, receivingYards: Hand, airYards: Hand,
  carries: PersonStanding, rushingYards: PersonStanding, yardsAfterContact: PersonStanding,
  redZoneTouches: Flag,
  expectedPoints: Sparkles,
  tackles: ShieldHalf, sacks: ShieldHalf,
}

export const METRIC_GROUPS = ['Scoring', 'Usage', 'Receiving', 'Rushing', 'Defense'] as const
export type MetricGroup = (typeof METRIC_GROUPS)[number]

export function metricGroup(m: PlayerMetric): MetricGroup {
  switch (m) {
    case 'fantasyPoints': case 'expectedPoints': return 'Scoring'
    case 'snapShare': case 'targetShare': case 'redZoneTouches': return 'Usage'
    case 'targets': case 'receptions': case 'receivingYards': case 'airYards': return 'Receiving'
    case 'carries': case 'rushingYards': case 'yardsAfterContact': return 'Rushing'
    case 'tackles': case 'sacks': return 'Defense'
  }
}

export const METRIC_BLURB: Readonly<Record<PlayerMetric, string>> = {
  fantasyPoints: "Points scored in your league's scoring",
  expectedPoints: 'What his usage should have scored',
  snapShare: "Share of his side's snaps he played",
  targetShare: "His targets over his team's",
  redZoneTouches: 'Red-zone targets plus carries',
  targets: 'Passes thrown his way',
  receptions: 'Catches',
  receivingYards: 'Yards after the catch included',
  airYards: 'How far downfield his targets were',
  carries: 'Rushing attempts',
  rushingYards: 'Yards on the ground',
  yardsAfterContact: 'Per carry, after first contact',
  tackles: 'Solo plus assisted',
  sacks: 'Quarterback takedowns',
}

// MARK: - Small parts

/** A capsule label with an icon — the controls' `chip`. */
export function Chip({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return <span className="chart-chip t-meta"><Icon size={12} aria-hidden />{text}</span>
}

/** Up or down arrow for a trend, or a dash. */
export function TrendArrow({ value, dash = true }: { value: number | undefined; dash?: boolean }) {
  if (value !== undefined && value !== 0) {
    const up = value > 0
    const Icon = up ? ArrowUpRight : ArrowDownRight
    return <Icon size={12} strokeWidth={3} color={up ? 'var(--start)' : 'var(--sit)'} aria-label={up ? 'Trending up' : 'Trending down'} />
  }
  return dash ? <span className="chart-faint">–</span> : null
}

/** A player picked from search: avatar, name, detail and a trailing icon — one button (Swift wraps `PanelPlayerRow` in a Button). */
export function PickRow({ playerID, name, position, detail, icon: Icon, label, onPick }: {
  playerID: string; name: string; position?: Position; detail: string; icon: LucideIcon; label: string; onPick: () => void
}) {
  return (
    <button type="button" className="panel-row" onClick={onPick} aria-label={label}>
      <PlayerAvatar sleeperID={playerID} name={name} position={position} size={26} />
      <span className="panel-row-main">
        <span className="panel-row-name"><span className="t-meta" style={{ fontWeight: 600 }}>{name}</span></span>
        {detail && <span className="t-micro muted panel-row-detail">{detail}</span>}
      </span>
      <Icon size={16} color="var(--accent)" aria-hidden />
    </button>
  )
}

/** The panel's width for drawing; a fixed guess until measured (and when rendered to HTML). */
function useWidth(fallback = 360) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.round(w))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

// MARK: - Line chart

export interface ChartSeries {
  id: string
  name: string
  color: string
  points: readonly MetricPoint[]
  /** Stroke width. */
  lineWidth: number
  /** Point radius. */
  radius: number
}

export interface ChartReference { label: string; value: number }

const MARGIN = { top: 16, right: 10, bottom: 20, left: 38 }

/**
 * Lines by week, points on each game, an optional soft area and dashed
 * projection for one line, and an optional reference rule.
 */
export function LineChart({ series, metric, weeks, height, area, projection, reference, label }: {
  series: readonly ChartSeries[]
  metric: PlayerMetric
  /** The x axis marks: every week any line has. */
  weeks: readonly number[]
  height: number
  area?: { color: string; points: readonly MetricPoint[] }
  projection?: { color: string; points: readonly MetricPoint[] }
  reference?: ChartReference
  label: string
}) {
  const { ref, width } = useWidth()
  const gradientID = useId().replace(/:/g, '')
  const values = [
    ...series.flatMap((s) => s.points.map((p) => p.value)),
    ...(projection?.points.map((p) => p.value) ?? []),
    ...(reference ? [reference.value] : []),
  ]
  const { domain, ticks } = niceDomain(values)
  const plotRight = Math.max(width - MARGIN.right, MARGIN.left + 10)
  const plotBottom = height - MARGIN.bottom
  const x = rounded(linearScale(weekDomain(weeks), [MARGIN.left, plotRight]))
  const y = rounded(linearScale(domain, [plotBottom, MARGIN.top]))
  const xy = (points: readonly MetricPoint[]): XY[] => points.map((p) => ({ x: x(p.week), y: y(p.value) }))
  const stride = labelStride(weeks.length, plotRight - MARGIN.left)
  const fmt = (v: number) => formatMetric(metric, v)
  return (
    <div ref={ref} className="chart-frame">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="chart-svg">
        <title>{label}</title>
        <g className="chart-grid" aria-hidden>
          {ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={MARGIN.left} x2={plotRight} y1={y(t)} y2={y(t)} />
              <text x={MARGIN.left - 5} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis-label">{fmt(t)}</text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <g key={`x${w}`}>
              <line x1={x(w)} x2={x(w)} y1={MARGIN.top} y2={plotBottom} />
              {i % stride === 0 && <text x={x(w)} y={height - 5} textAnchor="middle" className="chart-axis-label">{`W${w}`}</text>}
            </g>
          ))}
        </g>
        <g className="chart-marks" aria-hidden>
          {area && area.points.length > 0 && (
            <>
              <defs>
                <linearGradient id={gradientID} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={area.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={area.color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <path d={areaPath(xy(area.points), y(Math.max(domain[0], 0)))} fill={`url(#${gradientID})`} />
            </>
          )}
          {projection && projection.points.length > 0 && (
            <path d={monotonePath(xy(projection.points))} fill="none" stroke={projection.color} strokeOpacity={0.45}
              strokeWidth={1.5} strokeDasharray="4 3" className="chart-projection" />
          )}
          {series.map((s) => (
            <g key={s.id} className="chart-series">
              <path d={monotonePath(xy(s.points))} fill="none" stroke={s.color} strokeWidth={s.lineWidth} strokeLinecap="round" strokeLinejoin="round" />
              {s.points.map((p) => <circle key={p.week} cx={x(p.week)} cy={y(p.value)} r={s.radius} fill={s.color} />)}
            </g>
          ))}
          {reference && (
            <g className="chart-reference">
              <line x1={MARGIN.left} x2={plotRight} y1={y(reference.value)} y2={y(reference.value)} strokeDasharray="3 3" />
              <text x={MARGIN.left + 2} y={y(reference.value) - 4} className="chart-axis-label">{`${reference.label} ${fmt(reference.value)}`}</text>
            </g>
          )}
        </g>
      </svg>
      <p className="chart-sr-only">
        {series.map((s) => `${s.name}: ${s.points.map((p) => `W${p.week} ${fmt(p.value)}`).join(', ')}.`).join(' ')}
        {reference ? ` ${reference.label} ${fmt(reference.value)}.` : ''}
      </p>
    </div>
  )
}

// MARK: - Bar chart

export interface BarGroup { label: string; values: readonly (number | undefined)[] }

/** Grouped bars: one group per measure, one bar per series, a leading value axis. */
export function BarChart({ groups, colors, names, height, label, format }: {
  groups: readonly BarGroup[]
  colors: readonly string[]
  names: readonly string[]
  height: number
  label: string
  format: (v: number) => string
}) {
  const { ref, width } = useWidth()
  const values = groups.flatMap((g) => g.values.filter((v): v is number => v !== undefined))
  const { domain, ticks } = niceDomain(values)
  const plotRight = Math.max(width - MARGIN.right, MARGIN.left + 10)
  const top = 8
  const plotBottom = height - MARGIN.bottom
  const y = rounded(linearScale(domain, [plotBottom, top]))
  const slots = groupedBars(groups.length, colors.length, plotRight - MARGIN.left)
  const band = (plotRight - MARGIN.left) / Math.max(groups.length, 1)
  return (
    <div ref={ref} className="chart-frame">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="chart-svg">
        <title>{label}</title>
        <g className="chart-grid" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={plotRight} y1={y(t)} y2={y(t)} />
              <text x={MARGIN.left - 5} y={y(t)} dy="0.32em" textAnchor="end" className="chart-axis-label">{formatNumber0(t)}</text>
            </g>
          ))}
          {groups.map((g, i) => (
            <text key={g.label} x={MARGIN.left + band * (i + 0.5)} y={height - 5} textAnchor="middle" className="chart-axis-label">{g.label}</text>
          ))}
        </g>
        <g className="chart-marks" aria-hidden>
          {groups.map((g, gi) => g.values.map((v, si) => {
            if (v === undefined) return null
            const slot = slots[gi]![si]!
            const y0 = y(Math.max(domain[0], 0)), y1 = y(v)
            const h = Math.abs(y0 - y1)
            const r = Math.min(3, slot.width / 2, h)
            return <path key={`${g.label}-${si}`} className="chart-bar" fill={colors[si]} d={barPath(MARGIN.left + slot.x, Math.min(y0, y1), slot.width, h, r)} />
          }))}
        </g>
      </svg>
      <p className="chart-sr-only">
        {groups.map((g) => `${g.label}: ${g.values.map((v, i) => (v === undefined ? undefined : `${names[i]} ${format(v)}`)).filter(Boolean).join(', ')}.`).join(' ')}
      </p>
    </div>
  )
}

/** Coordinates to two decimals, for tidy SVG. */
const rounded = (scale: (v: number) => number) => (v: number) => Math.round(scale(v) * 100) / 100

const formatNumber0 = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10))

/** A bar with rounded corners (Swift `.cornerRadius(3)`). */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return ''
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// MARK: - Trend chart (Swift `TrendComparisonChart`)

/**
 * Several players' weekly trend on one chart. The clicked player's line is
 * heavier; a single player gets a soft fill and, for fantasy points, his
 * weekly projection dashed behind.
 */
export function TrendComparisonChart({ comparison, hidden = new Set(), projection, reference, height = 180 }: {
  comparison: TrendComparison
  hidden?: ReadonlySet<string>
  /** Week → projection, drawn when there's one line and the metric is points. */
  projection?: ReadonlyMap<number, number>
  reference?: ChartReference
  height?: number
}) {
  const metric = comparison.metric
  const lines = comparison.lines.filter((l) => !hidden.has(l.id) && l.points.length > 0)
  const single = lines.length === 1
  const first = single ? lines[0] : undefined
  const series: ChartSeries[] = lines.map((l) => ({
    id: l.id, name: l.name, color: lineColor(l), points: l.points,
    lineWidth: l.isFocused || single ? 3 : 2,
    radius: symbolRadius(l.isFocused || single ? 34 : 20),
  }))
  const projected = first && metric === 'fantasyPoints' && projection
    ? first.points.flatMap((p) => { const v = projection.get(p.week); return v === undefined ? [] : [{ week: p.week, value: v }] })
    : []
  return (
    <LineChart
      series={series} metric={metric} weeks={trendWeeks(comparison)} height={height}
      area={first ? { color: lineColor(first), points: first.points } : undefined}
      projection={first && projected.length ? { color: lineColor(first), points: projected } : undefined}
      reference={reference}
      label={`${METRIC[metric].label} by week for ${lines.map((l) => l.name).join(', ')}`}
    />
  )
}

/** Swift Charts' `symbolSize` is an area in points². */
export const symbolRadius = (area: number) => Math.round(Math.sqrt(area / Math.PI) * 10) / 10

// MARK: - Metric chart (Swift `MetricChart`)

export interface MetricChartSeries { id: string; name: string; color: string; points: readonly MetricPoint[] }

/** A metric by week: one line per player, with an optional reference rule (his position's average). */
export function MetricChart({ series, metric, reference, height = 150 }: {
  series: readonly MetricChartSeries[]; metric: PlayerMetric; reference?: ChartReference; height?: number
}) {
  const only = series.length === 1 ? series[0] : undefined
  return (
    <LineChart
      series={series.map((s) => ({ ...s, lineWidth: 2.5, radius: symbolRadius(24) }))}
      metric={metric} weeks={seriesWeeks(series)} height={height}
      area={only ? { color: only.color, points: only.points } : undefined}
      reference={reference}
      label={`${METRIC[metric].label} by week for ${series.map((s) => s.name).join(', ')}`}
    />
  )
}

// MARK: - Legend and summary

/** Tappable legend chips: colour, name, season average — tap to hide or show a line. */
export function TrendLegend({ comparison, hidden, onToggle }: {
  comparison: TrendComparison; hidden: ReadonlySet<string>; onToggle: (id: string) => void
}) {
  return (
    <div className="trend-legend">
      {comparison.lines.map((line) => {
        const off = hidden.has(line.id)
        const color = lineColor(line)
        return (
          <button key={line.id} type="button" className={`trend-legend-chip${off ? ' off' : ''}`} onClick={() => onToggle(line.id)}
            aria-label={`${off ? 'Show' : 'Hide'} ${line.name}`} aria-pressed={!off}>
            <span className="trend-dot" style={{ background: off ? 'transparent' : color, borderColor: color }} aria-hidden />
            <span className="t-meta trend-legend-name" style={{ fontWeight: line.isFocused ? 700 : 500 }}>{shortName(line.name)}</span>
            <span className="t-meta muted chart-num">
              {line.applies ? (line.summary ? formatMetric(comparison.metric, line.summary.seasonAverage) : '–') : 'n/a'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Season average, last 3 with the trend arrow, and rank, one row per player. */
export function TrendSummaryTable({ comparison }: { comparison: TrendComparison }) {
  const metric = comparison.metric
  const fmt = (v: number) => formatMetric(metric, v)
  const avg = (l: (typeof comparison.lines)[number]) => l.summary?.seasonAverage ?? -Infinity
  const sorted = [...comparison.lines].sort((a, b) => avg(b) - avg(a))
  return (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col"><span className="chart-sr-only">Player</span></th>
          <th scope="col">Avg</th><th scope="col">Last 3</th><th scope="col">Trend</th><th scope="col">Rank</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((line) => {
          const s = line.summary
          return (
            <tr key={line.id}>
              <th scope="row">
                <span className="chart-name-cell">
                  <span className="trend-dot small" style={{ background: lineColor(line), borderColor: lineColor(line) }} aria-hidden />
                  <span style={{ fontWeight: line.isFocused ? 700 : 500 }}>{shortName(line.name)}</span>
                </span>
              </th>
              {s ? (
                <>
                  <td style={{ fontWeight: 600 }}>{fmt(s.seasonAverage)}</td>
                  <td>{s.lastThreeAverage !== undefined ? fmt(s.lastThreeAverage) : '–'}</td>
                  <td><TrendArrow value={s.trend} /></td>
                  <td className="muted">{s.rank !== undefined ? `#${s.rank}` : '–'}</td>
                </>
              ) : (
                <>
                  <td className="chart-faint">{line.applies ? '–' : 'n/a'}</td>
                  <td /><td /><td />
                </>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// MARK: - Metric picker

/** A popover anchored under its button; closes on a click outside or Escape. */
export function Popover({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) ref.current?.querySelector<HTMLButtonElement>('button')?.focus() }, [open])
  if (!open) return null
  return (
    <>
      <div className="chart-popover-scrim" onClick={onClose} aria-hidden />
      <div ref={ref} className="card chart-popover" role="dialog" aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
        {children}
      </div>
    </>
  )
}

/** A bordered pill that reads as a control — the metric and a chevron — opening a grouped picker. */
export function MetricPicker({ selection, inUse = new Set(), positions = [], prominent = true, onPick }: {
  selection: PlayerMetric
  /** Metrics already charted elsewhere, marked in the list. */
  inUse?: ReadonlySet<PlayerMetric>
  /** Positions being compared, to mark metrics that don't apply to anyone. */
  positions?: readonly (Position | undefined)[]
  prominent?: boolean
  onPick: (metric: PlayerMetric) => void
}) {
  const [open, setOpen] = useState(false)
  const Icon = METRIC_ICON[selection]
  return (
    <span className="chart-popover-wrap">
      <button type="button" className={`metric-picker${prominent ? ' prominent' : ''}`} onClick={() => setOpen((o) => !o)}
        title="Change what this chart shows" aria-label={`Chart data: ${METRIC[selection].label}. Change`} aria-expanded={open} aria-haspopup="dialog">
        <Icon size={prominent ? 14 : 12} aria-hidden />
        <span className="metric-picker-label">{METRIC[selection].label}</span>
        <ChevronDown size={12} strokeWidth={3} style={{ opacity: 0.7 }} aria-hidden />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Chart data">
        <MetricPickerList selection={selection} inUse={inUse} positions={positions} onPick={(m) => { setOpen(false); onPick(m) }} />
      </Popover>
    </span>
  )
}

/** Every metric, grouped, with what it measures. */
export function MetricPickerList({ selection, inUse = new Set(), positions = [], onPick }: {
  selection?: PlayerMetric
  inUse?: ReadonlySet<PlayerMetric>
  positions?: readonly (Position | undefined)[]
  onPick: (metric: PlayerMetric) => void
}) {
  return (
    <div className="metric-picker-list">
      {METRIC_GROUPS.map((group) => (
        <div key={group} className="metric-picker-group" role="group" aria-label={group}>
          <div className="t-micro muted metric-picker-heading">{group.toUpperCase()}</div>
          {PLAYER_METRICS.filter((m) => metricGroup(m) === group).map((metric) => {
            const applies = positions.length === 0 || positions.some((p) => metricApplies(metric, p))
            const Icon = METRIC_ICON[metric]
            const selected = metric === selection
            return (
              <button key={metric} type="button" className={`metric-picker-row${selected ? ' selected' : ''}`}
                style={{ opacity: applies ? 1 : 0.5 }} onClick={() => onPick(metric)} aria-pressed={selected}>
                <Icon size={16} color="var(--accent)" aria-hidden style={{ flex: 'none', width: 18 }} />
                <span className="metric-picker-text">
                  <span className="t-body" style={{ fontWeight: selected ? 700 : 500 }}>{METRIC[metric].label}</span>
                  <span className="t-meta muted">{applies ? METRIC_BLURB[metric] : "Doesn't apply to these players"}</span>
                </span>
                {selected ? <Check size={16} color="var(--accent)" aria-label="Selected" />
                  : inUse.has(metric) ? <span className="t-meta chart-faint">charted</span> : null}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// MARK: - Trend controls

/** Metric, whose trend, and smoothing — the header of a trend chart. */
export function TrendControls({ metric, scope, smoothing, showsScope = true, showsSmoothing = true, onChange }: {
  metric: PlayerMetric
  scope: TrendScope
  smoothing: number
  showsScope?: boolean
  showsSmoothing?: boolean
  onChange: (change: (settings: PanelSettings) => void) => void
}) {
  const scopes: TrendScope[] = ['compare', 'player']
  return (
    <div className="trend-controls">
      <MetricPicker selection={metric} prominent={false} onPick={(option) => onChange((s) => { s.extra['metric'] = option })} />
      {showsScope && (
        <MenuButton
          className="chart-chip-button"
          align="start"
          ariaLabel={`Whose trend: ${TREND_SCOPE_LABEL[scope]}`}
          label={<Chip icon={scope === 'compare' ? Users : User} text={scope === 'compare' ? 'Compare' : 'One player'} />}
          entries={scopes.map((option) => ({
            kind: 'item' as const,
            label: TREND_SCOPE_LABEL[option],
            icon: option === scope ? Check : option === 'compare' ? Users : User,
            onSelect: () => onChange((s) => { s.extra['trendScope'] = option }),
          }))}
        />
      )}
      {showsSmoothing && (
        <button type="button" className="chart-chip-button" title="Smooth each line with a 3-game rolling average"
          aria-pressed={smoothing > 1}
          onClick={() => onChange((s) => { if (smoothing > 1) delete s.extra['smooth']; else s.extra['smooth'] = '3' })}>
          <Chip icon={AudioWaveform} text={smoothing > 1 ? '3-game avg' : 'Raw'} />
        </button>
      )}
    </div>
  )
}

// MARK: - Observing several models

/** Re-renders when any of several models changes (Player Cards in a list). */
export function useObserve(models: readonly Observable[]): void {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const key = models.length
  useEffect(() => {
    const offs = models.map((m) => m.subscribe(bump))
    return () => { for (const off of offs) off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...models])
}
