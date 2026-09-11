// The real current NFL week, from Sleeper.
//
// useAppStore.currentWeek is typed by hand in Settings and goes stale the
// moment the season moves on — every season-history feature keyed off it
// would then silently show "not enough completed weeks." This is the
// authoritative source; the Settings value stays as the fallback/override.

import { useState, useEffect } from 'react'
import { getNflState } from '../services/sleeperService'

/**
 * @param {number} [fallbackWeek] - useAppStore's currentWeek, used until the
 *   real state loads and if the request fails entirely.
 * @returns {{ week: number|null, seasonType: string|null, detected: boolean, loading: boolean }}
 *   `detected` is false when `week` is just the fallback echoed back, so
 *   callers can say where the number came from instead of implying certainty.
 */
export function useNflState(fallbackWeek) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getNflState()
      .then((s) => { if (!cancelled) { setState(s); setLoading(false) } })
      // Non-fatal: a failure here just means we keep using the Settings value.
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const detectedWeek = typeof state?.week === 'number' && state.week > 0 ? state.week : null

  return {
    week: detectedWeek ?? fallbackWeek ?? null,
    seasonType: state?.season_type ?? null,
    detected: detectedWeek != null,
    loading,
  }
}
