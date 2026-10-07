/**
 * The compare sheet — a port of `PhoneCompareView` (generic over a
 * `CompareSource`) built on `ComparePanel`'s header, table and ranges. The
 * same dialog answers two questions, picked with the lens: who starts this
 * week (the start tally), or who to keep and add (the rest-of-season verdict).
 * Discover feeds it the compare list; Decide feeds it an ephemeral session.
 * Its editable trend-chart grid is a desktop workspace panel and isn't ported.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Plus, SearchCheck, X } from 'lucide-react'
import { playerPosition } from '@data/playerIndex'
import type { DiscoveryModel } from '@models/market/DiscoveryModel'
import { buildStartGutCheck } from '@models/player/CompareGutCheck'
import { COMPARE_LENSES, COMPARE_LENS_LABEL, type CompareLens } from '@models/player/CompareLens'
import {
  COMPARISON_METRIC_LABEL, formatComparisonMetric, PlayerComparison, type ComparisonMetric,
} from '@models/player/PlayerComparison'
import { startPickIsFreeAgent } from '@models/player/StartVerdict'
import type { LinkBus } from '@models/workspaces/LinkBus'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import type { LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, SlidingPicker } from '@ui/components/Player'
import { LoadingPlaceholder } from '@ui/components/State'
import { StartVerdictCard } from '../lineup/StartVerdictCard'
import { CompareVerdictCard } from '../workspaces/panels/compareVerdictCard'
import { points, SearchField, shortName, useModels } from './shared'
import './market.css'

/** `ChartPalette.series` — the link colours, Blue first. */
const SERIES = ['#3b82f6', '#f97316', '#22c55e', '#a855f7']
const seriesColor = (i: number) => SERIES[i % SERIES.length]!

const trimWhitespaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

// MARK: - Source

/**
 * Whoever holds the players the dialog shows — Swift `CompareSource`:
 * Discover's compare list, or a Decide session that lives only as long as the
 * dialog.
 */
export interface CompareSource {
  ids: readonly string[]
  /** Who holds the slot being decided; Discover has none. */
  incumbentID?: string
  /** "FLEX", "WR2" — the slot being decided. */
  slotToken?: string
  canRemove(id: string): boolean
  remove(id: string): void
  /** Adds from the dialog's own search; absent when the source brings its own (Decide's hopper). */
  add?: (id: string) => void
  canAdd: boolean
  /** Empties the list; absent when the source can't be cleared. */
  clear?: () => void
}

/** Discover's compare list: the Blue link group, as the desktop panels use. */
export function linkBusCompareSource(linkBus: LinkBus, group: LinkGroup): CompareSource {
  return {
    ids: linkBus.compareList(group),
    canRemove: () => true,
    remove: (id) => linkBus.publish({ kind: 'removeCompare', playerID: id }, group),
    add: (id) => linkBus.publish({ kind: 'addCompare', playerID: id }, group),
    canAdd: linkBus.canAddToCompare(group),
    clear: () => linkBus.publish({ kind: 'clearCompare' }, group),
  }
}

// MARK: - Rows per lens (`PhoneCompareRow.rows(for:)`)

const THIS_WEEK_ROWS: readonly ComparisonMetric[] = [
  'projectedThisWeek', 'commandCenterThisWeek', 'pointsPerGame', 'formLast4', 'expectedPointsLast4',
  'impliedTeamTotal', 'floorThisWeek', 'ceilingThisWeek', 'opponentRank', 'snapShare', 'targetShare', 'redZoneTouches',
]
const REST_OF_SEASON_ROWS: readonly ComparisonMetric[] = [
  'projectedThisWeek', 'restOfSeason', 'pointsPerGame', 'expectedPointsLast4',
  'snapShare', 'targetShare', 'redZoneTouches', 'gradeScore', 'opponentRank', 'impliedTeamTotal',
]
export const compareRows = (lens: CompareLens) => (lens === 'thisWeek' ? THIS_WEEK_ROWS : REST_OF_SEASON_ROWS)

/** The phone's short row names on the this-week lens. */
const THIS_WEEK_LABEL: Partial<Record<ComparisonMetric, string>> = {
  commandCenterThisWeek: 'Command Center', formLast4: 'Last 4 pts/gm', floorThisWeek: 'Floor', ceilingThisWeek: 'Ceiling',
}
const rowLabel = (metric: ComparisonMetric, lens: CompareLens) =>
  (lens === 'thisWeek' ? THIS_WEEK_LABEL[metric] : undefined) ?? COMPARISON_METRIC_LABEL[metric]

// MARK: - Dialog

