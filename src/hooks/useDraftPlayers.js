import { useState, useEffect, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'
import { cacheGet, cacheSet, cacheClear, TTL } from '../utils/cache'
import {
  loadMarketData, buildAdpNameIndex, buildDstTeamIndex, lookupMarket, gsisIdFor,
} from '../services/marketService'

// v2: we now cache the TRIMMED player list, not Sleeper's raw ~5 MB /players/nfl
// blob. The raw payload does not reliably fit in localStorage (~5 MB cap), so the
// old cache silently failed its write and refetched megabytes on every load.
const PLAYER_CACHE = 'fcc-draft-players-v2'
const TRENDING_CACHE = 'sleeper-draft-trending-v1'
const LEGACY_PLAYER_CACHE = 'sleeper-players-v1'

const RELEVANT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])

export const POSITION_ORDER = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 }

function normalizeName(p) {
  if (p.full_name) return p.full_name
  const parts = [p.first_name, p.last_name].filter(Boolean)
  return parts.length ? parts.join(' ') : p.player_id
}

export function useDraftPlayers() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [marketError, setMarketError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    setMarketError(null)

    // One-time eviction of the oversized legacy blob, which otherwise squats on
    // most of the origin's storage budget and starves every other cache write.
    cacheClear(LEGACY_PLAYER_CACHE)

    try {
      const cached = !force ? cacheGet(PLAYER_CACHE) : null
      if (cached) {
        setPlayers(cached)
        setLastUpdated(Date.now())
        setLoading(false)
        return
      }

      const playerMap = await sleeperApi.getPlayers()

      let trending = !force ? cacheGet(TRENDING_CACHE) : null
      if (!trending) {
        const [adds, drops] = await Promise.all([
          sleeperApi.getTrendingAdds(),
          sleeperApi.getTrendingDrops(),
        ])
        trending = { adds, drops }
        cacheSet(TRENDING_CACHE, trending, TTL.TRENDING)
      }
      const addSet = new Set((trending.adds || []).map((t) => t.player_id))
      const dropSet = new Set((trending.drops || []).map((t) => t.player_id))

      // Consensus rank + bye. Non-fatal: the board still works without it.
      let market = null
      try {
        market = await loadMarketData()
      } catch (err) {
        setMarketError(err.message)
      }
      const adpNameIndex = market ? buildAdpNameIndex(market.adpByFpId) : null
      const dstTeamIndex = market ? buildDstTeamIndex(market.adpByFpId) : null

      const list = Object.values(playerMap)
        .filter((p) => p.active && RELEVANT_POSITIONS.has(p.position))
        .map((p) => {
          const base = {
            id: p.player_id,
            name: normalizeName(p),
            position: p.position,
            team: p.team || 'FA',
            searchRank: typeof p.search_rank === 'number' ? p.search_rank : null,
            injuryStatus: p.injury_status ?? null,
            trending: addSet.has(p.player_id) ? 'add' : dropSet.has(p.player_id) ? 'drop' : null,
            age: p.age ?? null,
            yearsExp: p.years_exp ?? null,
            college: p.college ?? null,
            depthChartOrder: p.depth_chart_order ?? null,
            number: p.number ?? null,
            // Sleeper does not publish gsis_id for every player; the crosswalk fills gaps.
            gsisId: p.gsis_id ?? null,
          }

          if (!market) return { ...base, adp: null, bye: null, matchedBy: null }

          const m = lookupMarket(base, { ...market, adpNameIndex, dstTeamIndex })
          return {
            ...base,
            ...m,
            gsisId: base.gsisId ?? gsisIdFor(base.id, market.idsBySleeper),
          }
        })

      setPlayers(list)
      cacheSet(PLAYER_CACHE, list, TTL.PLAYERS)
      setLastUpdated(Date.now())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { players, loading, error, marketError, lastUpdated, refresh: () => load(true) }
}
