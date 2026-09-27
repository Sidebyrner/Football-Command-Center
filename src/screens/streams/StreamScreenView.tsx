/**
 * A weekly stream screen: players ranked by this week's projected points in
 * your scoring, each compared with the starter a stream would replace — the
 * port of FCApp `StreamScreenView`, `StreamCompareTray` and `StreamRowView`.
 *
 * Web adaptations: the toolbar (Game context, Compare, Snapshots, refresh)
 * and the search field sit above the hero; sheets are in-page panels; the
 * row's context menu is a "More" menu button.
 */
import { useState, type CSSProperties } from 'react'
import {
  AlertTriangle, ArrowLeftRight, Camera, CheckCircle2, ChevronDown, Copy, DollarSign, Ellipsis,
  Flag, History, PlusCircle, RefreshCcw, Repeat, Search, SlidersHorizontal, Snowflake, SquareUser, UserCheck,
  Users, SquareSlash,
} from 'lucide-react'
import { HORIZON, PRACTICE_STATUS_LABEL, type StreamHorizon, type StreamProjection, type StreamRiskMode } from '@core/Stream'
import { availabilityLabel, faabRemaining, startAvailability, startBadge, waiverLabel, type Availability, type LeagueContext } from '@models/league/LeagueContext'
import type { StreamKindTypes } from '@models/streams/StreamKind'
import type { StreamScreenModel } from '@models/streams/StreamScreenModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { AboutThisData, FilterChip, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { PlayerAvatar, PositionChip, SlidingPicker, StatPill, positionColor } from '@ui/components/Player'
import { hueForScreen } from '@ui/hues'
import { screenIcon } from '@ui/icons'
import { panelSigned, StreamFormat, formatTime } from './format'
import { InjuryBadge, MenuButton, StreamPillGrid, StreamRangeBar, StreamStatTile, Unavailable, type MenuEntry } from './parts'
import type { StreamPill, StreamScreenSpec } from './spec'
import { StreamCompareView } from './StreamCompareView'
import { StreamPlayerPickerView } from './StreamPlayerPickerView'
import { StreamSnapshotsView } from './StreamSnapshotsView'
import './streams.css'

const RISKS: readonly StreamRiskMode[] = ['floor', 'neutral', 'ceiling']
const HORIZONS: readonly StreamHorizon[] = ['week', 'balanced', 'ros']
const RISK_SHORT: Record<StreamRiskMode, string> = { floor: 'Floor', neutral: 'Neutral', ceiling: 'Ceiling' }
const RISK_HINT: Record<StreamRiskMode, string> = {
  floor: 'Favours a safe floor — for when you\'re favoured to win.',
  neutral: 'Ranks on expected points.',
  ceiling: 'Favours upside — for when you\'re the underdog.',
}

type SheetState<P> =
  | { kind: 'context' }
  | { kind: 'snapshots' }
  | { kind: 'incumbent' }
  | { kind: 'compare' }
  | { kind: 'player'; row: P }

