/**
 * The Discovery panels — a port of FCApp `Workspaces/Panels/DiscoveryPanels.swift`
 * (Discovery list, Profile, News, Game log, Schedule) and `PlayerSearchPanel.swift`.
 * The detail panels follow the linked player through `LinkedCardGate`.
 */
import { useMemo, useState, type MouseEvent } from 'react'
import { ArrowUpDown, CheckCircle2, ListFilter, PlusCircle, Search, XCircle } from 'lucide-react'
import { formatFixed } from '@core/numeric'
import { gradeTier, isThin, SITUATION } from '@core/PlayerGrade'
import { POSITIONS, type Position } from '@core/Position'
import { newsID, newsPublishedAt, newsSourceLabel, type SleeperPlayerNews } from '@data/insightsModels'
import { playerPosition, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '@models/league/LeagueContext'
import { availabilityLabel } from '@models/league/LeagueContext'
import {
  DISCOVERY_SORTS, discoverySortFromStorageKey, discoverySortLabel, discoverySortStorageKey,
  discoverySortUnit, type DiscoverySort,
} from '@models/market/DiscoveryModel'
import { PlayerSchedule, type PlayerSchedule as Schedule, type PlayerScheduleWeek } from '@models/market/PlayerSchedule'
import { waiverRowValue, type WaiverRow } from '@models/market/WaiverBoardModel'
import type { PlayerCardModel, PlayerLogWeek } from '@models/player/PlayerCardModel'
import {
  LINK_GROUP_COLOR, panelCompareIsAvailable, panelPlayerTapHelp, panelPlayerTapOutcome,
} from '@models/workspaces/PanelEnvironment'
import { playerLookupMatches } from '@models/workspaces/PlayerLookup'
import { useApp, useModel } from '@ui/app/AppContext'
import { PlayerAvatar } from '@ui/components/Player'
import { shortName } from '../../board/format'
import { usePanelEnv, type PanelProps } from './PanelEnv'
import {
  LinkedCardGate, PanelFootnote, PanelGate, PanelMessage, PanelPlayerHeader, PanelPlayerRow, PanelScroll, panelFormat,
} from './shared'
import {
  bioLine, discoveryFootnote, formatDiscoveryValue, GAME_LOG_FOOTNOTE, profileInjuryText, relativeDate,
  scheduleFootnote, waiverBadge,
} from './discoveryFormat'
import './discoveryPanels.css'

const asPosition = (raw: string | undefined): Position | undefined =>
  raw !== undefined && (POSITIONS as readonly string[]).includes(raw) ? (raw as Position) : undefined

/** Swift `panelPlayerTap` for rows that aren't a `PanelPlayerRow`. */
function usePlayerTap(context: LeagueContext | undefined) {
  const env = usePanelEnv()
  const { openPlayerCard } = useApp()
  const onTap = (playerID: string) => (e: MouseEvent) => {
    switch (panelPlayerTapOutcome(env.linkPublish, env.compare, context !== undefined, e.metaKey || e.ctrlKey)) {
      case 'toggleCompare': env.compare.toggle(playerID); break
      case 'publish': env.linkPublish.handler({ kind: 'player', playerID }); break
      case 'openCard': if (context) openPlayerCard(playerID, context); break
      case 'none': break
    }
  }
  return { onTap, help: panelPlayerTapHelp(env.linkPublish, env.compare) }
}

// MARK: - Discovery list

/**
 * Every free agent at the positions you start: search, position, sort, and
 * a click sends the player to the linked panels.
 */
export function DiscoveryListPanel({ settings, rows }: PanelProps) {
  const { services } = useApp()
  const model = useModel(services.discovery)
  const { compare } = usePanelEnv()
  const panelPosition = asPosition(settings.positionFilter)
  const storedSort = settings.extra['sort']
  const panelSort = storedSort !== undefined ? discoverySortFromStorageKey(storedSort) : undefined
  const sort = panelSort ?? model.sort
  const all = model.context ? model.rows(panelPosition, panelSort) : []
  const shown = all.slice(0, rows)
  return (
    <PanelGate hasContext={model.context !== undefined} isLoading={model.isLoading} error={model.errorMessage}>
      <div className="dp-root">
        <div className="dp-controls">
          <div className="dp-controls-top">
            <SearchField value={model.query} onChange={(q) => { model.query = q }} placeholder="Search players or teams" />
            <label className="dp-toggle">
              <input type="checkbox" role="switch" checked={model.includeRivalBenches}
                onChange={(e) => { model.includeRivalBenches = e.target.checked }} />
              Rival benches
            </label>
          </div>
          {(panelPosition === undefined || panelSort === undefined) && (
            <div className="dp-controls-menus">
              {panelPosition === undefined && (
                <span className="dp-chip">
                  <ListFilter size={12} aria-hidden />
                  {model.positionFilter ?? 'All positions'}
                  <select aria-label="Position" value={model.positionFilter ?? ''}
                    onChange={(e) => { model.positionFilter = asPosition(e.target.value) }}>
                    <option value="">All positions</option>
                    {model.filterablePositions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </span>
              )}
              {panelSort === undefined && (
                <span className="dp-chip">
                  <ArrowUpDown size={12} aria-hidden />
                  {discoverySortLabel(model.sort)}
                  <select aria-label="Sort" value={discoverySortStorageKey(model.sort)}
                    onChange={(e) => {
                      const next = discoverySortFromStorageKey(e.target.value)
                      if (next) model.sort = next
                    }}>
                    {DISCOVERY_SORTS.map((s) => (
                      <option key={discoverySortStorageKey(s)} value={discoverySortStorageKey(s)}>{discoverySortLabel(s)}</option>
                    ))}
                  </select>
                </span>
              )}
            </div>
          )}
        </div>
        {all.length === 0 ? (
          <PanelMessage style="empty" text={model.query === ''
            ? 'No free agents at the positions your league starts.'
            : `Nobody matches “${model.query}”.`} />
        ) : (
          <PanelScroll>
            {shown.map((row) => (
              <PanelPlayerRow key={row.id} playerID={row.id} name={row.name} position={row.position}
                detail={[row.position, row.team, row.opponent].filter((x): x is string => x !== undefined).join(' · ')}
                badge={waiverBadge(row.injuryTag)}
                chip={row.availability.kind === 'freeAgent' ? undefined : availabilityLabel(row.availability)}
                trailing={<DiscoveryTrailing row={row} sort={sort} />}
                context={model.context} />
            ))}
            <PanelFootnote text={discoveryFootnote(Math.min(rows, all.length), all, sort, panelCompareIsAvailable(compare))} />
          </PanelScroll>
        )}
      </div>
    </PanelGate>
  )
}

function DiscoveryTrailing({ row, sort }: { row: WaiverRow; sort: DiscoverySort }) {
  if (sort.kind === 'name') {
    return <span className={`dp-trailing dp-caption ${row.projected === undefined ? 'faint' : 'muted'}`}>{panelFormat.points(row.projected)}</span>
  }
  const value = waiverRowValue(row, sort.column)
  return (
    <span className="dp-trailing">
      <span className={`dp-caption dp-strong ${value === undefined ? 'faint' : ''}`}>{formatDiscoveryValue(value, sort.column)}</span>
      <span className="dp-caption2 faint">{discoverySortUnit(sort)}</span>
    </span>
  )
}

function SearchField({ value, onChange, placeholder, slim = false }: { value: string; onChange: (v: string) => void; placeholder: string; slim?: boolean }) {
  return (
    <div className={slim ? 'dp-search slim' : 'dp-search'}>
      <Search size={12} aria-hidden />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)} />
      {value !== '' && (
        <button type="button" className="dp-icon-button" aria-label="Clear search" onClick={() => onChange('')}>
          <XCircle size={13} aria-hidden />
        </button>
      )}
    </div>
  )
}

