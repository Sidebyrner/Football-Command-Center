import { Loader2, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import Header from '../components/layout/Header'
import TeamGradeRow from '../components/draft/TeamGradeRow'
import PowerRankingsChart from '../components/rankings/PowerRankingsChart'
import WeeklyMatchupOdds from '../components/rankings/WeeklyMatchupOdds'
import { useTeamPowerRankings } from '../hooks/useTeamPowerRankings'
import useAppStore from '../store/useAppStore'

/**
 * League-wide team strength, visualized — the dedicated home for
 * computeAllTeamGrades' season-mode output (Trade Analyzer keeps its own
 * compact text list for quick reference, this is the deep dive), plus this
 * week's matchups shown with two separate signals per side: on-paper grade
 * and Vegas' actual implied scoring environment for each team's real
 * starters. Deliberately not blended into one number — see
 * WeeklyMatchupOdds.jsx.
 */
export default function PowerRankings() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)

  const { teams, playersById, loading, error } = useTeamPowerRankings(leagueId, sleeperUserId)

  return (
    <div className="flex flex-col h-screen">
      <Header title="Power Rankings" />
      <main className="flex-1 overflow-auto p-6 space-y-8">
        {error && (
          <p className="text-sm text-[var(--color-sit)]">Failed to load league rosters: {error}</p>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            Grading every team's current roster…
          </div>
        )}

        {!loading && !teams.length && !error && (
          <p className="text-sm text-[var(--color-text-muted)]">No rosters found for this league yet.</p>
        )}

        {!loading && teams.length > 0 && (
          <>
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-3">
                League strength, right now
              </h2>
              <PowerRankingsChart teams={teams} />
              <div className="mt-4 border border-[var(--color-border)] rounded bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                {teams.map((t) => (
                  <div key={t.id} className="px-1">
                    <TeamGradeRow team={t} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-3 flex items-center gap-1.5">
                <TrendingUp size={12} />
                This week's matchups
                {/* Deliberately a league-wide scan, not a lineup tool. The
                    slot-by-slot version of your own matchup lives on /matchup. */}
                <Link
                  to="/matchup"
                  className="ml-auto normal-case tracking-normal font-normal text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
                >
                  Plan your own matchup slot by slot →
                </Link>
              </h2>
              <WeeklyMatchupOdds teams={teams} playersById={playersById} />
            </section>
          </>
        )}
      </main>
    </div>
  )
}
