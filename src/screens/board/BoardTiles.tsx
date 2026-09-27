/**
 * The Board's tiles — a port of `Board/BoardTiles.swift`. Each tile observes
 * only the model it shows, so a live score tick redraws the score and nothing
 * else; each opens the screen behind it.
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  BriefcaseMedical, CalendarX2, ChartLine, ChevronRight, CircleDot, Footprints, Goal, Inbox, ListChecks, ListOrdered,
  Newspaper, Users, type LucideIcon,
} from 'lucide-react'
import { IDP, type Position } from '@core/Position'
import type { SleeperGameScore } from '@data/gameScore'
import { GameDayModel, gameClock, pairGames, type GameWithPlayers } from '@models/gameday/GameDayModel'
import { blocksStart, startAvailability, startBadge } from '@models/league/LeagueContext'
import { hasLiveGame, leftToPlay, type MatchupRow, type MatchupSide } from '@models/lineup/MatchupModel'
import { WAIVER_SORT_LABEL, WAIVER_SORT_UNIT, waiverRowValue, waiverSortIsPercent, type WaiverRow, type WaiverSort } from '@models/market/WaiverBoardModel'
import type { Observable } from '@models/Observable'
import type { Screen } from '@models/navigation/screens'
import { boardTileDestination, boardTileTitle, type BoardTile } from '@models/team/BoardTile'
import { isAllClear } from '@models/team/MyTeamModel'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar } from '@ui/components/Player'
import { StatusLabel } from '@ui/components/Screen'
import { hueForScreen } from '@ui/hues'
import { ReadinessRing } from '../team/ReadinessCard'
import { LiveBadge } from './LiveIndicators'
import { one, ordinal, panelPoints, panelSigned, shortName, useTick } from './format'
import './board.css'

/** The SF Symbols of `BoardTile.systemImage`, as lucide icons. */
export const boardTileIcon: Record<BoardTile, LucideIcon> = {
  liveMatchup: Users,
  games: Goal,
  readiness: ListChecks,
  injuries: BriefcaseMedical,
  topPickup: Inbox,
  streams: Footprints,
  standings: ListOrdered,
  scoringTrend: ChartLine,
  news: Newspaper,
  byeWeeks: CalendarX2,
}

/** One tile, dispatched to its view. */
export function BoardTileView({ tile }: { tile: BoardTile }) {
  switch (tile) {
    case 'liveMatchup': return <LiveMatchupTile />
    case 'games': return <GamesTile />
    case 'readiness': return <ReadinessTile />
    case 'injuries': return <InjuriesTile />
    case 'topPickup': return <TopPickupTile />
    case 'streams': return <StreamsTile />
    case 'standings': return <StandingsTile />
    case 'scoringTrend': return <ScoringTrendTile />
    case 'news': return <NewsTile />
    case 'byeWeeks': return <ByesTile />
  }
}

/**
 * The chrome every tile shares: icon and title, a chevron, and the whole card
 * as one click target opening the tile's screen. The target is a button laid
 * over the card, so a tile may hold buttons of its own (the streams tile).
 */
function BoardTileCard({ tile, accessory, destination, children }: {
  tile: BoardTile
  accessory?: ReactNode
  destination?: Screen
  children: ReactNode
}) {
  const { openScreen } = useApp()
  const target = destination ?? boardTileDestination(tile)
  const hue = hueForScreen(target)
  const Icon = boardTileIcon[tile]
  return (
    <article className="card bt-tile" style={{ '--hue': hue } as CSSProperties} data-tile={tile}>
      <button type="button" className="bt-tile-hit" aria-label={`${boardTileTitle[tile]} — open`} onClick={() => openScreen(target)} />
      <div className="bt-tile-header">
        <Icon size={13} strokeWidth={2.6} color={hue} aria-hidden />
        <h3 className="t-micro muted bt-tile-title">{boardTileTitle[tile]}</h3>
        <span className="bt-grow" />
        {accessory}
        <ChevronRight size={13} strokeWidth={3} color="var(--text-3)" aria-hidden />
      </div>
      <div className="bt-tile-body">{children}</div>
    </article>
  )
}

