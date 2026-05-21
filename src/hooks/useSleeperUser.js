import { useState, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'

export function useSleeperUser() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchUser = useCallback(async (username) => {
    setLoading(true)
    setError(null)
    try {
      const data = await sleeperApi.getUser(username)
      if (!data || !data.user_id) throw new Error('User not found')
      setUser(data)
      return data
    } catch (err) {
      setError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { user, loading, error, fetchUser }
}
