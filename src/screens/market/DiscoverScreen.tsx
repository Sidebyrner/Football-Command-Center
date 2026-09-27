/**
 * Discover — the port of `DiscoverView`: every free agent (or anyone in the
 * league), searchable and sortable, with a compare list. On the phone a row
 * pushes a player page built from desktop panels; on the web a row opens the
 * Player Card, which carries the same trends, log and news. The compare
 * sheet is a dialog over the screen.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowUpDown, Binoculars, Plus, RefreshCcw, SearchCheck, UserMinus, UserPlus, Users, X } from 'lucide-react'
import type { Position } from '@core/Position'
import { playerPosition } from '@data/playerIndex'
import { availabilityLabel, startAvailability, startBadge, type LeagueContext } from '@models/league/LeagueContext'
import {
  DISCOVERY_SORTS, discoverySortFromStorageKey, discoverySortLabel, discoverySortStorageKey, discoverySortUnit,
  type DiscoveryModel,
} from '@models/market/DiscoveryModel'
import { waiverRowValue, type WaiverRow } from '@models/market/WaiverBoardModel'
import {
  COMPARISON_METRICS, COMPARISON_METRIC_LABEL, formatComparisonMetric, PlayerComparison, type ComparisonMetric,
} from '@models/player/PlayerComparison'
import type { LinkBus } from '@models/workspaces/LinkBus'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import type { LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, SlidingPicker } from '@ui/components/Player'
import { FilterChip, ScreenHero } from '@ui/components/Screen'
import { InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { discoverValueText, InjuryBadge, points, SearchField, SelectMenu, shortName, Switch, tagBadge, useModels } from './shared'
import './market.css'

type Scope = 'freeAgents' | 'everyone'
const SCOPES: readonly Scope[] = ['freeAgents', 'everyone']
const SCOPE_LABEL: Record<Scope, string> = { freeAgents: 'Free agents', everyone: 'Everyone' }

/** The phone's comparison uses the Blue link colour's list, as the desktop panels do. */
const COMPARE_GROUP: LinkGroup = 1
/** `ChartPalette.series` — the link colours, Blue first. */
const SERIES = ['#3b82f6', '#f97316', '#22c55e', '#a855f7']
const seriesColor = (i: number) => SERIES[i % SERIES.length]!

const trimWhitespaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