/** A quiet line for a tile with nothing to show yet. */
function TileNote({ text }: { text: string }) {
  return <p className="t-meta muted bt-tile-note">{text}</p>
}

// MARK: - Matchup

const ahead = (a: MatchupSide | undefined, b: MatchupSide | undefined) => (a?.livePoints ?? 0) > (b?.livePoints ?? 0)

function MatchupSideView({ name, points, leading, isAhead }: { name: string; points?: number; leading: boolean; isAhead: boolean }) {
  return (
    <div className={`bt-matchup-side${leading ? '' : ' bt-trailing'}`}>
      <span className="t-display bt-num" style={{ color: isAhead ? 'var(--text)' : 'var(--text-2)' }}>
        {points === undefined ? '–' : one(points)}
      </span>
      <span className="t-meta muted bt-truncate" style={{ fontWeight: 500 }}>{name}</span>
    </div>
  )
}

function ShareBar({ mine, theirs }: { mine?: number; theirs?: number }) {
  const total = Math.max(0, mine ?? 0) + Math.max(0, theirs ?? 0)
  const share = total > 0 ? Math.max(0, mine ?? 0) / total : 0.5
  return (
    <div className="bt-share-bar" aria-hidden>
      <span className="bt-share-mine" style={{ width: `max(4px, calc(${share * 100}% - 1px))` }} />
      <span className="bt-share-theirs" />
    </div>
  )
}

function ago(date: number, now: number): string {
  const seconds = Math.max(0, Math.trunc((now - date) / 1000))
  return seconds < 60 ? `${seconds}s ago` : `${Math.trunc(seconds / 60)}m ago`
}

function UpdatedAgo({ updated, now }: { updated: number; now: () => number }) {
  useTick(10_000)
  return <span className="bt-t-micro-num faint">updated {ago(updated, now())}</span>
}

function LiveMatchupTile() {
  const { services } = useApp()
  const matchup = useModel(services.matchup)
  const gameDay = useModel(services.gameDay)
  const mine = matchup.mySide
  const theirs = matchup.opponentSide
  const live = (mine ? hasLiveGame(mine) : false) || (theirs ? hasLiveGame(theirs) : false)
  const updated = matchup.lastLiveUpdate ?? gameDay.lastUpdate
  return (
    <BoardTileCard tile="liveMatchup" accessory={live ? <LiveBadge /> : undefined}>
      {mine ? (
        <>
          <div className="bt-matchup-scores" aria-live="polite">
            <MatchupSideView name={mine.manager} points={mine.livePoints} leading isAhead={ahead(mine, theirs)} />
            <span className="t-meta faint">vs</span>
            {theirs ? (
              <MatchupSideView name={theirs.manager} points={theirs.livePoints} leading={false} isAhead={ahead(theirs, mine)} />
            ) : (
              <span className="t-meta muted">{matchup.noOpponentReason ?? 'No opponent'}</span>
            )}
          </div>
          <ShareBar mine={mine.livePoints} theirs={theirs?.livePoints} />
          <div className="bt-row-between">
            <span className="t-meta muted">
              {[`You: ${leftToPlay(mine)} to play`, ...(theirs ? [`Them: ${leftToPlay(theirs)}`] : [])].join(' · ')}
            </span>
            {updated !== undefined && live && (
              // Measured on the league's clock, which a demo or test fixes.
              <UpdatedAgo updated={updated} now={() => matchup.context?.now() ?? Date.now()} />
            )}
          </div>
        </>
      ) : matchup.isLoading ? (
        <div className="bt-tile-spinner" role="status" aria-label="Loading" />
      ) : (
        <TileNote text={matchup.errorMessage === undefined ? 'No matchup this week.' : "Couldn't load the matchup."} />
      )}
    </BoardTileCard>
  )
}

// MARK: - Games

