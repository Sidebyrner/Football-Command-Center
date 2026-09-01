import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import Header from '../components/layout/Header'
import DraftFilters from '../components/draft/DraftFilters'
import PlayerTable from '../components/draft/PlayerTable'
import PlayerDrawer from '../components/draft/PlayerDrawer'
import DraftStatusBar from '../components/draft/DraftStatusBar'
import PracticeDraftControl from '../components/draft/PracticeDraftControl'
import MyRosterPanel from '../components/draft/MyRosterPanel'
import PickFeed from '../components/draft/PickFeed'
import ScarcityIndicator from '../components/draft/ScarcityIndicator'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLiveDraft } from '../hooks/useLiveDraft'
import { useCohorts } from '../hooks/useCohorts'
import { usePlayerScores } from '../hooks/usePlayerScores'
import useAppStore from '../store/useAppStore'
import useWatchlistStore from '../store/useWatchlistStore'
import useScoringProfileStore from '../store/useScoringProfileStore'
import useResearchStore, { buildResearchIndex } from '../store/useResearchStore'

const DEFAULT_FILTERS = {
  search: '',
  positions: [],
  team: '',
  injury: '',
  trending: '',
  watchlistOnly: false,
  hideDrafted: true,
}

const DEFAULT_SORT = { col: 'position', dir: 'asc' }

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
  const { players, loading, error, marketError, lastUpdated, refresh } = useDraftPlayers()
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const practiceDraftId = useAppStore((s) => s.practiceDraftId)
  const draft = useLiveDraft(leagueId, sleeperUserId, { draftIdOverride: practiceDraftId })
  const { cohorts } = useCohorts()
  const { scores, loading: scoring } = usePlayerScores(players, cohorts)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const watchlistIds = useWatchlistStore((s) => s.ids)
  const toggleWatchlistId = useWatchlistStore((s) => s.toggle)
  const isDefaultScoring = useScoringProfileStore((s) => s.activeProfile.id === 'default-2026')
  // PlayerTable/PlayerDrawer expect a Set (fast .has() lookups on every row);
  // the store keeps a plain array so it serializes cleanly to localStorage.
  const watchlist = useMemo(() => new Set(watchlistIds), [watchlistIds])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const researchItems = useResearchStore((s) => s.items)
  const researchIndex = useMemo(() => buildResearchIndex(researchItems), [researchItems])

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([refresh(), draft.refresh()])
    setRefreshing(false)
  }

  function toggleWatch(playerId) {
    toggleWatchlistId(playerId)
  }

  // Positional-rank delta between consensus ADP and our scoring model.
  // Positive = this league's rules value the player more than the market does.
  // Computed strictly WITHIN position — a QB score of 85 and a WR score of 85
  // are not the same quantity (different cohorts, different weight tables), so
  // ranking across positions would silently compare two unrelated scales.
  const valueDeltas = useMemo(() => {
    const byPosition = {}
    for (const p of players) (byPosition[p.position] ??= []).push(p)

    const deltas = {}
    for (const group of Object.values(byPosition)) {
      const byAdp = [...group]
        .filter((p) => p.adp != null)
        .sort((a, b) => a.adp - b.adp)
      const byScore = [...group]
        .filter((p) => scores[p.id]?.available)
        .sort((a, b) => scores[a.id].score - scores[b.id].score)
        .reverse() // highest score = rank 1

      const adpRank = {}
      byAdp.forEach((p, i) => { adpRank[p.id] = i + 1 })
      const scoreRank = {}
      byScore.forEach((p, i) => { scoreRank[p.id] = i + 1 })

      for (const p of group) {
        if (adpRank[p.id] == null || scoreRank[p.id] == null) continue
        deltas[p.id] = adpRank[p.id] - scoreRank[p.id]
      }
    }
    return deltas
  }, [players, scores])

  const allTeams = useMemo(() => {
    return [...new Set(players.map((p) => p.team).filter(Boolean))].sort()
  }, [players])

  const playersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
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
      // Only hide drafted players once a draft is actually under way, so the
      // board is not silently truncated before the draft starts.
      if (filters.hideDrafted && draft.isLive && draft.draftedIds.has(p.id)) return false
      return true
    })
  }, [players, filters, watchlist, draft.isLive, draft.draftedIds])

  return (
    <div className="flex flex-col h-screen">
      <Header
        title="Draft Dashboard"
        onRefresh={handleRefresh}
        refreshing={refreshing || loading}
      />

      <PracticeDraftControl />

      {isDefaultScoring && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-[var(--color-caution)] bg-[var(--color-caution)]/10 border-b border-[var(--color-caution)]/30">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>
            Scores are using assumed default scoring, not your league's real rules —{' '}
            <Link to="/settings" className="underline font-semibold hover:text-[var(--color-caution)]">
              pull your league's scoring from Sleeper in Settings
            </Link>{' '}
            before you draft.
          </span>
        </div>
      )}

      <DraftStatusBar draft={draft} />

      <MyRosterPanel picks={draft.picks} userId={sleeperUserId} playersById={playersById} />

      {draft.isLive && (
        <>
          <PickFeed picks={draft.picks} pickByPlayer={draft.pickByPlayer} playersById={playersById} />
          <ScarcityIndicator players={players} scores={scores} draftedIds={draft.draftedIds} />
        </>
      )}

      <DraftFilters
        filters={filters}
        onChange={setFilters}
        teams={allTeams}
        showDraftedToggle={draft.isLive}
      />

      {error && (
        <div className="px-4 py-2 text-xs text-[var(--color-sit)] bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          Failed to load player data: {error}
        </div>
      )}

      {marketError && (
        <div className="px-4 py-2 text-xs text-[var(--color-caution)] bg-[var(--color-surface)] border-b border-[var(--color-border)]">
          ADP and bye weeks unavailable: {marketError}
        </div>
      )}

      <PlayerTable
        players={filtered}
        loading={loading}
        sort={sort}
        onSort={setSort}
        watchlist={watchlist}
        onToggleWatch={toggleWatch}
        onSelectPlayer={setSelectedPlayer}
        researchIndex={researchIndex}
        draftedIds={draft.isLive || draft.picks.length ? draft.draftedIds : null}
        pickByPlayer={draft.pickByPlayer}
        scores={scores}
        scoring={scoring}
        valueDeltas={valueDeltas}
      />

      {lastUpdated && !loading && (
        <div className="px-4 py-1.5 text-xs text-[var(--color-text-faint)] bg-[var(--color-surface)] border-t border-[var(--color-border)]">
          Player data from Sleeper · Updated {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}

      {selectedPlayer && (
        <PlayerDrawer
          player={selectedPlayer}
          watchlist={watchlist}
          onToggleWatch={toggleWatch}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}
