/**
 * Sit/Start — "who do I actually play" (§7.3). The port of `SitStartView`.
 *
 * One basis at a time, always named. What to do comes first — who to start and
 * who to sit — then whether the other bases agree, then the full lineup, then
 * who the basis couldn't value and why. Pull-to-refresh is the hero's refresh
 * button here.
 */
import {
  ArrowLeftRight, BadgeCheck, BriefcaseMedical, CircleArrowDown, CircleArrowUp, CircleHelp, ListChecks,
  Lock, LockOpen, SlidersHorizontal, Split, SquareArrowOutUpRight, type LucideIcon,
} from 'lucide-react'
import { formatFixed } from '@core/numeric'
import { formatCountdown, sleeperTeamLink } from '@models/league/GameDayWindow'
import { startBadge, type LeagueContext } from '@models/league/LeagueContext'
import {
  LINEUP_BASES, LINEUP_BASIS_HINT, LINEUP_BASIS_LABEL, SitStartModel, unrankedTotal, type LineupChange,
} from '@models/lineup/SitStartModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { AboutThisData, Callout, FilterChip, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { PlayerName, PositionChip } from '@ui/components/Player'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { LineupHubHeader } from './LineupHubHeader'
import { InjuryBadge, LoadFailure, RefreshButton, useLeagueNow } from './shared'
import './lineup.css'

const HUE = 'var(--hue-lineup)'
const one = (v: number | undefined) => (v === undefined ? '—' : formatFixed(v, 1))

export function SitStartScreen() {
  const { services } = useApp()
  const model = useModel(services.sitStart)
  const context = model.context
  const refresh = () => { void model.refresh() }

  return (
    <>
      <LineupHubHeader current="sitStart" />
      {context ? (
        <>
          <div className="lineup-stack">
            {model.errorMessage && <InlineErrorBanner message={model.errorMessage} />}
            <Hero model={model} context={context} onRefresh={refresh} />
          </div>

          <ScreenSection title="Optimize by" icon={SlidersHorizontal} hue={HUE}>
            <BasisPicker model={model} />
          </ScreenSection>

          {!(model.starts.length === 0 && model.moves.length === 0) ? (
            <ScreenSection title="Changes" icon={ArrowLeftRight} count={model.starts.length} hue={HUE}>
              <Recommendation model={model} context={context} />
              {model.disagreeingBases.length > 0 && <Disagreement model={model} />}
            </ScreenSection>
          ) : model.disagreeingBases.length > 0 ? (
            <Disagreement model={model} />
          ) : null}

          <LineupSection model={model} context={context} />
          <UnrankedSection model={model} context={context} />

          <AboutThisData>
            <FreshnessBanner provenance={context.provenance} />
            {context.statsSeasonNote && <CoverageNote text={context.statsSeasonNote} />}
            {model.basis === 'projected' && model.projectionSourceLabel !== undefined && (
              <CoverageNote text={`Projections: ${model.projectionSourceLabel}, scored under your league's rules.`} />
            )}
            {model.basis === 'projected' && model.projectionSourceLabel === undefined && (
              <CoverageNote text="Projections are unavailable right now, so this basis values nobody." />
            )}
            {model.basis === 'commandCenter' && (
              <CoverageNote text="Command Center: this season regressed toward last season (4 games to even), times a usage trend from expected points, times the matchup from defense-vs-position. Its own number, never blended with Rotowire's." />
            )}
            <CoverageNote text={SitStartModel.modelBasisNote} />
          </AboutThisData>
        </>
      ) : model.isLoading || model.errorMessage === undefined ? (
        <LoadingPlaceholder label="Loading your roster…" />
      ) : (
        <LoadFailure title="Could not load your roster" message={model.errorMessage} onRetry={refresh} />
      )}
    </>
  )
}

// MARK: - Hero