function GamesTile() {
  const { services } = useApp()
  const gameDay = useModel(services.gameDay)
  const matchup = useModel(services.matchup)
  const games = pairGames(gameDay.games, matchup.mySide?.rows ?? [], matchup.opponentSide?.rows ?? [])
  const shown = games.slice(0, 6)
  return (
    <BoardTileCard tile="games" accessory={gameDay.anyLive ? <LiveBadge /> : undefined}>
      {games.length === 0 ? (
        <TileNote text={gameDay.unavailable
          ? "Live game states aren't available right now — scores still come from your matchup."
          : "None of this week's games involve your starters yet."}
        />
      ) : (
        <>
          <ul className="bt-game-list">
            {shown.map((item) => <GameRow key={item.id} item={item} />)}
          </ul>
          <span className="bt-t-micro-num faint">{GameDayModel.source}</span>
        </>
      )}
    </BoardTileCard>
  )
}

function pregameLine(game: SleeperGameScore): string {
  // The kickoff is already on the right of the row.
  const parts: string[] = []
  if (game.channel) parts.push(game.channel)
  let favourite: [string, number] | undefined
  for (const entry of Object.entries(game.spread)) if (!favourite || entry[1] < favourite[1]) favourite = entry
  if (favourite && favourite[1] < 0) parts.push(`${favourite[0]} ${one(favourite[1])}`)
  if (game.forecastWindMph !== undefined && game.forecastWindMph >= 15) parts.push(`wind ${Math.trunc(game.forecastWindMph)} mph`)
  return parts.join(' · ')
}

function GameTeam({ code, score, game }: { code: string; score?: number; game: SleeperGameScore }) {
  return (
    <span className="bt-game-team">
      {game.possession === code && game.status === 'inProgress' && (
        <CircleDot size={11} color="var(--text-2)" role="img" aria-label="has the ball" />
      )}
      <span className="t-body" style={{ fontWeight: 600 }}>{code}</span>
      {score !== undefined && <span className="t-body bt-num">{score}</span>}
    </span>
  )
}

function PlayerChip({ row, mine }: { row: MatchupRow; mine: boolean }) {
  return (
    <span className={`bt-player-chip${mine ? ' bt-mine' : ''}`}>
      <span className="bt-player-chip-dot" aria-hidden />
      <span className="bt-sr-only">{mine ? 'Yours: ' : 'Theirs: '}</span>
      <span>{shortName(row.name ?? '')}</span>
      {row.livePoints !== undefined && <span className="muted bt-num">{one(row.livePoints)}</span>}
    </span>
  )
}

function GameRow({ item }: { item: GameWithPlayers }) {
  const game = item.game
  const pregame = game.status === 'pregame' ? pregameLine(game) : ''
  const down = game.status === 'inProgress' ? game.downAndDistance : undefined
  const downLine = down === undefined
    ? undefined
    : down + (game.yardLine !== undefined ? ` at ${game.yardLineTerritory !== undefined ? `${game.yardLineTerritory} ` : ''}${game.yardLine}` : '')
  return (
    <li className="bt-game-row">
      <div className="bt-row-8">
        <GameTeam code={game.away} score={game.awayScore} game={game} />
        <span className="bt-t-micro-num faint">@</span>
        <GameTeam code={game.home} score={game.homeScore} game={game} />
        <span className="bt-grow" />
        {game.isRedZone && <span className="bt-red-zone">RED ZONE</span>}
        <span className="t-meta bt-num" style={{ fontWeight: 600, color: game.status === 'inProgress' ? 'var(--sit)' : 'var(--text-2)' }}>
          {gameClock(game)}
        </span>
      </div>
      {downLine !== undefined ? (
        <span className="bt-t-micro-num muted">{downLine}</span>
      ) : pregame !== '' ? (
        <span className="bt-t-micro-num muted">{pregame}</span>
      ) : null}
      <div className="bt-player-chips">
        {item.mine.map((row, i) => <PlayerChip key={`m${i}`} row={row} mine />)}
        {item.theirs.map((row, i) => <PlayerChip key={`t${i}`} row={row} mine={false} />)}
      </div>
    </li>
  )
}

// MARK: - Lineup