export function CompareDialog({ model, source, initialLens = 'restOfSeason', footer, onClose }: {
  model: DiscoveryModel
  source: CompareSource
  initialLens?: CompareLens
  /** Shown under the grid — Decide's free-agent hopper. */
  footer?: ReactNode
  onClose: () => void
}) {
  const { services, openPlayerCard, openScreen } = useApp()
  // The this-week numbers come from Sit/Start, Matchup and the Waiver Board.
  useModel(services.sitStart)
  useModel(services.matchup)
  useModel(services.waivers)
  const context = model.context
  const ids = source.ids
  const [search, setSearch] = useState('')
  const [lens, setLens] = useState<CompareLens>(initialLens)
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

  const thisWeek = lens === 'thisWeek'
  const decide = services.decide
  const comparison = PlayerComparison.build(cards, (id) => model.row(id), model.defense, 6, undefined,
    thisWeek ? (id) => decide.signals(id) : undefined)
  const needle = trimWhitespaces(search)
  const title = source.slotToken !== undefined ? `Decide ${source.slotToken}` : 'Compare'
  const add = source.add

  let verdict: ReactNode = null
  if (context && comparison.players.length > 0) {
    if (thisWeek) {
      const start = decide.verdict(comparison.players.map((p) => p.id), source.incumbentID, source.slotToken)
      verdict = (
        <StartVerdictCard
          verdict={start}
          gutCheck={buildStartGutCheck(comparison, start, decide.posture)}
          openWaivers={startPickIsFreeAgent(start) ? () => { onClose(); openScreen('waivers') } : undefined}
        />
      )
    } else {
      verdict = <CompareVerdictCard comparison={comparison} context={context} />
    }
  }

  return (
    <div className="mk-scrim" onClick={onClose}>
      <div className="mk-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="mk-dialog-header">
          <h2 className="t-section">{title}</h2>
          <button type="button" className="button mk-small" onClick={onClose}>Done</button>
        </header>
        {!context ? <LoadingPlaceholder label="Loading…" cards={2} /> : (
          <div className="mk-stack">
            <SlidingPicker options={COMPARE_LENSES} value={lens} onChange={setLens} label={(l) => COMPARE_LENS_LABEL[l]} ariaLabel="Question" />
            <div className="mk-compare-chips">
              {comparison.players.map((p) => (
                <div key={p.id} className="mk-compare-chip" style={{ '--tint': seriesColor(p.seriesIndex) } as CSSProperties}>
                  <button type="button" className="mk-compare-chip-main" onClick={() => openPlayerCard(p.id, context)}>
                    <PlayerAvatar sleeperID={p.id} name={p.name} position={p.position} size={24} />
                    <span>
                      <span className="t-meta" style={{ fontWeight: 600, display: 'block' }}>{p.name}</span>
                      <span className="t-meta muted">
                        {[p.position, p.team].filter(Boolean).join(' · ')}
                        {p.id === source.incumbentID && <> · <span className="compare-yours">STARTING</span></>}
                      </span>
                    </span>
                  </button>
                  {source.canRemove(p.id) && (
                    <button type="button" className="mk-icon-button" aria-label={`Remove ${p.name} from compare`} onClick={() => source.remove(p.id)}>
                      <X size={14} aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {add && (
              <div className="mk-toolbar-row">
                {source.canAdd ? (
                  <SearchField value={search} onChange={setSearch} placeholder="Add a player…" />
                ) : (
                  <span className="t-meta muted">Four is the most — remove one to add another.</span>
                )}
                <span style={{ flex: 1 }} />
                {comparison.players.length > 0 && source.clear && (
                  <button type="button" className="button mk-small" onClick={source.clear}>Clear</button>
                )}
              </div>
            )}
            {add && needle !== '' && (
              <div className="inset mk-stack-tight">
                {(() => {
                  const matches = playerLookupMatches(needle, context, ids)
                  if (matches.length === 0) return <span className="t-meta muted">{`No player matches “${needle}”.`}</span>
                  return matches.map((player) => (
                    <button key={player.id} type="button" className="mk-search-result"
                      onClick={() => { add(player.id); setSearch('') }}>
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
                {verdict}
                {!thisWeek && <CompareBars comparison={comparison} />}
                <CompareTable comparison={comparison} lens={lens} incumbentID={source.incumbentID} />
                <p className="t-meta muted" style={{ margin: 0 }}>
                  {thisWeek
                    ? 'Best on each row in green — the same numbers Sit/Start uses.'
                    : 'Best on each row in green; your players are ranked too.'}
                </p>
                {!thisWeek && <Ranges comparison={comparison} />}
              </>
            )}
            {footer}
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
function CompareTable({ comparison, lens, incumbentID }: { comparison: PlayerComparison; lens: CompareLens; incumbentID?: string }) {
  return (
    <div className="inset mk-table-scroll">
      <table className="mk-table">
        <thead>
          <tr>
            <th scope="col"><span className="mk-sr-only">Metric</span></th>
            {comparison.players.map((p) => (
              <th key={p.id} scope="col" className="t-micro">
                <span className="mk-dot" style={{ background: seriesColor(p.seriesIndex) }} aria-hidden /> {shortName(p.name)}
                {p.id === incumbentID && <span className="mk-sr-only"> (starting)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {compareRows(lens).map((metric) => {
            const values = comparison.values(metric)
            if (!values.some((v) => v !== undefined)) return null
            const best = comparison.bestIndex(metric)
            return (
              <tr key={metric}>
                <th scope="row" className="t-meta muted">{rowLabel(metric, lens)}</th>
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
