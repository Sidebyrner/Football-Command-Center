import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertTriangle } from 'lucide-react'
import { gradeColor } from '../shared/chartTheme'
import { lineupImpliedTotal } from '../../utils/oddsHelpers'
import { useLeagueMatchups } from '../../hooks/useLeagueMatchups'
import { useImpliedTotals } from '../../hooks/useImpliedTotals'
import useAppStore from '../../store/useAppStore'
import '../../screens/tools/researchTools.css'

function TeamSide({ team, playersById, impliedForTeam, align }) {
  const vegas = useMemo(
    () => (team ? lineupImpliedTotal(team.starterIds, playersById, impliedForTeam) : null),
    [team, playersById, impliedForTeam]
  )

  if (!team) {
    return <div className="flex-1 t-body faint">Bye / unknown</div>
  }

  const gamesFound = vegas ? vegas.teamCount - vegas.missing.length : 0

  return (
    <div className={`flex-1 min-w-0 ${align === 'right' ? 'text-right rt-side-right' : ''}`}>
      <p className="t-body truncate" style={{ margin: 0, fontWeight: 600 }}>
        {team.name}{team.isMe ? ' (you)' : ''}
      </p>
      <div className={`rt-row ${align === 'right' ? 'justify-end' : ''}`} style={{ gap: 6, marginTop: 4 }}>
        <span className="rt-grade t-meta" style={{ '--grade': gradeColor(team.grade) }}>
          {team.grade ?? '—'}
        </span>
        <span className="t-meta faint">on paper</span>
      </div>
      <p className="t-meta muted" style={{ margin: '4px 0 0' }}>
        {vegas?.total != null ? (
          <>Vegas: <strong style={{ color: 'var(--text)' }}>{vegas.total.toFixed(1)}</strong> implied pts across {gamesFound} team{gamesFound === 1 ? '' : 's'}</>
        ) : (
          <span className="faint">Vegas: no lines loaded</span>
        )}
      </p>
      {vegas?.missing.length > 0 && (
        <p className="t-caption faint" style={{ margin: '2px 0 0' }}>
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

  if (matchupsLoading) return <p className="t-body muted" role="status" style={{ margin: 0 }}>Loading matchups…</p>
  if (matchupsError) return <p className="t-body" role="alert" style={{ margin: 0, color: 'var(--sit)' }}>Failed to load matchups: {matchupsError}</p>
  if (matchups.length === 0) {
    return <p className="card t-body muted" style={{ margin: 0 }}>No matchups found for week {currentWeek} yet.</p>
  }

  return (
    <div className="rt-card-list">
      {source === null && !oddsLoading && (
        <p className="t-meta flex items-start gap-1.5" style={{ margin: 0, color: 'var(--caution)' }}>
          <AlertTriangle size={13} className="flex-shrink-0" style={{ marginTop: 1 }} aria-hidden />
          <span>
            No lines available — add an Odds API key on the{' '}
            <Link to="/tools/odds" className="rt-link">Odds tool</Link>, or run{' '}
            <code>npm run preprocess-nflverse</code> for the free recorded lines.
          </span>
        </p>
      )}
      {source === 'schedule' && (
        <p className="t-meta faint" style={{ margin: 0 }}>
          Implied totals from the preprocessed schedule's recorded lines, not live odds.
        </p>
      )}
      {oddsLoading && (
        <p className="t-meta muted flex items-center gap-1.5" role="status" style={{ margin: 0 }}>
          <Loader2 size={12} className="animate-spin" aria-hidden /> Loading lines…
        </p>
      )}
      {matchups.map((m) => {
        const [sideA, sideB] = m.sides
        const teamA = sideA ? teamByRosterId[sideA.rosterId] : null
        const teamB = sideB ? teamByRosterId[sideB.rosterId] : null
        return (
          <div key={m.matchupId} className="card rt-matchup">
            <TeamSide team={teamA} playersById={playersById} impliedForTeam={impliedForTeam} />
            <span className="t-micro faint rt-vs flex-shrink-0" style={{ marginTop: 3 }}>vs</span>
            <TeamSide team={teamB} playersById={playersById} impliedForTeam={impliedForTeam} align="right" />
          </div>
        )
      })}
    </div>
  )
}
