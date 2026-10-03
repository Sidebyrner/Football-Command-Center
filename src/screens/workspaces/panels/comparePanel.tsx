/**
 * The Compare panel — a port of `ComparePanel`, `CompareBarsChart`,
 * `CompareMetricTable` (Panels/ComparePanel.swift) and `CompareChartCard`,
 * `AddChartTile`, `AdaptiveCardGrid` (Panels/CompareCharts.swift).
 *
 * Two to four players side by side: their weekly numbers on an editable grid
 * of charts, the key per-game numbers as grouped bars, a table with the best
 * value on each row picked out, and each player's range. Players come from
 * the link colour's compare list — ⌘-click a player in any panel of the same
 * colour, or search here.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Position } from '@core/Position'
import {
  ArrowLeft, ArrowRight, AudioWaveform, CircleX, Ellipsis, Loader2, PlusCircle, SearchCheck, Trash2, UsersRound,
} from 'lucide-react'
import { playerPosition } from '@data/playerIndex'
import type { LeagueContext } from '@models/league/LeagueContext'
import {
  COMPARISON_METRIC_LABEL, COMPARISON_METRICS, formatComparisonMetric, PlayerComparison, type ComparisonMetric,
} from '@models/player/PlayerComparison'
import { METRIC, type PlayerMetric } from '@models/player/PlayerMetrics'
import {
  buildTrend, chartSpecsFrom, encodeChartSpecs, MAX_CHARTS, type TrendChartSpec, type TrendComparison,
} from '@models/player/TrendComparison'
import type { LinkChange } from '@models/workspaces/LinkBus'
import { LINK_GROUP_COLOR, updatePanelSettings } from '@models/workspaces/PanelEnvironment'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import { linkGroupName, type LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar } from '@ui/components/Player'
import { MenuButton, StreamRangeBar } from '../../streams/parts'
import { usePanelEnv, type PanelProps } from './PanelEnv'
import { PanelFootnote, PanelMessage, PanelScroll } from './shared'
import { chartColor } from './chartScale'
import {
  BarChart, MetricPicker, MetricPickerList, PickRow, Popover, shortName, TrendComparisonChart, TrendLegend, useObserve,
} from './chartViews'
import { toggled } from './chartTrendPanel'
import { CompareVerdictCard } from './compareVerdictCard'

export function ComparePanel({ settings, rows }: PanelProps) {
  const { services } = useApp()
  const dashboard = useModel(services.dashboard)
  const { linkGroup } = usePanelEnv()
  if (linkGroup === undefined) {
    return <PanelMessage style="empty" text="Pick a link colour on this panel, then ⌘-click players in panels of the same colour." />
  }
  if (!dashboard.context) return <PanelMessage style="loading" text="Loading…" />
  return <CompareContent group={linkGroup} context={dashboard.context} settings={settings} rows={rows} />
}

function CompareContent({ group, context, settings, rows }: PanelProps & { group: LinkGroup; context: LeagueContext }) {
  const { services } = useApp()
  const discovery = useModel(services.discovery)
  const bus = useModel(services.linkBus)
  const env = usePanelEnv()
  const [search, setSearch] = useState('')
  /** Players hidden on every chart, from the legends. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const ids = bus.compareList(group)
  const cards = ids.map((id) => services.playerCard(id, context))
  useObserve(cards)
  const idsKey = ids.join(',')
  useEffect(() => {
    for (const card of cards) void card.load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])
  const comparison = PlayerComparison.build(cards, (id) => discovery.row(id), discovery.defense, rows)
  const publish = (change: LinkChange) => env.linkPublish.handler(change)

  // The panel's charts, in order.
  const specs = chartSpecsFrom(settings.extra['charts'])
  const edit = (change: (specs: TrendChartSpec[]) => void) => {
    const next = [...specs]
    change(next)
    updatePanelSettings(env.settingsUpdate, (s) => { s.extra['charts'] = encodeChartSpecs(next) })
  }
  const trend = (spec: TrendChartSpec): TrendComparison | undefined =>
    discovery.metrics ? buildTrend(discovery.metrics, spec.metric, ids, undefined, 'compare', rows, spec.smoothing) : undefined

  const needle = search.trim()
  return (
    <PanelScroll>
      <div className="panel-stack" style={{ gap: 6 }}>
        <div className="compare-chips">
          {comparison.players.map((player) => {
            const tint = chartColor(player.seriesIndex)
            return (
              <div key={player.id} className="compare-chip"
                style={{ background: `color-mix(in srgb, ${tint} 10%, transparent)`, borderColor: `color-mix(in srgb, ${tint} 35%, transparent)` }}>
                <button type="button" className="compare-chip-main" title="Show in linked panels" onClick={() => publish({ kind: 'player', playerID: player.id })}>
                  <span className="compare-chip-avatar" style={{ '--tint': tint } as CSSProperties}>
                    <PlayerAvatar sleeperID={player.id} name={player.name} position={player.position} size={24} />
                  </span>
                  <span className="compare-chip-text">
                    <span className="t-meta" style={{ fontWeight: 600 }}>{player.name}</span>
                    <span className="t-meta muted">
                      {[player.position, player.team].filter(Boolean).join(' · ')}
                      {player.availability?.kind === 'mine' && <span className="compare-yours"> YOURS</span>}
                    </span>
                  </span>
                </button>
                <button type="button" className="chart-icon-button" aria-label={`Remove ${player.name} from compare`}
                  onClick={() => publish({ kind: 'removeCompare', playerID: player.id })}>
                  <CircleX size={16} aria-hidden />
                </button>
              </div>
            )
          })}
        </div>
        <div className="compare-toolbar">
          {bus.canAddToCompare(group) ? (
            <label className="compare-search">
              <SearchCheck size={14} color="var(--text-2)" aria-hidden />
              <input type="search" value={search} placeholder="Add a player…" aria-label="Add a player to compare"
                onChange={(e) => setSearch(e.target.value)} />
            </label>
          ) : (
            <span className="t-meta muted">Four is the most — remove one to add another.</span>
          )}
          <span className="spacer" />
          {comparison.players.length > 0 && (
            <button type="button" className="compare-text-button" onClick={() => publish({ kind: 'clearCompare' })}>Clear</button>
          )}
        </div>
        {needle && (
          <div className="compare-results">
            <SearchResults needle={needle} context={context} excluding={ids} onPick={(id) => { publish({ kind: 'addCompare', playerID: id }); setSearch('') }} />
          </div>
        )}
      </div>
      {comparison.players.length === 0 ? (
        <div className="compare-empty">
          <UsersRound size={24} color={LINK_GROUP_COLOR[group]} aria-hidden />
          <span className="t-meta" style={{ fontWeight: 600 }}>Compare up to four players</span>
          <span className="t-meta muted">{`⌘-click players in any ${linkGroupName(group).toLowerCase()} panel (long-press on iPad), or search above.`}</span>
        </div>
      ) : (
        <>
          <CompareVerdictCard comparison={comparison} context={context} />
          <ChartGrid specs={specs} trend={trend} positions={comparison.players.map((p) => p.position)}
            hidden={hidden} onToggle={(id) => setHidden((h) => toggled(h, id))} edit={edit} />
          <div className="compare-bars-row">
            <div className="compare-block">
              <span className="compare-block-title">Per game</span>
              <CompareBarsChart comparison={comparison} />
            </div>
            <div className="compare-block compare-table-block">
              <CompareMetricTable comparison={comparison} />
            </div>
          </div>
          <CompareRanges comparison={comparison} />
        </>
      )}
    </PanelScroll>
  )
}

/** Search matches, or "No player matches". */
function SearchResults({ needle, context, excluding, onPick }: {
  needle: string; context: LeagueContext; excluding: readonly string[]; onPick: (id: string) => void
}) {
  const matches = playerLookupMatches(needle, context, excluding)
  return (
    <>
      {matches.length === 0 && <span className="t-meta muted">{`No player matches “${needle}”.`}</span>}
      {matches.map((player) => {
        const position = playerPosition(player)
        return (
          <PickRow key={player.id} playerID={player.id} name={player.name} position={position}
            detail={[position, player.team].filter(Boolean).join(' · ')} icon={PlusCircle}
            label={`Add ${player.name} to compare`} onPick={() => onPick(player.id)} />
        )
      })}
    </>
  )
}

