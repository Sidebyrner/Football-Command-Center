import { useState, useMemo } from 'react'
import Header from '../components/layout/Header'
import DraftFilters from '../components/draft/DraftFilters'
import PlayerTable from '../components/draft/PlayerTable'
import { useDraftPlayers, POSITION_ORDER } from '../hooks/useDraftPlayers'

const DEFAULT_FILTERS = {
  search: '',
  positions: [],
  team: '',
  injury: '',
  trending: '',
  watchlistOnly: false,
}

const DEFAULT_SORT = { col: 'position', dir: 'asc' }

function loadWatchlist() {
  try {
    return new Set(JSON.parse(localStorage.getItem('fcc-draft-watchlist') || '[]'))
  } catch {
    return new Set()
  }
}

function saveWatchlist(set) {
  try {
    localStorage.setItem('fcc-draft-watchlist', JSON.stringify([...set]))
  } catch {}
}

function matchesInjuryFilter(injuryStatus, filter) {
  if (!filter) return true
  const s = (injuryStatus || '').toLowerCase()
  if (filter === 'healthy') return !injuryStatus
  if (filter === 'questionable') return s === 'questionable'
  if (filter === 'doubtful') return s === 'doubtful'
  if (filter === 'out') return s === 'out' || s === 'ir' || s === 'pup' || s === 'injured reserve'
  return true
}

export default function DraftDashboard() {
  const { players, loading, error, lastUpdated, refresh } = useDraftPlayers()
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [watchlist, setWatchlist] = useState(loadWatchlist)
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  function toggleWatch(playerId) {
    setWatchlist((prev) => {
      const next = new Set(prev)
      if (next.has(playerId)) next.delete(playerId)
      else next.add(playerId)
      saveWatchlist(next)
      return next
    })
  }

  const allTeams = useMemo(() => {
    const teams = [...new Set(players.map((p) => p.team).filter(Boolean))].sort()
    return teams
  }, [players])

  const filtered = useMemo(() => {
    const q = filters.search.toLowerCase().trim()
    return players.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (filters.positions.length && !filters.positions.includes(p.position)) return false
      if (filters.team && p.team !== filters.team) return false
      if (!matchesInjuryFilter(p.injuryStatus, filters.injury)) return false
      if (filters.trending && p.trending !== filters.trending) return false
      if (filters.watchlistOnly && !watchlist.has(p.id)) return false
      return true
    })
  }, [players, filters, watchlist])

  return (
    <div className="flex flex-col h-screen">
      <Header
        title="Draft Dashboard"
        onRefresh={handleRefresh}
        refreshing={refreshing || loading}
      />

      <DraftFilters filters={filters} onChange={setFilters} teams={allTeams} />

      {error && (
        <div className="px-4 py-2 text-xs text-[var(--color-sit)] bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          Failed to load player data: {error}
        </div>
      )}

      <PlayerTable
        players={filtered}
        loading={loading}
        sort={sort}
        onSort={setSort}
        watchlist={watchlist}
        onToggleWatch={toggleWatch}
      />

      {lastUpdated && !loading && (
        <div className="px-4 py-1.5 text-xs text-[var(--color-text-faint)] bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          Player data from Sleeper · Updated {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