export function StreamScreenView<K extends StreamKindTypes>({ model: source, spec }: { model: StreamScreenModel<K>; spec: StreamScreenSpec<K> }) {
  const model = useModel(source)
  const [expanded, setExpanded] = useState<string>()
  const [sheet, setSheet] = useState<SheetState<K['Projection']>>()
  const hue = hueForScreen(spec.screen)
  const Icon = screenIcon[spec.screen]
  const noun = model.kind.playerNoun
  const context = model.context
  const close = () => setSheet(undefined)

  const scaleMax = Math.max(
    model.rows.slice(0, 50).reduce((m, r) => Math.max(m, r.ceilingP75), 0),
    model.report?.incumbent?.ceilingP75 ?? 0,
  ) * 1.05

  return (
    <div className="stream-screen" style={{ '--hue': hue } as CSSProperties}>
      <Toolbar model={model} onOpen={setSheet} />

      {model.errorMessage !== undefined && context && <InlineErrorBanner message={model.errorMessage} />}
      {!context && (model.isLoading || model.errorMessage === undefined) ? (
        <LoadingPlaceholder label={`Projecting ${noun}s…`} />
      ) : !context ? (
        <div className="card stream-load-error" role="alert">
          <div className="t-section stream-label"><AlertTriangle size={17} aria-hidden /> Could not load your league</div>
          <div className="t-meta muted">{model.errorMessage}</div>
        </div>
      ) : !model.leagueStartsKind ? (
        <Unavailable
          icon={SquareSlash}
          title={`No ${model.kind.positions.join('/')} slots`}
          description={`Your league doesn't start any ${noun}s, so there is nothing to stream.`}
        />
      ) : (
        <>
          <Hero model={model} spec={spec} context={context} />
          <ScreenSection title="Starter to beat" icon={UserCheck} hue={hue}>
            <StarterCard model={model} spec={spec} scaleMax={scaleMax} onOpen={setSheet} />
          </ScreenSection>
          <ScreenSection title="Tune" icon={SlidersHorizontal} hue={hue}>
            <Controls model={model} spec={spec} />
          </ScreenSection>
          <ScreenSection title="Streamers" icon={Icon} hue={hue} count={model.rows.length === 0 ? undefined : Math.min(model.rows.length, 50)}>
            <List model={model} spec={spec} context={context} scaleMax={scaleMax} expanded={expanded} setExpanded={setExpanded} onOpen={setSheet} />
          </ScreenSection>
          <AboutThisData>
            <Header model={model} spec={spec} context={context} />
            <FreshnessBanner provenance={context.provenance} />
            {model.sourceNotes.map((note) => <CoverageNote key={note} text={note} />)}
          </AboutThisData>
        </>
      )}

      {model.compareIDs.length > 0 && (
        <CompareTray
          players={model.compareIDs.map((id) => model.projection(id)).filter((p): p is K['Projection'] => p !== undefined)}
          limit={model.compareLimit}
          onClear={() => model.clearCompare()}
          onCompare={() => setSheet({ kind: 'compare' })}
        />
      )}

      {sheet?.kind === 'context' && <spec.ContextEditor model={model} onClose={close} />}
      {sheet?.kind === 'snapshots' && <StreamSnapshotsView model={model} onClose={close} />}
      {sheet?.kind === 'incumbent' && <StreamPlayerPickerView model={model} mode="incumbent" onClose={close} />}
      {sheet?.kind === 'compare' && <StreamCompareView model={model} spec={spec.compare} teamSpread={spec.teamSpread} onClose={close} />}
      {sheet?.kind === 'player' && <spec.PlayerEditor model={model} row={sheet.row} onClose={close} />}
    </div>
  )
}

// MARK: - Toolbar

function Toolbar<K extends StreamKindTypes>({ model, onOpen }: { model: StreamScreenModel<K>; onOpen: (s: SheetState<K['Projection']>) => void }) {
  const noContext = model.context === undefined
  return (
    <div className="stream-toolbar">
      <label className="stream-search">
        <Search size={15} aria-hidden />
        <span className="stream-vh">Search</span>
        <input type="search" placeholder="Player or team" value={model.query} onChange={(e) => { model.query = e.target.value }} />
      </label>
      <div className="stream-toolbar-actions">
        <button type="button" className="stream-tool" onClick={() => onOpen({ kind: 'context' })} disabled={noContext}>
          <SlidersHorizontal size={16} aria-hidden /> <span>Game context</span>
        </button>
        <button type="button" className="stream-tool" onClick={() => onOpen({ kind: 'compare' })} disabled={noContext}>
          <Users size={16} aria-hidden /> <span>Compare</span>
        </button>
        <MenuButton
          className="stream-tool"
          disabled={model.report === undefined}
          label={<><Camera size={16} aria-hidden /> <span>Snapshots</span></>}
          entries={[
            { kind: 'item', label: 'Freeze snapshot now', icon: Snowflake, onSelect: () => { void model.freezeSnapshot() } },
            { kind: 'item', label: 'Saved snapshots', icon: History, onSelect: () => onOpen({ kind: 'snapshots' }) },
          ]}
        />
        <button type="button" className="stream-tool icon-only" onClick={() => { void model.refresh() }} disabled={model.isLoading} aria-label="Refresh">
          <RefreshCcw size={16} aria-hidden className={model.isLoading ? 'spinning' : undefined} />
        </button>
      </div>
    </div>
  )
}

