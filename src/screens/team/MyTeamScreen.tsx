/**
 * My Team (screen id `dashboard`) — a port of `DashboardView.swift`:
 * "what needs me right now" (§7.1).
 *
 * Ordered by urgency: what to fix before kickoff, then this week's game, then
 * who to pick up, then the season so far. Two zooms — This Week and Season —
 * share the hero header.
 */
import { ToolsCard } from './ToolsCard'
import { useState } from 'react'
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, Armchair, BriefcaseMedical, CalendarMinus, ChartLine, CheckCircle2,
  ChevronRight, ExternalLink, Inbox, LayoutGrid, ListOrdered, LockOpen, Newspaper, RefreshCw, SquareDashed, Trophy,
} from 'lucide-react'
import { formatFixed } from '@core/numeric'
import { formatCountdown, kickoffLabel, teamLink } from '@models/league/GameDayWindow'
import { providerLabel } from '@data/LeagueDataSource'
import {
  draftSurplus, LineupAlertKind, lineupAlertID, standingsRecord, type DashboardModel, type TrendPoint,
} from '@models/team/DashboardModel'
import { thisWeekStatus } from '@models/team/DashboardThisWeek'
import { MY_TEAM_ZOOMS, myTeamZoomLabel } from '@models/team/MyTeamModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PositionChip, SlidingPicker } from '@ui/components/Player'
import { AboutThisData, Callout, StatusLabel } from '@ui/components/Screen'
import { FreshnessBanner, InlineErrorBanner, LoadingPlaceholder } from '@ui/components/State'
import { deltaColor, one, useTick } from '../board/format'
import { ReadinessCard } from './ReadinessCard'
import { ByeStripCard, ResultsStrip, StartTradeCard, UpcomingOpponentsCard } from './SeasonSections'
import { SectionHeader } from './SectionHeader'
import { TeamHeroHeader } from './TeamHeroHeader'
import './team.css'

const compactAdds = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** "84.2–71.5 · 2 to fix", from what My Team already knows. */
function boardSummary(model: DashboardModel): string {
  const parts: string[] = []
  const week = model.thisWeek
  if (week && week.myPoints !== undefined && week.opponentPoints !== undefined && week.myPoints + week.opponentPoints > 0) {
    parts.push(`${one(week.myPoints)}–${one(week.opponentPoints)}`)
  }
  if (model.readiness) parts.push(model.readiness.problems > 0 ? `${model.readiness.problems} to fix` : 'lineup set')
  return parts.length === 0 ? 'Your week at a glance' : parts.join(' · ')
}

export function MyTeamScreen() {
  const { services, openScreen, openTrade } = useApp()
  const model = useModel(services.dashboard)
  const context = model.context

  return (
    <div className="bt-team-screen">
      <div className="bt-screen-toolbar">
        <button
          type="button"
          className="button bt-small"
          disabled={model.isLoading}
          onClick={() => void model.refresh()}
          aria-label="Refresh My Team"
        >
          <RefreshCw size={14} aria-hidden className={model.isLoading ? 'bt-spin' : undefined} /> Refresh
        </button>
      </div>

      {model.errorMessage !== undefined && context && <InlineErrorBanner message={model.errorMessage} />}

      {!context && (model.isLoading || model.errorMessage === undefined) ? (
        <LoadingPlaceholder label="Loading your league…" />
      ) : !context && model.errorMessage !== undefined ? (
        <div className="bt-stack-8" role="alert">
          <span className="t-section bt-row-6"><AlertTriangle size={18} aria-hidden /> Could not load your league</span>
          <span className="t-meta muted">{model.errorMessage}</span>
        </div>
      ) : context ? (
        <>
          <TeamHeroHeader model={model} context={context} />
          <SlidingPicker
            options={MY_TEAM_ZOOMS}
            value={model.zoom}
            onChange={(z) => { model.zoom = z }}
            label={(z) => myTeamZoomLabel[z]}
            ariaLabel="My Team view"
          />
          <div className="bt-team-zoom" key={model.zoom}>
            {model.zoom === 'thisWeek' ? (
              <>
                <BoardCard summary={boardSummary(model)} onOpen={() => openScreen('board')} />
                {model.readiness && <ReadinessCard readiness={model.readiness} onFix={() => openScreen('sitStart')} />}
                <AlertsSection model={model} />
                <ThisWeekCard model={model} />
                <WaiverTargetsSection model={model} />
                <NewsSection model={model} />
              </>
            ) : (
              <>
                <StandingsSection model={model} />
                {model.results.length > 0 && <ResultsStrip results={model.results} />}
                {model.upcoming.length > 0 && <UpcomingOpponentsCard upcoming={model.upcoming} />}
                {model.byeStrip.length > 0 && <ByeStripCard weeks={model.byeStrip} onOpen={() => openScreen('planning')} />}
                <StartTradeCard onStart={() => openTrade({})} />
                <TrendSection model={model} />
                <BenchSection model={model} />
                <DraftSection model={model} />
                <TransactionsSection model={model} />
                <ToolsCard />
              </>
            )}
          </div>
          <AboutThisData>
            <FreshnessBanner provenance={context.provenance} />
          </AboutThisData>
        </>
      ) : null}
    </div>
  )
}

