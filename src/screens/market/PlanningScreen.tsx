/**
 * Planning — the port of `PlanningView`: "get ahead of the schedule". Three
 * jobs, one at a time, each opening with the sentence that says what it is
 * for — fix your bye weeks, find a trade partner, or grab a free agent before
 * you need him. A first-visit card explains all three once.
 */
import { useState, type CSSProperties } from 'react'
import {
  ArrowLeftRight, CalendarX, ChevronDown, ChevronRight, Inbox, RefreshCcw, TriangleAlert, Wand2, type LucideIcon,
} from 'lucide-react'
import { formatFixed } from '@core/numeric'
import type { LeagueContext } from '@models/league/LeagueContext'
import { availabilityLabel } from '@models/league/LeagueContext'
import {
  PLANNING_MODE_TITLE, PLANNING_MODES, planningModePurpose, type PlanningMode, type PlanningPlayer, type TradeTarget,
} from '@models/market/PlanningJobs'
import type { CrunchCell, PlanningModel } from '@models/market/PlanningModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PositionChip, SlidingPicker } from '@ui/components/Player'
import { AboutThisData, ScreenHero, StatusLabel } from '@ui/components/Screen'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { compact, SectionHeader, WeekChips } from './shared'
import './market.css'

const HUE = 'var(--hue-market)'

const MODE_ICON: Record<PlanningMode, LucideIcon> = { byes: CalendarX, trades: ArrowLeftRight, waivers: Inbox }

export function PlanningScreen() {
  const { services } = useApp()
  const model = useModel(services.planning)
  const settings = useModel(services.settingsModel)
  const introSeen = settings.settings.hasSeenPlanningIntro
  const [refreshing, setRefreshing] = useState(false)
  const context = model.context
  const ModeIcon = MODE_ICON[model.mode]

  const refresh = async () => {
    setRefreshing(true)
    try { await model.refresh() } finally { setRefreshing(false) }
  }

  return (
    <div className="mk-screen" style={{ '--hue': HUE } as CSSProperties}>
      {model.errorMessage !== undefined && context && <InlineErrorBanner message={model.errorMessage} />}
      {!context && (model.isLoading || model.errorMessage === undefined) ? (
        <LoadingPlaceholder label="Loading your season…" />
      ) : !context ? (
        <div className="card mk-stack-tight" role="alert">
          <div className="t-section mk-inline"><TriangleAlert size={18} aria-hidden /> Could not load your league</div>
          <div className="t-meta muted">{model.errorMessage}</div>
        </div>
      ) : (
        <>
          <PlanningHero model={model} context={context} />
          {!introSeen && <PlanningIntroCard onDismiss={() => settings.markPlanningIntroSeen()} />}
          <div className="mk-stack-tight">
            <div className="mk-toolbar-row">
              <div style={{ flex: 1 }}>
                <SlidingPicker options={PLANNING_MODES} value={model.mode} onChange={(m) => { model.mode = m }}
                  label={(m) => PLANNING_MODE_TITLE[m]} ariaLabel="Planning job" />
              </div>
              <button type="button" className="mk-icon-button" aria-label="Refresh" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCcw size={16} aria-hidden />
              </button>
            </div>
            <p className="t-body muted mk-inline" key={model.mode}>
              <ModeIcon size={16} aria-hidden style={{ flex: 'none' }} /> {planningModePurpose(model.mode)}
            </p>
          </div>
          {model.mode === 'byes' && <ByesSection model={model} context={context} />}
          {model.mode === 'trades' && <TradesSection model={model} />}
          {model.mode === 'waivers' && <WaiversSection model={model} />}
          <AboutThisData>
            <FreshnessBanner provenance={context.provenance} />
            {context.statsSeasonNote !== undefined && <CoverageNote text={context.statsSeasonNote} />}
            {model.coverageWarning !== undefined && <CoverageNote text={model.coverageWarning} />}
          </AboutThisData>
        </>
      )}
    </div>
  )
}