// MARK: - Header

/** The answer: this week's best stream, and what it gains on your starter. */
function Hero<K extends StreamKindTypes>({ model, spec, context }: { model: StreamScreenModel<K>; spec: StreamScreenSpec<K>; context: LeagueContext }) {
  const best = model.report?.ranked[0]
  const starter = model.report?.incumbent
  const gain = best && starter ? best.expPts - starter.expPts : undefined
  let detail = 'Nobody projects yet — see About this data.'
  if (best) {
    const vs = `${best.team} ${best.opponent}`
    detail = vs
    if (gain !== undefined && starter) {
      detail = gain > 0
        ? `${vs} · ${panelSigned(gain)} on ${StreamFormat.shortName(starter.name)}`
        : `${vs} · your starter ${StreamFormat.shortName(starter.name)} is still ahead`
    }
  }
  const stats = best
    ? [
      { value: StreamFormat.one(best.expPts), label: 'exp. pts' },
      { value: StreamFormat.pct(best.pPlay), label: 'plays' },
      ...(gain !== undefined ? [{ value: panelSigned(gain), label: 'vs starter' }] : []),
    ]
    : []
  return (
    <ScreenHero
      overline={`Streams · ${spec.title.replace(' Stream', '')} · Week ${context.currentWeek}`}
      icon={screenIcon[spec.screen]}
      answer={best ? StreamFormat.shortName(best.name) : 'No stream'}
      detail={detail}
      stats={stats}
      hue={hueForScreen(spec.screen)}
    />
  )
}

function Header<K extends StreamKindTypes>({ model, spec, context }: { model: StreamScreenModel<K>; spec: StreamScreenSpec<K>; context: LeagueContext }) {
  const remaining = faabRemaining(context.leagueFacts)
  return (
    <div className="stream-about-header">
      <p className="t-meta muted">
        Projected in your scoring: {spec.scoringSummary(model.scoring)}. Ranked by utility, which tilts expected points toward floor or ceiling.
      </p>
      <div className="stream-about-facts t-meta muted">
        <span className="stream-label"><DollarSign size={13} aria-hidden /> {waiverLabel(context.leagueFacts.waivers)}</span>
        {remaining !== undefined && <span>${remaining} left</span>}
        {model.lastSnapshotAt !== undefined && (
          <span className="stream-label"><Snowflake size={13} aria-hidden /> Snapshot {formatTime(model.lastSnapshotAt)}</span>
        )}
      </div>
    </div>
  )
}

// MARK: - Starter

