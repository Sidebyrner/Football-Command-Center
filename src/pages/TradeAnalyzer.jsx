import { useMemo } from 'react'
import { ArrowLeftRight, Loader2 } from 'lucide-react'
import Header from '../components/layout/Header'
import TeamGradeRow from '../components/draft/TeamGradeRow'
import { getPositionColor } from '../utils/playerHelpers'
import { computeAllTeamGrades, findTradeOpportunities } from '../utils/teamGrades'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useCohorts } from '../hooks/useCohorts'
import { usePlayerScores } from '../hooks/usePlayerScores'
import { useLeagueTeamRosters } from '../hooks/useLeagueTeamRosters'
import { useLeagueRosterSettings } from '../hooks/useLeagueRosterSettings'
import { useMissingPlayerMeta } from '../hooks/useMissingPlayerMeta'
import useAppStore from '../store/useAppStore'

/**
 * "Trade value comparison tool" — grades every real current roster in the
 * league (not draft picks; this runs all season, which is when trades
 * actually happen) using the same value + roster-construction algorithm as
 * TeamGradesPanel, then surfaces candidate trades: teams whose surplus
 * matches your need, and vice versa.
 */
export default function TradeAnalyzer() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)

  const { players, loading: playersLoading } = useDraftPlayers()
  const { cohorts } = useCohorts()
  const { scores, loading: scoring } = usePlayerScores(players, cohorts)
  const { teams: rosters, loading: rostersLoading, error: rostersError } = useLeagueTeamRosters(leagueId)
  const { slotTemplate, loading: settingsLoading } = useLeagueRosterSettings(leagueId)

  const playersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
  }, [players])

  // Real rosters in an IDP league will always include LB/DL/DB — none of
  // which are in the main board's player pool. Resolve them separately.
  const missingIds = useMemo(() => {
    const ids = new Set()
    for (const t of rosters) for (const id of t.playerIds) if (!playersById[id]) ids.add(id)
    return [...ids]
  }, [rosters, playersById])
  const idpMeta = useMissingPlayerMeta(missingIds)
  const mergedPlayersById = useMemo(() => ({ ...playersById, ...idpMeta }), [playersById, idpMeta])

  const teamsInput = useMemo(
    () => rosters.map((t) => ({ ...t, isMe: !!sleeperUserId && t.id === sleeperUserId })),
    [rosters, sleeperUserId]
  )

  const teams = useMemo(() => {
    if (!slotTemplate || !teamsInput.length) return []
    return computeAllTeamGrades(teamsInput, { scores, playersById: mergedPlayersById, slotTemplate })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  }, [teamsInput, scores, mergedPlayersById, slotTemplate])

  const myTeam = teams.find((t) => t.isMe)
  const opportunities = useMemo(
    () => (myTeam ? findTradeOpportunities(myTeam, teams) : []),
    [myTeam, teams]
  )

  const loading = playersLoading || scoring || rostersLoading || settingsLoading

  return (
    <div className="flex flex-col h-screen">
      <Header title="Trade Analyzer" />
      <main className="flex-1 overflow-auto p-6 space-y-6">
        {rostersError && (
          <p className="text-sm text-[var(--color-sit)]">Failed to load league rosters: {rostersError}</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Grading every team's current roster…
          </div>
        )}

        {!loading && !teams.length && !rostersError && (
          <p className="text-sm text-[var(--color-text-muted)]">
            No rosters found for this league yet.
          </p>
        )}

        {!loading && teams.length > 0 && (
          <>
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
                Team power, right now
              </h2>
              <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                {teams.map((t) => (
                  <div key={t.id} className="px-1">
                    <TeamGradeRow team={t} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2 flex items-center gap-1.5">
                <ArrowLeftRight size={12} />
                Trade opportunities
              </h2>

              {!myTeam && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Your team wasn't found in this league's rosters — check Settings.
                </p>
              )}

              {myTeam && opportunities.length === 0 && (
                <p className="text-sm text-[var(--color-text-muted)]">
                  No clear matches right now — no other team is both thin where you have bench
                  surplus and deep where you're thin.
                </p>
              )}

              {myTeam && opportunities.length > 0 && (
                <div className="space-y-2">
                  {opportunities.map(({ team, give, get }) => (
                    <div
                      key={team.id}
                      className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-3 py-2.5"
                    >
                      <p className="text-sm font-semibold text-[var(--color-text)] mb-1">{team.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        You could offer{' '}
                        {give.map((pos, i) => (
                          <span key={pos}>
                            {i > 0 && ', '}
                            <span style={{ color: getPositionColor(pos) }} className="font-semibold">{pos}</span>
                          </span>
                        ))}{' '}
                        depth for their{' '}
                        {get.map((pos, i) => (
                          <span key={pos}>
                            {i > 0 && ', '}
                            <span style={{ color: getPositionColor(pos) }} className="font-semibold">{pos}</span>
                          </span>
                        ))}{' '}
                        depth — they're thin at what you have, you're thin at what they have.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