/** The answer: the next week you can't field a full lineup, or that you're covered. */
function PlanningHero({ model, context }: { model: PlanningModel; context: LeagueContext }) {
  const short = model.userShortWeeks()
  const next = short.reduce<CrunchCell | undefined>((best, c) => (best === undefined || c.week < best.week ? c : best), undefined)
  let detail = 'You can field a full lineup in every remaining week.'
  if (next) {
    const positions = next.shortPositions.join(', ')
    detail = positions === '' ? 'Your first bye crunch.' : `Your first bye crunch — ${positions}.`
  }
  return (
    <ScreenHero
      overline="Market · Planning"
      icon={CalendarX}
      answer={next ? `Week ${next.week}: ${next.shortfall} short` : 'Covered'}
      detail={detail}
      stats={[
        { value: `${short.length}`, label: 'short weeks' },
        { value: `${context.remainingWeeks.length}`, label: 'weeks left' },
      ]}
      tone={next ? 'caution' : 'start'}
      hue={HUE}
    />
  )
}

// MARK: - Intro

export function PlanningIntroCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="card mk-stack-tight">
      <div className="t-title">Plan ahead</div>
      <p className="t-body muted">Planning looks at the rest of your season so problems don't catch you on a Sunday.</p>
      {PLANNING_MODES.map((mode) => {
        const Icon = MODE_ICON[mode]
        return (
          <div key={mode} className="mk-intro-row">
            <Icon size={18} color={HUE} aria-hidden />
            <span className="mk-row-text">
              <span className="t-body" style={{ fontWeight: 600 }}>{PLANNING_MODE_TITLE[mode]}</span>
              <span className="t-meta muted">{planningModePurpose(mode)}</span>
            </span>
          </div>
        )
      })}
      <div><button type="button" className="button primary" onClick={onDismiss}>Got it</button></div>
    </div>
  )
}

// MARK: - Byes

function ByesSection({ model, context }: { model: PlanningModel; context: LeagueContext }) {
  const short = model.userShortWeeks()
  return (
    <div className="mk-stack">
      {short.length === 0 ? (
        <div className="card"><StatusLabel tone="start">You can field a full lineup in every remaining week.</StatusLabel></div>
      ) : (
        <>
          <p className="t-meta muted">{`Short in ${short.length} of ${context.remainingWeeks.length} remaining weeks. Click a week to fix it.`}</p>
          {short.map((cell) => <ShortWeekCard key={cell.id} model={model} cell={cell} />)}
        </>
      )}
      <details className="card mk-disclosure">
        <summary>
          <ChevronRight size={16} className="mk-disclosure-chevron" aria-hidden />
          <SectionHeader title="League view" subtitle="Every team, every week. Numbers are starting slots that team can't fill." />
        </summary>
        <LeagueGrid model={model} context={context} />
      </details>
    </div>
  )
}

function ShortWeekCard({ model, cell }: { model: PlanningModel; cell: CrunchCell }) {
  const expanded = model.selectedWeek === cell.week
  const needed = [...model.neededPositions(cell.week)].sort()
  const panelID = `planning-week-${cell.week}`
  return (
    <div className="card mk-stack-tight">
      <button type="button" className="mk-week-toggle" aria-expanded={expanded} aria-controls={panelID}
        onClick={() => { model.selectedWeek = expanded ? undefined : cell.week }}>
        <span className="mk-row-text">
          <span className="t-section">{`Week ${cell.week}`}</span>
          <span className="mk-row-title">{needed.map((p) => <PositionChip key={p} position={p} />)}</span>
        </span>
        <span className="mk-short-pill t-micro" style={{ background: cell.shortfall >= 2 ? 'var(--sit)' : 'var(--caution)' }}>
          {`${cell.shortfall} short`}
        </span>
        <ChevronDown size={16} className="muted mk-chevron" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} aria-hidden />
      </button>
      {expanded && <WeekDetail model={model} cell={cell} id={panelID} />}
    </div>
  )
}

function WeekDetail({ model, cell, id }: { model: PlanningModel; cell: CrunchCell; id: string }) {
  const pickups = model.pickups(cell.week, 5)
  const partners = model.tradePartners(cell.week)
  return (
    <div className="mk-stack-tight mk-week-detail" id={id}>
      <div className="t-body" style={{ fontWeight: 600 }}>Pick up</div>
      {pickups.length === 0
        ? <p className="t-meta muted">{`No one available at these positions plays in week ${cell.week}.`}</p>
        : pickups.map((p) => <PlanningPlayerRow key={p.id} player={p} showWeeks={false} />)}
      <div className="t-body" style={{ fontWeight: 600, paddingTop: 4 }}>Trade with</div>
      {partners.length === 0 ? (
        <p className="t-meta muted">{`Every rival is short in week ${cell.week} too.`}</p>
      ) : (
        <>
          <p className="t-meta muted">{partners.map((t) => t.manager).join(' · ')}</p>
          <p className="t-meta faint">They can field a full lineup that week — see Trades for who they can spare.</p>
        </>
      )}
    </div>
  )
}

