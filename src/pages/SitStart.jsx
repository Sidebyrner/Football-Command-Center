import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import Header from '../components/layout/Header'
import { getPositionColor } from '../utils/playerHelpers'
import { impliedTotalForTeam } from '../utils/oddsHelpers'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useCohorts } from '../hooks/useCohorts'
import { usePlayerScores } from '../hooks/usePlayerScores'
import { useLeagueTeamRosters } from '../hooks/useLeagueTeamRosters'
import { useOdds } from '../hooks/useOdds'
import useAppStore from '../store/useAppStore'

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

/**
 * Side-by-side comparison of players on your own roster. Deliberately shows
 * two SEPARATE labeled signals rather than one blended "start this one"
 * score — this app tried that once already (see evaluateWeekly's removal
 * from EvalPanel) and pulled it for claiming matchup-awareness it didn't
 * have. Season quality is evaluateDraft's real signal, honestly labeled as
 * what it is; game environment is Vegas' actual read on this week, not this
 * app's model.
 */
export default function SitStart() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const oddsApiKey = useAppStore((s) => s.oddsApiKey)

  const { players } = useDraftPlayers()
  const { cohorts } = useCohorts()
  const { scores } = usePlayerScores(players, cohorts)
  const { teams, loading: rostersLoading } = useLeagueTeamRosters(leagueId)
  const { odds, fetchOdds, loading: oddsLoading } = useOdds(oddsApiKey)

  const [selected, setSelected] = useState([])

  const playersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
  }, [players])

  const myTeam = teams.find((t) => t.id === sleeperUserId)

  const byPosition = useMemo(() => {
    if (!myTeam) return {}
    const grouped = {}
    for (const id of myTeam.playerIds) {
      const p = playersById[id]
      const pos = p?.position ?? '?'
      ;(grouped[pos] ??= []).push(id)
    }
    return grouped
  }, [myTeam, playersById])

  function toggle(id) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  if (!leagueId) {
    return (
      <div className="flex flex-col h-screen">
        <Header title="Sit / Start" />
        <main className="flex-1 overflow-auto p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Connect your Sleeper league in{' '}
            <Link to="/settings" className="underline font-semibold">Settings</Link>{' '}
            to compare players on your roster.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <Header title="Sit / Start" />
      <main className="flex-1 overflow-auto p-6 flex gap-6">
        <aside className="w-64 flex-shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
            Your roster
          </h2>
          {rostersLoading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
          {!rostersLoading && !myTeam && (
            <p className="text-sm text-[var(--color-text-muted)]">Roster not found for your account.</p>
          )}
          {POSITION_ORDER.filter((pos) => byPosition[pos]?.length).map((pos) => (
            <div key={pos} className="mb-3">
              <div className="text-[9px] uppercase tracking-wide mb-1" style={{ color: getPositionColor(pos) }}>
                {pos}
              </div>
              <ul className="space-y-0.5">
                {byPosition[pos].map((id) => {
                  const p = playersById[id]
                  const isSelected = selected.includes(id)
                  return (
                    <li key={id}>
                      <button
                        onClick={() => toggle(id)}
                        className={`w-full text-left text-xs truncate px-2 py-1 rounded transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-semibold'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'
                        }`}
                      >
                        {p?.name ?? id}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </aside>

        <section className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              Comparing ({selected.length})
            </h2>
            {oddsApiKey && (
              <button
                onClick={fetchOdds}
                disabled={oddsLoading}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                {oddsLoading ? 'Loading odds…' : 'Refresh odds'}
              </button>
            )}
          </div>

          {selected.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              Click 2 or more players on the left — same position or not — to compare them.
            </p>
          )}

          {!oddsApiKey && selected.length > 0 && (
            <p className="text-xs text-[var(--color-caution)] mb-3">
              No Odds API key configured —{' '}
              <Link to="/settings" className="underline font-semibold">add one in Settings</Link>{' '}
              to see this week's game environment alongside season quality.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selected.map((id) => {
              const p = playersById[id]
              const s = scores[id]
              const gameCtx = odds.length ? impliedTotalForTeam(odds, p?.team) : null
              return (
                <div key={id} className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] p-4 relative">
                  <button
                    onClick={() => toggle(id)}
                    className="absolute top-2 right-2 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                    aria-label="Remove from comparison"
                  >
                    <X size={13} />
                  </button>

                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: getPositionColor(p?.position), backgroundColor: `${getPositionColor(p?.position)}20` }}
                    >
                      {p?.position ?? '?'}
                    </span>
                    <span className="text-sm font-semibold text-[var(--color-text)] truncate">{p?.name ?? id}</span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">Season quality</p>
                      {s?.available ? (
                        <>
                          <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">{s.score}</p>
                          <p className="text-[10px] text-[var(--color-text-faint)]">{s.tierLabel} · {s.coverage}% real data</p>
                        </>
                      ) : (
                        <p className="text-xs text-[var(--color-text-faint)]">{s?.reason ?? 'Not scoreable'}</p>
                      )}
                    </div>

                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">This week's game environment</p>
                      {gameCtx?.implied != null ? (
                        <>
                          <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">{gameCtx.implied.toFixed(1)}</p>
                          <p className="text-[10px] text-[var(--color-text-faint)]">implied pts vs {gameCtx.opponent}</p>
                        </>
                      ) : (
                        <p className="text-xs text-[var(--color-text-faint)]">
                          {oddsApiKey ? 'No line found for this game yet' : 'Add an Odds API key to see this'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
