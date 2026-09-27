import { useEffect, useMemo } from 'react'
import { AlertTriangle, Scale, CalendarDays } from 'lucide-react'
import { AboutThisData, Callout, ScreenHero, ScreenSection } from '@ui/components/Screen'
import RefreshButton from '../components/shared/RefreshButton'
import OddsKeyField from '../components/odds/OddsKeyField'
import '../screens/tools/researchTools.css'
import { useOdds } from '../hooks/useOdds'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLeagueTeamRosters } from '../hooks/useLeagueTeamRosters'
import { abbrFromOddsTeamName, teamNameFromAbbr, toNflverseTeam } from '../utils/nflTeams'
import { useSchedule } from '../hooks/useSchedule'
import { gameLine } from '../utils/oddsHelpers'
import ImpliedTotalsChart from '../components/odds/ImpliedTotalsChart'
import GameEnvironmentScatter from '../components/odds/GameEnvironmentScatter'
import MyTeamOdds from '../components/odds/MyTeamOdds'
import { useMissingPlayerMeta } from '../hooks/useMissingPlayerMeta'
import { makeImpliedResolver, withLiveLines } from '../utils/oddsHelpers'
import useAppStore from '../store/useAppStore'
import { kickoffIso } from '../utils/gameClock'
import { findMyTeam } from '../utils/leagueTeams'

function formatSpread(spread) {
  if (spread == null) return '—'
  return spread > 0 ? `+${spread}` : `${spread}`
}

/**
 * NFL game lines (spread, total, implied team total per side) via The Odds
 * API — useOdds/oddsApi.js already handle the fetch, proxy fallback, and
 * quota tracking; this page is just the view. Games involving your own
 * roster's players surface first.
 */
