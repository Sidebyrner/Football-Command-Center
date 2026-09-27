/**
 * Injury Center — "who is hurt, who steps in, and who fills my hole". The port
 * of `InjuryCenterView`.
 *
 * Three sections, each a different source and each saying so: your roster's
 * injury signals (Sleeper tags plus the official practice report), the
 * depth-chart names behind every injured player in the league, and rivals'
 * tagged starters as trade leverage. "Find a fill" on one of your players
 * opens the Replacement Finder, ranked on one named basis at a time.
 */
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight, ArrowRight, BriefcaseMedical, CircleArrowOutUpRight, Eye, Lock, LockOpen, OctagonAlert,
  SquareArrowOutUpRight, UserCog, X,
} from 'lucide-react'
import { formatNumber } from '@core/numeric'
import { formatCountdown, kickoffLabel, sleeperTeamLink } from '@models/league/GameDayWindow'
import { availabilityLabel, blocksStart, startAvailability, type LeagueContext } from '@models/league/LeagueContext'
import {
  injuredPlayerHeadline, InjurySeverity, REPLACEMENT_BASES, REPLACEMENT_BASIS_HINT, REPLACEMENT_BASIS_LABEL,
  type InjuredPlayer, type InjuryCenterModel, type InjuryOpening, type ReplacementCandidate,
} from '@models/market/InjuryCenterModel'
import { newsPublishedAt, newsSourceLabel, type SleeperPlayerNews } from '@data/insightsModels'
import { useApp, useModel } from '@ui/app/AppContext'
import { AboutThisData, Callout, ScreenHero, ScreenSection, StatusLabel, type StatusTone } from '@ui/components/Screen'
import { PlayerAvatar, PlayerName, PositionChip, SlidingPicker, StatPill } from '@ui/components/Player'
import { CoverageNote, FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { LineupHubHeader } from './LineupHubHeader'
import { LoadFailure, RefreshButton, relativeNamed, useLeagueNow, weekdayTime } from './shared'
import '../players/sheet.css'
import './lineup.css'

const HUE = 'var(--hue-lineup)'
const one = (v: number) => formatNumber(v, 1)

/**
 * The injured players on your roster, split by what they ask of you: starters
 * ruled out need a move now; everyone else is worth watching. Worst-first
 * order is kept within each group.
 */
export function injuryGroups(roster: readonly InjuredPlayer[], context: LeagueContext): { actNow: InjuredPlayer[]; watch: InjuredPlayer[] } {
  const actNow: InjuredPlayer[] = [], watch: InjuredPlayer[] = []
  for (const player of roster) {
    if (player.isStarter && blocksStart(startAvailability(player.id, context))) actNow.push(player)
    else watch.push(player)
  }
  return { actNow, watch }
}

export function InjuriesScreen() {
  const { services } = useApp()
  const model = useModel(services.injuries)
  const context = model.context
  const [finding, setFinding] = useState<InjuredPlayer>()
  const refresh = () => { void model.refresh() }

  return (
    <>
      <LineupHubHeader current="injuries" />
      {context ? (
        <Loaded model={model} context={context} onFind={setFinding} onRefresh={refresh} />
      ) : model.isLoading || model.errorMessage === undefined ? (
        <LoadingPlaceholder label="Reading the injury report…" />
      ) : (
        <LoadFailure title="Could not load your league" message={model.errorMessage} onRetry={refresh} />
      )}
      {finding && context && (
        <ReplacementFinder model={model} context={context} injured={finding} onClose={() => setFinding(undefined)} />
      )}
    </>
  )
}

function Loaded({ model, context, onFind, onRefresh }: {
  model: InjuryCenterModel; context: LeagueContext; onFind: (p: InjuredPlayer) => void; onRefresh: () => void
}) {
  const groups = injuryGroups(model.roster, context)
  return (
    <>
      <div className="lineup-stack">
        {model.errorMessage && <InlineErrorBanner message={model.errorMessage} />}
        <Hero model={model} groups={groups} onRefresh={onRefresh} />
      </div>
      <RosterSections model={model} context={context} groups={groups} onFind={onFind} />
      <OpeningsSection model={model} context={context} />
      <RivalsSection model={model} context={context} />
      <AboutThisData>
        <FreshnessBanner provenance={context.provenance} />
        {model.sourceNotes.map((note) => <CoverageNote key={note} text={note} />)}
      </AboutThisData>
    </>
  )
}

/** The answer: how many starters are out or questionable. */
function Hero({ model, groups, onRefresh }: {
  model: InjuryCenterModel; groups: ReturnType<typeof injuryGroups>; onRefresh: () => void
}) {
  const questionable = groups.watch.filter((p) => p.isStarter).length
  const out = groups.actNow.length
  let answer: string, tone: StatusTone
  if (out > 0) {
    answer = `${out} starter${out === 1 ? '' : 's'} out`
    tone = 'sit'
  } else if (questionable > 0) {
    answer = `${questionable} questionable`
    tone = 'caution'
  } else {
    answer = 'All clear'
    tone = 'start'
  }
  return (
    <ScreenHero
      overline="Lineup · Injuries"
      icon={BriefcaseMedical}
      answer={answer}
      detail={out > 0 ? 'Swap them out before kickoff — tap one to find a fill.'
        : questionable > 0 ? 'Most questionable players play. Check inactives 90 minutes before kickoff.'
          : 'No starter carries an injury designation.'}
      stats={[
        { value: `${model.roster.length}`, label: 'on your roster tagged' },
        { value: `${model.openings.length}`, label: 'fill-ins in the league' },
      ]}
      tone={tone}
      hue={HUE}
      trailing={<RefreshButton onRefresh={onRefresh} busy={model.isLoading} />}
    />
  )
}

// MARK: - Your roster

function RosterSections({ model, context, groups, onFind }: {
  model: InjuryCenterModel; context: LeagueContext; groups: ReturnType<typeof injuryGroups>; onFind: (p: InjuredPlayer) => void
}) {
  const { openScreen } = useApp()
  return (
    <>
      <ScreenSection title="Act now" subtitle="Starters ruled out this week. Tap one to find a fill." icon={OctagonAlert} count={groups.actNow.length} hue={HUE}>
        {groups.actNow.length === 0 ? (
          <div className="card"><StatusLabel tone="start">No starter is ruled out.</StatusLabel></div>
        ) : (
          <>
            <Rows players={groups.actNow} model={model} context={context} onFind={onFind} />
            <button type="button" className="link-button lineup-link small" onClick={() => openScreen('sitStart')}>
              <ArrowLeftRight size={13} aria-hidden /> Swap them out in Sit/Start
            </button>
          </>
        )}
      </ScreenSection>
      <ScreenSection
        title="Keep an eye on"
        subtitle="Questionable starters and anyone hurt on your bench — Sleeper's tag and the practice report, worst first."
        icon={Eye}
        count={groups.watch.length}
        hue={HUE}
      >
        {groups.watch.length === 0 ? (
          <div className="card t-meta muted">Nobody else carries an injury signal.</div>
        ) : (
          <Rows players={groups.watch} model={model} context={context} onFind={onFind} />
        )}
      </ScreenSection>
    </>
  )
}

function Rows({ players, model, context, onFind }: {
  players: InjuredPlayer[]; model: InjuryCenterModel; context: LeagueContext; onFind: (p: InjuredPlayer) => void
}) {
  const now = useLeagueNow(context, 30_000)
  return (
    <>
      {players.map((player) => (
        <InjuredPlayerRow key={player.id} player={player} news={model.news[player.id]?.[0]} now={now} context={context} onFind={() => onFind(player)} />
      ))}
    </>
  )
}

function severityTone(severity: InjurySeverity): StatusTone | undefined {
  switch (severity) {
    case InjurySeverity.out: case InjurySeverity.doubtful: case InjurySeverity.reserve: return 'sit'
    case InjurySeverity.questionableNoPractice: case InjurySeverity.questionable: return 'caution'
    default: return undefined
  }
}

const toneColor: Record<StatusTone, string> = { start: 'var(--start)', caution: 'var(--caution)', sit: 'var(--sit)' }

function InjuredPlayerRow({ player, news, now, context, onFind }: {
  player: InjuredPlayer; news?: SleeperPlayerNews; now: number; context: LeagueContext; onFind: () => void
}) {
  const tone = severityTone(player.severity)
  const title = news?.metadata?.title
  const published = news ? newsPublishedAt(news) : undefined
  const body = (
    <div className="injured-row">
      <div className="injured-head">
        <PlayerAvatar sleeperID={player.id} name={player.name} position={player.position} size={36} />
        <div className="injured-main">
          <div className="injured-name-line">
            <span className="t-body"><PlayerName id={player.id} name={player.name} context={context} /></span>
            <PositionChip position={player.position} />
            {player.slotToken !== undefined
              ? <span className="t-meta muted" style={{ fontWeight: 600, fontSize: '0.6875rem' }}>{player.slotToken}</span>
              : <span className="t-meta muted" style={{ fontSize: '0.6875rem' }}>Bench</span>}
          </div>
          <span className="t-meta" style={{ fontWeight: 600, color: tone ? toneColor[tone] : 'var(--text-2)' }}>
            {injuredPlayerHeadline(player)}
          </span>
          {player.kickoff !== undefined && (
            player.isLocked ? (
              <span className="lock-line"><Lock size={10} aria-hidden />{`Locked — kicked off ${kickoffLabel(player.kickoff)}`}</span>
            ) : (
              <span className="lock-line"><LockOpen size={10} aria-hidden />{`Locks in ${formatCountdown((player.kickoff - now) / 1000)} (${kickoffLabel(player.kickoff)})`}</span>
            )
          )}
        </div>
        {player.projectedPoints !== undefined && <StatPill label="proj" value={one(player.projectedPoints)} />}
      </div>
      {news && title && (
        <div className="news">
          <span className="t-meta">{title}</span>
          <span className="t-meta muted" style={{ fontSize: '0.6875rem' }}>
            {[newsSourceLabel(news), published ? relativeNamed(published.getTime(), now) : undefined].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      <div className="injured-foot">
        <span className="t-meta tertiary" style={{ fontSize: '0.6875rem' }}>{`Tag as of ${weekdayTime(player.tagAsOf)}`}</span>
        {!player.isLocked && (
          <button type="button" className="link-button lineup-link small" onClick={onFind} aria-label={`Find a fill for ${player.name}`}>
            Find a fill <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
  return tone ? <Callout tone={tone}>{body}</Callout> : <div className="card">{body}</div>
}

// MARK: - Who benefits

function OpeningsSection({ model, context }: { model: InjuryCenterModel; context: LeagueContext }) {
  return (
    <ScreenSection
      title="Fill-ins"
      subtitle="The next names on the official depth chart behind every injured player in the league, with last game's snap share and expected points."
      icon={CircleArrowOutUpRight}
      count={model.openings.length}
      hue={HUE}
    >
      {model.openings.length === 0 ? (
        <div className="card t-meta muted">
          {context.inSeason.depthCharts === undefined
            ? 'Depth charts are not available, so successors cannot be named.'
            : 'No rostered player in the league carries a game designation.'}
        </div>
      ) : (
        model.openings.map((opening) => <OpeningCard key={opening.id} opening={opening} context={context} />)
      )}
    </ScreenSection>
  )
}

function OpeningCard({ opening, context }: { opening: InjuryOpening; context: LeagueContext }) {
  return (
    <div className="card opening">
      <div className="opening-head">
        <PositionChip position={opening.position} />
        <span className="t-body"><PlayerName id={opening.id} name={opening.injuredName} context={context} /></span>
        <span className="t-meta muted">{opening.team ?? ''}</span>
        <span style={{ flex: 1 }} />
        <span className="t-meta muted" style={{ fontSize: '0.6875rem' }}>{availabilityLabel(opening.availability)}</span>
      </div>
      <span className="t-meta" style={{ color: opening.severity <= InjurySeverity.doubtful ? 'var(--sit)' : 'var(--caution)' }}>{opening.headline}</span>
      {opening.beneficiaries.map((player) => (
        <div key={player.id} className="beneficiary">
          <span className="beneficiary-depth">{player.depthBehind}</span>
          <PlayerAvatar sleeperID={player.sleeperID} name={player.name} position={player.position} size={24} />
          <div className="beneficiary-main">
            <span className="t-meta" style={{ fontWeight: 600 }}>
              {player.sleeperID !== undefined ? <PlayerName id={player.sleeperID} name={player.name} context={context} /> : player.name}
            </span>
            <span className="t-meta" style={{ fontSize: '0.6875rem', color: player.availability.kind === 'freeAgent' ? 'var(--start)' : 'var(--text-2)' }}>
              {availabilityLabel(player.availability)}
            </span>
          </div>
          {player.lastSnapShare !== undefined && <StatPill label="snaps" value={`${formatNumber(player.lastSnapShare * 100, 0)}%`} />}
          {player.lastExpectedPoints !== undefined && <StatPill label="xFP" value={one(player.lastExpectedPoints)} />}
          {player.projectedPoints !== undefined && <StatPill label="proj" value={one(player.projectedPoints)} />}
        </div>
      ))}
    </div>
  )
}

// MARK: - Rivals

function RivalsSection({ model, context }: { model: InjuryCenterModel; context: LeagueContext }) {
  if (model.rivalInjuries.length === 0) return null
  return (
    <ScreenSection
      title="Around the league"
      subtitle="A rival with a hole is a rival who will talk. Marked when you hold a spare at that position."
      icon={UserCog}
      count={model.rivalInjuries.length}
      hue={HUE}
    >
      {model.rivalInjuries.map((rival) => (
        <div key={`${rival.rosterID}-${rival.id}`} className="card rival">
          <PositionChip position={rival.position} />
          <div className="rival-main">
            <span className="t-body"><PlayerName id={rival.id} name={rival.playerName} context={context} /></span>
            <span className="t-meta muted">{`${rival.manager} · ${rival.headline}`}</span>
          </div>
          {rival.youHaveSurplus && (
            <span className="spare"><ArrowLeftRight size={11} aria-hidden /> You have a spare</span>
          )}
        </div>
      ))}
    </ScreenSection>
  )
}

// MARK: - Replacement Finder

export function ReplacementFinder({ model, context, injured, onClose }: {
  model: InjuryCenterModel; context: LeagueContext; injured: InjuredPlayer; onClose: () => void
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const candidates = model.candidates(injured)
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="finder-title" onClick={(e) => e.stopPropagation()}>
        <button ref={close} type="button" className="icon-button sheet-close" onClick={onClose} aria-label="Done"><X size={18} /></button>
        <div className="finder">
          <div className="t-micro muted" id="finder-title">Replacement Finder</div>
          <div className="lineup-stack" style={{ gap: 4 }}>
            <h2 className="t-title" style={{ margin: 0 }}>{`Fill for ${injured.name}`}</h2>
            <p className="t-meta muted" style={{ margin: 0 }}>
              {injured.slotToken !== undefined ? `His ${injured.slotToken} slot this week.` : 'His position this week.'}
            </p>
          </div>
          <div className="lineup-stack" style={{ gap: 6 }}>
            <SlidingPicker
              options={REPLACEMENT_BASES}
              value={model.basis}
              onChange={(b) => { model.basis = b }}
              label={(b) => REPLACEMENT_BASIS_LABEL[b]}
              ariaLabel="Rank by"
            />
            <p className="t-meta muted" style={{ margin: 0 }}>{REPLACEMENT_BASIS_HINT[model.basis]}</p>
          </div>
          {candidates.length === 0 ? (
            <div className="card t-meta muted">Nobody this basis can value is available for that slot — try another basis.</div>
          ) : (
            candidates.map((c) => <CandidateRow key={c.id} candidate={c} context={context} />)
          )}
          <a className="lineup-link small" href={sleeperTeamLink(context.league.leagueID)} target="_blank" rel="noopener noreferrer">
            <SquareArrowOutUpRight size={13} aria-hidden /> Make the move in Sleeper
          </a>
        </div>
      </div>
    </div>
  )
}

function CandidateRow({ candidate, context }: { candidate: ReplacementCandidate; context: LeagueContext }) {
  const gain = candidate.lineupGain
  const detail = [candidate.team, candidate.opponent !== undefined ? `vs ${candidate.opponent}` : undefined, availabilityLabel(candidate.availability), candidate.injuryTag]
    .filter((x): x is string => x !== undefined)
    .join(' · ')
  return (
    <div className="card candidate">
      <PlayerAvatar sleeperID={candidate.id} name={candidate.name} position={candidate.position} size={32} />
      <div className="candidate-main">
        <div className="injured-name-line">
          <span className="t-body"><PlayerName id={candidate.id} name={candidate.name} context={context} /></span>
          <PositionChip position={candidate.position} />
        </div>
        <span className="t-meta" style={{ color: candidate.availability.kind === 'freeAgent' ? 'var(--start)' : 'var(--text-2)' }}>{detail}</span>
      </div>
      {candidate.value !== undefined && <StatPill label="value" value={one(candidate.value)} />}
      {gain !== undefined && (
        <StatPill label="lineup" value={gain > 0 ? `+${one(gain)}` : '—'} tint={gain > 0 ? 'var(--start)' : 'var(--text-2)'} />
      )}
    </div>
  )
}
