// League-wide trending adds from Sleeper. getTrendingPlayers has been
// wrapped and cached in sleeperService.js since before this session and was
// called nowhere — this turns it on.

import { useState, useEffect } from 'react'
import { getTrendingPlayers } from '../services/sleeperService'

/**
 * @returns {{ trending: Array<{player_id: string, count: number}>, loading, error }}
 */
export function useTrendingAdds() {
  const [trending, setTrending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getTrendingPlayers('add')
      .then((data) => { if (!cancelled) { setTrending(data ?? []); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return { trending, loading, error }
}
