import { useState, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'
import { cacheGet, cacheSet, TTL } from '../utils/cache'

const CACHE_KEY = 'sleeper-players-v1'

export function usePlayerCache() {
  const [players, setPlayers] = useState(() => cacheGet(CACHE_KEY) || {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchPlayers = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const cached = cacheGet(CACHE_KEY)
      if (cached) {
        setPlayers(cached)
        return cached
      }
    }
    setLoading(true)
    setError(null)
    try {
      const data = await sleeperApi.getPlayers()
      cacheSet(CACHE_KEY, data, TTL.PLAYERS)
      setPlayers(data)
      return data
    } catch (err) {
      setError(err.message)
      return {}
    } finally {
      setLoading(false)
    }
  }, [])

  return { players, loading, error, fetchPlayers }
}
