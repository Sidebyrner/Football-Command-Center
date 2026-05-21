import { useState, useEffect, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'

export function useSleeperMatchup(leagueId, week) {
  const [matchups, setMatchups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchMatchups = useCallback(async () => {
    if (!leagueId || !week) return
    setLoading(true)
    setError(null)
    try {
      const data = await sleeperApi.getMatchups(leagueId, week)
      setMatchups(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [leagueId, week])

  useEffect(() => {
    fetchMatchups()
  }, [fetchMatchups])

  return { matchups, loading, error, refresh: fetchMatchups }
}
