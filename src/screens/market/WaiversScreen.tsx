/**
 * Waiver Board — the port of `WaiverBoardView`: every free agent with what he
 * has been doing and what he is projected to do, ranked on one named column
 * at a time, with the league's own waiver rules at the top. Clicking a row
 * opens the add/drop dialog (the phone's sheet); the "…" button is the
 * phone's player context menu.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowUpDown, ExternalLink, Inbox, RefreshCcw, TriangleAlert, Upload } from 'lucide-react'
import { formatNumber } from '@core/numeric'
import { sleeperTeamLink } from '@models/league/GameDayWindow'
import { availabilityLabel, waiverLabel } from '@models/league/LeagueContext'
import {
  WAIVER_SORT_LABEL, WAIVER_SORT_SOURCE, WAIVER_SORT_UNIT, WAIVER_SORTS, waiverRowValue,
  type WaiverBoardModel, type WaiverFacts, type WaiverRow, type WaiverSort,
} from '@models/market/WaiverBoardModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar, PositionChip, StatPill } from '@ui/components/Player'
import { AboutThisData, FilterChip, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { PlayerMenu, SearchField, SelectMenu, shortName, Switch, waiverValueText, WeekChips } from './shared'
import './market.css'

const HUE = 'var(--hue-market)'

export function WaiversScreen() {
  const { services } = useApp()
  const model = useModel(services.waivers)
  const [adding, setAdding] = useState<WaiverRow>()
  const [refreshing, setRefreshing] = useState(false)
  const context = model.context

  const refresh = async () => {
    setRefreshing(true)
    try { await model.refresh() } finally { setRefreshing(false) }
  }

  return (
    <div className="mk-screen" style={{ '--hue': HUE } as CSSProperties}>
      {model.errorMessage !== undefined && context && <InlineErrorBanner message={model.errorMessage} />}
      {!context && (model.isLoading || model.errorMessage === undefined) ? (
        <LoadingPlaceholder label="Ranking the waiver wire…" />
      ) : !context ? (
        <div className="card mk-stack-tight" role="alert">
          <div className="t-section mk-inline"><TriangleAlert size={18} aria-hidden /> Could not load your league</div>
          <div className="t-meta muted">{model.errorMessage}</div>
        </div>
      ) : (
        <>
          <WaiverHero model={model} />
          <div className="mk-toolbar-row">
            <SearchField value={model.query} onChange={(q) => { model.query = q }} placeholder="Player or team" />
            <button type="button" className="mk-icon-button" aria-label="Refresh" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCcw size={16} aria-hidden />
            </button>
          </div>
          <ScreenSection title="Rank by" icon={ArrowUpDown} hue={HUE}>
            <Controls model={model} />
          </ScreenSection>
          <ScreenSection title="Free agents" icon={Inbox} hue={HUE} count={model.rows.length === 0 ? undefined : Math.min(model.rows.length, 60)}>
            <BoardList model={model} onAdd={setAdding} />
          </ScreenSection>
          <DropSection model={model} />
          <AboutThisData>
            {model.facts && <CoverageNote text={factsDetail(model.facts)} />}
            <FreshnessBanner provenance={context.provenance} />
            {model.sourceNotes.map((n) => <CoverageNote key={n} text={n} />)}
          </AboutThisData>
        </>
      )}
      {adding && <AddDropDialog model={model} add={adding} onClose={() => setAdding(undefined)} />}
    </div>
  )
}

// MARK: - Hero

/** The answer: who to claim first, and what your league lets you spend. */
function WaiverHero({ model }: { model: WaiverBoardModel }) {
  const top = model.rows[0]
  const stats: { value: string; label: string }[] = []
  const facts = model.facts
  if (facts) {
    if (facts.system.kind !== 'unknown') stats.push({ value: systemShort(facts), label: 'system' })
    if (facts.faabRemaining !== undefined) stats.push({ value: `$${facts.faabRemaining}`, label: 'FAAB left' })
    if (facts.waiverPosition !== undefined) stats.push({ value: `#${facts.waiverPosition}`, label: 'priority' })
  }
  let detail = 'No free agent has this measure yet.'
  if (top) {
    const where = [top.position, top.team].filter((x): x is string => x !== undefined).join(' · ')
    const value = waiverRowValue(top, model.sort)
    detail = value === undefined
      ? `${where} · top by ${WAIVER_SORT_LABEL[model.sort].toLowerCase()}`
      : `${where} · ${waiverValueText(value, model.sort)} ${WAIVER_SORT_UNIT[model.sort]}`
  }
  return (
    <ScreenHero
      overline="Market · Waivers"
      icon={Inbox}
      answer={top ? shortName(top.name) : 'Nobody yet'}
      detail={detail}
      stats={stats}
      hue={HUE}
    />
  )
}