export function DiscoverScreen() {
  const { services } = useApp()
  const model = useModel(services.discovery)
  const linkBus = useModel(services.linkBus)
  const [scope, setScope] = useState<Scope>('freeAgents')
  const [comparing, setComparing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const hue = 'var(--hue-market)'
  const compareCount = linkBus.compareList(COMPARE_GROUP).length

  const refresh = async () => {
    setRefreshing(true)
    try { await services.loadIfConfigured(true) } finally { setRefreshing(false) }
  }

  const toolbar = (
    <div className="mk-toolbar">
      <SearchField
        value={model.query}
        onChange={(q) => { model.query = q }}
        placeholder={scope === 'freeAgents' ? 'Free agent or team' : 'Any player'}
      />
      <div className="mk-toolbar-row">
        <SelectMenu
          value={discoverySortStorageKey(model.sort)}
          options={DISCOVERY_SORTS.map(discoverySortStorageKey)}
          label={(k) => discoverySortLabel(discoverySortFromStorageKey(k)!)}
          onChange={(k) => { const s = discoverySortFromStorageKey(k); if (s) model.sort = s }}
          ariaLabel="Sort"
          disabled={scope === 'everyone'}
          icon={<ArrowUpDown size={14} aria-hidden />}
        />
        <Switch
          label="Rival benches"
          checked={model.includeRivalBenches}
          onChange={(v) => { model.includeRivalBenches = v }}
          disabled={scope === 'everyone'}
        />
        <span style={{ flex: 1 }} />
        <button type="button" className="button mk-small" onClick={() => setComparing(true)}>
          <Users size={15} aria-hidden /> {compareCount === 0 ? 'Compare' : `Compare ${compareCount}`}
        </button>
        <button type="button" className="mk-icon-button" aria-label="Refresh" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCcw size={16} aria-hidden />
        </button>
      </div>
    </div>
  )

  let body
  if (model.context) {
    body = (
      <>
        <DiscoverHero model={model} />
        {toolbar}
        <div className="mk-stack">
          <SlidingPicker options={SCOPES} value={scope} onChange={setScope} label={(s) => SCOPE_LABEL[s]} ariaLabel="Scope" />
          {scope === 'freeAgents' && (
            <div className="mk-chips" role="group" aria-label="Position">
              <FilterChip label="All" selected={model.positionFilter === undefined} onClick={() => { model.positionFilter = undefined }} />
              {model.filterablePositions.map((p) => (
                <FilterChip key={p} label={p} selected={model.positionFilter === p}
                  onClick={() => { model.positionFilter = model.positionFilter === p ? undefined : p }} />
              ))}
            </div>
          )}
        </div>
        {scope === 'freeAgents'
          ? <FreeAgents model={model} linkBus={linkBus} />
          : <Everyone model={model} context={model.context} linkBus={linkBus} />}
      </>
    )
  } else if (model.errorMessage !== undefined && !model.isLoading) {
    body = <InlineErrorBanner message={model.errorMessage} />
  } else {
    body = <LoadingPlaceholder label="Finding players…" />
  }

  return (
    <div className="mk-screen" style={{ '--hue': hue } as CSSProperties}>
      {body}
      {comparing && <CompareDialog model={model} linkBus={linkBus} onClose={() => setComparing(false)} />}
    </div>
  )
}

/** The answer: the best free agent on the current sort, and how deep the pool is. */
function DiscoverHero({ model }: { model: DiscoveryModel }) {
  const top = model.visible[0]
  const unit = discoverySortUnit(model.sort) ?? ''
  let detail = 'Nobody at the positions your league starts.'
  if (top) {
    const where = [top.position, top.team].filter((x): x is string => x !== undefined).join(' · ')
    const v = rowValue(model, top)
    detail = v !== undefined ? `${where} · ${v} ${unit}, best by ${discoverySortLabel(model.sort).toLowerCase()}` : where
  }
  return (
    <ScreenHero
      overline="Market · Discover"
      icon={Binoculars}
      answer={top ? shortName(top.name) : 'No free agents'}
      detail={detail}
      stats={[
        { value: `${model.visible.length}`, label: 'free agents' },
        { value: `${model.filterablePositions.length}`, label: 'positions' },
      ]}
      hue="var(--hue-market)"
    />
  )
}

function rowValue(model: DiscoveryModel, row: WaiverRow): string | undefined {
  const sort = model.sort
  if (sort.kind !== 'column') return undefined
  const value = waiverRowValue(row, sort.column)
  return value === undefined ? undefined : discoverValueText(value, sort.column)
}

function FreeAgents({ model, linkBus }: { model: DiscoveryModel; linkBus: LinkBus }) {
  const { openPlayerCard } = useApp()
  const rows = model.visible.slice(0, 100)
  const context = model.context!
  return (
    <section className="mk-stack" aria-label="Free agents">
      {rows.length === 0 && (
        <p className="t-meta muted">
          {model.query === '' ? 'No free agents at the positions your league starts.' : `Nobody matches “${model.query}”.`}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="card mk-list" data-testid="discover.rows">
          {rows.map((row) => (
            <DiscoverRow
              key={row.id}
              playerID={row.id}
              name={row.name}
              position={row.position}
              detail={[row.team, row.opponent].filter((x): x is string => x !== undefined).join(' · ')}
              badge={row.injuryTag !== undefined ? tagBadge(row.injuryTag) : undefined}
              value={rowValue(model, row)}
              unit={discoverySortUnit(model.sort)}
              linkBus={linkBus}
              onOpen={() => openPlayerCard(row.id, context)}
            />
          ))}
        </ul>
      )}
      <p className="t-meta muted">
        {`${Math.min(100, model.visible.length)} of ${model.visible.length} · sorted by ${discoverySortLabel(model.sort).toLowerCase()}. Use a row’s compare button to compare.`}
      </p>
    </section>
  )
}

function Everyone({ model, context, linkBus }: { model: DiscoveryModel; context: LeagueContext; linkBus: LinkBus }) {
  const { openPlayerCard } = useApp()
  const matches = useMemo(() => playerLookupMatches(model.query, context, [], 40), [model.query, context])
  return (
    <section className="mk-stack" aria-label="Everyone">
      {trimWhitespaces(model.query) === '' ? (
        <p className="t-meta muted">Search any player in the league — rostered or not.</p>
      ) : matches.length === 0 ? (
        <p className="t-meta muted">{`Nobody matches “${model.query}”.`}</p>
      ) : null}
      {matches.length > 0 && (
        <ul className="card mk-list">
          {matches.map((player) => {
            const ppg = context.sleeperPointsPerGame(player.id)
            return (
              <DiscoverRow
                key={player.id}
                playerID={player.id}
                name={player.name}
                position={playerPosition(player)}
                detail={[player.team, availabilityLabel(context.availabilityOf(player.id))].filter((x): x is string => x !== undefined).join(' · ')}
                badge={startBadge(startAvailability(player.id, context))}
                value={ppg !== undefined ? points(ppg) : undefined}
                unit="pts/gm"
                linkBus={linkBus}
                onOpen={() => openPlayerCard(player.id, context)}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}

function DiscoverRow(props: {
  playerID: string
  name: string
  position?: Position
  detail: string
  badge?: string
  value?: string
  unit?: string
  linkBus: LinkBus
  onOpen: () => void
}) {
  const { playerID, name, position, detail, badge, value, unit, linkBus, onOpen } = props
  const comparing = linkBus.isComparing(playerID, COMPARE_GROUP)
  const canAdd = linkBus.canAddToCompare(COMPARE_GROUP)
  const toggle = () => linkBus.publish(comparing ? { kind: 'removeCompare', playerID } : { kind: 'addCompare', playerID }, COMPARE_GROUP)
  return (
    <li className="mk-row" data-testid="discover.row">
      <button type="button" className="mk-row-main" onClick={onOpen} aria-label={`${name}${position ? `, ${position}` : ''}${badge ? `, ${badge}` : ''}, ${value ?? 'no value'} ${unit ?? ''}. Open player card`}>
        <span className="mk-avatar-wrap">
          <PlayerAvatar sleeperID={playerID} name={name} position={position} size={36} />
          {comparing && <span className="mk-compare-dot" aria-hidden><Users size={10} /></span>}
        </span>
        <span className="mk-row-text">
          <span className="mk-row-title">
            <span className="mk-name">{name}</span>
            <PositionChip position={position} />
            {badge && <InjuryBadge label={badge} />}
          </span>
          <span className="t-meta muted mk-ellipsis">{detail}</span>
        </span>
        <span className="mk-row-value">
          <span className={`mk-value${value === undefined ? ' faint' : ''}`}>{value ?? '—'}</span>
          {unit && <span className="t-meta faint">{unit}</span>}
        </span>
      </button>
      <button
        type="button"
        className={`mk-icon-button${comparing ? ' on' : ''}`}
        onClick={toggle}
        disabled={!comparing && !canAdd}
        aria-pressed={comparing}
        aria-label={comparing ? `Remove ${name} from compare` : `Add ${name} to compare`}
        title={comparing ? 'Remove from compare' : 'Add to compare'}
      >
        {comparing ? <UserMinus size={17} aria-hidden /> : <UserPlus size={17} aria-hidden />}
      </button>
    </li>
  )
}

// MARK: - Compare

/**
 * The compare sheet — a port of `ComparePanel`'s header, table and ranges.
 * Its editable trend-chart grid is a desktop workspace panel and isn't ported.
 */
export function CompareDialog({ model, linkBus, onClose }: { model: DiscoveryModel; linkBus: LinkBus; onClose: () => void }) {
  const { services, openPlayerCard } = useApp()
  const context = model.context
  const ids = linkBus.compareList(COMPARE_GROUP)
  const [search, setSearch] = useState('')
  const cards = useMemo(
    () => (context ? ids.map((id) => services.playerCard(id, context)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(','), context, services],
  )
  useModels(cards)
  useEffect(() => { for (const card of cards) void card.load() }, [cards])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const comparison = PlayerComparison.build(cards, (id) => model.row(id), model.defense, 6)
  const needle = trimWhitespaces(search)
  const publish = (change: Parameters<LinkBus['publish']>[0]) => linkBus.publish(change, COMPARE_GROUP)

  return (
    <div className="mk-scrim" onClick={onClose}>
      <div className="mk-dialog" role="dialog" aria-modal="true" aria-label="Compare" onClick={(e) => e.stopPropagation()}>
        <header className="mk-dialog-header">
          <h2 className="t-section">Compare</h2>
          <button type="button" className="button mk-small" onClick={onClose}>Done</button>
        </header>
        {!context ? <LoadingPlaceholder label="Loading…" cards={2} /> : (
          <div className="mk-stack">
            <div className="mk-compare-chips">
              {comparison.players.map((p) => (
                <div key={p.id} className="mk-compare-chip" style={{ '--tint': seriesColor(p.seriesIndex) } as CSSProperties}>
                  <button type="button" className="mk-compare-chip-main" onClick={() => openPlayerCard(p.id, context)}>
                    <PlayerAvatar sleeperID={p.id} name={p.name} position={p.position} size={24} />
                    <span>
                      <span className="t-meta" style={{ fontWeight: 600, display: 'block' }}>{p.name}</span>
                      <span className="t-meta muted">{[p.position, p.team].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                  <button type="button" className="mk-icon-button" aria-label={`Remove ${p.name} from compare`} onClick={() => publish({ kind: 'removeCompare', playerID: p.id })}>
                    <X size={14} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <div className="mk-toolbar-row">
              {linkBus.canAddToCompare(COMPARE_GROUP) ? (
                <SearchField value={search} onChange={setSearch} placeholder="Add a player…" />
              ) : (
                <span className="t-meta muted">Four is the most — remove one to add another.</span>
              )}
              <span style={{ flex: 1 }} />
              {comparison.players.length > 0 && (
                <button type="button" className="button mk-small" onClick={() => publish({ kind: 'clearCompare' })}>Clear</button>
              )}
            </div>
            {needle !== '' && (
              <div className="inset mk-stack-tight">
                {(() => {
                  const matches = playerLookupMatches(needle, context, ids)
                  if (matches.length === 0) return <span className="t-meta muted">{`No player matches “${needle}”.`}</span>
                  return matches.map((player) => (
                    <button key={player.id} type="button" className="mk-search-result"
                      onClick={() => { publish({ kind: 'addCompare', playerID: player.id }); setSearch('') }}>
                      <PlayerAvatar sleeperID={player.id} name={player.name} position={playerPosition(player)} size={24} />
                      <span className="mk-row-text">
                        <span className="mk-name">{player.name}</span>
                        <span className="t-meta muted">{[playerPosition(player), player.team].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Plus size={16} color="var(--accent)" aria-hidden />
                    </button>
                  ))
                })()}
              </div>
            )}
            {comparison.players.length === 0 ? (
              <div className="mk-empty">
                <SearchCheck size={24} color={SERIES[0]} aria-hidden />
                <div className="t-meta" style={{ fontWeight: 600 }}>Compare up to four players</div>
                <div className="t-meta muted">Use the compare button on any row, or search above.</div>
              </div>
            ) : (
              <>
                <CompareBars comparison={comparison} />
                <CompareTable comparison={comparison} />
                <Ranges comparison={comparison} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const BAR_MEASURES: readonly ComparisonMetric[] = ['pointsPerGame', 'expectedPointsLast4', 'projectedThisWeek', 'restOfSeason']
const BAR_LABEL: Partial<Record<ComparisonMetric, string>> = {
  pointsPerGame: 'Pts/gm', expectedPointsLast4: 'xFP L4', projectedThisWeek: 'Proj', restOfSeason: 'RoS',
}

/** The per-game numbers that share one scale, as grouped bars. */
function CompareBars({ comparison }: { comparison: PlayerComparison }) {
  const groups = BAR_MEASURES.map((m) => ({ m, values: comparison.players.map((p) => p.values[m]) }))
    .filter((g) => g.values.some((v) => v !== undefined))
  if (groups.length === 0) return <p className="t-meta muted">No per-game numbers yet.</p>
  const top = Math.max(...groups.flatMap((g) => g.values.filter((v): v is number => v !== undefined)), 1)
  return (
    <div className="inset mk-stack-tight">
      <span className="t-meta muted" style={{ fontWeight: 600 }}>Per game</span>
      <div className="mk-bars" role="img" aria-label={`Per-game numbers for ${comparison.players.map((p) => p.name).join(', ')}`}>
        {groups.map((g) => (
          <div key={g.m} className="mk-bar-group">
            <div className="mk-bar-cols">
              {g.values.map((v, i) => (
                <span key={i} className="mk-bar" style={{ height: `${v === undefined ? 0 : Math.max(2, (v / top) * 100)}%`, background: seriesColor(i) }} />
              ))}
            </div>
            <span className="t-meta muted">{BAR_LABEL[g.m]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One row per metric, one column per player; the best value on each row picked out. */
function CompareTable({ comparison }: { comparison: PlayerComparison }) {
  return (
    <div className="inset mk-table-scroll">
      <table className="mk-table">
        <thead>
          <tr>
            <th scope="col"><span className="mk-sr-only">Metric</span></th>
            {comparison.players.map((p) => (
              <th key={p.id} scope="col" className="t-micro">
                <span className="mk-dot" style={{ background: seriesColor(p.seriesIndex) }} aria-hidden /> {shortName(p.name)}
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
                <th scope="row" className="t-meta muted">{COMPARISON_METRIC_LABEL[metric]}</th>
                {values.map((v, i) => (
                  <td key={i} className="t-meta" style={{
                    fontWeight: i === best ? 700 : 400,
                    color: i === best ? 'var(--start)' : v === undefined ? 'var(--text-2)' : 'var(--text)',
                  }}>
                    {v === undefined ? '—' : formatComparisonMetric(metric, v)}{i === best && <span className="mk-sr-only"> (best)</span>}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Ranges({ comparison }: { comparison: PlayerComparison }) {
  const top = Math.max(0, ...comparison.players.map((p) => p.ceiling ?? 0)) * 1.05 || 1
  return (
    <div className="mk-stack-tight">
      <span className="t-meta muted" style={{ fontWeight: 600 }}>Range this season</span>
      {comparison.players.map((p) => {
        if (p.floor === undefined || p.ceiling === undefined) return null
        const expected = p.expected ?? (p.floor + p.ceiling) / 2
        const pct = (x: number) => `${Math.max(0, Math.min(100, (x / top) * 100))}%`
        return (
          <div key={p.id} className="mk-range-row">
            <span className="t-meta mk-ellipsis" style={{ width: 84, fontWeight: 500 }}>{shortName(p.name)}</span>
            <span className="mk-range" role="img" aria-label={`${p.name}: worst ${points(p.floor)}, best ${points(p.ceiling)}, expected ${points(expected)}`}>
              <span className="mk-range-fill" style={{ left: pct(p.floor), width: `calc(${pct(p.ceiling)} - ${pct(p.floor)})`, background: seriesColor(p.seriesIndex) }} />
              <span className="mk-range-dot" style={{ left: pct(expected), borderColor: seriesColor(p.seriesIndex) }} />
            </span>
          </div>
        )
      })}
      <span className="t-meta muted">Worst and best game this season; the dot is this week's projection, else his average.</span>
    </div>
  )
}

