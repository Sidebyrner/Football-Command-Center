import { useState, useMemo } from 'react'
import { Loader2, CalendarClock } from 'lucide-react'
import Header from '../components/layout/Header'
import ByeCrunchGrid from '../components/planning/ByeCrunchGrid'
import AcquisitionBoard from '../components/planning/AcquisitionBoard'
import { useByeOutlook } from '../hooks/useByeOutlook'
import { useAcquisitionBoard } from '../hooks/useAcquisitionBoard'
import { useTrendingAdds } from '../hooks/useTrendingAdds'
import { useMissingPlayerMeta } from '../hooks/useMissingPlayerMeta'
import { useWeeklySeasons } from '../hooks/usePlayerWeekly'
import { useNflState } from '../hooks/useNflState'
import useAppStore from '../store/useAppStore'
import { pickStatsSeason, statsSeasonNote } from '../utils/statsSeason'

/**
 * Getting ahead of the schedule.
 *
 * Everything else in this app answers "what about this week." This page is the
 * only one that looks forward: which future weeks your roster structurally
 * cannot cover, and who is available to fix them. The two halves are on one
 * page because the answer to the first is only useful while you can still act
 * on it — a week 11 hole found in week 11 is just a loss.
 */
export default function Planning() {
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const season = useAppStore((s) => s.season)
  const settingsWeek = useAppStore((s) => s.currentWeek)

  const { week: currentWeek, detected } = useNflState(settingsWeek)
  const [selectedWeek, setSelectedWeek] = useState(null)

  const {
    weeks, teams, myOutlook, crunchWeeks, byeWeeks,
    rosters, slotTemplate, playersById,
    loading: byeLoading, error: byeError,
  } = useByeOutlook(leagueId, season, currentWeek ?? 1, sleeperUserId)

  // nflverse publishes a season at a time; the newest available file is the
  // one every other production view in the app scores against.
  const weeklySeasons = useWeeklySeasons()
  // Newest season with at least three weeks of games — see utils/statsSeason.js.
  const { statsSeason, currentSeasonWeeks } = pickStatsSeason(weeklySeasons, season)
  const seasonNote = statsSeasonNote({ statsSeason, scheduleSeason: season, currentSeasonWeeks })

  const {
    players, baselines, profileName,
    loading: boardLoading, error: boardError,
  } = useAcquisitionBoard({ statsSeason, rosters, sleeperUserId, slotTemplate })

  const { trending } = useTrendingAdds()

  // Trending reaches IDP; the main player pool doesn't. Resolve those names
  // rather than printing raw Sleeper ids.
  const missingTrendingIds = useMemo(
    () => (trending ?? []).map((t) => t.player_id).filter((id) => id && !playersById[id]),
    [trending, playersById]
  )
  const extraMeta = useMissingPlayerMeta(missingTrendingIds)
  const allPlayersById = useMemo(
    () => ({ ...playersById, ...extraMeta }),
    [playersById, extraMeta]
  )

  const byeTeamsForWeek = useMemo(
    () => (selectedWeek ? new Set(byeWeeks[selectedWeek] ?? []) : null),
    [selectedWeek, byeWeeks]
  )

  if (!leagueId) {
    return (
      <div className="flex flex-col h-screen">
        <Header title="Planning" />
        <main className="flex-1 p-6">
          <p className="text-sm text-[var(--color-text-muted)]">
            Set your league in Settings first — this page reads every team's roster.
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <Header title="Planning" />
      <main className="flex-1 overflow-auto p-6 space-y-8">
        <section>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              Bye-week crunch, from week {currentWeek ?? '—'} on
            </h2>
            <span className="text-[10px] text-[var(--color-text-faint)]">
              {detected ? 'current week from Sleeper' : 'current week from Settings'}
            </span>
          </div>

          {byeLoading && (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Loader2 size={14} className="animate-spin" />
              Working out every team's remaining byes…
            </div>
          )}

          {!byeLoading && (
            <>
              {crunchWeeks.length > 0 && (
                <div className="flex items-start gap-2 mb-3 text-sm text-[var(--color-text)]">
                  <CalendarClock size={15} className="mt-0.5 flex-shrink-0 text-[var(--color-caution)]" />
                  <p>
                    You can't field a full lineup in{' '}
                    <span className="font-semibold">
                      {crunchWeeks.map((w) => `week ${w.week}`).join(', ')}
                    </span>
                    . Worst is week {crunchWeeks[0].week}, short {crunchWeeks[0].totalShortfall}{' '}
                    {crunchWeeks[0].totalShortfall === 1 ? 'slot' : 'slots'}.
                  </p>
                </div>
              )}
              <ByeCrunchGrid
                weeks={weeks}
                teams={teams}
                myOutlook={myOutlook}
                selectedWeek={selectedWeek}
                onPickWeek={(w) => setSelectedWeek((prev) => (prev === w ? null : w))}
                loading={byeLoading}
                error={byeError}
              />
            </>
          )}
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-3">
            Who to go get
            {selectedWeek && (
              <span className="ml-2 normal-case tracking-normal text-[var(--color-accent)]">
                filtered to players available in week {selectedWeek}
              </span>
            )}
          </h2>

          {!statsSeason && !boardLoading ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No weekly production file is available, so there's nothing to rank. The bye grid above
              still works — it comes from the schedule.
            </p>
          ) : (
            <AcquisitionBoard
              players={players}
              baselines={baselines}
              trending={trending}
              playersById={allPlayersById}
              profileName={profileName}
              selectedWeek={selectedWeek}
              byeTeams={byeTeamsForWeek}
              onClearWeek={() => setSelectedWeek(null)}
              loading={boardLoading || byeLoading}
              error={boardError}
            />
          )}

          {seasonNote && (
            <p className="text-[10px] text-[var(--color-caution)] mt-2">{seasonNote}</p>
          )}
        </section>
      </main>
    </div>
  )
}