/** `WaiverFactsStrip.systemShort`. */
function systemShort(facts: WaiverFacts): string {
  switch (facts.system.kind) {
    case 'rolling': return 'Rolling'
    case 'reverseStandings': return 'Rev. standings'
    case 'faab': return 'FAAB'
    case 'unknown': return 'Unknown'
  }
}

/** `WaiverFactsStrip.detail`. */
function factsDetail(facts: WaiverFacts): string {
  const parts = [waiverLabel(facts.system)]
  if (facts.processingDay !== undefined) parts.push(`claims process ${facts.processingDay}`)
  parts.push('read live from your league settings')
  return parts.join(' · ')
}

// MARK: - Controls

function Controls({ model }: { model: WaiverBoardModel }) {
  return (
    <div className="mk-stack-tight">
      <div className="mk-toolbar-row">
        <SelectMenu<WaiverSort>
          value={model.sort}
          options={WAIVER_SORTS}
          label={(s) => WAIVER_SORT_LABEL[s]}
          onChange={(s) => { model.sort = s }}
          ariaLabel="Rank by"
          icon={<ArrowUpDown size={14} aria-hidden />}
        />
        <span style={{ flex: 1 }} />
        <Switch label="Rival benches" checked={model.includeRivalBenches} onChange={(v) => { model.includeRivalBenches = v }} />
      </div>
      <div className="mk-chips" role="group" aria-label="Filter">
        <FilterChip label="All" selected={model.positionFilter === undefined} onClick={() => { model.positionFilter = undefined }} />
        {model.filterablePositions.map((p) => (
          <FilterChip key={p} label={p} selected={model.positionFilter === p}
            onClick={() => { model.positionFilter = model.positionFilter === p ? undefined : p }} />
        ))}
        <FilterChip label="Plays this week" selected={model.playingThisWeekOnly}
          onClick={() => { model.playingThisWeekOnly = !model.playingThisWeekOnly }} />
      </div>
      <p className="t-meta muted">{WAIVER_SORT_SOURCE[model.sort]}</p>
    </div>
  )
}

// MARK: - Board

function BoardList({ model, onAdd }: { model: WaiverBoardModel; onAdd: (row: WaiverRow) => void }) {
  if (model.rows.length === 0) {
    return (
      <div className="card t-meta muted">
        Nobody matches. Loosen the filters, or the sources this board reads are unavailable — see the notes below.
      </div>
    )
  }
  const context = model.context!
  return (
    <div className="mk-stack-tight">
      {model.rows.slice(0, 60).map((row) => (
        <div key={row.id} className="mk-row-card">
          <button type="button" className="mk-row-card-main" onClick={() => onAdd(row)} aria-label={`Claim ${row.name}: see what each drop does`}>
            <WaiverRowView row={row} sort={model.sort} />
          </button>
          <PlayerMenu playerID={row.id} context={context} name={row.name} />
        </div>
      ))}
      {model.rows.length > 60 && (
        <p className="t-meta muted">{`Showing 60 of ${model.rows.length}. Filter by position or search to narrow it.`}</p>
      )}
      {model.unvaluedCount > 0 && (
        <p className="t-meta muted">{`${model.unvaluedCount} listed without this measure, at the bottom — absent, not zero.`}</p>
      )}
    </div>
  )
}

/** One board row: who, where, and the value on the chosen column. */
export function WaiverRowView({ row, sort }: { row: WaiverRow; sort: WaiverSort }) {
  const subtitle = [
    row.team, row.opponent !== undefined ? `vs ${row.opponent}` : undefined, row.playsThisWeek ? undefined : 'bye', row.injuryTag,
    row.availability.kind === 'freeAgent' ? undefined : availabilityLabel(row.availability),
    row.isLocked ? 'locked' : undefined,
  ].filter((x): x is string => x !== undefined).join(' · ')
  const others = (['projected', 'snapShare', 'expectedPoints'] as WaiverSort[]).filter((s) => s !== sort).slice(0, 2)
  const value = waiverRowValue(row, sort)
  return (
    <span className="mk-waiver-row">
      <PlayerAvatar sleeperID={row.id} name={row.name} position={row.position} size={32} />
      <span className="mk-row-text">
        <span className="mk-row-title">
          <span className="mk-name">{row.name}</span>
          <PositionChip position={row.position} />
        </span>
        <span className="t-meta mk-ellipsis" style={{ color: row.availability.kind === 'freeAgent' ? 'var(--text-2)' : 'var(--caution)' }}>{subtitle}</span>
        {row.coversWeeks.length > 0 && <WeekChips weeks={row.coversWeeks} prefix="covers" />}
      </span>
      <span className="mk-secondary">
        {others.map((other) => {
          const v = waiverRowValue(row, other)
          return v === undefined ? null : <StatPill key={other} label={WAIVER_SORT_UNIT[other]} value={waiverValueText(v, other)} tint="var(--text-2)" />
        })}
      </span>
      <span className="mk-row-value" style={{ minWidth: 52 }}>
        {value !== undefined
          ? <span className="mk-value">{waiverValueText(value, sort)}</span>
          : <span className="mk-value faint">—</span>}
        <span className="t-meta muted">{WAIVER_SORT_UNIT[sort]}</span>
      </span>
    </span>
  )
}

