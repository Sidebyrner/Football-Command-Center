import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { GRADE_COLOR_HEX, TEXT_FAINT_HEX } from '../../utils/chartColors'
import { lineupImpliedTotal } from '../../utils/oddsHelpers'
import { useLeagueMatchups } from '../../hooks/useLeagueMatchups'
import { useImpliedTotals } from '../../hooks/useImpliedTotals'
import useAppStore from '../../store/useAppStore'

function TeamSide({ team, playersById, impliedForTeam, align }) {
  const vegas = useMemo(
    () => (team ? lineupImpliedTotal(team.starterIds, playersById, impliedForTeam) : null),
    [team, playersById, impliedForTeam]
  )

  if (!team) {
    return <div className="flex-1 text-sm text-[var(--color-text-faint)]">Bye / unknown</div>
  }

  const color = team.grade ? GRADE_COLOR_HEX[team.grade] : TEXT_FAINT_HEX
  const gamesFound = vegas ? vegas.teamCount - vegas.missing.length : 0

  return (
    <div className={`flex-1 min-w-0 ${align === 'right' ? 'text-right' : ''}`}>
      <p className="text-sm font-semibold text-[var(--color-text)] truncate">
        {team.name}{team.isMe ? ' (you)' : ''}
      </p>
      <div className={`flex items-center gap-1.5 mt-1 ${align === 'right' ? 'justify-end' : ''}`}>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
          style={{ color, backgroundColor: `${color}20` }}
        >
          {team.grade ?? '—'}
        </span>
        <span className="text-[10px] text-[var(--color-text-faint)]">on paper</span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] mt-1 tabular-nums">
        {vegas?.total != null ? (
          <>Vegas: <span className="font-semibold text-[var(--color-text)]">{vegas.total.toFixed(1)}</span> implied pts across {gamesFound} team{gamesFound === 1 ? '' : 's'}</>
        ) : (
          <span className="text-[var(--color-text-faint)]">Vegas: no lines loaded</span>
        )}
      </p>
      {vegas?.missing.length > 0 && (
        <p className="text-[9px] text-[var(--color-text-faint)] mt-0.5">
          {vegas.missing.length} starter team{vegas.missing.length === 1 ? '' : 's'} with no line ({vegas.missing.join(', ')})
        </p>
      )}
    </div>
  )
}

/**
 * This week's fantasy matchups, league-wide, with two deliberately separate
 * signals per side — never blended into one verdict (same discipline
 * SitStart.jsx established after a prior blended score was pulled for
 * overclaiming precision it didn't have): the on-paper team grade, and
 * Vegas' actual implied scoring environment for that team's real starters
 * this week.
 */
export default function WeeklyMatchupOdds({ teams, playersById }) {
  const leagueId = useAppStore((s) => s.leagueId)
  const currentWeek = useAppStore((s) => s.currentWeek)

  const { matchups, loading: matchupsLoading, error: matchupsError } = useLeagueMatchups(leagueId, currentWeek)
  const { impliedForTeam, source, loading: oddsLoading } = useImpliedTotals(currentWeek)

  const teamByRosterId = useMemo(() => {
    const map = {}
    for (const t of teams) if (t.rosterId != null) map[t.rosterId] = t
    return map
  }, [teams])

  if (matchupsLoading) return <p className="text-sm text-[var(--color-text-muted)]">Loading matchups…</p>
  if (matchupsError) return <p className="text-sm text-[var(--color-sit)]">Failed to load matchups: {matchupsError}</p>
  if (matchups.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No matchups found for week {currentWeek} yet.</p>
  }

  return (
    <div className="space-y-2">
      {source === null && !oddsLoading && (
        <p className="text-xs text-[var(--color-caution)] mb-2">
          No lines available — add an Odds API key in Settings, or run{' '}
          <code>npm run preprocess-nflverse</code> for the free recorded lines.
        </p>
      )}
      {source === 'schedule' && (
        <p className="text-[10px] text-[var(--color-text-faint)] mb-2">
          Implied totals from the preprocessed schedule's recorded lines, not live odds.
        </p>
      )}
      {oddsLoading && (
        <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5 mb-2">
          <Loader2 size={11} className="animate-spin" /> Loading lines…
        </p>
      )}
      {matchups.map((m) => {
        const [sideA, sideB] = m.sides
        const teamA = sideA ? teamByRosterId[sideA.rosterId] : null
        const teamB = sideB ? teamByRosterId[sideB.rosterId] : null
        return (
          <div
            key={m.matchupId}
            className="border border-[var(--color-border)] rounded bg-[var(--color-surface)] px-4 py-3 flex items-center gap-4"
          >
            <TeamSide team={teamA} playersById={playersById} impliedForTeam={impliedForTeam} />
            <span className="text-[10px] text-[var(--color-text-faint)] flex-shrink-0">vs</span>
            <TeamSide team={teamB} playersById={playersById} impliedForTeam={impliedForTeam} align="right" />
          </div>
        )
      })}
    </div>
  )
}