// MARK: - Charts

/** The panel's charts, each with its own data picker, then a tile to add another. */
function ChartGrid({ specs, trend, positions, hidden, onToggle, edit }: {
  specs: readonly TrendChartSpec[]
  trend: (spec: TrendChartSpec) => TrendComparison | undefined
  positions: readonly (Position | undefined)[]
  hidden: ReadonlySet<string>
  onToggle: (id: string) => void
  edit: (change: (specs: TrendChartSpec[]) => void) => void
}) {
  const inUse = new Set(specs.map((s) => s.metric))
  return (
    <AdaptiveCardGrid>
      {specs.map((spec, i) => (
        <CompareChartCard
          key={`chart-${i}`}
          spec={spec} trend={trend(spec)} inUse={inUse}
          canMoveEarlier={i > 0} canMoveLater={i < specs.length - 1}
          hidden={hidden} onToggle={onToggle}
          onChange={(next) => edit((s) => { s[i] = next })}
          onMove={(step) => edit((s) => { const a = s[i]!, b = s[i + step]!; s[i] = b; s[i + step] = a })}
          onRemove={() => edit((s) => { s.splice(i, 1) })}
        />
      ))}
      {specs.length < MAX_CHARTS && (
        <AddChartTile inUse={inUse} positions={positions} remaining={MAX_CHARTS - specs.length}
          onAdd={(metric) => edit((s) => { s.push({ metric, smoothing: 1 }) })} />
      )}
    </AdaptiveCardGrid>
  )
}