// MARK: - Board link

/** A link from My Team to the Board. */
function BoardCard({ summary, onOpen }: { summary: string; onOpen: () => void }) {
  return (
    <button type="button" className="card bt-pressable bt-board-link" onClick={onOpen}>
      <span className="bt-board-link-icon" aria-hidden><LayoutGrid size={20} /></span>
      <span className="bt-grow bt-stack-2" style={{ minWidth: 0 }}>
        <span className="t-section">Board</span>
        <span className="t-meta muted bt-truncate">{summary}</span>
      </span>
      <ChevronRight size={16} color="var(--text-3)" aria-hidden />
    </button>
  )
}

// MARK: - Alerts

const alertIcon = { [LineupAlertKind.onBye]: CalendarMinus, [LineupAlertKind.emptySlot]: SquareDashed, [LineupAlertKind.injured]: BriefcaseMedical }
const alertColor = (kind: LineupAlertKind) => (kind === LineupAlertKind.onBye ? 'var(--sit)' : 'var(--caution)')

function NextLock({ model }: { model: DashboardModel }) {
  useTick(30_000)
  const next = model.nextLock
  const context = model.context
  if (next === undefined || !context) return null
  return (
    <span className="t-meta muted bt-row-6">
      <LockOpen size={13} aria-hidden />
      Next lineup lock in {formatCountdown((next - context.now()) / 1000)} ({kickoffLabel(next)})
    </span>
  )
}

function AlertsSection({ model }: { model: DashboardModel }) {
  const { openScreen } = useApp()
  if (model.alerts.length === 0) {
    return (
      <div className="card">
        <StatusLabel tone="start">Lineup looks clean for this week.</StatusLabel>
      </div>
    )
  }
  const leagueID = model.context?.league.leagueID
  return (
    <Callout tone="caution">
      <div className="bt-stack-10">
        <div className="bt-row-between">
          <h3 className="t-section bt-row-6" style={{ color: 'var(--caution)', margin: 0 }}>
            <AlertTriangle size={17} aria-hidden /> Before kickoff
          </h3>
          <button type="button" className="button bt-small" onClick={() => openScreen('sitStart')}>
            Fix in Sit/Start <ArrowRight size={13} aria-hidden />
          </button>
        </div>
        <NextLock model={model} />
        {model.alerts.map((alert) => {
          const Icon = alertIcon[alert.kind]
          const color = alertColor(alert.kind)
          return (
            <div key={lineupAlertID(alert)} className="bt-alert-row">
              <Icon size={17} color={color} aria-hidden style={{ flex: 'none', width: 20 }} />
              <div className="bt-stack-1">
                {alert.playerName && <span className="t-body" style={{ fontWeight: 600 }}>{alert.playerName}</span>}
                <span className="t-meta" style={{ color }}>{alert.detail}</span>
                {alert.asOf !== undefined && <span className="bt-t-micro-num muted">as of {kickoffLabel(alert.asOf)}</span>}
              </div>
            </div>
          )
        })}
        {model.context !== undefined && (
          <a className="t-meta bt-link bt-row-6" href={teamLink(model.context)} target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden /> Open in {providerLabel(model.context.provider)}
          </a>
        )}
      </div>
    </Callout>
  )
}