// MARK: - Profile

/** Who he is and where he stands: bio, status, depth chart, bye, grade. */
export function PlayerProfilePanel(_: PanelProps) {
  return <LinkedCardGate>{(card) => <ProfileBody card={card} />}</LinkedCardGate>
}

function ProfileBody({ card }: { card: PlayerCardModel }) {
  useModel(card)
  const bio = bioLine(card.context.players.players[card.id])
  const status = card.status
  const ppg = card.context.sleeperPointsPerGame(card.id)
  const grade = card.grade
  return (
    <div className="dp-fill">
      <PanelScroll>
        <PanelPlayerHeader card={card} />
        {bio && <div className="dp-caption muted">{bio}</div>}
        <div className="dp-profile-grid">
          <div className="dp-rows">
            {status && (
              <>
                <ProfileRow label="Status" value={availabilityLabel(status.availability)} />
                <ProfileRow label="Injury" value={profileInjuryText(status)}
                  tint={status.sleeperTag === undefined && status.report?.designation === undefined ? undefined : 'var(--caution)'} />
                <ProfileRow label="Depth" value={status.depthRank !== undefined ? `#${status.depthRank + 1} at ${card.position ?? ''}` : 'not listed'} />
                <ProfileRow label="Bye" value={status.byeWeek !== undefined ? `Week ${status.byeWeek}` : '—'} />
                {status.opponent !== undefined && (
                  <ProfileRow label="This week"
                    value={`vs ${status.opponent}` + (status.impliedTotal !== undefined ? ` · ${formatFixed(status.impliedTotal, 1)} implied` : '')} />
                )}
              </>
            )}
            {ppg !== undefined && <ProfileRow label="Pts/gm" value={panelFormat.points(ppg)} />}
            {card.rotowireThisWeek !== undefined && <ProfileRow label="Projected" value={panelFormat.points(card.rotowireThisWeek)} />}
          </div>
          <div>
            <div className="dp-grade">
              <span className="dp-caption dp-strong muted">Grade</span>
              {grade?.score !== undefined ? (
                <>
                  <span className="dp-big" style={{
                    fontSize: '1.0625rem',
                    color: grade.score >= 68 ? 'var(--start)' : grade.score >= 40 ? 'var(--text)' : 'var(--sit)',
                  }}>{grade.score}</span>
                  {gradeTier(grade) && <span className="dp-caption2 muted">{gradeTier(grade)}</span>}
                  {isThin(grade) && <span className="dp-caption2" style={{ color: 'var(--caution)' }}>thin</span>}
                </>
              ) : (
                <span className="dp-caption2 faint">not enough data yet</span>
              )}
            </div>
            {card.chips.length > 0 && (
              <div className="dp-chips">
                {card.chips.map((chip) => (
                  <div className="dp-situation" key={chip.metric}>
                    <span className="dp-caption2 dp-strong dp-ellipsis">{SITUATION[chip.metric].label}</span>
                    <span className="dp-caption2 muted dp-clamp2">{chip.detail}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PanelScroll>
    </div>
  )
}

function ProfileRow({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div className="dp-row">
      <span className="dp-caption2 muted dp-row-label">{label}</span>
      <span className="dp-caption dp-clamp2" style={tint ? { color: tint } : undefined}>{value}</span>
    </div>
  )
}

// MARK: - News

/** Sleeper's news on the linked player. */
export function PlayerNewsPanel({ rows }: PanelProps) {
  return <LinkedCardGate>{(card) => <NewsBody card={card} rows={rows} />}</LinkedCardGate>
}

function NewsBody({ card, rows }: { card: PlayerCardModel; rows: number }) {
  useModel(card)
  return (
    <div className="dp-fill">
      <PanelScroll>
        <PanelPlayerHeader card={card} />
        {card.news.length === 0 && (
          <div className="dp-caption muted">{card.newsUnavailable ? 'News couldn’t be loaded.' : `No recent news on ${card.name}.`}</div>
        )}
        {card.news.slice(0, rows).map((item) => <NewsRow key={newsID(item)} item={item} />)}
      </PanelScroll>
    </div>
  )
}

function NewsRow({ item }: { item: SleeperPlayerNews }) {
  const published = newsPublishedAt(item)
  const meta = [newsSourceLabel(item), published ? relativeDate(published) : undefined]
    .filter((x): x is string => x !== undefined).join(' · ')
  const content = (
    <>
      {item.metadata?.title !== undefined && <h4 className="dp-news-title">{item.metadata.title}</h4>}
      {item.metadata?.description !== undefined && <p className="dp-caption2 muted dp-clamp4">{item.metadata.description}</p>}
      <span className="dp-caption2 faint">{meta}</span>
    </>
  )
  const url = item.metadata?.url
  if (url !== undefined && /^https?:\/\//i.test(url)) {
    return <a className="dp-news" href={url} target="_blank" rel="noopener noreferrer">{content}</a>
  }
  return <div className="dp-news">{content}</div>
}

// MARK: - Game log

/** His last game, then the last N as a table. */
export function GameLogPanel({ rows }: PanelProps) {
  return <LinkedCardGate>{(card) => <GameLogBody card={card} rows={rows} />}</LinkedCardGate>
}

function GameLogBody({ card, rows }: { card: PlayerCardModel; rows: number }) {
  useModel(card)
  const weeks = card.log.slice(0, rows)
  const last = card.log.find((w) => w.played)
  return (
    <div className="dp-fill">
      <PanelScroll>
        <PanelPlayerHeader card={card} />
        {last && <LastGame week={last} />}
        {card.log.length === 0 ? (
          <div className="dp-caption muted">No games logged this season.</div>
        ) : (
          <>
            <div className="dp-table-wrap">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th scope="col" className="lead">Wk</th>
                    <th scope="col" className="lead">Opp</th>
                    <th scope="col">Pts</th>
                    <th scope="col">Proj</th>
                    <th scope="col" className="dp-wide">Snap</th>
                    <th scope="col" className="dp-wide">Tgt</th>
                    <th scope="col" className="dp-wide">Att</th>
                    <th scope="col" className="dp-wide">xFP</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week) => <LogRow key={week.week} week={week} />)}
                </tbody>
              </table>
            </div>
            <PanelFootnote text={GAME_LOG_FOOTNOTE} />
          </>
        )}
      </PanelScroll>
    </div>
  )
}

function LastGame({ week }: { week: PlayerLogWeek }) {
  const { points, projected } = week
  return (
    <div className="dp-card">
      <div>
        <div className="dp-caption2 dp-bold muted">Last game</div>
        <div className="dp-caption">{`Week ${week.week}` + (week.opponent !== undefined ? ` vs ${week.opponent}` : '')}</div>
      </div>
      <span className="dp-spacer" />
      <span className="dp-big">{panelFormat.points(points)}</span>
      {projected !== undefined && points !== undefined && (
        <span className="dp-caption2 dp-num" style={{ color: points >= projected ? 'var(--start)' : 'var(--sit)' }}>
          {panelFormat.signed(points - projected) + ' vs proj'}
        </span>
      )}
    </div>
  )
}

function LogRow({ week }: { week: PlayerLogWeek }) {
  return (
    <tr className={week.played ? undefined : 'dnp'}>
      <td className="lead">{week.week}</td>
      <td className="lead">{week.played ? (week.opponent ?? '—') : 'DNP'}</td>
      <td className="dp-strong">{panelFormat.points(week.points)}</td>
      <td className={week.played ? 'muted' : undefined}>{panelFormat.points(week.projected)}</td>
      <td className="dp-wide">{week.snapShare !== undefined ? `${Math.round(week.snapShare * 100)}%` : '—'}</td>
      <td className="dp-wide">{week.targets !== undefined ? `${Math.trunc(week.targets)}` : '—'}</td>
      <td className="dp-wide">{week.rushAttempts !== undefined ? `${Math.trunc(week.rushAttempts)}` : '—'}</td>
      <td className="dp-wide">{panelFormat.points(week.expectedPoints)}</td>
    </tr>
  )
}

// MARK: - Schedule

/**
 * The rest of his season: opponents, the recorded lines, and how soft each
 * defense has been against his position.
 */
export function SchedulePanel(_: PanelProps) {
  return <LinkedCardGate>{(card, context) => <ScheduleBody card={card} context={context} />}</LinkedCardGate>
}

function ScheduleBody({ card, context }: { card: PlayerCardModel; context: LeagueContext }) {
  const { services } = useApp()
  const discovery = useModel(services.discovery)
  const defense = discovery.defense
  const schedule = useMemo(() => PlayerSchedule.build(card.id, context, defense), [card.id, context, defense])
  return (
    <div className="dp-fill">
      <PanelScroll>
        <PanelPlayerHeader card={card} />
        {schedule.weeks.length === 0 ? (
          <div className="dp-caption muted">The regular season is over.</div>
        ) : (
          <>
            <Strength schedule={schedule} />
            <div className="dp-table-wrap">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th scope="col" className="lead">Wk</th>
                    <th scope="col" className="lead">Opp</th>
                    <th scope="col" className="dp-wide">Spread</th>
                    <th scope="col" className="dp-wide">Total</th>
                    <th scope="col">Implied</th>
                    <th scope="col">Def rank</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.weeks.map((week) => (
                    <ScheduleRow key={week.week} week={week} current={week.week === schedule.currentWeek} />
                  ))}
                </tbody>
              </table>
            </div>
            <PanelFootnote text={scheduleFootnote(schedule)} />
          </>
        )}
      </PanelScroll>
    </div>
  )
}

function Strength({ schedule }: { schedule: Schedule }) {
  const sos = schedule.strengthOfSchedule
  if (sos === undefined) {
    return <div className="dp-card"><span className="dp-caption muted">Not enough defense data yet for a strength of schedule.</span></div>
  }
  const tint = sos >= 1.05 ? 'var(--start)' : sos <= 0.95 ? 'var(--sit)' : 'var(--text)'
  return (
    <div className="dp-card" style={{ alignItems: 'center' }}>
      <div>
        <div className="dp-big" style={{ color: tint }}>{formatFixed(sos, 2)}×</div>
        <div className="dp-caption2 muted">rest-of-season SoS</div>
      </div>
      <span className="dp-caption dp-strong" style={{ color: tint }}>
        {sos >= 1.05 ? 'Softer than average' : sos <= 0.95 ? 'Tougher than average' : 'About average'}
      </span>
      <span className="dp-spacer" />
      <span className="dp-caption2 faint">{schedule.strengthOfScheduleGames} games</span>
    </div>
  )
}

function ScheduleRow({ week, current }: { week: PlayerScheduleWeek; current: boolean }) {
  const cls = current ? 'current' : undefined
  if (week.isBye) {
    return (
      <tr className={cls} aria-current={current ? 'true' : undefined}>
        <td className="lead">{week.week}</td>
        <td className="lead faint">BYE</td>
        <td className="dp-wide" /><td className="dp-wide" /><td /><td />
      </tr>
    )
  }
  const soft = (week.defenseVsAverage ?? 0) >= 0
  return (
    <tr className={cls} aria-current={current ? 'true' : undefined}>
      <td className="lead">{week.week}</td>
      <td className="lead">{week.opponent !== undefined ? (week.isHome === false ? '@' : '') + week.opponent : '—'}</td>
      <td className="dp-wide muted">{week.spread !== undefined ? formatFixed(week.spread, 1, { sign: true }) : '—'}</td>
      <td className="dp-wide muted">{week.total !== undefined ? formatFixed(week.total, 1) : '—'}</td>
      <td>{week.impliedTotal !== undefined ? formatFixed(week.impliedTotal, 1) : '—'}</td>
      <td>
        {week.defenseRank !== undefined
          ? <span style={{ color: soft ? 'var(--start)' : 'var(--sit)' }}>#{week.defenseRank}</span>
          : <span className="faint">—</span>}
      </td>
    </tr>
  )
}

// MARK: - Player search

/**
 * A slim search down the side of a board: click a result to light up the
 * linked panels with him, ＋ (or ⌘-click) to add him to the colour's
 * comparison. The compared players stay pinned at the top.
 */
export function PlayerSearchPanel({ rows }: PanelProps) {
  const { services } = useApp()
  const discovery = useModel(services.discovery)
  const bus = useModel(services.linkBus)
  const { linkGroup, linkPublish } = usePanelEnv()
  const [query, setQuery] = useState('')
  const context = discovery.context
  const { onTap, help } = usePlayerTap(context)
  if (!context) return <PanelMessage style="loading" text="Loading…" />

  const compared = bus.compareList(linkGroup)
  const focused = bus.selection(linkGroup)?.playerID
  const canAdd = bus.canAddToCompare(linkGroup)
  const results = playerLookupMatches(query, context, [], rows)
  const publish = linkPublish.handler
  const empty = query.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '') === ''

  return (
    <div className="dp-root">
      <SearchField value={query} onChange={setQuery} placeholder="Search" slim />
      {linkGroup === undefined && (
        <p className="dp-caption2 dp-caution">Pick a link colour so clicks reach other panels.</p>
      )}
      <PanelScroll>
        {compared.length > 0 && (
          <div className="dp-compared">
            <span className="dp-caption2 dp-bold muted">COMPARING</span>
            {compared.map((id, offset) => {
              const name = context.playerName(id) ?? id
              return (
                <div className="dp-compared-row" key={id}>
                  <span className="dp-dot" style={{ background: LINK_GROUP_COLOR[((offset % 4) + 1) as 1 | 2 | 3 | 4] }} aria-hidden />
                  <button type="button" className="dp-link-button" onClick={onTap(id)} title={help}>
                    <span className="dp-caption dp-ellipsis" style={{ fontWeight: id === focused ? 700 : 500 }}>{shortName(name)}</span>
                  </button>
                  <button type="button" className="dp-icon-button" aria-label={`Remove ${name} from compare`}
                    onClick={() => publish({ kind: 'removeCompare', playerID: id })}>
                    <XCircle size={13} aria-hidden />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {empty ? (
          <span className="dp-caption2 muted">{compared.length === 0 ? 'Type a name. Click to focus, ＋ to compare.' : 'Type to add more.'}</span>
        ) : results.length === 0 ? (
          <span className="dp-caption2 muted">No player matches.</span>
        ) : null}
        {results.map((player) => (
          <SearchResult key={player.id} player={player} focused={player.id === focused}
            comparing={compared.includes(player.id)} canAdd={canAdd} linked={linkGroup !== undefined}
            onTap={onTap(player.id)} help={help}
            onToggle={(comparing) => publish(comparing
              ? { kind: 'removeCompare', playerID: player.id }
              : { kind: 'addCompare', playerID: player.id })} />
        ))}
      </PanelScroll>
    </div>
  )
}

function SearchResult({ player, focused, comparing, canAdd, linked, onTap, help, onToggle }: {
  player: IndexedPlayer
  focused: boolean
  comparing: boolean
  canAdd: boolean
  linked: boolean
  onTap: (e: MouseEvent) => void
  help: string
  onToggle: (comparing: boolean) => void
}) {
  const position = playerPosition(player)
  return (
    <div className="dp-result">
      <button type="button" className="dp-link-button" onClick={onTap} title={`${player.name}\n${help}`}>
        <PlayerAvatar sleeperID={player.id} name={player.name} position={position} size={22} />
        <span className="dp-result-text">
          <span className="dp-caption dp-ellipsis" style={{ fontWeight: focused ? 700 : 600 }}>{shortName(player.name)}</span>
          <span className="dp-caption2 muted dp-ellipsis">
            {[position, player.team].filter((x): x is string => x !== undefined).join(' · ')}
          </span>
        </span>
      </button>
      {linked && (
        <button type="button" className="dp-icon-button" disabled={!comparing && !canAdd}
          title={comparing ? 'Remove from compare' : 'Add to compare'}
          aria-label={comparing ? `Remove ${player.name} from compare` : `Add ${player.name} to compare`}
          style={{ color: comparing ? 'var(--accent)' : 'var(--text-2)' }}
          onClick={() => onToggle(comparing)}>
          {comparing ? <CheckCircle2 size={15} aria-hidden /> : <PlusCircle size={15} aria-hidden />}
        </button>
      )}
    </div>
  )
}
