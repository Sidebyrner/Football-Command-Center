// Real current rosters for every team in the league — the data source behind
// "know what other teams are working with." getLeagueRosters/getLeagueUsers
// already existed in sleeperService.js but nothing in the app called them
// before this; the whole point of season-mode Team Grades / Trade Analyzer is
// turning that on.

import { useState, useEffect } from 'react'
import { getLeagueRosters, getLeagueUsers } from '../services/sleeperService'

/**
 * @returns {{ teams: Array<{id, name, playerIds, starterIds, rosterId, record, pointsFor, pointsAgainst}>, loading, error }}
 *   `id` is the roster's owner_id (matches Sleeper's userId elsewhere in the app).
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
        const nameByUserId = {}
        for (const u of users ?? []) nameByUserId[u.user_id] = u.display_name || u.username

        const joined = (rosters ?? [])
          .filter((r) => r.owner_id)
          .map((r) => ({
            id: r.owner_id,
            name: nameByUserId[r.owner_id] ?? `Team ${r.roster_id}`,
            playerIds: r.players ?? [],
            starterIds: r.starters ?? [],
            rosterId: r.roster_id,
            // Sleeper already returns season record and points here; this
            // response was being read for rosters only and the rest thrown
            // away, leaving the app with no standings anywhere.
            record: {
              wins: r.settings?.wins ?? 0,
              losses: r.settings?.losses ?? 0,
              ties: r.settings?.ties ?? 0,
            },
            pointsFor: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
            pointsAgainst: (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100,
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