function StarterCard<K extends StreamKindTypes>({ model, spec, scaleMax, onOpen }: {
  model: StreamScreenModel<K>; spec: StreamScreenSpec<K>; scaleMax: number; onOpen: (s: SheetState<K['Projection']>) => void
}) {
  const inc = model.report?.incumbent
  const myPlayerLabel = (c: K['Candidate']) => {
    const id = c.playerID ?? c.name
    const p = model.projection(id)
    return p ? `${c.name} · ${p.roleLabel} · ${StreamFormat.one(p.expPts)}` : c.name
  }
  const entries: MenuEntry[] = [
    { kind: 'item', label: 'Weakest starter (default)', onSelect: () => { void model.setIncumbent(undefined) } },
    { kind: 'heading', label: `Your ${model.kind.playerNoun}s` },
    ...model.myPlayers.map((c): MenuEntry => ({
      kind: 'item', label: myPlayerLabel(c), onSelect: () => { void model.setIncumbent(c.playerID ?? c.name) },
    })),
    { kind: 'divider' },
    { kind: 'item', label: 'Choose any player…', icon: Search, onSelect: () => onOpen({ kind: 'incumbent' }) },
  ]
  return (
    <div className="card stream-starter">
      <div className="stream-starter-actions">
        {inc?.playerID !== undefined && (
          <button
            type="button"
            className="stream-small-button"
            onClick={() => {
              const id = inc.playerID!
              if (!model.isComparing(id)) model.toggleCompare(id)
              onOpen({ kind: 'compare' })
            }}
          >
            <Users size={14} aria-hidden /> Compare with…
          </button>
        )}
        <MenuButton label={<><Repeat size={14} aria-hidden /> Change</>} ariaLabel="Change the starter to beat" entries={entries} />
      </div>
      {inc ? (
        <>
          <div className="stream-starter-head">
            <PlayerAvatar sleeperID={inc.playerID} name={inc.name} position={inc.platform} size={36} />
            <div className="stream-grow">
              <div className="stream-name-line">
                <span className="t-section">{inc.name}</span>
                <PositionChip position={inc.platform} label={inc.roleLabel} />
                {model.incumbentIsDefault ? (
                  <span className="t-micro muted stream-plain">weakest starter</span>
                ) : model.incumbentOwnerLabel !== undefined ? (
                  <span className="t-meta stream-caution">{model.incumbentOwnerLabel}</span>
                ) : null}
              </div>
              <div className="t-meta muted">{inc.team} {inc.opponent} · {PRACTICE_STATUS_LABEL[inc.practice]}</div>
            </div>
            <StatPill label="E[pts]" value={StreamFormat.one(inc.expPts)} />
          </div>
          <StreamRangeBar floor={inc.floorP25} expected={inc.expPts} ceiling={inc.ceilingP75} scaleMax={scaleMax} tint={positionColor(inc.platform)} />
          <StreamPillGrid pills={[...spec.starterPills(inc), { label: 'P(plays)', value: StreamFormat.pct(inc.pPlay) }]} minimumWidth={72} />
        </>
      ) : (
        <p className="t-meta muted">No starter chosen — rankings show projected points only. Pick anyone with Change.</p>
      )}
    </div>
  )
}

// MARK: - Controls

function Controls<K extends StreamKindTypes>({ model, spec }: { model: StreamScreenModel<K>; spec: StreamScreenSpec<K> }) {
  return (
    <div className="stream-controls">
      <SlidingPicker options={RISKS} value={model.risk} onChange={(r) => { model.risk = r }} label={(r) => RISK_SHORT[r]} ariaLabel="Risk" />
      <p className="t-meta muted">{RISK_HINT[model.risk]}</p>
      {model.kind.usesHorizon && (
        <>
          <SlidingPicker options={HORIZONS} value={model.horizon} onChange={(h) => { model.horizon = h }} label={(h) => HORIZON[h].label} ariaLabel="Horizon" />
          <p className="t-meta muted">{HORIZON[model.horizon].hint}</p>
        </>
      )}
      <div className="stream-filter-row">
        <div className="stream-chips">
          {spec.filterPositions.length > 1 && (
            <>
              <FilterChip label="All" selected={model.positionFilter === undefined} onClick={() => { model.positionFilter = undefined }} />
              {spec.filterPositions.map((p) => (
                <FilterChip key={p} label={p} selected={model.positionFilter === p} onClick={() => { model.positionFilter = model.positionFilter === p ? undefined : p }} />
              ))}
            </>
          )}
        </div>
        <label className="stream-switch t-meta">
          <input type="checkbox" role="switch" checked={model.onlyAvailable} onChange={(e) => { model.onlyAvailable = e.target.checked }} />
          <span className="stream-switch-track" aria-hidden />
          Free agents only
        </label>
      </div>
    </div>
  )
}

