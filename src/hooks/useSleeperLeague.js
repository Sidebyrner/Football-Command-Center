import { useState, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'

export function useSleeperLeague() {
  const [leagues, setLeagues] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchLeagues = useCallback(async (userId, season) => {
    setLoading(true)
    setError(null)
    try {
      const data = await sleeperApi.getLeagues(userId, season)
      setLeagues(data || [])
      return data || []
    } catch (err) {
      setError(err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  return { leagues, loading, error, fetchLeagues }
}