function ReadinessTile() {
  const { services } = useApp()
  const dashboard = useModel(services.dashboard)
  const sitStart = useModel(services.sitStart)
  const readiness = dashboard.readiness
  const swaps = sitStart.starts.length
  return (
    <BoardTileCard tile="readiness">
      {readiness ? (
        <div className="bt-row-10">
          <ReadinessRing readiness={readiness} size={52} lineWidth={7} />
          <div className="bt-stack-2">
            {isAllClear(readiness) && swaps === 0 ? (
              <StatusLabel tone="start">Set</StatusLabel>
            ) : (
              <>
                {readiness.problems > 0 && <span className="t-body" style={{ fontWeight: 600, color: 'var(--sit)' }}>{readiness.problems} to fix</span>}
                {readiness.caution > 0 && <span className="t-meta" style={{ color: 'var(--caution)' }}>{readiness.caution} questionable</span>}
                {swaps > 0 && <span className="t-meta muted">{swaps} swap{swaps === 1 ? '' : 's'} suggested</span>}
              </>
            )}
          </div>
        </div>
      ) : (
        <TileNote text="Lineup loading…" />
      )}
    </BoardTileCard>
  )
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="bt-stack-0">
      <span className="t-title bt-num" style={{ color: n > 0 ? color : 'var(--text-2)' }}>{n}</span>
      <span className="bt-t-micro-num muted">{label}</span>
    </div>
  )
}

function InjuriesTile() {
  const { services } = useApp()
  const model = useModel(services.injuries)
  const context = model.context
  let body: ReactNode
  if (!context) {
    body = <TileNote text="Injuries loading…" />
  } else {
    const starters = model.roster.filter((p) => p.isStarter)
    const blocked = starters.filter((p) => blocksStart(startAvailability(p.id, context)))
    const questionable = starters.filter((p) => startAvailability(p.id, context).kind === 'questionable')
    if (blocked.length === 0 && questionable.length === 0) {
      body = (
        <>
          <StatusLabel tone="start">All clear</StatusLabel>
          <span className="t-meta muted">No starter is hurt.</span>
        </>
      )
    } else {
      const top = blocked[0] ?? questionable[0]
      body = (
        <>
          <div className="bt-row-12">
            <Count n={blocked.length} label="out" color="var(--sit)" />
            <Count n={questionable.length} label="Q" color="var(--caution)" />
          </div>
          {top && (
            <span className="t-meta muted bt-truncate">
              {shortName(top.name)} · {startBadge(startAvailability(top.id, context)) ?? ''}
            </span>
          )}
        </>
      )
    }
  }
  return <BoardTileCard tile="injuries">{body}</BoardTileCard>
}

// MARK: - Market

function waiverValueText(row: WaiverRow, sort: WaiverSort): string {
  const value = waiverRowValue(row, sort)
  if (value === undefined) return '—'
  if (waiverSortIsPercent(sort)) return `${Math.round(value * 100)}%`
  if (sort === 'projectedOverLine') return panelSigned(value)
  return panelPoints(value)
}

function TopPickupTile() {
  const { services } = useApp()
  const model = useModel(services.waivers)
  const row = model.rows[0]
  return (
    <BoardTileCard tile="topPickup">
      {row ? (
        <>
          <div className="bt-row-8">
            <PlayerAvatar sleeperID={row.id} name={row.name} position={row.position} size={30} />
            <div className="bt-stack-1" style={{ minWidth: 0 }}>
              <span className="t-body bt-truncate" style={{ fontWeight: 600 }}>{shortName(row.name)}</span>
              <span className="bt-t-micro-num muted">{[row.position, row.team].filter((s) => s !== undefined).join(' · ')}</span>
            </div>
          </div>
          {waiverRowValue(row, model.sort) !== undefined ? (
            <span className="t-meta bt-num" style={{ fontWeight: 600, color: 'var(--start)' }}>
              {waiverValueText(row, model.sort)} {WAIVER_SORT_UNIT[model.sort]}
            </span>
          ) : (
            <span className="bt-t-micro-num muted">Top by {WAIVER_SORT_LABEL[model.sort].toLowerCase()}</span>
          )}
        </>
      ) : (
        <TileNote text={model.isLoading ? 'Ranking free agents…' : 'Nobody on the Waiver Board.'} />
      )}
    </BoardTileCard>
  )
}