// MARK: - List

function List<K extends StreamKindTypes>(props: {
  model: StreamScreenModel<K>; spec: StreamScreenSpec<K>; context: LeagueContext; scaleMax: number
  expanded?: string; setExpanded: (id: string | undefined) => void; onOpen: (s: SheetState<K['Projection']>) => void
}) {
  const { model, spec, context, scaleMax, expanded, setExpanded, onOpen } = props
  const { openPlayerCard, openTrade } = useApp()
  if (model.rows.length === 0) {
    return (
      <p className="card t-meta muted">
        Nobody matches. Loosen the filters, or there are no {context.scheduleSeason} Sleeper stat lines yet — see the notes below.
      </p>
    )
  }
  const injuryBadge = (row: StreamProjection): string | undefined => {
    if (row.playerID !== undefined) {
      const badge = startBadge(startAvailability(row.playerID, context))
      if (badge !== undefined) return badge
    }
    switch (row.practice) {
      case 'Q': return 'Q'
      case 'D': return 'Doubtful'
      case 'OUT': return 'Out'
      case 'IR': return 'IR'
      default: return undefined
    }
  }
  const menu = (row: K['Projection']): MenuEntry[] => {
    const id = row.playerID
    if (id === undefined) return []
    const entries: MenuEntry[] = [{ kind: 'item', label: 'Open Player Card', icon: SquareUser, onSelect: () => openPlayerCard(id, context) }]
    const availability = context.availabilityOf(id)
    if (availability.kind === 'rivalStarter' || availability.kind === 'rivalBench') {
      const position = context.position(id)
      entries.push({
        kind: 'item', label: 'Trade for…', icon: ArrowLeftRight,
        onSelect: () => openTrade({ positions: position ? new Set([position]) : undefined, rivalRosterID: availability.rosterID, theirPlayerID: id }),
      })
    } else if (availability.kind === 'mine') {
      entries.push({ kind: 'item', label: 'Offer in trade', icon: ArrowLeftRight, onSelect: () => openTrade({ myPlayerID: id }) })
    }
    entries.push({ kind: 'item', label: 'Copy name', icon: Copy, onSelect: () => { void navigator.clipboard?.writeText(context.playerName(id) ?? id) } })
    entries.push({ kind: 'divider' })
    const comparing = model.isComparing(id)
    entries.push({
      kind: 'item', label: comparing ? 'Remove from compare' : 'Add to compare',
      disabled: !comparing && !model.canAddToCompare, onSelect: () => model.toggleCompare(id),
    })
    entries.push({ kind: 'item', label: 'Set as starter to beat', onSelect: () => { void model.setIncumbent(id) } })
    return entries
  }
  return (
    <div className="stream-list">
      {model.rows.slice(0, 50).map((row, offset) => (
        <StreamRow
          key={row.id}
          row={row}
          rank={offset + 1}
          usage={spec.usage(row)}
          pills={spec.rowPills(row)}
          bid={model.bidLabel(row)}
          availability={row.playerID !== undefined ? context.availabilityOf(row.playerID) : undefined}
          injuryBadge={injuryBadge(row)}
          scaleMax={scaleMax}
          isExpanded={expanded === row.id}
          onToggle={() => setExpanded(expanded === row.id ? undefined : row.id)}
          onAdjust={() => onOpen({ kind: 'player', row })}
          isComparing={row.playerID !== undefined && model.isComparing(row.playerID)}
          canCompare={model.canAddToCompare}
          onCompare={() => { if (row.playerID !== undefined) model.toggleCompare(row.playerID) }}
          menu={menu(row)}
          index={offset}
        />
      ))}
      {model.rows.length > 50 && <p className="t-micro muted stream-plain">Showing 50 of {model.rows.length}. Filter or search to narrow it.</p>}
    </div>
  )
}

// MARK: - Compare tray

