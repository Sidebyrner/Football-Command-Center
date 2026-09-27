/**
 * The team panels — a port of FCApp `Workspaces/Panels/TeamPanels.swift`:
 * lineup readiness, sit/start, the matchup score, injuries, bye weeks, news
 * and standings, each drawn from the model its full screen uses.
 */
import { useEffect, useReducer } from 'react'
import { ArrowUpRight, BadgeCheck, BriefcaseMedical, CalendarMinus, LockOpen, RadioTower, SquareDashed } from 'lucide-react'
import { startAvailability, startBadge } from '@models/league/LeagueContext'
import { formatCountdown, kickoffLabel } from '@models/league/GameDayWindow'
import { leftToPlay, rowIsLive, type MatchupSide } from '@models/lineup/MatchupModel'
import { LINEUP_BASIS_LABEL, type LineupChange } from '@models/lineup/SitStartModel'
import { injuredPlayerHeadline } from '@models/market/InjuryCenterModel'
import { LineupAlertKind, lineupAlertID, standingsRecord, type LineupAlert } from '@models/team/DashboardModel'
import type { LeagueContext } from '@models/league/LeagueContext'
import { useApp, useModel } from '@ui/app/AppContext'
import { ReadinessCard } from '../../team/ReadinessCard'
import type { PanelProps } from './PanelEnv'
import { usePanelEnv } from './PanelEnv'
import { PanelFootnote, PanelGate, PanelMessage, PanelPlayerRow, PanelScroll, panelFormat } from './shared'
import { slotLabel, usePanelPlayerTap } from './teamPanelParts'
import './teamPanels.css'

// MARK: - Lineup readiness

const alertIcon = (kind: LineupAlertKind) =>
  kind === LineupAlertKind.onBye ? CalendarMinus : kind === LineupAlertKind.emptySlot ? SquareDashed : BriefcaseMedical
const alertColour = (kind: LineupAlertKind) => (kind === LineupAlertKind.onBye ? 'var(--sit)' : 'var(--caution)')

/** Re-renders every `seconds` — SwiftUI's `TimelineView(.periodic)`. */
function useTick(seconds: number) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, seconds * 1000)
    return () => clearInterval(id)
  }, [seconds])
}

/**
 * Is every slot filled with someone who'll play — the readiness ring, then
 * what's wrong, then the next lock.
 */
export function LineupReadinessPanel(_: PanelProps) {
  const { services, openScreen } = useApp()
  const model = useModel(services.dashboard)
  const context = model.context
  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      <PanelScroll>
        {model.readiness && (
          <div className="tp-readiness"><ReadinessCard readiness={model.readiness} onFix={() => openScreen('sitStart')} /></div>
        )}
        {model.nextLock !== undefined && context && <NextLock next={model.nextLock} context={context} />}
        {model.alerts.map((alert) => <AlertLine key={lineupAlertID(alert)} alert={alert} context={context} />)}
      </PanelScroll>
    </PanelGate>
  )
}

function NextLock({ next, context }: { next: number; context: LeagueContext }) {
  useTick(30)
  return (
    <span className="tp-caption muted tp-label">
      <LockOpen size={13} aria-hidden />
      {`Next lock in ${formatCountdown((next - context.now()) / 1000)} · ${kickoffLabel(next)}`}
    </span>
  )
}

function AlertLine({ alert, context }: { alert: LineupAlert; context?: LeagueContext }) {
  const tap = usePanelPlayerTap(alert.playerID, context)
  const Icon = alertIcon(alert.kind)
  const colour = alertColour(alert.kind)
  return (
    <div className={`tp-alert${tap ? ' tp-tappable' : ''}`} {...tap}>
      <span className="tp-alert-icon"><Icon size={14} color={colour} aria-hidden /></span>
      <span className="tp-alert-text">
        {alert.playerName !== undefined && <span className="tp-caption tp-strong">{alert.playerName}</span>}
        <span className="tp-caption2" style={{ color: colour }}>{alert.detail}</span>
      </span>
    </div>
  )
}

// MARK: - Sit/Start