export default function Odds() {
  const oddsApiKey = useAppStore((s) => s.oddsApiKey)
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const season = useAppStore((s) => s.season)
  const currentWeek = useAppStore((s) => s.currentWeek)
  const leagueName = useAppStore((s) => s.leagueName)
  const { odds, hasFetched, quota, loading, error, fetchOdds } = useOdds(oddsApiKey, season, currentWeek)
  const { players } = useDraftPlayers()
  const { teams } = useLeagueTeamRosters(leagueId)
  const myTeam = findMyTeam(teams, sleeperUserId)
  // Free fallback. nfldata publishes spread and total per game alongside the
  // schedule, so the page has something real to draw before anyone pays for a
  // key. These are NOT live odds — they're whatever nfldata last recorded — and
  // every surface built on them says so.
  const { games: scheduleGames, byTeam: recordedByTeam } = useSchedule(season, currentWeek)
  // `odds` is already this week's games only (useOdds). Laying them over the
  // schedule keeps each roster row's opponent, spread, total and implied
  // total on one game and one source.
  const scheduleByTeam = useMemo(() => withLiveLines(recordedByTeam, odds), [recordedByTeam, odds])

  // Whole-roster view needs names for IDP too, which useDraftPlayers filters
  // out of the board entirely — same fallback the other roster surfaces use.
  const playersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
  }, [players])
  const missingIds = useMemo(
    () => (myTeam?.playerIds ?? []).filter((id) => id && id !== '0' && !playersById[id]),
    [myTeam, playersById]
  )
  const idpMeta = useMissingPlayerMeta(missingIds)
  const rosterPlayersById = useMemo(
    () => ({ ...playersById, ...idpMeta }),
    [playersById, idpMeta]
  )

  // Auto-fetch once on mount if a key exists and nothing is cached yet —
  // useOdds itself only fetches when asked, by design (it's a paid/quota'd
  // call), so this is the one place that decides "on page load" counts.
  useEffect(() => {
    if (oddsApiKey && !hasFetched) fetchOdds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsApiKey])

  const myTeamAbbrs = useMemo(() => {
    if (!myTeam) return new Set()
    return new Set(myTeam.playerIds.map((id) => rosterPlayersById[id]?.team).filter(Boolean))
  }, [myTeam, rosterPlayersById])

  // Roster teams normalized once, so the LAR/LA split can't make your own
  // games fail to highlight.
  const myNflverseAbbrs = useMemo(
    () => new Set([...myTeamAbbrs].map(toNflverseTeam)),
    [myTeamAbbrs]
  )

  const liveGames = useMemo(() => {
    return (odds ?? []).map((g) => {
      const homeAbbr = abbrFromOddsTeamName(g.home_team)
      const awayAbbr = abbrFromOddsTeamName(g.away_team)
      const mine = myTeamAbbrs.has(homeAbbr) || myTeamAbbrs.has(awayAbbr)
      return { ...g, homeAbbr, awayAbbr, mine, line: gameLine(g) }
    })
  }, [odds, myTeamAbbrs])

  const fallbackGames = useMemo(() => {
    return (scheduleGames ?? [])
      .filter((g) => g.totalLine != null && g.spreadLine != null)
      .map((g) => {
        // nfldata's spreadLine is positive when the HOME team is favored — the
        // opposite sign from The Odds API's home spread. Convert here so both
        // sources hand gameLine-shaped data to the same components.
        const homeSpread = -g.spreadLine
        const total = g.totalLine
        return {
          id: `sched-${g.away}-${g.home}`,
          home_team: teamNameFromAbbr(g.home) ?? g.home,
          away_team: teamNameFromAbbr(g.away) ?? g.away,
          // Schedule times are US Eastern; a bare `${date}T${time}` would be read
          // as the browser's own time zone.
          commence_time: kickoffIso(g) ?? g.kickoff,
          homeAbbr: g.home,
          awayAbbr: g.away,
          mine: myNflverseAbbrs.has(g.home) || myNflverseAbbrs.has(g.away),
          line: {
            total,
            homeSpread,
            awaySpread: g.spreadLine,
            homeImplied: total / 2 + g.spreadLine / 2,
            awayImplied: total / 2 - g.spreadLine / 2,
          },
        }
      })
  }, [scheduleGames, myNflverseAbbrs])

  const usingFallback = liveGames.length === 0 && fallbackGames.length > 0

  // Built from the data this page already fetched rather than useImpliedTotals,
  // which would spin up a second useOdds and risk a duplicate paid fetch.
  const impliedForTeam = useMemo(
    () => makeImpliedResolver(odds, scheduleByTeam, toNflverseTeam),
    [odds, scheduleByTeam]
  )

  const games = useMemo(() => {
    const src = liveGames.length ? liveGames : fallbackGames
    return [...src].sort(
      (a, b) => (b.mine === a.mine ? 0 : b.mine ? 1 : -1) || new Date(a.commence_time) - new Date(b.commence_time)
    )
  }, [liveGames, fallbackGames])

  const mineCount = games.filter((g) => g.mine).length
  const sourceLine = usingFallback
    ? `Week ${currentWeek} lines from the preprocessed schedule (nfldata) — no API credits used.`
    : quota.remaining != null
      ? `${quota.remaining} Odds API requests remaining this month`
      : 'Live lines from The Odds API'

  return (
    <div className="rt-page">
      <ScreenHero
        overline="Tools · Odds"
        icon={Scale}
        hue="var(--hue-market)"
        answer={games.length > 0 ? `${games.length} game${games.length === 1 ? '' : 's'} in week ${currentWeek}` : `Week ${currentWeek} lines`}
        detail={[leagueName, season && `${season} season`, games.length > 0 && (usingFallback ? 'recorded lines, not live' : 'live lines')].filter(Boolean).join(' · ')}
        stats={games.length > 0 ? [
          { value: String(mineCount), label: mineCount === 1 ? 'game with your players' : 'games with your players' },
          ...(quota.remaining != null && !usingFallback ? [{ value: String(quota.remaining), label: 'API requests left' }] : []),
        ] : []}
        trailing={oddsApiKey ? <RefreshButton onClick={fetchOdds} loading={loading} /> : undefined}
      />

      {!oddsApiKey && (
        <Callout tone="caution">
          <div className="rt-stack">
            <p className="t-body flex items-start gap-2" style={{ margin: 0 }}>
              <AlertTriangle size={16} color="var(--caution)" className="flex-shrink-0" style={{ marginTop: 2 }} aria-hidden />
              <span>
                {usingFallback
                  ? 'Showing the schedule file\u2019s recorded lines, not live odds — they don\u2019t move as the week does. Add an Odds API key below for live spreads and totals.'
                  : 'No Odds API key yet — add one below for live spreads and totals.'}
              </span>
            </p>
            <OddsKeyField />
          </div>
        </Callout>
      )}

      {error && <p className="t-body" role="alert" style={{ margin: 0, color: 'var(--sit)' }}>Failed to load odds: {error}</p>}

      {oddsApiKey && loading && games.length === 0 && (
        <p className="t-body muted" role="status" style={{ margin: 0 }}>Loading odds…</p>
      )}

      {!loading && games.length === 0 && !error && (
        <p className="card t-body muted" style={{ margin: 0 }}>
          No games found for week {currentWeek}. Try refreshing, or run{' '}
          <code>npm run preprocess-nflverse</code> to build the {season} schedule.
        </p>
      )}

      {games.length > 0 && (
        <>
          {/* Your own roster first — it's why you opened the page. The
              market-wide charts below are the context for it. */}
          <MyTeamOdds
            myTeam={myTeam}
            playersById={rosterPlayersById}
            scheduleByTeam={scheduleByTeam}
            impliedForTeam={impliedForTeam}
            source={usingFallback ? 'schedule' : 'live'}
            week={currentWeek}
          />

          <p className="t-meta muted" style={{ margin: 0 }}>{sourceLine}</p>

          <ImpliedTotalsChart games={games} myTeamAbbrs={myTeamAbbrs} />

          <GameEnvironmentScatter games={games} myTeamAbbrs={myTeamAbbrs} />

          <ScreenSection title="Every game" icon={CalendarDays} count={games.length} hue="var(--hue-market)">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {games.map((g) => (
                <article
                  key={g.id}
                  className={`card rt-game${g.mine ? ' mine' : ''}`}
                  aria-label={`${g.away_team} at ${g.home_team}${g.mine ? ', your players' : ''}`}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-s)' }}>
                    <span className="t-meta faint">
                      {new Date(g.commence_time).toLocaleString([], {
                        weekday: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </span>
                    {g.mine && <span className="rt-badge accent t-micro">Your players</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="t-body" style={{ margin: 0, fontWeight: 600 }}>{g.away_team}</p>
                      <p className="t-meta muted" style={{ margin: 0 }}>
                        {formatSpread(g.line.awaySpread)}
                        {g.line.awayImplied != null && <> · implied {g.line.awayImplied.toFixed(1)}</>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="t-body" style={{ margin: 0, fontWeight: 600 }}>{g.home_team}</p>
                      <p className="t-meta muted" style={{ margin: 0 }}>
                        {formatSpread(g.line.homeSpread)}
                        {g.line.homeImplied != null && <> · implied {g.line.homeImplied.toFixed(1)}</>}
                      </p>
                    </div>
                  </div>
                  {g.line.total != null && (
                    <p className="t-meta faint" style={{ margin: 'var(--space-s) 0 0' }}>O/U {g.line.total}</p>
                  )}
                </article>
              ))}
            </div>
          </ScreenSection>
        </>
      )}

      {oddsApiKey && (
        <div className="card">
          <OddsKeyField />
        </div>
      )}

      <AboutThisData>
        <span>Live spreads and totals come from The Odds API with your own key; each refresh uses one request from its monthly quota.</span>
        <span>Without a key, the page draws the lines nfldata recorded alongside the schedule — they don't move during the week.</span>
        <span>Implied team total = half the game total, adjusted by half the spread. It describes the game, not the player.</span>
      </AboutThisData>
    </div>
  )
}