/** Cards in as many columns as fit, up to three, each at least 320px wide. */
export function AdaptiveCardGrid({ children }: { children: ReactNode }) {
  return <div className="compare-card-grid">{children}</div>
}

/** One chart in a Compare panel: its data picker up top, then the lines and a legend. Its menu smooths, moves or removes it. */
export function CompareChartCard({ spec, trend, inUse, canMoveEarlier, canMoveLater, hidden, onToggle, onChange, onMove, onRemove }: {
  spec: TrendChartSpec
  trend?: TrendComparison
  inUse: ReadonlySet<PlayerMetric>
  canMoveEarlier: boolean
  canMoveLater: boolean
  hidden: ReadonlySet<string>
  onToggle: (id: string) => void
  onChange: (next: TrendChartSpec) => void
  onMove: (step: number) => void
  onRemove: () => void
}) {
  let content
  if (!trend) {
    content = <div className="compare-card-empty"><Loader2 size={18} className="spin" color="var(--text-3)" aria-label="Loading" /></div>
  } else if (trend.lines.every((l) => l.points.length === 0)) {
    content = <div className="compare-card-empty">{`No ${METRIC[spec.metric].label.toLowerCase()} logged for these players.`}</div>
  } else {
    content = (
      <>
        <TrendComparisonChart comparison={trend} hidden={hidden} height={170} />
        <TrendLegend comparison={trend} hidden={hidden} onToggle={onToggle} />
      </>
    )
  }
  return (
    <div className="compare-block" style={{ gap: 8 }}>
      <div className="compare-card-head">
        <MetricPicker selection={spec.metric} inUse={inUse} positions={trend?.lines.map((l) => l.position) ?? []}
          onPick={(metric) => onChange({ ...spec, metric })} />
        {spec.smoothing > 1 && <span className="chart-chip t-meta muted" style={{ color: 'var(--text-2)', padding: '2px 6px' }}>3-game avg</span>}
        <span className="spacer" />
        <span title="Chart options">
          <MenuButton
            className="chart-icon-button"
            ariaLabel="Chart options"
            label={<Ellipsis size={20} aria-hidden />}
            entries={[
              { kind: 'item', label: spec.smoothing > 1 ? 'Show raw weeks' : 'Smooth (3-game average)', icon: AudioWaveform,
                onSelect: () => onChange({ ...spec, smoothing: spec.smoothing > 1 ? 1 : 3 }) },
              { kind: 'divider' },
              { kind: 'item', label: 'Move earlier', icon: ArrowLeft, disabled: !canMoveEarlier, onSelect: () => onMove(-1) },
              { kind: 'item', label: 'Move later', icon: ArrowRight, disabled: !canMoveLater, onSelect: () => onMove(1) },
              { kind: 'divider' },
              { kind: 'item', label: 'Remove chart', icon: Trash2, destructive: true, onSelect: onRemove },
            ]}
          />
        </span>
      </div>
      {content}
    </div>
  )
}