/** Who is lined up to compare, with a clear primary action. Compare needs two; until then it says so. */
function CompareTray<P extends StreamProjection>({ players, limit, onClear, onCompare }: { players: P[]; limit: number; onClear: () => void; onCompare: () => void }) {
  return (
    <div className="stream-tray" role="region" aria-label="Compare">
      <div className="stream-tray-top">
        <div className="stream-tray-faces" aria-hidden>
          {players.slice(0, 4).map((p) => <PlayerAvatar key={p.id} sleeperID={p.playerID} name={p.name} position={p.platform} size={34} />)}
        </div>
        <div className="stream-grow">
          <div className="t-body stream-strong stream-ellipsis">{players.length} of {limit} to compare</div>
          <div className="t-meta muted stream-ellipsis">
            {players.length < 2 ? 'Add one more to see them side by side' : players.map((p) => StreamFormat.shortName(p.name)).join(' · ')}
          </div>
        </div>
      </div>
      <div className="stream-tray-actions">
        <button type="button" className="stream-pill-button destructive" onClick={onClear}>Clear</button>
        <button type="button" className="stream-pill-button primary" onClick={onCompare} disabled={players.length < 2}>
          <Users size={16} aria-hidden /> Compare side by side
        </button>
      </div>
    </div>
  )
}

// MARK: - Row

/**
 * One streamer. Collapsed, it answers "who, how healthy, how many points".
 * Opened, it adds roomy stat tiles, the odds against your starter, the
 * model's reasoning and the actions.
 */
