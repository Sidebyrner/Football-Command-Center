/**
 * Discover — the port of `DiscoverView`: every free agent (or anyone in the
 * league), searchable and sortable, with a compare list. On the phone a row
 * pushes a player page built from desktop panels; on the web a row opens the
 * Player Card, which carries the same trends, log and news. The compare
 * sheet is a dialog over the screen.
 */
import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowUpDown, Binoculars, RefreshCcw, UserMinus, UserPlus, Users } from 'lucide-react'
import type { Position } from '@core/Position'
import { playerPosition } from '@data/playerIndex'
import { availabilityLabel, startAvailability, startBadge, type LeagueContext } from '@models/league/LeagueContext'
import {
  DISCOVERY_SORTS, discoverySortFromStorageKey, discoverySortLabel, discoverySortStorageKey, discoverySortUnit,
  type DiscoveryModel,
} from '@models/market/DiscoveryModel'
import { waiverRowValue, type WaiverRow } from '@models/market/WaiverBoardModel'
import type { LinkBus } from '@models/workspaces/LinkBus'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import type { LinkGroup } from '@models/workspaces/Workspace'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, SlidingPicker } from '@ui/components/Player'
import { FilterChip, ScreenHero } from '@ui/components/Screen'
import { InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { CompareDialog, linkBusCompareSource } from './CompareDialog'
import { discoverValueText, InjuryBadge, points, SearchField, SelectMenu, shortName, Switch, tagBadge } from './shared'
import './market.css'

type Scope = 'freeAgents' | 'everyone'
const SCOPES: readonly Scope[] = ['freeAgents', 'everyone']
const SCOPE_LABEL: Record<Scope, string> = { freeAgents: 'Free agents', everyone: 'Everyone' }

/** The phone's comparison uses the Blue link colour's list, as the desktop panels do. */
const COMPARE_GROUP: LinkGroup = 1
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
      {comparing && <CompareDialog model={model} source={linkBusCompareSource(linkBus, COMPARE_GROUP)} onClose={() => setComparing(false)} />}
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

export { CompareDialog } from './CompareDialog'
