import { useMemo } from 'react'
import { BarChart3, ListOrdered, Trophy, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AboutThisData, ScreenHero, ScreenSection } from '@ui/components/Screen'
import { ErrorState, LoadingPlaceholder } from '@ui/components/State'
import TeamGradeRow from '../components/draft/TeamGradeRow'
import PowerRankingsChart from '../components/rankings/PowerRankingsChart'
import WeeklyMatchupOdds from '../components/rankings/WeeklyMatchupOdds'
import { useTeamPowerRankings } from '../hooks/useTeamPowerRankings'
import useAppStore from '../store/useAppStore'
import '../screens/tools/researchTools.css'

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

  const leagueName = useAppStore((s) => s.leagueName)
  const season = useAppStore((s) => s.season)
  const currentWeek = useAppStore((s) => s.currentWeek)

  const { teams, playersById, loading, error } = useTeamPowerRankings(leagueId, sleeperUserId)

  // Where you stand, for the hero — teams arrive already ordered by score.
  const mine = useMemo(() => {
    const i = teams.findIndex((t) => t.isMe)
    return i < 0 ? null : { rank: i + 1, team: teams[i] }
  }, [teams])

  const answer = loading
    ? 'Grading every roster…'
    : mine
      ? `You're #${mine.rank} of ${teams.length}`
      : teams.length > 0 ? `${teams.length} teams ranked` : 'League strength'

  return (
    <div className="rt-page">
      <ScreenHero
        overline="Tools · Power Rankings"
        icon={Trophy}
        hue="var(--hue-team)"
        answer={answer}
        detail={[leagueName, season && `${season} season`, currentWeek && `Week ${currentWeek}`].filter(Boolean).join(' · ')}
        stats={mine?.team.grade ? [
          { value: mine.team.grade, label: 'your grade' },
          ...(mine.team.score != null ? [{ value: String(mine.team.score), label: 'score' }] : []),
        ] : []}
      />

      {error && <ErrorState message={`Failed to load league rosters: ${error}`} />}

      {loading && <LoadingPlaceholder label="Grading every team's current roster…" cards={3} />}

      {!loading && !teams.length && !error && (
        <p className="card t-body muted" style={{ margin: 0 }}>No rosters found for this league yet.</p>
      )}

      {!loading && teams.length > 0 && (
        <>
          <ScreenSection title="League strength, right now" icon={BarChart3} hue="var(--hue-team)">
            <PowerRankingsChart teams={teams} />
          </ScreenSection>

          <ScreenSection title="Every team" icon={ListOrdered} count={teams.length} hue="var(--hue-team)">
            <div className="card rt-divided" style={{ padding: 'var(--space-xs)' }}>
              {teams.map((t) => (
                <div key={t.id} style={{ padding: '2px 4px' }}>
                  <TeamGradeRow team={t} />
                </div>
              ))}
            </div>
          </ScreenSection>

          <ScreenSection
            title="This week's matchups"
            icon={TrendingUp}
            hue="var(--hue-team)"
            subtitle="A league-wide scan: on-paper grade and Vegas' implied points, side by side and never blended."
          >
            {/* Deliberately a league-wide scan, not a lineup tool. The
                slot-by-slot version of your own matchup lives on Lineup › Matchup. */}
            <Link to="/lineup/matchup" className="rt-link t-meta" style={{ justifySelf: 'start' }}>
              Plan your own matchup slot by slot →
            </Link>
            <WeeklyMatchupOdds teams={teams} playersById={playersById} />
          </ScreenSection>
        </>
      )}

      <AboutThisData>
        <span>Each team's real current roster, graded the same way Trade Analyzer grades it: average player score plus roster construction. A point-in-time read — there's no history to plot a trend over.</span>
        <span>Value is how far the roster beats expected value; construction is whether its starter slots are actually filled rather than stacked at one position.</span>
      </AboutThisData>
    </div>
  )
}
