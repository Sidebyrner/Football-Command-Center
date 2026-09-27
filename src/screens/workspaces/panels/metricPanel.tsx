/**
 * The Metric panel — a port of `MetricPanel` and `MetricSummaryView`
 * (Panels/MetricPanel.swift): one stat with its numbers and a chart — for the
 * clicked player, the link colour's compare list, players pinned to this
 * panel, or your roster. A board of these is a comparison dashboard of your
 * own design.
 */
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Check, CircleX, Pin, User, Users, UsersRound, type LucideIcon } from 'lucide-react'
import type { Position } from '@core/Position'
import { playerPosition } from '@data/playerIndex'
import type { LeagueContext } from '@models/league/LeagueContext'
import {
  formatMetric, METRIC, metricApplies, MINIMUM_GAMES_FOR_RANK, PLAYER_METRICS,
  type MetricSummary, type PlayerMetric, type PlayerMetricsIndex,
} from '@models/player/PlayerMetrics'
import { LINK_GROUP_COLOR, panelPlayerTapHelp, panelPlayerTapOutcome, updatePanelSettings } from '@models/workspaces/PanelEnvironment'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import { linkGroupName, type PanelSettings } from '@models/workspaces/Workspace'
import { METRIC_SCOPES, metricScopeLabel, type MetricScope } from '@models/workspaces/WorkspacePresets'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar } from '@ui/components/Player'
import { MenuButton } from '../../streams/parts'
import { usePanelEnv, type PanelProps } from './PanelEnv'
import { PanelFootnote, PanelMessage, PanelScroll } from './shared'
import { chartColor } from './chartScale'
import { Chip, METRIC_ICON, MetricChart, PickRow, shortName, TrendArrow } from './chartViews'

/** Swift `MetricScope.systemImage`, as lucide icons. */
const SCOPE_ICON: Readonly<Record<MetricScope, LucideIcon>> = { player: User, compare: Users, pinned: Pin, roster: UsersRound }

export const metricFrom = (stored: string | undefined): PlayerMetric =>
  (PLAYER_METRICS as readonly string[]).includes(stored ?? '') ? (stored as PlayerMetric) : 'fantasyPoints'
export const metricScopeFrom = (stored: string | undefined): MetricScope =>
  (METRIC_SCOPES as readonly string[]).includes(stored ?? '') ? (stored as MetricScope) : 'player'
/** Swift `Array.suffix`: the last `n`, none for n ≤ 0. */
const suffix = <T,>(xs: readonly T[], n: number): T[] => (n > 0 ? xs.slice(-n) : [])

export const pinnedFrom = (stored: string | undefined): string[] => (stored ?? '').split(',').filter((s) => s.length > 0)

export function MetricPanel({ settings, rows }: PanelProps) {
  const { services } = useApp()
  const discovery = useModel(services.discovery)
  if (discovery.metrics) return <MetricContent index={discovery.metrics} settings={settings} lastN={rows} />
  if (discovery.errorMessage && !discovery.isLoading) return <PanelMessage style="error" text={discovery.errorMessage} />
  return <PanelMessage style="loading" text="Loading…" />
}