// MARK: - This week

function Score({ manager, points, average, align }: { manager: string; points?: number; average?: number; align: 'start' | 'end' }) {
  return (
    <span className={`bt-score bt-stack-2 ${align === 'end' ? 'bt-align-end' : ''}`}>
      <span className="t-body bt-truncate" style={{ fontWeight: 600 }}>{manager}</span>
      <span className="t-title">{points === undefined ? '—' : formatFixed(points, 1)}</span>
      {average !== undefined && <span className="bt-t-micro-num muted">teams avg {formatFixed(average, 1)} pts</span>}
    </span>
  )
}

function ThisWeekCard({ model }: { model: DashboardModel }) {
  const { openScreen } = useApp()
  const week = model.thisWeek
  if (!week) return null
  return (
    <button type="button" className="card bt-pressable bt-this-week bt-stack-10" onClick={() => openScreen('matchup')}>
      <span className="bt-row-between">
        <span className="t-micro muted bt-kerned">WEEK {week.week}</span>
        <span className="t-meta bt-accent-link bt-row-2">Matchup <ChevronRight size={13} aria-hidden /></span>
      </span>
      <span className="bt-row-between bt-baseline">
        <Score manager={week.myManager} points={week.myPoints} average={week.myAverageTeamTotal} align="start" />
        {week.opponentManager !== undefined && (
          <Score manager={week.opponentManager} points={week.opponentPoints} average={week.opponentAverageTeamTotal} align="end" />
        )}
      </span>
      <span className="bt-row-between">
        <span className="t-meta muted" style={{ fontWeight: 500 }}>{thisWeekStatus(week)}</span>
        <span className="t-meta muted bt-num" style={{ fontWeight: 600 }}>
          {week.opponentLeftToPlay !== undefined
            ? `${week.myLeftToPlay} vs ${week.opponentLeftToPlay} left to play`
            : `${week.myLeftToPlay} left to play`}
        </span>
      </span>
    </button>
  )
}

// MARK: - Waiver targets

function WaiverTargetsSection({ model }: { model: DashboardModel }) {
  const { openScreen } = useApp()
  if (model.waiverTargets.length === 0) return null
  return (
    <section className="card bt-stack-8">
      <SectionHeader
        title="Waiver targets"
        subtitle="Trending adds nobody in your league has. Popularity only."
        icon={Inbox}
        count={model.waiverTargets.length}
      />
      {model.waiverTargets.map((target) => (
        <div key={target.playerID} className="bt-target-row">
          <span style={{ width: 40, flex: 'none' }}><PositionChip position={target.position} /></span>
          <span className="bt-grow bt-stack-1" style={{ minWidth: 0 }}>
            <span className="bt-row-4">
              <span className="t-body bt-truncate">{target.name}</span>
              {target.team && <span className="bt-t-micro-num muted">{target.team}</span>}
            </span>
            {target.fillsNeedThisWeek && (
              <span className="bt-t-micro-num bt-row-4" style={{ color: 'var(--start)', fontWeight: 600 }}>
                <CheckCircle2 size={12} aria-hidden /> Fills a hole this week
              </span>
            )}
          </span>
          <span className="t-meta muted bt-num bt-nowrap">{compactAdds.format(target.adds)} adds</span>
        </div>
      ))}
      <button type="button" className="bt-text-button t-meta" onClick={() => openScreen('planning')}>
        <ArrowRight size={13} aria-hidden /> Plan waivers for the weeks ahead
      </button>
    </section>
  )
}

// MARK: - Standings

