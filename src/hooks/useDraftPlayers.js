import { useState, useEffect, useCallback } from 'react'
import { sleeperApi } from '../utils/sleeperApi'
import { cacheGet, cacheSet, TTL } from '../utils/cache'

const PLAYER_CACHE = 'sleeper-players-v1'
const TRENDING_CACHE = 'sleeper-draft-trending-v1'

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
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError(null)
    try {
      let playerMap = !force ? cacheGet(PLAYER_CACHE) : null
      if (!playerMap) {
        playerMap = await sleeperApi.getPlayers()
        cacheSet(PLAYER_CACHE, playerMap, TTL.PLAYERS)
      }

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

      const list = Object.values(playerMap)
        .filter((p) => p.active && RELEVANT_POSITIONS.has(p.position))
        .map((p) => ({
          id: p.player_id,
          name: normalizeName(p),
          position: p.position,
          team: p.team || 'FA',
          rank: typeof p.search_rank === 'number' ? p.search_rank : null,
          byeWeek: p.bye_week ?? null,
          injuryStatus: p.injury_status ?? null,
          trending: addSet.has(p.player_id) ? 'add' : dropSet.has(p.player_id) ? 'drop' : null,
          age: p.age ?? null,
          yearsExp: p.years_exp ?? null,
          // Extra fields used by the player drawer
          college: p.college ?? null,
          depthChartOrder: p.depth_chart_order ?? null,
          number: p.number ?? null,
          // Join key for nflverse data lookup
          gsisId: p.gsis_id ?? null,
        }))

      setPlayers(list)
      setLastUpdated(Date.now())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { players, loading, error, lastUpdated, refresh: () => load(true) }
}
