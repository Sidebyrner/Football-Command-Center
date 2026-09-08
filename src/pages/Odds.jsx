import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import Header from '../components/layout/Header'
import { useOdds } from '../hooks/useOdds'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLeagueTeamRosters } from '../hooks/useLeagueTeamRosters'
import { abbrFromOddsTeamName } from '../utils/nflTeams'
import { gameLine } from '../utils/oddsHelpers'
import useAppStore from '../store/useAppStore'

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
  const { odds, quota, loading, error, fetchOdds } = useOdds(oddsApiKey)
  const { players } = useDraftPlayers()
  const { teams } = useLeagueTeamRosters(leagueId)

  // Auto-fetch once on mount if a key exists and nothing is cached yet —
  // useOdds itself only fetches when asked, by design (it's a paid/quota'd
  // call), so this is the one place that decides "on page load" counts.
  useEffect(() => {
    if (oddsApiKey && odds.length === 0) fetchOdds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsApiKey])

  const myTeamAbbrs = useMemo(() => {
    const myTeam = teams.find((t) => t.id === sleeperUserId)
    if (!myTeam) return new Set()
    const playerById = {}
    for (const p of players) playerById[p.id] = p
    return new Set(myTeam.playerIds.map((id) => playerById[id]?.team).filter(Boolean))
  }, [teams, sleeperUserId, players])

  const games = useMemo(() => {
    return (odds ?? [])
      .map((g) => {
        const homeAbbr = abbrFromOddsTeamName(g.home_team)
        const awayAbbr = abbrFromOddsTeamName(g.away_team)
        const mine = myTeamAbbrs.has(homeAbbr) || myTeamAbbrs.has(awayAbbr)
        return { ...g, homeAbbr, awayAbbr, mine, line: gameLine(g) }
      })
      .sort((a, b) => (b.mine === a.mine ? 0 : b.mine ? 1 : -1) || new Date(a.commence_time) - new Date(b.commence_time))
  }, [odds, myTeamAbbrs])

  return (
    <div className="flex flex-col h-screen">
      <Header title="Odds" onRefresh={oddsApiKey ? fetchOdds : undefined} refreshing={loading} />
      <main className="flex-1 overflow-auto p-6 space-y-4">
        {!oddsApiKey && (
          <div className="flex items-start gap-2 px-4 py-3 text-sm text-[var(--color-caution)] bg-[var(--color-caution)]/10 border border-[var(--color-caution)]/30 rounded">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              No Odds API key configured —{' '}
              <Link to="/settings" className="underline font-semibold hover:text-[var(--color-caution)]">
                add one in Settings
              </Link>{' '}
              to see live spreads, totals, and implied team totals. Free tier: 500 requests/month.
            </span>
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-sit)]">Failed to load odds: {error}</p>}

        {oddsApiKey && loading && games.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">Loading odds…</p>
        )}

        {oddsApiKey && !loading && games.length === 0 && !error && (
          <p className="text-sm text-[var(--color-text-muted)]">No games found. Try refreshing.</p>
        )}

        {games.length > 0 && (
          <>
            {quota.remaining != null && (
              <p className="text-xs text-[var(--color-text-faint)]">
                {quota.remaining} Odds API requests remaining this month
              </p>
            )}
            <div className="space-y-2">
              {games.map((g) => (
                <div
                  key={g.id}
                  className={`border rounded px-4 py-3 bg-[var(--color-surface)] ${
                    g.mine ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-border)]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[var(--color-text-faint)]">
                      {new Date(g.commence_time).toLocaleString([], {
                        weekday: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </span>
                    {g.mine && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                        YOUR PLAYERS
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{g.away_team}</p>
                      <p className="text-xs text-[var(--color-text-muted)] tabular-nums">
                        {formatSpread(g.line.awaySpread)}
                        {g.line.awayImplied != null && <> · implied {g.line.awayImplied.toFixed(1)}</>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[var(--color-text)]">{g.home_team}</p>
                      <p className="text-xs text-[var(--color-text-muted)] tabular-nums">
                        {formatSpread(g.line.homeSpread)}
                        {g.line.homeImplied != null && <> · implied {g.line.homeImplied.toFixed(1)}</>}
                      </p>
                    </div>
                  </div>
                  {g.line.total != null && (
                    <p className="text-[10px] text-[var(--color-text-faint)] mt-1.5">O/U {g.line.total}</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
