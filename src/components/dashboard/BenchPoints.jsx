import { useMemo } from 'react'
import { benchAnalysisForSeason } from '../../utils/benchPoints'
import { useLeagueRosterSettings } from '../../hooks/useLeagueRosterSettings'
import useAppStore from '../../store/useAppStore'

const MAX_WEEKS_SHOWN = 5

/**
 * What your lineup scored vs. the best lineup you had available — the
 * "you left 23 points on your bench" number, computed from the starters and
 * per-player points Sleeper already returns for every past week.
 */
export default function BenchPoints({ myTeam, weeklyByRoster, playersById, loading }) {
  const leagueId = useAppStore((s) => s.leagueId)
  const { slotTemplate } = useLeagueRosterSettings(leagueId)

  const analysis = useMemo(() => {
    if (!myTeam || !slotTemplate) return null
    return benchAnalysisForSeason(weeklyByRoster?.[myTeam.rosterId], slotTemplate, playersById)
  }, [myTeam, weeklyByRoster, slotTemplate, playersById])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (!analysis || analysis.byWeek.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        No completed weeks yet to analyze.
      </p>
    )
  }

  const worst = [...analysis.byWeek].sort((a, b) => b.left - a.left).slice(0, MAX_WEEKS_SHOWN)

  return (
    <div>
      <div className="mb-3">
        <p className="text-2xl font-bold tabular-nums text-[var(--color-text)]">
          {analysis.totalLeft.toFixed(1)}
        </p>
        <p className="text-[10px] text-[var(--color-text-faint)]">
          total points left on your bench across {analysis.byWeek.length} week
          {analysis.byWeek.length === 1 ? '' : 's'}
        </p>
      </div>

      <ul className="space-y-1.5">
        {worst.filter((w) => w.left > 0).map((w) => (
          <li key={w.week} className="text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Week {w.week}</span>
              <span className="tabular-nums font-semibold text-[var(--color-sit)]">
                −{w.left.toFixed(1)}
              </span>
            </div>
            {w.benchHeroes[0] && (
              <p className="text-[10px] text-[var(--color-text-faint)] truncate">
                should have started {playersById[w.benchHeroes[0].id]?.name ?? w.benchHeroes[0].id}
                {' '}({w.benchHeroes[0].points.toFixed(1)})
              </p>
            )}
          </li>
        ))}
        {worst.every((w) => w.left === 0) && (
          <li className="text-xs text-[var(--color-start)]">
            Perfect lineups every week so far.
          </li>
        )}
      </ul>

      <p className="text-[10px] text-[var(--color-text-faint)] mt-3 leading-relaxed">
        "Best available" runs the same lineup optimizer the Matchup Planner uses, with points
        actually scored as the basis — so overlapping flex slots are handled properly and
        equal-value shuffles aren't reported as missed moves.
      </p>
    </div>
  )
}