/** The answer: set, or how many swaps and what they're worth. */
function Hero({ model, context, onRefresh }: { model: SitStartModel; context: LeagueContext; onRefresh: () => void }) {
  const now = useLeagueNow(context, 30_000)
  const set = model.starts.length === 0 && model.moves.length === 0
  const swaps = model.starts.length
  const label = LINEUP_BASIS_LABEL[model.basis]
  const gain = model.gain
  const next = model.nextLock
  const countdown = next ? formatCountdown((next.date - now) / 1000) : undefined
  return (
    <ScreenHero
      overline="Lineup · Sit/Start"
      icon={ArrowLeftRight}
      answer={set ? 'Lineup set' : `${swaps} swap${swaps === 1 ? '' : 's'}`}
      detail={set
        ? `Already the best lineup by ${label}.`
        : `Worth ${gain === undefined ? '–' : formatFixed(gain, 1, { sign: true })} points by ${label}.`}
      tone={set ? 'start' : undefined}
      hue={HUE}
      trailing={
        <span className="hero-trailing">
          {countdown !== undefined && (
            <span className="hero-lock" aria-label={`Next lock in ${countdown}`}>
              <LockOpen size={12} aria-hidden /> {countdown}
            </span>
          )}
          <RefreshButton onRefresh={onRefresh} busy={model.isLoading} />
        </span>
      }
    />
  )
}

// MARK: - Basis

function BasisPicker({ model }: { model: SitStartModel }) {
  return (
    <div className="lineup-stack" style={{ gap: 'var(--space-s)' }}>
      <div className="chip-row" role="group" aria-label="Optimize by">
        {LINEUP_BASES.map((basis) => (
          <FilterChip key={basis} label={LINEUP_BASIS_LABEL[basis]} selected={model.basis === basis} onClick={() => { model.basis = basis }} />
        ))}
      </div>
      <p className="t-meta muted" style={{ margin: 0 }} aria-live="polite">{LINEUP_BASIS_HINT[model.basis]}</p>
    </div>
  )
}

// MARK: - The answer