// MARK: - Drops

function DropSection({ model }: { model: WaiverBoardModel }) {
  if (model.dropCandidates.length === 0) return null
  return (
    <ScreenSection
      title="Your bench, weakest first"
      subtitle="Ranked on this week's projection. IR-eligible players free a bench spot without a drop."
      icon={Upload}
      hue={HUE}
    >
      <div className="card mk-stack-tight">
        {model.dropCandidates.map((c) => (
          <div key={c.id} className="mk-drop-row">
            <PositionChip position={c.row.position} />
            <span className="mk-row-text">
              <span className="t-body" style={{ fontWeight: 500 }}>{c.row.name}</span>
              <span className="t-meta" style={{ color: c.irEligible ? 'var(--start)' : 'var(--text-2)' }}>
                {[c.row.team, c.row.injuryTag, c.irEligible ? 'IR-eligible' : undefined,
                  c.maybeIRWithLeagueSetting ? 'IR-eligible if your league allows Out' : undefined,
                  c.row.isLocked ? 'locked' : undefined].filter((x): x is string => x !== undefined).join(' · ')}
              </span>
            </span>
            {c.row.projected !== undefined
              ? <StatPill label="proj" value={formatNumber(c.row.projected, 1)} />
              : <span className="t-meta faint">no proj</span>}
          </div>
        ))}
      </div>
    </ScreenSection>
  )
}

// MARK: - Add / drop

/** The phone's `AddDropSheet`: what each drop does to this week's best lineup. */
export function AddDropDialog({ model, add, onClose }: { model: WaiverBoardModel; add: WaiverRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const context = model.context
  return (
    <div className="mk-scrim" onClick={onClose}>
      <div className="mk-dialog" role="dialog" aria-modal="true" aria-label="Add / drop" onClick={(e) => e.stopPropagation()}>
        <header className="mk-dialog-header">
          <h2 className="t-section">Add / drop</h2>
          <button type="button" className="button mk-small" onClick={onClose} autoFocus>Done</button>
        </header>
        <div className="mk-stack">
          <div className="mk-stack-tight">
            <div className="t-title">{`Claim ${add.name}`}</div>
            <div className="t-meta muted">What each drop does to your best lineup this week, on the projection.</div>
          </div>
          <div className="card mk-pad-s"><WaiverRowView row={add} sort="projected" /></div>
          {model.dropCandidates.length === 0 && (
            <div className="card t-meta muted">No bench player to drop — you would need to move someone to IR first.</div>
          )}
          {model.dropCandidates.map((drop) => {
            const effect = model.pairEffect(add, drop)
            const delta = effect.delta
            return (
              <div key={drop.id} className="card mk-drop-row">
                <PositionChip position={drop.row.position} />
                <span className="mk-row-text">
                  <span className="t-body" style={{ fontWeight: 500 }}>{`Drop ${drop.row.name}`}</span>
                  {effect.note !== undefined ? (
                    <span className="t-meta muted">{effect.note}</span>
                  ) : effect.before !== undefined && effect.after !== undefined ? (
                    <span className="t-meta muted">{`lineup ${formatNumber(effect.before, 1)} → ${formatNumber(effect.after, 1)}`}</span>
                  ) : null}
                  {drop.irEligible && <span className="t-meta" style={{ color: 'var(--start)' }}>IR-eligible — park him instead of dropping</span>}
                </span>
                {delta !== undefined && (
                  <StatPill
                    label="this week"
                    value={(delta >= 0 ? '+' : '') + formatNumber(delta, 1)}
                    tint={delta > 0 ? 'var(--start)' : delta < 0 ? 'var(--sit)' : 'var(--text-2)'}
                  />
                )}
              </div>
            )
          })}
          {context && (
            <a className="mk-link t-meta" href={sleeperTeamLink(context.league.leagueID)} target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden /> Make the claim in Sleeper
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

