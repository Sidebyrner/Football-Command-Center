// This week's fantasy matchups — who's playing whom, and each side's live/
// final points. sleeperService.getLeagueMatchups already existed (cached)
// but had no caller anywhere in the app before this.

import { useState, useEffect } from 'react'
import { getLeagueMatchups } from '../services/sleeperService'

/**
 * @returns {{ matchups: Array<{matchupId, sides: Array<{rosterId, points}>}>, loading, error }}
 *   `sides` normally has exactly 2 entries; a bye week or an odd team count
 *   can leave a matchup with just 1.
 */
export function useLeagueMatchups(leagueId, week) {
  const [matchups, setMatchups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId || !week) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    getLeagueMatchups(leagueId, week)
      .then((raw) => {
        if (cancelled) return
        const byMatchupId = new Map()
        for (const m of raw ?? []) {
          if (m.matchup_id == null) continue
          if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, [])
          byMatchupId.get(m.matchup_id).push({ rosterId: m.roster_id, points: m.points ?? 0 })
        }
        setMatchups([...byMatchupId.entries()].map(([matchupId, sides]) => ({ matchupId, sides })))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [leagueId, week])

  return { matchups, loading, error }
}
