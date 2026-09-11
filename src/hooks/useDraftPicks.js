// This league's completed draft picks, fetched once.
//
// Deliberately NOT useLiveDraft: that hook exists to follow a draft in
// progress and polls on an interval forever (useLiveDraft.js's non-live
// branch runs every 30s with force:true, bypassing the cache). Reading a
// finished draft's pick list months later needs none of that — one cached
// read, no timers.

import { useState, useEffect } from 'react'
import { getLeagueDrafts, getDraftPicks } from '../services/sleeperService'

/**
 * @returns {{ picks: Array, draftId: string|null, loading: boolean, error: string|null }}
 *   `picks` are Sleeper's raw pick objects (pick_no, round, player_id,
 *   picked_by, roster_id).
 */
export function useDraftPicks(leagueId) {
  const [picks, setPicks] = useState([])
  const [draftId, setDraftId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)

    getLeagueDrafts(leagueId)
      .then((drafts) => {
        if (cancelled) return null
        if (!drafts?.length) return null
        // Newest draft — for a finished season that's the real one. (A live
        // draft is useLiveDraft's job, not this hook's.)
        const newest = [...drafts].sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0))[0]
        setDraftId(newest.draft_id)
        return getDraftPicks(newest.draft_id)
      })
      .then((data) => {
        if (cancelled || data == null) { if (!cancelled) setLoading(false); return }
        setPicks(data ?? [])
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [leagueId])

  return { picks, draftId, loading, error }
}