/** A dashed tile that adds a chart of whatever's picked. */
export function AddChartTile({ inUse, positions, remaining, onAdd }: {
  inUse: ReadonlySet<PlayerMetric>
  positions: readonly (Position | undefined)[]
  remaining: number
  onAdd: (metric: PlayerMetric) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <span className="chart-popover-wrap" style={{ display: 'flex' }}>
      <button type="button" className="compare-add-tile" disabled={remaining <= 0} data-testid="compare.addChart"
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <PlusCircle size={24} color="var(--accent)" aria-hidden />
        <span className="t-body" style={{ fontWeight: 600 }}>Add chart</span>
        <span className="t-meta muted">{remaining > 0 ? 'Chart another stat for these players' : 'Six charts is the most'}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Add chart">
        <MetricPickerList inUse={inUse} positions={positions} onPick={(m) => { setOpen(false); onAdd(m) }} />
      </Popover>
    </span>
  )
}

// MARK: - Per game

const BAR_MEASURES: readonly ComparisonMetric[] = ['pointsPerGame', 'expectedPointsLast4', 'projectedThisWeek', 'restOfSeason']

export function barShortLabel(metric: ComparisonMetric): string {
  switch (metric) {
    case 'pointsPerGame': return 'Pts/gm'
    case 'expectedPointsLast4': return 'xFP L4'
    case 'projectedThisWeek': return 'Proj'
    case 'restOfSeason': return 'RoS'
    default: return COMPARISON_METRIC_LABEL[metric]
  }
}

/** The per-game numbers that are on one scale, as grouped bars. */
export function CompareBarsChart({ comparison }: { comparison: PlayerComparison }) {
  const names = comparison.players.map((p) => p.name)
  const colors = comparison.players.map((p) => chartColor(p.seriesIndex))
  const groups = BAR_MEASURES
    .map((m) => ({ label: barShortLabel(m), values: comparison.players.map((p) => p.values[m]) }))
    .filter((g) => g.values.some((v) => v !== undefined))
  if (groups.length === 0) return <div className="compare-card-empty" style={{ minHeight: 150 }}>No per-game numbers yet.</div>
  return (
    <BarChart groups={groups} colors={colors} names={names} height={170}
      label={`Per-game numbers for ${names.join(', ')}`} format={(v) => formatComparisonMetric('pointsPerGame', v)} />
  )
}

/** One row per metric, one column per player; the best value on each row is picked out, respecting which direction is better. */
export function CompareMetricTable({ comparison }: { comparison: PlayerComparison }) {
  return (
    <table className="chart-table">
      <thead>
        <tr>
          <th scope="col"><span className="chart-sr-only">Metric</span></th>
          {comparison.players.map((p) => (
            <th key={p.id} scope="col">
              <span className="chart-name-cell">
                <span className="trend-dot small" style={{ background: chartColor(p.seriesIndex) }} aria-hidden />
                {shortName(p.name)}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {COMPARISON_METRICS.map((metric) => {
          const values = comparison.values(metric)
          if (!values.some((v) => v !== undefined)) return null
          const best = comparison.bestIndex(metric)
          return (
            <tr key={metric}>
              <th scope="row" className="muted" style={{ fontSize: '0.6875rem' }}>{COMPARISON_METRIC_LABEL[metric]}</th>
              {values.map((v, i) => (
                <td key={i} className={i === best ? 'best' : v === undefined ? 'muted' : undefined}>
                  {v === undefined ? '—' : formatComparisonMetric(metric, v)}
                  {i === best && <span className="chart-sr-only"> (best)</span>}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Worst and best game this season, with this week's projection (else his average) as the dot. */
function CompareRanges({ comparison }: { comparison: PlayerComparison }) {
  const ceilings = comparison.players.map((p) => p.ceiling).filter((c): c is number => c !== undefined)
  const top = (ceilings.length ? Math.max(...ceilings) : 0) * 1.05
  return (
    <div className="panel-stack">
      <span className="compare-block-title">Range this season</span>
      {comparison.players.map((player) => {
        const { floor, ceiling } = player
        if (floor === undefined || ceiling === undefined) return null
        return (
          <div key={player.id} className="compare-range-row">
            <span className="compare-range-name">{shortName(player.name)}</span>
            <StreamRangeBar floor={floor} expected={player.expected ?? (floor + ceiling) / 2} ceiling={ceiling}
              scaleMax={top} tint={chartColor(player.seriesIndex)} />
          </div>
        )
      })}
      <PanelFootnote text="Worst and best game this season; the dot is this week's projection, else his average." />
    </div>
  )
}