function StandingsSection({ model }: { model: DashboardModel }) {
  const [showAll, setShowAll] = useState(false)
  if (model.standings.length === 0) return null
  const shown = showAll ? model.standings : model.standings.slice(0, 5)
  return (
    <section className="card bt-stack-4">
      <SectionHeader title="Standings" icon={ListOrdered} />
      <ol className="bt-standings">
        {shown.map((row, index) => (
          <li key={row.rosterID} className={row.isUser ? 'bt-me' : undefined}>
            <span className="t-meta faint bt-num bt-standings-rank">{index + 1}</span>
            <span className="t-body bt-truncate bt-grow" style={{ fontWeight: row.isUser ? 600 : 400 }}>
              {row.isUser ? `${row.manager} (you)` : row.manager}
            </span>
            <span className="t-body bt-num">{standingsRecord(row)}</span>
            <span className="t-meta muted bt-num bt-standings-pf">{formatFixed(row.pointsFor, 1)}</span>
          </li>
        ))}
      </ol>
      {model.standings.length > 5 && (
        <button type="button" className="bt-text-button t-meta" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show top 5' : `Show all ${model.standings.length}`}
        </button>
      )}
    </section>
  )
}

// MARK: - Bench points

function BenchSection({ model }: { model: DashboardModel }) {
  if (model.benchWeeks.length === 0) return null
  const worst = model.benchWeeks.filter((w) => w.left > 0).sort((a, b) => b.left - a.left).slice(0, 3)
  const n = model.benchWeeks.length
  return (
    <section className="card bt-stack-8">
      <SectionHeader title="Left on your bench" subtitle="What your lineup scored against the best one you had." icon={Armchair} />
      <div className="bt-row-6 bt-baseline">
        <span className="t-display">{formatFixed(model.totalLeftOnBench, 1)}</span>
        <span className="t-meta muted">pts across {n} week{n === 1 ? '' : 's'}</span>
      </div>
      {worst.length === 0 ? (
        <span className="t-meta" style={{ color: 'var(--start)' }}>Perfect lineups every week so far.</span>
      ) : worst.map((week) => {
        const hero = week.shouldHaveStarted[0]
        return (
          <div key={week.week} className="bt-row-between bt-baseline">
            <span className="bt-stack-1" style={{ minWidth: 0 }}>
              <span className="t-meta" style={{ fontWeight: 600 }}>Week {week.week}</span>
              {hero && (
                <span className="bt-t-micro-num muted bt-truncate">should have started {hero.name} ({formatFixed(hero.points, 1)})</span>
              )}
            </span>
            <span className="t-meta bt-num" style={{ fontWeight: 600, color: 'var(--sit)' }}>−{formatFixed(week.left, 1)}</span>
          </div>
        )
      })}
    </section>
  )
}

// MARK: - Trend

function TrendBar({ point, trend }: { point: TrendPoint; trend: TrendPoint[] }) {
  const mines = trend.map((p) => p.mine).filter((v): v is number => v !== undefined)
  const avgs = trend.map((p) => p.leagueAverage).filter((v): v is number => v !== undefined)
  const maximum = Math.max(mines.length ? Math.max(...mines) : 1, avgs.length ? Math.max(...avgs) : 1)
  return (
    <span className="bt-trend-bar" aria-hidden>
      {point.mine !== undefined && maximum > 0 && (
        <span className="bt-trend-mine" style={{ width: `${Math.max(0, (point.mine / maximum) * 100)}%` }} />
      )}
      {point.leagueAverage !== undefined && maximum > 0 && (
        <span className="bt-trend-avg" style={{ left: `calc(${(point.leagueAverage / maximum) * 100}% - 1px)` }} />
      )}
    </span>
  )
}

