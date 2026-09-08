// Real current rosters for every team in the league — the data source behind
// "know what other teams are working with." getLeagueRosters/getLeagueUsers
// already existed in sleeperService.js but nothing in the app called them
// before this; the whole point of season-mode Team Grades / Trade Analyzer is
// turning that on.

import { useState, useEffect } from 'react'
import { getLeagueRosters, getLeagueUsers } from '../services/sleeperService'

/**
 * @returns {{ teams: Array<{id, name, playerIds}>, loading, error }}
 *   `id` is the roster's owner_id (matches Sleeper's userId elsewhere in the app).
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
        const nameByUserId = {}
        for (const u of users ?? []) nameByUserId[u.user_id] = u.display_name || u.username

        const joined = (rosters ?? [])
          .filter((r) => r.owner_id)
          .map((r) => ({
            id: r.owner_id,
            name: nameByUserId[r.owner_id] ?? `Team ${r.roster_id}`,
            playerIds: r.players ?? [],
          }))
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
