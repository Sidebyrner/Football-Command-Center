import { useState, useEffect, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'

export function useSleeperRoster(leagueId) {
  const [rosters, setRosters] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchRosters = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const [rostersData, usersData] = await Promise.all([
        sleeperApi.getRosters(leagueId),
        sleeperApi.getUsers(leagueId),
      ])
      setRosters(rostersData || [])
      setUsers(usersData || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    fetchRosters()
  }, [fetchRosters])

  return { rosters, users, loading, error, refresh: fetchRosters }
}
