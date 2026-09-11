import Header from '../components/layout/Header'
import { getPositionColor } from '../utils/playerHelpers'
import { useTeamPowerRankings } from '../hooks/useTeamPowerRankings'
import { useLeagueMatchups } from '../hooks/useLeagueMatchups'
import { useLeagueTransactions } from '../hooks/useLeagueTransactions'
import { useSeasonMatchupHistory } from '../hooks/useSeasonMatchupHistory'
import { useNflState } from '../hooks/useNflState'
import LineupAlerts from '../components/dashboard/LineupAlerts'
import TeamNews from '../components/dashboard/TeamNews'
import QuickLinksStrip from '../components/dashboard/QuickLinksStrip'
import StandingsCard from '../components/dashboard/StandingsCard'
import WaiverTargets from '../components/dashboard/WaiverTargets'
import DraftValueRealized from '../components/dashboard/DraftValueRealized'
import BenchPoints from '../components/dashboard/BenchPoints'
import WeeklyScoringTrend from '../components/dashboard/WeeklyScoringTrend'
import { Link } from 'react-router-dom'
import useAppStore from '../store/useAppStore'

function Card({ title, children, className = '' }) {
  return (
    <div className={`border border-[var(--color-border)] rounded bg-[var(--color-surface)] p-4 ${className}`}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-3">
        {title}
      </h2>
      {children}
    </div>
  )
}

