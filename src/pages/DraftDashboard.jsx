import { useState, useMemo } from 'react'
import { AlertTriangle, ListOrdered, RefreshCw } from 'lucide-react'
import { ScreenHero, Callout } from '@ui/components/Screen'
import DraftFilters from '../components/draft/DraftFilters'
import PlayerTable from '../components/draft/PlayerTable'
import PlayerDrawer from '../components/draft/PlayerDrawer'
import DraftStatusBar from '../components/draft/DraftStatusBar'
import PracticeDraftControl from '../components/draft/PracticeDraftControl'
import MyRosterPanel from '../components/draft/MyRosterPanel'
import TeamGradesPanel from '../components/draft/TeamGradesPanel'
import PickFeed from '../components/draft/PickFeed'
import ScarcityIndicator from '../components/draft/ScarcityIndicator'
import StrategyBriefPanel from '../components/draft/StrategyBriefPanel'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useLiveDraft } from '../hooks/useLiveDraft'
import { useCohorts } from '../hooks/useCohorts'
import { usePlayerScores } from '../hooks/usePlayerScores'
import { useLeagueRosterSettings } from '../hooks/useLeagueRosterSettings'
import useAppStore from '../store/useAppStore'
import useWatchlistStore from '../store/useWatchlistStore'
import useScoringProfileStore from '../store/useScoringProfileStore'
import useResearchStore, { buildResearchIndex } from '../store/useResearchStore'
import '../components/draft/draft.css'

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

// The hero's one answer: where the draft stands for you right now.
function heroAnswer(draft) {
  if (draft.isLive) {
    if (draft.picksUntilMyTurn === 0) return "You're on the clock"
    if (draft.picksUntilMyTurn != null) {
      return `${draft.picksUntilMyTurn} pick${draft.picksUntilMyTurn === 1 ? '' : 's'} until you`
    }
    return 'Draft is live'
  }
  if (draft.draft?.status === 'complete') return 'Draft complete'
  return 'Draft board'
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
  const { players, loading, error, marketError, lastUpdated, refresh } = useDraftPlayers()
  const leagueId = useAppStore((s) => s.leagueId)
  const sleeperUserId = useAppStore((s) => s.sleeperUserId)
  const practiceDraftId = useAppStore((s) => s.practiceDraftId)
  const draft = useLiveDraft(leagueId, sleeperUserId, { draftIdOverride: practiceDraftId })
  const { cohorts } = useCohorts()
  const { scores, loading: scoring } = usePlayerScores(players, cohorts)
  const { slotTemplate } = useLeagueRosterSettings(leagueId)
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

  // Real-data payload for the strategy brief — capped, not the whole board.
  // A local model has a much smaller usable context than sending all ~1,500
  // players would need, and "the top of each position plus anyone you're
  // watching" is what a strategy conversation actually needs, not a full
  // dump. Only players with a real computed score are ever included.
  const BRIEF_TOP_N = 8
  const briefPlayers = useMemo(() => {
    const byPosition = {}
    for (const p of players) (byPosition[p.position] ??= []).push(p)

    const selected = new Map()
    for (const list of Object.values(byPosition)) {
      const scored = list
        .filter((p) => scores[p.id]?.available && !draft.draftedIds.has(p.id))
        .sort((a, b) => scores[b.id].score - scores[a.id].score)
        .slice(0, BRIEF_TOP_N)
      for (const p of scored) selected.set(p.id, p)
      for (const p of list) {
        if (watchlist.has(p.id) && scores[p.id]?.available) selected.set(p.id, p)
      }
    }

    return [...selected.values()].map((p) => ({
      name: p.name,
      position: p.position,
      score: scores[p.id].score,
      tierLabel: scores[p.id].tierLabel,
      adp: p.adp ?? null,
      valueDelta: valueDeltas[p.id] ?? null,
      drafted: draft.draftedIds.has(p.id),
    }))
  }, [players, scores, valueDeltas, draft.draftedIds, watchlist])

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

  const busy = refreshing || loading
  const heroDetail = loading
    ? 'Loading the player pool from Sleeper…'
    : `${players.length.toLocaleString()} players · this league's scoring vs. consensus ADP`

  return (
    <div className="dd-page">
      <div className="dd-toolbar">
        <PracticeDraftControl />
        <span className="dd-toolbar-spacer" />
        <button
          type="button"
          className="button dd-small"
          onClick={handleRefresh}
          disabled={busy}
          aria-label="Refresh player data and draft"
        >
          <RefreshCw size={14} aria-hidden className={busy ? 'dd-spin' : undefined} />
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <ScreenHero
        overline="Tools · Draft"
        icon={ListOrdered}
        hue="var(--hue-team)"
        answer={heroAnswer(draft)}
        detail={heroDetail}
      />

      {isDefaultScoring && (
        <Callout tone="caution">
          <div className="dd-callout-row t-meta">
            <AlertTriangle size={15} color="var(--caution)" aria-hidden />
            <span>
              Scores are using assumed default scoring — your league's own rules haven't loaded from
              Sleeper yet. They're picked up automatically once your league loads.
            </span>
          </div>
        </Callout>
      )}

      <DraftStatusBar draft={draft} />

      <MyRosterPanel picks={draft.picks} userId={sleeperUserId} playersById={playersById} />

      <StrategyBriefPanel players={briefPlayers} />

      {draft.isLive && (
        <>
          <PickFeed picks={draft.picks} pickByPlayer={draft.pickByPlayer} playersById={playersById} />
          <ScarcityIndicator players={players} scores={scores} draftedIds={draft.draftedIds} />
          <TeamGradesPanel
            picks={draft.picks}
            pickByPlayer={draft.pickByPlayer}
            sleeperUserId={sleeperUserId}
            playersById={playersById}
            scores={scores}
            slotTemplate={slotTemplate}
          />
        </>
      )}

      <DraftFilters
        filters={filters}
        onChange={setFilters}
        teams={allTeams}
        showDraftedToggle={draft.isLive}
      />

      {error && (
        <Callout tone="sit">
          <div className="dd-callout-row t-meta" role="alert">
            <AlertTriangle size={15} color="var(--sit)" aria-hidden />
            <span>Failed to load player data: {error}</span>
          </div>
        </Callout>
      )}

      {marketError && (
        <Callout tone="caution">
          <div className="dd-callout-row t-meta">
            <AlertTriangle size={15} color="var(--caution)" aria-hidden />
            <span>ADP and bye weeks unavailable: {marketError}</span>
          </div>
        </Callout>
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
        footer={lastUpdated && !loading
          ? `Player data from Sleeper · Updated ${new Date(lastUpdated).toLocaleTimeString()}`
          : null}
      />

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
