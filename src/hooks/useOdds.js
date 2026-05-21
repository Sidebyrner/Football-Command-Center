import { useState, useCallback } from 'react'
import { fetchNFLOdds } from '../utils/oddsApi'
import { cacheGet, cacheSet, TTL } from '../utils/cache'

const CACHE_KEY = 'nfl-odds-v1'
const QUOTA_KEY = 'odds-api-quota'

export function useOdds(apiKey) {
  const [odds, setOdds] = useState(() => cacheGet(CACHE_KEY) || [])
  const [quota, setQuota] = useState(() => {
    const q = localStorage.getItem(QUOTA_KEY)
    return q ? JSON.parse(q) : { remaining: null, used: null }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchOdds = useCallback(async () => {
    if (!apiKey) {
      setError('No Odds API key configured')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data, remaining, used } = await fetchNFLOdds(apiKey)
      cacheSet(CACHE_KEY, data, TTL.ODDS)
      setOdds(data)
      const q = { remaining, used }
      setQuota(q)
      localStorage.setItem(QUOTA_KEY, JSON.stringify(q))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiKey])

  return { odds, quota, loading, error, fetchOdds }
}
