// Real current rosters for every team in the league — the data source behind
// "know what other teams are working with." getLeagueRosters/getLeagueUsers
// already existed in sleeperService.js but nothing in the app called them
// before this; the whole point of season-mode Team Grades / Trade Analyzer is
// turning that on.

import { useState, useEffect } from 'react'
import { getLeagueRosters, getLeagueUsers } from '../services/sleeperService'
import { joinLeagueTeams } from '../utils/leagueTeams'

/**
 * @returns {{ teams: Array<{id, name, memberIds, isOpen, playerIds, starterIds, rosterId, record, pointsFor, pointsAgainst}>, loading, error }}
 *   `id` is the roster's owner_id (matches Sleeper's userId elsewhere in the
 *   app), or `roster-<n>` for an open team. Match the user with isMyTeam /
 *   findMyTeam from utils/leagueTeams so co-owners find their team too.
 *   `starterIds` is Sleeper's real starters array — use this for "what's
 *   actually started," not assignPicksToSlots (that's for grading roster
 *   construction quality, a different question). `rosterId` is Sleeper's
 *   roster_id, needed to join against matchup data (keyed by roster_id, not
 *   owner_id).
 */
export function useLeagueTeamRosters(leagueId) {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    Promise.all([getLeagueRosters(leagueId), getLeagueUsers(leagueId)])
      .then(([rosters, users]) => {
        if (cancelled) return
        const joined = joinLeagueTeams(rosters, users)
        setTeams(joined)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [leagueId])

  return { teams, loading, error }
}