function Recommendation({ model, context }: { model: SitStartModel; context: LeagueContext }) {
  const label = LINEUP_BASIS_LABEL[model.basis]
  return (
    <div className="card lineup-stack">
      {model.starts.length === 0 && model.moves.length === 0 ? (
        <div className="callout-row t-body">
          <BadgeCheck size={18} color="var(--start)" aria-hidden />
          <span>Your lineup is already the best one by <strong>{label}</strong>.</span>
        </div>
      ) : (
        <>
          {model.starts.length > 0 && (
            <ChangeList title="Start" icon={CircleArrowUp} tint="var(--start)" changes={model.starts} context={context} />
          )}
          {model.sits.length > 0 && (
            <ChangeList title="Sit" icon={CircleArrowDown} tint="var(--sit)" changes={model.sits} context={context} />
          )}
          <a className="lineup-link" href={sleeperTeamLink(context.league.leagueID)} target="_blank" rel="noopener noreferrer" style={{ paddingTop: 2 }}>
            <SquareArrowOutUpRight size={14} aria-hidden /> Make these changes in Sleeper
          </a>
          {model.moves.length > 0 && (
            <div className="moves">
              {model.moves.map((move) => (
                <div key={move.playerID} className="t-meta muted">{`${move.name} moves ${move.from} → ${move.to}`}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ChangeList({ title, icon: Icon, tint, changes, context }: {
  title: string; icon: LucideIcon; tint: string; changes: LineupChange[]; context: LeagueContext
}) {
  return (
    <div className="change-list">
      <div className="change-heading" style={{ color: tint }}>
        <Icon size={14} aria-hidden /> {title}
      </div>
      {changes.map((change) => (
        <div key={change.playerID} className="slot-row">
          <span className="slot-token">{change.slot}</span>
          <span className="slot-name t-body">
            <PlayerName id={change.playerID} name={change.name} context={context} />
          </span>
          {change.injury && <InjuryBadge label={change.injury} />}
          <span className="slot-spacer" />
          <span className="slot-value">{one(change.value)}</span>
        </div>
      ))}
    </div>
  )
}

function Disagreement({ model }: { model: SitStartModel }) {
  const bases = model.disagreeingBases
  return (
    <Callout tone="caution">
      <div className="callout-row">
        <Split size={15} color="var(--caution)" aria-hidden />
        <span>
          {`${bases.map((b) => LINEUP_BASIS_LABEL[b]).join(', ')} pick${bases.length === 1 ? 's' : ''} a different lineup — the measures disagree, so this is a judgement call, not a calculation.`}
        </span>
      </div>
    </Callout>
  )
}

// MARK: - Lineup

function LineupSection({ model, context }: { model: SitStartModel; context: LeagueContext }) {
  const locked = model.lockedStarters
  return (
    <ScreenSection
      title="Proposed lineup"
      icon={ListChecks}
      hue={HUE}
      subtitle={locked > 0 ? `${locked} starter${locked === 1 ? ' has' : 's have'} kicked off and can't be moved.` : undefined}
    >
      <div className="card lineup-card">
        {model.lineup.map((slot) => (
          <div key={slot.index} className={`slot-row proposed-row${slot.changed ? ' changed' : ''}`}>
            <span className="slot-token">{slot.slot}</span>
            <PositionChip position={slot.playerID === undefined ? undefined : context.position(slot.playerID)} />
            <span className="slot-name t-body" style={slot.playerID === undefined ? { color: 'var(--caution)' } : undefined}>
              {slot.playerID !== undefined
                ? <PlayerName id={slot.playerID} name={slot.name} context={context} />
                : (slot.name ?? 'Empty')}
            </span>
            {startBadge(slot.availability) && <InjuryBadge label={startBadge(slot.availability)!} />}
            <span className="slot-spacer" />
            {slot.isLocked ? (
              <Lock size={11} className="muted" role="img" aria-label="Locked — game started" />
            ) : slot.keptBecauseUnvalued ? (
              <span className="t-micro tertiary" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>kept</span>
            ) : null}
            <span className="slot-value">{one(slot.value)}</span>
          </div>
        ))}
        {model.lockedBench.length > 0 && (
          <p className="lineup-note">{`Already played from your bench, so they can't start: ${model.lockedBench.join(', ')}`}</p>
        )}
        {model.injuredWithoutCover.length > 0 && (
          <div className="lineup-warning">
            <BriefcaseMedical size={14} color="var(--sit)" aria-hidden />
            <span>{`Nobody on your bench can replace ${model.injuredWithoutCover.join(', ')}. Check the waiver wire before kickoff.`}</span>
          </div>
        )}
        {model.lineup.some((s) => s.availability.kind === 'questionable') && (
          <p className="lineup-note">Q players are started on their full value. Most Questionable players play — check inactives about 90 minutes before kickoff.</p>
        )}
        {model.lineup.some((s) => s.keptBecauseUnvalued) && (
          <p className="lineup-note">"Kept" slots have no value on this basis, so your current starter stays.</p>
        )}
      </div>
    </ScreenSection>
  )
}

// MARK: - Unranked

function UnrankedSection({ model, context }: { model: SitStartModel; context: LeagueContext }) {
  const unranked = model.unranked
  const total = unrankedTotal(unranked)
  if (total === 0) return null
  const label = LINEUP_BASIS_LABEL[model.basis]
  return (
    <ScreenSection title="Left out" subtitle="Players this basis can't value — never counted as zero." icon={CircleHelp} count={total} hue={HUE}>
      <div className="card lineup-stack" style={{ gap: 'var(--space-s)' }}>
        <Group title="Injured — never recommended to start" names={unranked.injured} tint="var(--sit)" />
        <Group title="On bye this week" names={unranked.onBye} tint="var(--sit)" />
        <Group title="No stats for DEF and IDP" names={unranked.noProductionData} />
        <Group title={`No ${label.toLowerCase()} value in ${context.statsSeason}`} names={unranked.noSeasonLine} />
        <Group title="No recorded line for their game" names={unranked.noGameLine} />
        <Group title="No projection this week" names={unranked.noProjection} />
        <Group title="No Sleeper stat line this season, and nothing to project from" names={unranked.noSleeperLine} />
      </div>
    </ScreenSection>
  )
}

function Group({ title, names, tint = 'var(--text-2)' }: { title: string; names: string[]; tint?: string }) {
  if (names.length === 0) return null
  return (
    <div className="unranked-group">
      <div className="t-meta" style={{ color: tint }}>{title}</div>
      <div className="t-meta muted">{names.join(', ')}</div>
    </div>
  )
}