/** What the streams tile needs from any stream screen model. */
interface StreamLineModel extends Observable {
  isLoading: boolean
  report?: {
    ranked: readonly { id: string; name: string; opponent: string; expPts: number }[]
    incumbent?: { id: string; expPts: number }
  }
}

function StreamLine({ label, model: source, screen }: { label: string; model: StreamLineModel; screen: Screen }) {
  const { openScreen } = useApp()
  const model = useModel(source)
  const best = model.report?.ranked[0]
  const incumbent = model.report?.incumbent
  const gain = best && incumbent && incumbent.id !== best.id ? best.expPts - incumbent.expPts : undefined
  return (
    <li>
      <button type="button" className="bt-stream-line" onClick={() => openScreen(screen)}>
        <span className="bt-stream-label bt-t-micro-num">{label}</span>
        {best ? (
          <>
            <span className="t-meta bt-truncate" style={{ fontWeight: 600 }}>{shortName(best.name)}</span>
            <span className="bt-t-micro-num muted bt-truncate">{best.opponent}</span>
            <span className="bt-grow" />
            {gain !== undefined && (
              <span className="bt-t-micro-num bt-num" style={{ color: gain > 0 ? 'var(--start)' : 'var(--text-2)' }}>{panelSigned(gain)}</span>
            )}
            <span className="t-meta bt-num" style={{ fontWeight: 600 }}>{one(best.expPts)}</span>
          </>
        ) : (
          <>
            <span className="t-meta faint">{model.isLoading ? 'Ranking…' : 'No stream'}</span>
            <span className="bt-grow" />
          </>
        )}
      </button>
    </li>
  )
}

/** The best stream this week at each position the league starts. */
function StreamsTile() {
  const { services } = useApp()
  const dashboard = useModel(services.dashboard)
  const started = new Set<Position>(dashboard.context?.template.starters.flatMap((s) => [...s.eligible]) ?? [])
  const startsIDP = [...IDP].some((p) => started.has(p))
  return (
    <BoardTileCard tile="streams">
      <ul className="bt-stream-lines">
        {started.has('QB') && <StreamLine label="QB" model={services.qbStream} screen="qbStream" />}
        {started.has('RB') && <StreamLine label="RB" model={services.rbStream} screen="rbStream" />}
        {started.has('WR') && <StreamLine label="WR" model={services.wrStream} screen="wrStream" />}
        {started.has('K') && <StreamLine label="K" model={services.kStream} screen="kStream" />}
        {started.has('DEF') && <StreamLine label="D/ST" model={services.dstStream} screen="dstStream" />}
        {startsIDP && <StreamLine label="IDP" model={services.idpStream} screen="idpStream" />}
      </ul>
    </BoardTileCard>
  )
}

// MARK: - Season

function StandingsTile() {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  const index = model.standings.findIndex((r) => r.isUser)
  const row = model.standings[index]
  return (
    <BoardTileCard tile="standings">
      {row ? (
        <>
          <span className="t-title">{ordinal(index + 1)}</span>
          <span className="t-meta muted">
            of {model.standings.length} · {row.wins}-{row.losses}{row.ties > 0 ? `-${row.ties}` : ''}
          </span>
          <span className="bt-t-micro-num faint bt-num">{one(row.pointsFor)} PF</span>
        </>
      ) : (
        <TileNote text={model.context === undefined ? 'Standings loading…' : 'No games played yet.'} />
      )}
    </BoardTileCard>
  )
}