/** The recommended lineup: what changes and what it's worth, then the lineup. */
export function SitStartPanel(_: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.sitStart)
  const context = model.context
  const gain = model.gain
  const count = model.starts.length
  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      <PanelScroll>
        {gain !== undefined && gain > 0.05 ? (
          <span className="tp-subheadline tp-label" style={{ color: 'var(--start)' }}>
            <ArrowUpRight size={15} aria-hidden />
            {`${panelFormat.signed(gain)} pts with ${count} change${count === 1 ? '' : 's'}`}
          </span>
        ) : (
          <span className="tp-subheadline tp-label" style={{ color: 'var(--start)' }}>
            <BadgeCheck size={15} aria-hidden />
            Your lineup is already the best
          </span>
        )}
        {model.starts.length > 0 && <ChangeGroup title="Start" tint="var(--start)" changes={model.starts} context={context} />}
        {model.sits.length > 0 && <ChangeGroup title="Sit" tint="var(--sit)" changes={model.sits} context={context} />}
        {model.lineup.length > 0 && (
          <>
            <span className="tp-caption tp-strong muted tp-heading">Lineup</span>
            <div className="tp-rows">
              {model.lineup.map((slot) => (
                <div key={slot.index} className="tp-slot-row">
                  <span className="tp-slot">{slotLabel(slot.slot)}</span>
                  <PanelPlayerRow
                    playerID={slot.playerID} name={slot.name ?? 'Empty'}
                    position={slot.playerID !== undefined ? context?.position(slot.playerID) : undefined}
                    badge={startBadge(slot.availability)} chip={slot.isLocked ? 'locked' : undefined}
                    context={context}
                    trailing={
                      <span className="tp-caption tp-num" style={slot.changed ? { fontWeight: 700, color: 'var(--start)' } : undefined}>
                        {panelFormat.points(slot.value)}
                      </span>
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}
        <PanelFootnote text={`On ${LINEUP_BASIS_LABEL[model.basis].toLowerCase()}.`} />
      </PanelScroll>
    </PanelGate>
  )
}

function ChangeGroup({ title, tint, changes, context }: { title: string; tint: string; changes: LineupChange[]; context?: LeagueContext }) {
  return (
    <div className="tp-rows">
      <span className="tp-caption2 tp-bold" style={{ color: tint }}>{title.toUpperCase()}</span>
      {changes.map((change) => (
        <PanelPlayerRow
          key={`${change.playerID}-${change.slot}`}
          playerID={change.playerID} name={change.name} position={context?.position(change.playerID)}
          detail={slotLabel(change.slot)} badge={change.injury} context={context}
          trailing={<span className="tp-caption tp-num">{panelFormat.points(change.value)}</span>}
        />
      ))}
    </div>
  )
}

// MARK: - Matchup score

/** This week's score: live when games are on, projected before. */
export function MatchupScorePanel(_: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.matchup)
  const context = model.context
  const showingLive = model.comparisonBasis === 'livePoints'

  const total = (side: MatchupSide): number | undefined => {
    if (side.livePoints !== undefined && showingLive) return side.livePoints
    const projected = side.rows.map((r) => r.projected).filter((v): v is number => v !== undefined)
    return projected.length === 0 ? side.livePoints : projected.reduce((a, b) => a + b, 0)
  }

  const starters = (side: MatchupSide) => (
    <div className="tp-rows">
      <span className="tp-caption tp-strong muted tp-heading">Your starters</span>
      {side.rows.map((row) => (
        <div key={row.index} className="tp-slot-row">
          <span className="tp-slot">{slotLabel(row.slot)}</span>
          <PanelPlayerRow
            playerID={row.playerID} name={row.name ?? 'Empty'} position={row.position}
            detail={row.onBye ? 'Bye' : [row.nflTeam, row.opponent].filter((x): x is string => x !== undefined).join(' ')}
            chip={rowIsLive(row) ? 'live' : undefined} context={context}
            trailing={<span className="tp-caption tp-num">{panelFormat.points(showingLive ? row.livePoints : row.projected)}</span>}
          />
        </div>
      ))}
    </div>
  )

  const mine = model.mySide
  const theirs = model.opponentSide
  let body
  if (mine && theirs) {
    const my = total(mine) ?? 0
    const their = total(theirs) ?? 0
    const share = my + their > 0 ? my / (my + their) : 0.5
    body = (
      <>
        <div className="tp-scoreboard">
          <div className="tp-score-line">
            <ScoreSide name="You" points={my} leading winning={my >= their} />
            {model.anyGameLive ? (
              <span className="tp-caption2 tp-bold tp-label" style={{ color: 'var(--sit)' }}><RadioTower size={12} aria-hidden />Live</span>
            ) : (
              <span className="tp-caption2 muted">{showingLive ? 'Final so far' : 'Projected'}</span>
            )}
            <ScoreSide name={theirs.manager} points={their} leading={false} winning={their > my} />
          </div>
          <div className="tp-share" aria-hidden>
            <span className="tp-share-mine" style={{ width: `max(calc(${share * 100}% - 1px), 4px)` }} />
            <span className="tp-share-theirs" />
          </div>
          <span className="tp-caption2 muted">{`${leftToPlay(mine)} left to play · they have ${leftToPlay(theirs)}`}</span>
        </div>
        {starters(mine)}
      </>
    )
  } else if (mine) {
    body = (
      <>
        <span className="tp-caption muted">{model.noOpponentReason ?? 'No opponent this week.'}</span>
        {starters(mine)}
      </>
    )
  } else {
    body = <PanelMessage style="empty" text={model.noOpponentReason ?? 'No matchup this week.'} />
  }

  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      <PanelScroll>{body}</PanelScroll>
    </PanelGate>
  )
}

function ScoreSide({ name, points, leading, winning }: { name: string; points: number; leading: boolean; winning: boolean }) {
  return (
    <span className="tp-score-side" style={{ alignItems: leading ? 'flex-start' : 'flex-end' }}>
      <span className="tp-score tp-num" style={winning ? undefined : { color: 'var(--text-2)' }}>{panelFormat.points(points)}</span>
      <span className="tp-caption2 muted tp-ellipsis">{name}</span>
    </span>
  )
}

// MARK: - Injuries

/** Your injured players, worst first. */
export function InjuriesPanel({ rows }: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.injuries)
  const context = model.context
  return (
    <PanelGate hasContext={context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      {model.roster.length === 0 ? (
        <PanelMessage style="empty" text="No injury designations on your roster." />
      ) : (
        <PanelScroll>
          <div className="tp-rows">
            {model.roster.slice(0, rows).map((player) => (
              <PanelPlayerRow
                key={player.id}
                playerID={player.id} name={player.name} position={player.position}
                detail={injuredPlayerHeadline(player)}
                badge={context ? startBadge(startAvailability(player.id, context)) : undefined}
                chip={player.isStarter ? 'starter' : undefined} context={context}
                trailing={player.projectedPoints !== undefined
                  ? <span className="tp-caption tp-num muted">{panelFormat.points(player.projectedPoints)}</span>
                  : undefined}
              />
            ))}
          </div>
          {model.roster.length > rows && <PanelFootnote text={`${model.roster.length - rows} more in the Injury Center.`} />}
        </PanelScroll>
      )}
    </PanelGate>
  )
}

// MARK: - Bye weeks

const byeColour = (shortfall: number) =>
  shortfall === 0 ? 'color-mix(in srgb, var(--start) 35%, transparent)' : shortfall === 1 ? 'var(--caution)' : 'var(--sit)'

/**
 * Upcoming weeks as a strip of squares — how many slots you'd be short, over
 * how much of the league is short too — then which positions.
 */
export function ByeWeeksPanel(_: PanelProps) {
  const { services, openScreen } = useApp()
  const dashboard = useModel(services.dashboard)
  const planning = useModel(services.planning)
  let content
  if (dashboard.byeStrip.length === 0) {
    content = <PanelMessage style="empty" text="No bye weeks left." />
  } else {
    const short = planning.userShortWeeks()
    content = (
      <>
        <div className="tp-bye-strip">
          {dashboard.byeStrip.map((week) => (
            <div
              key={week.week} className="tp-bye-week" role="img"
              aria-label={week.yourShortfall === 0
                ? `Week ${week.week}: full lineup`
                : `Week ${week.week}: ${week.yourShortfall} short, ${week.teamsShort} of ${week.teamCount} teams short`}
            >
              <span className="tp-bye-square" style={{ background: byeColour(week.yourShortfall) }}>
                {week.yourShortfall > 0 ? week.yourShortfall : ''}
              </span>
              <span className="tp-bye-league">
                <span style={{ width: `${Math.max(0.08, week.teamsShort / Math.max(1, week.teamCount)) * 100}%` }} />
              </span>
              <span className="tp-caption2 tp-num muted">{week.week}</span>
            </div>
          ))}
        </div>
        {short.length === 0 ? (
          <span className="tp-caption tp-label" style={{ color: 'var(--start)' }}>
            <BadgeCheck size={13} aria-hidden />You can field a full lineup every week.
          </span>
        ) : (
          <div className="tp-rows">
            {short.slice(0, 4).map((cell) => (
              <button key={cell.week} type="button" className="tp-row-button" onClick={() => openScreen('planning')}>
                <span className="tp-caption tp-strong">{`Week ${cell.week}`}</span>
                <span className="tp-caption2" style={{ color: 'var(--caution)' }}>{`short ${cell.shortPositions.join(', ')}`}</span>
              </button>
            ))}
          </div>
        )}
      </>
    )
  }
  return (
    <PanelGate hasContext={dashboard.context !== undefined} isLoading={dashboard.isLoading} error={dashboard.errorMessage}>
      <PanelScroll>{content}</PanelScroll>
    </PanelGate>
  )
}

// MARK: - News

/** Your players in the news. */
export function NewsPanel({ rows }: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  let content
  if (!model.hasRelay) {
    content = <PanelMessage style="empty" text="News comes through your relay. Add it in Settings." />
  } else if (model.news.length === 0) {
    content = <PanelMessage style="empty" text="Nothing new on your players." />
  } else {
    content = (
      <PanelScroll>
        <div className="tp-rows">
          {model.news.slice(0, rows).map((item) => {
            const inner = (
              <>
                <span className="tp-caption tp-clamp3">{item.title}</span>
                {item.publishedAt !== undefined && <span className="tp-caption2" style={{ color: 'var(--text-3)' }}>{item.publishedAt}</span>}
              </>
            )
            const url = safeURL(item.url)
            return url
              ? <a key={item.title} className="tp-news tp-row-link" href={url} target="_blank" rel="noopener noreferrer">{inner}</a>
              : <div key={item.title} className="tp-news">{inner}</div>
          })}
        </div>
      </PanelScroll>
    )
  }
  return (
    <PanelGate hasContext={model.context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      {content}
    </PanelGate>
  )
}

/** Swift's `URL(string:)` gate, and only web links. */
function safeURL(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

// MARK: - Standings

/**
 * The league table. Clicking a team links it — the Trade partners panel
 * picks it out.
 */
export function StandingsPanel({ rows }: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  const { linkPublish } = usePanelEnv()
  return (
    <PanelGate hasContext={model.context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      {model.standings.length === 0 ? (
        <PanelMessage style="empty" text="The table fills in once games are played." />
      ) : (
        <PanelScroll>
          <div className="tp-rows">
            {model.standings.slice(0, rows).map((row, index) => (
              <button
                key={row.rosterID} type="button"
                className={`tp-row-button tp-standing${row.isUser ? ' tp-standing-user' : ''}`}
                onClick={() => linkPublish.handler({ kind: 'team', rosterID: row.rosterID })}
              >
                <span className="tp-caption2 tp-num tp-rank">{index + 1}</span>
                <span className={`tp-caption tp-ellipsis tp-grow${row.isUser ? ' tp-strong' : ''}`}>
                  {row.isUser ? `${row.manager} (you)` : row.manager}
                </span>
                <span className="tp-caption tp-num">{standingsRecord(row)}</span>
                <span className="tp-caption2 tp-num muted tp-pf">{panelFormat.points(row.pointsFor)}</span>
              </button>
            ))}
          </div>
        </PanelScroll>
      )}
    </PanelGate>
  )
}