function StreamRow<P extends StreamProjection>(props: {
  row: P; rank: number; usage: string; pills: StreamPill[]; bid?: string; availability?: Availability
  injuryBadge?: string; scaleMax: number; isExpanded: boolean; onToggle: () => void; onAdjust: () => void
  isComparing: boolean; canCompare: boolean; onCompare: () => void; menu: MenuEntry[]; index: number
}) {
  const { row, rank, usage, pills, bid, availability, injuryBadge, scaleMax, isExpanded, onToggle, onAdjust, isComparing, canCompare, onCompare, menu, index } = props
  const one = StreamFormat.one
  const subtitleParts = [`${row.team} ${row.opponent}`, usage]
  // A practice line the injury badge doesn't already say.
  if (injuryBadge === undefined && row.practice !== 'none') subtitleParts.push(PRACTICE_STATUS_LABEL[row.practice])
  const subtitle = subtitleParts.filter((s) => s.length > 0).join(' · ')
  const a11y = [`${rank}. ${row.name}`, row.roleLabel]
  if (injuryBadge !== undefined) a11y.push(injuryBadge === 'Q' ? 'Questionable' : injuryBadge)
  a11y.push(`${one(row.expPts)} expected points, floor ${one(row.floorP25)}, ceiling ${one(row.ceilingP75)}`)
  if (row.expGain !== undefined) a11y.push(`${StreamFormat.signed(row.expGain)} versus your starter`)
  const compareDisabled = !isComparing && !canCompare

  return (
    <article className={`card stream-row${isComparing ? ' comparing' : ''}`} style={{ '--i': Math.min(index, 12) } as CSSProperties}>
      <button type="button" className="stream-row-summary" onClick={onToggle} aria-expanded={isExpanded} aria-label={a11y.join(', ')}>
        <span className="stream-row-top">
          <span className="stream-rank-wrap">
            <PlayerAvatar sleeperID={row.playerID} name={row.name} position={row.platform} size={44} />
            <span className="stream-rank">{rank}</span>
          </span>
          <span className="stream-row-who">
            <span className="t-section">{row.name}</span>
            <span className="stream-badges">
              <PositionChip position={row.platform} label={row.roleLabel} />
              {injuryBadge !== undefined && <InjuryBadge label={injuryBadge} />}
              {availability && availability.kind !== 'freeAgent' && <span className="t-meta stream-caution stream-strong">{availabilityLabel(availability)}</span>}
            </span>
            <span className="t-meta muted">{subtitle}</span>
          </span>
          <span className="stream-row-points">
            <span className="stream-points">{one(row.expPts)}</span>
            <span className="t-micro muted stream-plain">est pts</span>
            {row.expGain !== undefined && (
              <>
                <span className="stream-gain" style={{ color: row.expGain >= 0 ? 'var(--start)' : 'var(--sit)' }}>
                  {(row.expGain >= 0 ? '+' : '') + one(row.expGain)}
                </span>
                <span className="t-micro muted stream-plain">vs starter</span>
              </>
            )}
          </span>
        </span>
        <StreamRangeBar floor={row.floorP25} expected={row.expPts} ceiling={row.ceilingP75} scaleMax={scaleMax} tint={positionColor(row.platform)} />
      </button>

      <div className="stream-row-footer">
        <button
          type="button"
          className={`stream-compare-toggle${isComparing ? ' on' : ''}`}
          onClick={onCompare}
          disabled={compareDisabled}
          aria-pressed={isComparing}
          aria-label={isComparing ? `Remove ${row.name} from compare` : `Add ${row.name} to compare`}
          title={canCompare || isComparing ? 'Side-by-side comparison, up to 4 players' : 'Compare is full — remove someone first'}
        >
          {isComparing ? <CheckCircle2 size={16} aria-hidden /> : <PlusCircle size={16} aria-hidden />}
          {isComparing ? 'In compare' : 'Compare'}
        </button>
        <span className="stream-grow" />
        {menu.length > 0 && <MenuButton label={<Ellipsis size={16} aria-hidden />} ariaLabel={`More for ${row.name}`} entries={menu} className="stream-outline-button" />}
        <button type="button" className="stream-outline-button" onClick={onToggle} aria-hidden tabIndex={-1}>
          {isExpanded ? 'Less' : 'Stats'} <ChevronDown size={14} className={isExpanded ? 'flip' : undefined} />
        </button>
      </div>

      {isExpanded && (
        <div className="stream-row-details">
          <hr className="stream-divider" />
          {(row.pBeatIncumbent !== undefined || bid !== undefined) && (
            <div className="stream-tile-pair">
              {row.pBeatIncumbent !== undefined && (
                <StreamStatTile
                  value={StreamFormat.pct(row.pBeatIncumbent)}
                  label="beats your starter"
                  tint={row.pBeatIncumbent >= 0.6 ? 'var(--start)' : row.pBeatIncumbent < 0.4 ? 'var(--sit)' : undefined}
                />
              )}
              {bid !== undefined && <StreamStatTile value={bid} label="suggested bid" />}
            </div>
          )}
          <div className="stream-detail-block">
            <div className="t-meta muted stream-strong">This week</div>
            <div className="stream-tile-grid">
              {pills.map((p) => <StreamStatTile key={p.label} value={p.value} label={p.label} tint={p.tint} />)}
            </div>
          </div>
          {(row.notes.length > 0 || row.explain.length > 0 || row.flags.length > 0) && (
            <div className="stream-detail-block">
              <div className="t-meta muted stream-strong">Why</div>
              {row.notes.length > 0 && <p className="t-meta">{row.notes}</p>}
              {row.explain.length > 0 && (
                <ul className="stream-explain t-meta muted">
                  {row.explain.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
              {row.flags.length > 0 && (
                <p className="t-meta stream-caution stream-label"><Flag size={13} aria-hidden /> {row.flags.join(' · ')}</p>
              )}
            </div>
          )}
          <div className="stream-row-actions">
            <button type="button" className="button" onClick={onAdjust}><SlidersHorizontal size={15} aria-hidden /> Adjust inputs</button>
          </div>
          {row.sources.length > 0 && <p className="t-micro faint stream-plain">{row.sources.join(' · ')}</p>}
        </div>
      )}
    </article>
  )
}