function TrendSection({ model }: { model: DashboardModel }) {
  if (model.trend.length === 0) return null
  return (
    <section className="card bt-stack-8">
      <SectionHeader title="Weekly scoring" subtitle="You against the league average — real results only." icon={ChartLine} />
      {model.trend.map((point) => (
        <div
          key={point.week}
          className="bt-trend-row"
          aria-label={`Week ${point.week}: ${point.mine === undefined ? 'no score' : `${formatFixed(point.mine, 1)} points`}${point.leagueAverage === undefined ? '' : `, league average ${formatFixed(point.leagueAverage, 1)}`}${point.rank === undefined ? '' : `, rank ${point.rank}`}`}
          role="group"
        >
          <span className="bt-t-micro-num muted bt-num" style={{ width: 26 }}>W{point.week}</span>
          <TrendBar point={point} trend={model.trend} />
          <span className="t-meta bt-num" style={{ width: 48, textAlign: 'right' }}>{point.mine === undefined ? '—' : formatFixed(point.mine, 1)}</span>
          <span className="bt-t-micro-num muted bt-num" style={{ width: 28, textAlign: 'right' }}>{point.rank === undefined ? '' : `#${point.rank}`}</span>
        </div>
      ))}
    </section>
  )
}

// MARK: - Draft

function DraftSection({ model }: { model: DashboardModel }) {
  return (
    <section className="card bt-stack-8">
      <SectionHeader
        title="Draft value realized"
        subtitle="Each pick against what that pick number actually returned league-wide."
        icon={Trophy}
      />
      {model.draftUnavailable !== undefined ? (
        <span className="t-meta muted">{model.draftUnavailable}</span>
      ) : model.draftResults.length === 0 ? (
        <span className="t-meta muted">No graded picks yet.</span>
      ) : model.draftResults.slice(0, 6).map((pick) => {
        const surplus = draftSurplus(pick)
        return (
          <div key={pick.playerID} className="bt-target-row">
            <span style={{ width: 40, flex: 'none' }}><PositionChip position={pick.position} /></span>
            <span className="t-body bt-truncate">{pick.name}</span>
            <span className="bt-t-micro-num muted">#{pick.pickNo}</span>
            <span className="bt-grow" />
            <span className="t-meta bt-num" style={{ fontWeight: 600, color: deltaColor(surplus) }}>{formatFixed(surplus, 1, { sign: true })}</span>
          </div>
        )
      })}
    </section>
  )
}

// MARK: - News and transactions

function NewsSection({ model }: { model: DashboardModel }) {
  if (model.news.length === 0) return null
  return (
    <section className="card bt-stack-6">
      <SectionHeader title="Your players in the news" icon={Newspaper} />
      {model.news.slice(0, 6).map((item, i) => (
        <div key={`${item.title}-${i}`} className="bt-stack-1">
          <span className="t-meta clamp-2">{item.title}</span>
          {item.publishedAt && <span className="bt-t-micro-num faint">{item.publishedAt}</span>}
        </div>
      ))}
    </section>
  )
}

function TransactionsSection({ model }: { model: DashboardModel }) {
  const [showAll, setShowAll] = useState(false)
  if (model.transactions.length === 0) return null
  const shown = showAll ? model.transactions : model.transactions.slice(0, 5)
  return (
    <section className="card bt-stack-8">
      <SectionHeader title="Recent league moves" icon={ArrowLeftRight} />
      {shown.map((t) => (
        <div key={t.transactionID} className="bt-stack-1">
          <span className="bt-row-6">
            <span className="t-meta bt-truncate" style={{ fontWeight: 600 }}>{t.manager}</span>
            <span className="bt-t-micro-num muted">{t.type.replaceAll('_', ' ')}</span>
            <span className="bt-grow" />
            <span className="bt-t-micro-num faint">W{t.week}</span>
          </span>
          {t.addedNames.length > 0 && (
            <span className="bt-t-micro-num bt-truncate" style={{ color: 'var(--start)' }}>+ {t.addedNames.join(', ')}</span>
          )}
          {t.droppedNames.length > 0 && (
            <span className="bt-t-micro-num bt-truncate" style={{ color: 'var(--sit)' }}>− {t.droppedNames.join(', ')}</span>
          )}
        </div>
      ))}
      {model.transactions.length > 5 && (
        <button type="button" className="bt-text-button t-meta" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${model.transactions.length}`}
        </button>
      )}
    </section>
  )
}