function PlayerRow({ id, playersById, muted }) {
  const p = playersById[id]
  return (
    <li className={`flex items-center gap-2 text-xs ${muted ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
      <span
        className="font-semibold w-8 flex-shrink-0"
        style={{ color: p ? getPositionColor(p.position) : undefined }}
      >
        {p?.position ?? '?'}
      </span>
      <span className="truncate">{p?.name ?? id}</span>
    </li>
  )
}

function RosterCard({ myTeam, playersById, loading, error }) {
  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load your roster: {error}</p>
  if (!myTeam) return <p className="text-sm text-[var(--color-text-muted)]">Roster not found for your account.</p>

  // Sleeper fills unset starter slots with the literal string "0", not an
  // empty/omitted entry — real before Week 1 locks the lineup for the first
  // time. Treat those as empty slots, not a phantom player.
  const realStarterIds = myTeam.starterIds.filter((id) => id && id !== '0')
  const emptyStarterCount = myTeam.starterIds.length - realStarterIds.length
  const benchIds = myTeam.playerIds.filter((id) => !realStarterIds.includes(id))

  return (
    <>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">
        Starters ({realStarterIds.length}{emptyStarterCount > 0 ? ` of ${myTeam.starterIds.length}` : ''})
      </p>
      {emptyStarterCount > 0 && (
        <p className="text-[10px] text-[var(--color-caution)] mb-1.5">
          {emptyStarterCount} starter slot{emptyStarterCount > 1 ? 's' : ''} not set yet on Sleeper.
        </p>
      )}
      <ul className="space-y-1 mb-3">
        {realStarterIds.map((id) => <PlayerRow key={id} id={id} playersById={playersById} />)}
      </ul>
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1.5">
        Bench ({benchIds.length})
      </p>
      <ul className="space-y-1">
        {benchIds.map((id) => <PlayerRow key={id} id={id} playersById={playersById} muted />)}
      </ul>
    </>
  )
}

function MatchupCard({ myTeam, myMatchup, mySide, opponentTeam, opponentSide, currentWeek, loading, error }) {
  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load this week's matchup: {error}</p>
  if (!myMatchup) {
    return <p className="text-sm text-[var(--color-text-muted)]">No matchup found for week {currentWeek} yet.</p>
  }
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text)]">{myTeam.name} <span className="text-[var(--color-text-faint)] font-normal">(you)</span></p>
        <p className="text-xl font-bold tabular-nums text-[var(--color-text)]">{(mySide?.points ?? 0).toFixed(1)}</p>
      </div>
      <span className="text-xs text-[var(--color-text-faint)] flex-shrink-0 px-2">vs</span>
      <div className="text-right">
        <p className="text-sm font-semibold text-[var(--color-text)]">{opponentTeam?.name ?? 'Unknown'}</p>
        <p className="text-xl font-bold tabular-nums text-[var(--color-text)]">{(opponentSide?.points ?? 0).toFixed(1)}</p>
      </div>
    </div>
  )
}

function WaiverCard({ transactions, loading, error }) {
  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load waiver activity: {error}</p>
  if (transactions.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No waiver activity this week.</p>

  return (
    <ul className="space-y-2.5">
      {transactions.slice(0, 8).map((t) => (
        <li key={t.id} className="space-y-0.5">
          {t.adds.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 text-xs text-[var(--color-start)]">
              <span className="font-bold">+</span><span className="truncate">{p.name}</span>
            </div>
          ))}
          {t.drops.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 text-xs text-[var(--color-sit)]">
              <span className="font-bold">−</span><span className="truncate">{p.name}</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  )
}

/**
 * Season-long home base: your actual roster (real starters/bench from
 * Sleeper, not a recomputed "optimal" lineup), this week's fantasy matchup,
 * and this league's real waiver-wire activity.
 */
export default function Dashboard() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const currentWeek = useAppStore((s) => s.currentWeek)

  // Sleeper's own current week beats the hand-typed Settings value, which
  // goes stale the moment the season moves on; Settings stays the fallback.
  const { week: liveWeek, detected } = useNflState(currentWeek)
  const week = liveWeek ?? currentWeek
  const throughWeek = Math.max(0, week - 1)

  const { teams, playersById, loading: rostersLoading, error: rostersError } = useTeamPowerRankings(leagueId, sleeperUserId)
  const { matchups, loading: matchupsLoading, error: matchupsError } = useLeagueMatchups(leagueId, week)
  const { transactions, loading: txLoading, error: txError } = useLeagueTransactions(leagueId, week, playersById)
  const {
    weeklyTotalsByRoster, weeklyByRoster, weeksLoaded, loading: historyLoading,
  } = useSeasonMatchupHistory(leagueId, throughWeek)

  const myTeam = teams.find((t) => t.id === sleeperUserId)
  const myMatchup = myTeam ? matchups.find((m) => m.sides.some((s) => s.rosterId === myTeam.rosterId)) : null
  const mySide = myMatchup?.sides.find((s) => s.rosterId === myTeam?.rosterId)
  const opponentSide = myMatchup?.sides.find((s) => s.rosterId !== myTeam?.rosterId)
  const opponentTeam = opponentSide ? teams.find((t) => t.rosterId === opponentSide.rosterId) : null

  if (!leagueId) {
    return (
      <div className="flex flex-col h-screen">
        <Header title="Dashboard" />
        <main className="flex-1 overflow-auto p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Connect your Sleeper league in{' '}
            <Link to="/settings" className="underline font-semibold">Settings</Link>{' '}
            to see your roster, matchup, and waiver activity.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <Header title="Dashboard" />

      <LineupAlerts myTeam={myTeam} playersById={playersById} currentWeek={week} />
      <TeamNews myTeam={myTeam} playersById={playersById} />
      <QuickLinksStrip teams={teams} myTeam={myTeam} playersById={playersById} week={week} />

      <main className="flex-1 overflow-auto p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card title="My Roster">
            <RosterCard myTeam={myTeam} playersById={playersById} loading={rostersLoading} error={rostersError} />
          </Card>

          <Card title={`Week ${week} Matchup`}>
            <MatchupCard
              myTeam={myTeam}
              myMatchup={myMatchup}
              mySide={mySide}
              opponentTeam={opponentTeam}
              opponentSide={opponentSide}
              currentWeek={week}
              loading={rostersLoading || matchupsLoading}
              error={rostersError || matchupsError}
            />
          </Card>

          <Card title="Standings">
            <StandingsCard teams={teams} loading={rostersLoading} error={rostersError} />
          </Card>

          <Card title="Waiver Targets">
            <WaiverTargets teams={teams} myTeam={myTeam} playersById={playersById} />
          </Card>

          <Card title="Waiver Wire Activity">
            <WaiverCard transactions={transactions} loading={txLoading} error={txError} />
          </Card>

          <Card title="Points Left On Bench">
            <BenchPoints
              myTeam={myTeam}
              weeklyByRoster={weeklyByRoster}
              playersById={playersById}
              loading={historyLoading}
            />
          </Card>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card title="Weekly Scoring vs. The League">
            <WeeklyScoringTrend
              myTeam={myTeam}
              weeklyTotalsByRoster={weeklyTotalsByRoster}
              weeksLoaded={weeksLoaded}
              loading={historyLoading}
            />
          </Card>

          <Card title="Draft Value Realized">
            <DraftValueRealized playersById={playersById} throughWeek={throughWeek} />
          </Card>
        </div>

        {!detected && (
          <p className="text-[10px] text-[var(--color-text-faint)]">
            Couldn't reach Sleeper for the current NFL week — using week {week} from{' '}
            <Link to="/settings" className="underline">Settings</Link>.
          </p>
        )}
      </main>
    </div>
  )
}
