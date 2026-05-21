// Lazy-loads nflverse historical stats for a player when their drawer opens.
// Only fires when the player has a gsis_id (from Sleeper metadata).

import { useState, useEffect } from 'react'
import { getPlayerSeasonHistory } from '../services/nflverseService'

export function usePlayerStats(player) {
  const [history, setHistory] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const gsisId = player?.gsisId ?? null

  useEffect(() => {
    if (!gsisId) {
      setHistory(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    getPlayerSeasonHistory(gsisId)
      .then((data) => {
        if (!cancelled) {
          setHistory(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [gsisId])

  // Sorted season keys descending (most recent first)
  const seasons = history ? Object.keys(history).map(Number).sort((a, b) => b - a) : []

  return { history, seasons, loading, error, hasData: history !== null && seasons.length > 0 }
}