function MetricContent({ index, settings, lastN }: { index: PlayerMetricsIndex; settings: PanelSettings; lastN: number }) {
  const { services } = useApp()
  const bus = useModel(services.linkBus)
  const env = usePanelEnv()
  const group = env.linkGroup
  const [pinSearch, setPinSearch] = useState('')
  const metric = metricFrom(settings.extra['metric'])
  const scope = metricScopeFrom(settings.extra['scope'])
  const pinned = pinnedFrom(settings.extra['pinned'])
  const update = (change: (s: PanelSettings) => void) => updatePanelSettings(env.settingsUpdate, change)
  const setPinned = (ids: string[]) => update((s) => { if (ids.length === 0) delete s.extra['pinned']; else s.extra['pinned'] = ids.join(',') })

  let ids: readonly string[]
  switch (scope) {
    case 'player': { const id = bus.selection(group)?.playerID; ids = id ? [id] : []; break }
    case 'compare': ids = bus.compareList(group); break
    case 'pinned': ids = pinned; break
    case 'roster': ids = index.rosterPlayers(metric); break
  }

  const colour = group !== undefined ? linkGroupName(group).toLowerCase() : 'linked'
  const message = (text: string) => <div className="chart-message short">{text}</div>
  let body: ReactNode
  if (ids.length === 0) {
    switch (scope) {
      case 'player':
        body = group === undefined
          ? message('Pick a link colour on this panel, then click a player in a panel of the same colour.')
          : message(`Click a player in any ${colour} panel.`)
        break
      case 'compare': body = message(`⌘-click players (or ＋ in Player search) to add them to the ${colour} compare list.`); break
      case 'pinned': body = message('Search above to pin players to this panel.'); break
      case 'roster': body = message(`None of your players has ${METRIC[metric].label.toLowerCase()} yet.`); break
    }
  } else if (ids.length === 1 && scope === 'player') {
    const id = ids[0]!
    const context = index.context
    const position = context.position(id)
    const name = context.playerName(id) ?? id
    body = (
      <>
        <div className="metric-player-line">
          <PlayerAvatar sleeperID={id} name={name} position={position} size={26} />
          <div style={{ minWidth: 0 }}>
            <div className="t-meta" style={{ fontWeight: 600 }}>{name}</div>
            <div className="t-meta muted">{[position, context.nflTeam(id)].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <MetricSummaryView index={index} playerID={id} metric={metric} lastN={lastN} tint={group !== undefined ? LINK_GROUP_COLOR[group] : 'var(--accent)'} />
      </>
    )
  } else {
    body = <Several ids={ids} index={index} metric={metric} lastN={lastN} pinnedScope={scope === 'pinned'}
      onUnpin={(id) => setPinned(pinned.filter((p) => p !== id))} />
  }

  return (
    <div className="chart-panel">
      <div className="trend-controls">
        <span title="Which stat">
          <MenuButton
            className="chart-chip-button" align="start" ariaLabel={`Which stat: ${METRIC[metric].label}`}
            label={<Chip icon={METRIC_ICON[metric]} text={METRIC[metric].label} />}
            entries={PLAYER_METRICS.map((option) => ({
              kind: 'item' as const, label: METRIC[option].label, icon: option === metric ? Check : METRIC_ICON[option],
              onSelect: () => update((s) => { s.extra['metric'] = option }),
            }))}
          />
        </span>
        <span title="Whose numbers">
          <MenuButton
            className="chart-chip-button" align="start" ariaLabel={`Whose numbers: ${metricScopeLabel(scope)}`}
            label={<Chip icon={SCOPE_ICON[scope]} text={metricScopeLabel(scope)} />}
            entries={METRIC_SCOPES.map((option) => ({
              kind: 'item' as const, label: metricScopeLabel(option), icon: option === scope ? Check : SCOPE_ICON[option],
              onSelect: () => update((s) => { s.extra['scope'] = option }),
            }))}
          />
        </span>
      </div>
      <PanelScroll>
        {scope === 'pinned' && <PinEditor context={index.context} pinned={pinned} search={pinSearch} setSearch={setPinSearch}
          onPin={(id) => { setPinned([...pinned, id]); setPinSearch('') }} />}
        {body}
      </PanelScroll>
    </div>
  )
}

// MARK: - Several players

function Several({ ids, index, metric, lastN, pinnedScope, onUnpin }: {
  ids: readonly string[]; index: PlayerMetricsIndex; metric: PlayerMetric; lastN: number; pinnedScope: boolean; onUnpin: (id: string) => void
}) {
  const context = index.context
  const rows = ids.map((id, offset) => ({ id, name: context.playerName(id) ?? id, summary: index.summary(metric, id), color: chartColor(offset) }))
  const series = rows.map((row) => ({ id: row.id, name: row.name, color: row.color, points: suffix(index.series(metric, row.id), lastN) }))
  const avg = (r: (typeof rows)[number]) => r.summary?.seasonAverage ?? -Infinity
  const ranked = [...rows].sort((a, b) => avg(b) - avg(a))
  const fmt = (v: number) => formatMetric(metric, v)
  return (
    <>
      {series.every((s) => s.points.length === 0)
        ? <div className="chart-message short">{`No ${METRIC[metric].label.toLowerCase()} logged for these players yet.`}</div>
        : <MetricChart series={series} metric={metric} />}
      <table className="chart-table">
        <thead>
          <tr>
            <th scope="col"><span className="chart-sr-only">Player</span></th>
            <th scope="col">Avg</th><th scope="col">Last 3</th><th scope="col">Rank</th>
            {pinnedScope && <th scope="col"><span className="chart-sr-only">Unpin</span></th>}
          </tr>
        </thead>
        <tbody>
          {ranked.map((row) => (
            <tr key={row.id}>
              <th scope="row">
                <PlayerTap playerID={row.id} context={context}>
                  <span className="trend-dot small" style={{ background: row.color }} aria-hidden />
                  <span>{shortName(row.name)}</span>
                </PlayerTap>
              </th>
              <td style={{ fontWeight: 600 }}>{row.summary ? fmt(row.summary.seasonAverage) : '—'}</td>
              <td>{row.summary?.lastThreeAverage !== undefined ? fmt(row.summary.lastThreeAverage) : '—'}</td>
              <td className="muted">{row.summary?.rank !== undefined ? `#${row.summary.rank}` : '—'}</td>
              {pinnedScope && (
                <td>
                  <button type="button" className="chart-icon-button" aria-label={`Unpin ${row.name}`} onClick={() => onUnpin(row.id)}>
                    <CircleX size={14} aria-hidden />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <PanelFootnote text={`Per game this season; rank at his position among players with ${MINIMUM_GAMES_FOR_RANK}+ games. ${METRIC[metric].source}.`} />
    </>
  )
}

/** Swift `.panelPlayerTap`: follows the link, ⌘-click toggles compare, unlinked opens the Player Card. */
function PlayerTap({ playerID, context, children }: { playerID: string; context: LeagueContext; children: ReactNode }) {
  const env = usePanelEnv()
  const { openPlayerCard } = useApp()
  const onClick = (e: MouseEvent) => {
    switch (panelPlayerTapOutcome(env.linkPublish, env.compare, true, e.metaKey || e.ctrlKey)) {
      case 'toggleCompare': env.compare.toggle(playerID); break
      case 'publish': env.linkPublish.handler({ kind: 'player', playerID }); break
      case 'openCard': openPlayerCard(playerID, context); break
      case 'none': break
    }
  }
  return (
    <button type="button" className="chart-name-button chart-name-cell" onClick={onClick} title={panelPlayerTapHelp(env.linkPublish, env.compare)}>
      {children}
    </button>
  )
}

// MARK: - Pinned

function PinEditor({ context, pinned, search, setSearch, onPin }: {
  context: LeagueContext; pinned: readonly string[]; search: string; setSearch: (s: string) => void; onPin: (id: string) => void
}) {
  const full = pinned.length >= 6
  const matches = playerLookupMatches(search, context, pinned, 5)
  return (
    <div className="panel-stack" style={{ gap: 4 }}>
      <label className="compare-search" style={{ maxWidth: 'none' }}>
        <Pin size={14} color="var(--text-2)" aria-hidden />
        <input type="search" value={search} disabled={full} placeholder={full ? 'Six is the most' : 'Pin a player…'}
          aria-label="Pin a player" onChange={(e) => setSearch(e.target.value)} />
      </label>
      {matches.map((player) => {
        const position = playerPosition(player)
        return (
          <PickRow key={player.id} playerID={player.id} name={player.name} position={position}
            detail={[position, player.team].filter(Boolean).join(' · ')} icon={Pin} label={`Pin ${player.name}`} onPick={() => onPin(player.id)} />
        )
      })}
    </div>
  )
}

// MARK: - One player (Swift `MetricSummaryView`)

/** One player on one metric: the headline numbers, rank at his position, and a chart against the position average. */
export function MetricSummaryView({ index, playerID, metric, lastN = 6, tint = 'var(--accent)' }: {
  index: PlayerMetricsIndex; playerID: string; metric: PlayerMetric; lastN?: number; tint?: string
}) {
  const context = index.context
  const position = context.position(playerID)
  const message = (text: string) => <div className="chart-message short">{text}</div>
  if (!metricApplies(metric, position)) return message(`${METRIC[metric].label} doesn't apply to a ${position ?? 'player like him'}.`)
  const summary = index.summary(metric, playerID)
  if (!summary) return message(`No ${METRIC[metric].label.toLowerCase()} logged for him yet.`)
  const points = suffix(index.series(metric, playerID), lastN)
  return (
    <div className="panel-stack">
      <MetricHeadline metric={metric} summary={summary} position={position} />
      <MetricChart
        series={[{ id: playerID, name: context.playerName(playerID) ?? playerID, color: tint, points }]}
        metric={metric}
        reference={summary.positionAverage !== undefined ? { label: `${position ?? ''} avg`, value: summary.positionAverage } : undefined}
      />
      <PanelFootnote text={METRIC[metric].source + '.'} />
    </div>
  )
}

function MetricHeadline({ metric, summary, position }: { metric: PlayerMetric; summary: MetricSummary; position?: Position }) {
  const fmt = (v: number) => formatMetric(metric, v)
  const stat = (label: string, value: string) => (
    <span className="metric-stat"><span className="t-meta muted">{label}</span><b>{value}</b></span>
  )
  return (
    <div className="metric-headline">
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
          <span className="metric-big">{fmt(summary.seasonAverage)}</span>
          {METRIC[metric].unit && <span className="t-meta muted">{METRIC[metric].unit}</span>}
        </div>
        <div className="t-meta muted">{`per game · ${summary.games} game${summary.games === 1 ? '' : 's'}`}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {summary.lastGame !== undefined && summary.lastWeek !== undefined && stat(`Last game (W${summary.lastWeek})`, fmt(summary.lastGame))}
        {summary.lastThreeAverage !== undefined && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {stat('Last 3', fmt(summary.lastThreeAverage))}
            <TrendArrow value={summary.trend} dash={false} />
          </span>
        )}
      </div>
      {summary.rank !== undefined && (
        <div>
          <div className="t-body" style={{ fontWeight: 600, color: summary.rank <= Math.max(3, Math.floor(summary.rankOf / 10)) ? 'var(--start)' : 'var(--text)' }}>
            {`#${summary.rank}`}
          </div>
          <div className="t-meta muted">{`of ${summary.rankOf} ${position ?? ''}s`}</div>
        </div>
      )}
    </div>
  )
}
