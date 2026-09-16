import { useState, useCallback, useMemo } from 'react'
import { fetchNFLOdds } from '../utils/oddsApi'
import { cacheGet, cacheSet, TTL } from '../utils/cache'
import { oddsForWeek } from '../utils/oddsHelpers'
import { useSchedule } from './useSchedule'

const CACHE_KEY = 'nfl-odds-v1'
const QUOTA_KEY = 'odds-api-quota'

/**
 * @param {string} apiKey
 * @param {number} season
 * @param {number} week - `odds` holds only this week's scheduled games; see
 *   oddsForWeek for why the raw feed can't be read directly.
 * @returns `odds` (this week) and `hasFetched` (whether anything is cached at
 *   all — the "fetch on page load" check, which must not re-spend quota just
 *   because none of the cached games are this week's).
 */
export function useOdds(apiKey, season, week) {
  const [allOdds, setAllOdds] = useState(() => cacheGet(CACHE_KEY) || [])
  const [quota, setQuota] = useState(() => {
    const q = localStorage.getItem(QUOTA_KEY)
    return q ? JSON.parse(q) : { remaining: null, used: null }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const { games: weekGames } = useSchedule(season, week)

  const odds = useMemo(() => oddsForWeek(allOdds, weekGames), [allOdds, weekGames])

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
      setAllOdds(data)
      const q = { remaining, used }
      setQuota(q)
      localStorage.setItem(QUOTA_KEY, JSON.stringify(q))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiKey])

  return { odds, hasFetched: allOdds.length > 0, quota, loading, error, fetchOdds }
}