/** A small line chart — you against the league average — standing in for Swift Charts. */
function TrendChart({ points }: { points: { week: number; mine: number; leagueAverage?: number }[] }) {
  const width = 300
  const height = 110
  const left = 30
  const bottom = 18
  const values = points.flatMap((p) => (p.leagueAverage !== undefined ? [p.mine, p.leagueAverage] : [p.mine]))
  const niceMax = (() => {
    const max = Math.max(...values, 1)
    const step = max > 100 ? 50 : max > 40 ? 20 : 10
    return Math.ceil(max / step) * step
  })()
  const ticks = [0, niceMax / 2, niceMax]
  const x = (i: number) => left + 6 + (points.length <= 1 ? (width - left - 12) / 2 : (i * (width - left - 12)) / (points.length - 1))
  const y = (v: number) => 4 + (1 - v / niceMax) * (height - bottom - 4)
  const path = (vs: (number | undefined)[]) =>
    vs.map((v, i) => (v === undefined ? '' : `${i === 0 || vs[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(' ')
  const label = `Weekly scoring: ${points.map((p) => `week ${p.week} ${one(p.mine)}${p.leagueAverage !== undefined ? ` (league ${one(p.leagueAverage)})` : ''}`).join('; ')}`
  return (
    <svg className="bt-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="none">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={width} y1={y(t)} y2={y(t)} stroke="var(--stroke)" strokeWidth={0.5} />
          <text x={left - 4} y={y(t) + 3} textAnchor="end" className="bt-chart-label">{Math.round(t)}</text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.week} x={x(i)} y={height - 4} textAnchor="middle" className="bt-chart-label">W{p.week}</text>
      ))}
      <path d={path(points.map((p) => p.leagueAverage))} fill="none" stroke="color-mix(in srgb, var(--text-2) 60%, transparent)" strokeWidth={1.5} strokeDasharray="4 3" />
      <path d={path(points.map((p) => p.mine))} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={p.week} cx={x(i)} cy={y(p.mine)} r={2.5} fill="var(--accent)" />)}
    </svg>
  )
}

function Legend({ color, text, dashed = false }: { color: string; text: string; dashed?: boolean }) {
  return (
    <span className="bt-legend-item bt-t-micro-num muted">
      <span className={`bt-legend-swatch${dashed ? ' bt-dashed' : ''}`} style={{ '--swatch': color } as CSSProperties} aria-hidden />
      {text}
    </span>
  )
}

function ScoringTrendTile() {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  const points = model.trend
    .filter((p) => p.mine !== undefined)
    .map((p) => ({ week: p.week, mine: p.mine!, leagueAverage: p.leagueAverage }))
  return (
    <BoardTileCard tile="scoringTrend">
      {points.length === 0 ? (
        <TileNote text="No finished weeks yet." />
      ) : (
        <>
          <TrendChart points={points} />
          <div className="bt-row-10">
            <Legend color="var(--accent)" text="You" />
            <Legend color="var(--text-2)" text="League avg" dashed />
          </div>
        </>
      )}
    </BoardTileCard>
  )
}

function NewsTile() {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  return (
    <BoardTileCard tile="news">
      {!model.hasRelay ? (
        <TileNote text="News about your players comes through your relay — add one in Settings." />
      ) : model.news.length === 0 ? (
        <TileNote text="Nothing new on your players." />
      ) : (
        <ul className="bt-news-list">
          {model.news.slice(0, 3).map((item, i) => (
            <li key={`${item.title}-${i}`} className="t-meta clamp-2" style={{ fontWeight: 500 }}>{item.title}</li>
          ))}
        </ul>
      )}
    </BoardTileCard>
  )
}

function ByesTile() {
  const { services } = useApp()
  const model = useModel(services.dashboard)
  const week = model.byeStrip.find((w) => w.yourShortfall > 0)
  return (
    <BoardTileCard tile="byeWeeks">
      {week ? (
        <>
          <span className="t-section">Week {week.week}</span>
          <span className="t-meta" style={{ color: 'var(--caution)' }}>
            {week.yourShortfall} starter{week.yourShortfall === 1 ? '' : 's'} short
          </span>
        </>
      ) : model.context !== undefined ? (
        <>
          <StatusLabel tone="start">Covered</StatusLabel>
          <span className="t-meta muted">No bye leaves a hole.</span>
        </>
      ) : (
        <TileNote text="Byes loading…" />
      )}
    </BoardTileCard>
  )
}