function LeagueGrid({ model, context }: { model: PlanningModel; context: LeagueContext }) {
  const weeks = context.remainingWeeks
  return (
    <div className="mk-table-scroll" style={{ paddingTop: 8 }}>
      <table className="mk-grid">
        <thead>
          <tr>
            <th scope="col" className="t-meta mk-grid-team">Team</th>
            {weeks.map((w) => (
              <th key={w} scope="col" className="t-meta" style={{ color: model.selectedWeek === w ? 'var(--accent)' : 'var(--text-2)', fontWeight: 400 }}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {context.teams.map((team) => (
            <tr key={team.rosterID}>
              <th scope="row" className="t-meta mk-grid-team" style={{ fontWeight: team.isUser ? 700 : 400 }}>{team.manager}</th>
              {weeks.map((w) => {
                const cell = model.cell(team.rosterID, w)
                const short = cell?.isShort === true
                return (
                  <td key={w}>
                    <span
                      className="mk-grid-cell t-meta"
                      aria-label={cell ? (short ? `Week ${w}: ${cell.shortfall} short` : `Week ${w}: full`) : `Week ${w}: no data`}
                      style={{
                        background: !short ? 'var(--inset)' : cell!.shortfall >= 2 ? 'color-mix(in srgb, var(--sit) 90%, transparent)' : 'color-mix(in srgb, var(--caution) 90%, transparent)',
                        color: short ? '#fff' : 'var(--text-2)',
                        fontWeight: short ? 700 : 400,
                      }}
                    >
                      {cell ? (cell.shortfall > 0 ? `${cell.shortfall}` : '·') : '–'}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// MARK: - Trades

function TradesSection({ model }: { model: PlanningModel }) {
  const { openTrade } = useApp()
  const noShortWeeks = model.userShortWeeks().length === 0
  return (
    <div className="mk-stack">
      <StartTradeCard disabled={model.context === undefined} onClick={() => openTrade({})} />
      {noShortWeeks ? (
        <div className="card"><StatusLabel tone="start">No short weeks — the wizard can still find an upgrade.</StatusLabel></div>
      ) : model.tradeTargets.length === 0 ? (
        <div className="card t-body muted">No rival has a spare bench player who plays in your short weeks.</div>
      ) : (
        <>
          <p className="t-meta muted">Rivals who aren't short in your problem weeks and have a bench player at a position you need.</p>
          {model.tradeTargets.map((target) => (
            <TradeTargetCard key={target.id} target={target} onStart={() => openTrade({
              positions: new Set(target.candidates.map((c) => c.position)),
              weeks: target.weeksCovered,
              rivalRosterID: target.rival.rosterID,
              theirPlayerID: target.candidates[0]?.id,
            })} />
          ))}
        </>
      )}
    </div>
  )
}

/** The wizard's front door: one clear action above the evidence. */
function StartTradeCard({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" className="card mk-start-trade" onClick={onClick} disabled={disabled} data-testid="start-trade">
      <span className="mk-start-icon" aria-hidden><Wand2 size={22} /></span>
      <span className="mk-row-text">
        <span className="t-section">Start a trade</span>
        <span className="t-meta muted">Pick a need, find who can fill it, build the deal, write the pitch.</span>
      </span>
      <ChevronRight size={18} className="faint" aria-hidden />
    </button>
  )
}

function TradeTargetCard({ target, onStart }: { target: TradeTarget; onStart?: () => void }) {
  const n = target.weeksCovered.length
  return (
    <div className="card mk-stack-tight">
      <div className="mk-row-title">
        <span className="t-section mk-ellipsis">{target.rival.manager}</span>
        <span style={{ flex: 1 }} />
        <span className="t-meta" style={{ fontWeight: 600, color: 'var(--accent)' }}>{`covers ${n} week${n === 1 ? '' : 's'}`}</span>
      </div>
      <WeekChips weeks={target.weeksCovered} />
      {target.candidates.slice(0, 4).map((p) => <PlanningPlayerRow key={p.id} player={p} showWeeks showAvailability={false} />)}
      {onStart && (
        <button type="button" className="button mk-wide" onClick={onStart}>
          <ArrowLeftRight size={15} aria-hidden /> {`Build a trade with ${target.rival.manager}`}
        </button>
      )}
    </div>
  )
}

// MARK: - Waivers

function WaiversSection({ model }: { model: PlanningModel }) {
  const { openScreen } = useApp()
  const noShortWeeks = model.userShortWeeks().length === 0
  return (
    <div className="mk-stack">
      <button type="button" className="button mk-wide mk-left" onClick={() => openScreen('waivers')}>
        <Inbox size={16} aria-hidden style={{ flex: 'none' }} />
        <span className="t-meta" style={{ fontWeight: 600 }}>Open the Waiver Board — projections, snaps, targets and expected points for every free agent</span>
      </button>
      {noShortWeeks ? (
        <div className="card mk-stack-tight">
          <SectionHeader title="Best available" subtitle="No short weeks — the best free agents by season points per game." />
          {model.bestAvailable.map((p) => <PlanningPlayerRow key={p.id} player={p} showWeeks={false} showAvailability={false} />)}
        </div>
      ) : (
        <div className="card mk-stack-tight">
          <SectionHeader title="Fills your short weeks" subtitle="Free agents at a position you need, who play that week." />
          {model.waiverFills.length === 0 && <p className="t-meta muted">No free agent with stats fills a short week.</p>}
          {model.waiverFills.map((p) => <PlanningPlayerRow key={p.id} player={p} showWeeks showAvailability={false} />)}
        </div>
      )}
      <div className="card mk-stack-tight">
        <SectionHeader title="Trending adds" subtitle="Popularity only — what leagues everywhere are adding. The only signal for DEF and IDP." />
        {model.trendingUnavailable
          ? <p className="t-meta muted">Couldn't load trending adds.</p>
          : model.waiverTrending.length === 0
            ? <p className="t-meta muted">Nobody trending is available in your league.</p>
            : null}
        {model.waiverTrending.slice(0, 8).map((p) => <PlanningPlayerRow key={p.id} player={p} showWeeks showAvailability={false} />)}
      </div>
    </div>
  )
}

// MARK: - Shared rows

function PlanningPlayerRow({ player, showWeeks = true, showAvailability = true }: { player: PlanningPlayer; showWeeks?: boolean; showAvailability?: boolean }) {
  const { services, openPlayerCard } = useApp()
  const context = services.planning.context
  const signal = player.signals[0]
  const name = player.sleeperID !== undefined && context
    ? <button type="button" className="player-name mk-name" onClick={() => openPlayerCard(player.sleeperID!, context)}>{player.name}</button>
    : <span className="mk-name" style={{ fontWeight: 500 }}>{player.name}</span>
  return (
    <div className="mk-planning-row">
      <span style={{ width: 40, flex: 'none' }}><PositionChip position={player.position} /></span>
      <span className="mk-row-text">
        <span className="mk-row-title">
          {name}
          {player.team !== undefined && <span className="t-meta muted">{player.team}</span>}
        </span>
        {showAvailability && <span className="t-meta muted">{availabilityLabel(player.availability)}</span>}
        {showWeeks && player.coversWeeks.length > 0 && <WeekChips weeks={player.coversWeeks} prefix="covers" />}
        {signal && <span className="t-meta mk-ellipsis" style={{ color: 'var(--accent)' }}>{signal.label}</span>}
      </span>
      <span className="mk-row-value">
        {player.pointsPerGame !== undefined ? (
          <>
            <span className="mk-value">{formatFixed(player.pointsPerGame, 1)}</span>
            <span className="t-meta muted">pts/gm</span>
          </>
        ) : player.popularityOnly ? (
          <>
            {player.trendingAdds !== undefined && <span className="mk-value">{compact(player.trendingAdds)}</span>}
            <span className="t-meta muted">adds</span>
          </>
        ) : (
          <span className="t-meta faint">no stats</span>
        )}
      </span>
    </div>
  )
}
