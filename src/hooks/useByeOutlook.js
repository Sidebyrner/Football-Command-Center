// Which upcoming weeks each team in the league can't field a lineup in.
//
// The whole league, not just yours, because the useful question isn't only
// "when am I short" but "who else is short in that same week" — you want to
// trade with someone who ISN'T, and timing that is the point of looking ahead.

import { useMemo } from 'react'
import { byeWeeksFromSchedule, crunchForWeek } from '../utils/byeWeeks'
import { toNflverseTeam } from '../utils/nflTeams'
import { isMyTeam } from '../utils/leagueTeams'
import { useSchedule } from './useSchedule'
import { useLeagueTeamRosters } from './useLeagueTeamRosters'
import { useLeagueRosterSettings } from './useLeagueRosterSettings'
import { useLeaguePlayersById } from './useLeaguePlayersById'

/**
 * @param {string} leagueId
 * @param {string|number} season
 * @param {number} fromWeek - weeks before this are history; they're excluded
 * @param {string} sleeperUserId
 */
export function useByeOutlook(leagueId, season, fromWeek, sleeperUserId) {
  const { file: scheduleFile, loading: scheduleLoading, error: scheduleError } = useSchedule(season, fromWeek)
  const { teams: rosters, loading: rostersLoading, error: rostersError } = useLeagueTeamRosters(leagueId)
  const { slotTemplate, loading: settingsLoading } = useLeagueRosterSettings(leagueId)
  const { playersById, loading: playersLoading } = useLeaguePlayersById(rosters)

  const byes = useMemo(
    () => (scheduleFile ? byeWeeksFromSchedule(scheduleFile) : { byTeam: {}, byWeek: {}, teams: [] }),
    [scheduleFile]
  )

  const outlook = useMemo(() => {
    if (!slotTemplate || !rosters.length) return { weeks: [], teams: [] }

    // Only weeks that still have byes left in them are worth showing — the
    // rest are structurally identical to a normal week.
    const weeks = Object.keys(byes.byWeek)
      .map(Number)
      .filter((w) => w >= fromWeek)
      .sort((a, b) => a - b)

    const teamRows = rosters.map((t) => {
      const isMe = isMyTeam(t, sleeperUserId)
      const byWeek = {}
      for (const week of weeks) {
        const byeTeams = new Set(byes.byWeek[week] ?? [])
        // IR and taxi players can't cover a bye — Sleeper won't start them.
        byWeek[week] = crunchForWeek(t.startableIds ?? t.playerIds, {
          playersById,
          byeTeams,
          template: slotTemplate,
          normalizeTeam: toNflverseTeam,
        })
      }
      return { id: t.id, name: t.name, isMe, rosterId: t.rosterId, byWeek }
    })

    return { weeks, teams: teamRows }
  }, [byes, rosters, slotTemplate, playersById, fromWeek, sleeperUserId])

  const myOutlook = outlook.teams.find((t) => t.isMe) ?? null

  // Your problem weeks, worst first — what the acquisition board filters on.
  const crunchWeeks = useMemo(() => {
    if (!myOutlook) return []
    return outlook.weeks
      .map((week) => ({ week, ...myOutlook.byWeek[week] }))
      .filter((w) => w.totalShortfall > 0)
      .sort((a, b) => b.totalShortfall - a.totalShortfall || a.week - b.week)
  }, [myOutlook, outlook.weeks])

  return {
    weeks: outlook.weeks,
    teams: outlook.teams,
    myOutlook,
    crunchWeeks,
    byeWeeks: byes.byWeek,
    // Handed back so a page showing both halves of the planning feature can
    // reuse the rosters, slot template and player index this already loaded
    // rather than mounting the same three hooks a second time.
    rosters,
    slotTemplate,
    playersById,
    loading: scheduleLoading || rostersLoading || settingsLoading || playersLoading,
    error: scheduleError || rostersError,
  }
}
