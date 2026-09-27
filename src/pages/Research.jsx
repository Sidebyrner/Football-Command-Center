import { useState, useMemo } from 'react'
import { Plus, BookOpen, Archive, Rss, Loader2, NotebookPen } from 'lucide-react'
import { AboutThisData, ScreenHero, ScreenSection } from '@ui/components/Screen'
import ResearchCard from '../components/research/ResearchCard'
import ResearchItemForm from '../components/research/ResearchItemForm'
import NewsSummaryPanel from '../components/research/NewsSummaryPanel'
import DefenseVsPositionPanel from '../components/matchup/DefenseVsPositionPanel'
import useResearchStore from '../store/useResearchStore'
import useWatchlistStore from '../store/useWatchlistStore'
import useMockDraftStore from '../store/useMockDraftStore'
import { useDraftPlayers } from '../hooks/useDraftPlayers'
import { useNewsImport } from '../hooks/useNewsImport'
import { TAGS } from '../utils/researchTags'
import '../screens/tools/researchTools.css'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

export default function Research() {
  const { items, addItem, pinItem, archiveItem, deleteItem, loadSampleData } = useResearchStore()
  const { importNews, loading: importing, error: importError, notice: importNotice, hasApiProxy } = useNewsImport()
  const [importMsg, setImportMsg] = useState(null)

  // Who imported news should be checked against — the union of watchlisted
  // players and draft plan targets. Kept narrow on purpose (see
  // fetchRSSFeed's matchRelevantPlayer): this isn't "tag every article for
  // every NFL player," it's "tell me about players I'm actually tracking."
  const { players } = useDraftPlayers()
  const watchlistIds = useWatchlistStore((s) => s.ids)
  const planTargets = useMockDraftStore((s) => s.targets)
  const relevantPlayers = useMemo(() => {
    const map = new Map()
    const playersById = {}
    for (const p of players) playersById[p.id] = p
    for (const id of watchlistIds) {
      const p = playersById[id]
      if (p) map.set(id, { id, name: p.name })
    }
    for (const list of Object.values(planTargets)) {
      for (const t of list) {
        if (t.playerId && t.playerName) map.set(t.playerId, { id: t.playerId, name: t.playerName })
      }
    }
    return [...map.values()]
  }, [players, watchlistIds, planTargets])
  const relevantPlayerIds = useMemo(() => new Set(relevantPlayers.map((p) => p.id)), [relevantPlayers])

  async function handleImportNews() {
    setImportMsg(null)
    const added = await importNews(relevantPlayers)
    if (added > 0) setImportMsg(`Imported ${added} new item${added > 1 ? 's' : ''}.`)
  }

  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [addingItem, setAddingItem] = useState(false)

  const displayed = useMemo(() => {
    const q = search.toLowerCase().trim()
    return items
      .filter((item) => {
        if (!showArchived && item.isArchived) return false
        if (showArchived && !item.isArchived) return false
        if (q) {
          const hay = [item.title, item.body, item.playerName, item.playerTeam]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!hay.includes(q)) return false
        }
        if (posFilter && item.playerPosition !== posFilter) return false
        if (tagFilter && !item.tags.includes(tagFilter)) return false
        return true
      })
      .sort((a, b) => {
        // Pinned items float to top
        if (a.isSaved !== b.isSaved) return a.isSaved ? -1 : 1
        return new Date(b.createdAt) - new Date(a.createdAt)
      })
  }, [items, search, posFilter, tagFilter, showArchived])

  const activeCount = items.filter((i) => !i.isArchived).length
  const archivedCount = items.filter((i) => i.isArchived).length
  const pinnedCount = items.filter((i) => i.isSaved && !i.isArchived).length

  function handleSave(fields) {
    addItem(fields)
    setAddingItem(false)
  }

  return (
    <div className="rt-page">
      <ScreenHero
        overline="Tools · Research"
        icon={BookOpen}
        hue="var(--hue-team)"
        answer={activeCount > 0 ? `${activeCount} research note${activeCount === 1 ? '' : 's'}` : 'No research notes yet'}
        detail="Your notes and imported news on the players you're tracking, plus how every defense treats each position."
        stats={items.length > 0 ? [
          { value: String(pinnedCount), label: 'pinned' },
          { value: String(archivedCount), label: 'archived' },
        ] : []}
      />

      <NewsSummaryPanel items={items} relevantPlayerIds={relevantPlayerIds} />

      {/* Matchup research — needs no API key, so it sits above the note feed */}
      <DefenseVsPositionPanel />

      <ScreenSection
        title={showArchived ? 'Archived notes' : 'Notes and news'}
        icon={NotebookPen}
        count={displayed.length}
        hue="var(--hue-team)"
      >
        {/* Filter bar */}
        <div className="card rt-row" role="search" aria-label="Filter research">
          <input
            type="search"
            placeholder="Search items…"
            aria-label="Search research items"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rt-field"
            style={{ flex: '1 1 180px' }}
          />

          <select
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            aria-label="Filter by position"
            className="rt-field"
            style={{ flex: '0 1 auto' }}
          >
            <option value="">All Positions</option>
            {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="Filter by tag"
            className="rt-field"
            style={{ flex: '0 1 auto', minWidth: 120 }}
          >
            <option value="">All Tags</option>
            {TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            className={`button rt-button${showArchived ? ' on' : ''}`}
          >
            <Archive size={14} aria-hidden />
            <span>Archived</span>
            {archivedCount > 0 && <span className="t-meta faint">({archivedCount})</span>}
          </button>

          <div className="rt-row ml-auto">
            {/* Import news — relayed through the server proxy (B1/B2). Always
                shown, even unconfigured, so the feature is discoverable rather
                than silently absent; the error message says what's missing. */}
            <button
              type="button"
              onClick={handleImportNews}
              disabled={importing}
              aria-busy={importing}
              title={hasApiProxy
                ? 'Import latest NFL news from ESPN and Pro Football Talk'
                : 'No news relay in this build — it needs VITE_API_BASE_URL pointing at the server proxy'}
              className="button rt-button"
            >
              {importing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Rss size={14} aria-hidden />}
              Import News
            </button>

            <button
              type="button"
              onClick={() => setAddingItem((v) => !v)}
              aria-expanded={addingItem}
              className="button primary rt-button"
            >
              <Plus size={14} aria-hidden />
              Add Item
            </button>
          </div>
        </div>

        {(importMsg || importError || importNotice) && (
          <p
            className="t-meta"
            role="status"
            style={{
              margin: 0,
              color: importError ? 'var(--caution)' : importNotice ? 'var(--text-2)' : 'var(--start)',
            }}
          >
            {importError ?? importNotice ?? importMsg}
          </p>
        )}

        {/* Add form */}
        {addingItem && <ResearchItemForm onSave={handleSave} onCancel={() => setAddingItem(false)} />}

        {/* List */}
        {displayed.length === 0 ? (
          <div className="card empty-state">
            <BookOpen size={28} color="var(--text-3)" aria-hidden />
            {showArchived ? (
              <p className="t-body muted" style={{ margin: 0 }}>No archived items.</p>
            ) : activeCount === 0 ? (
              <>
                <p className="t-title" style={{ margin: 0 }}>No research items yet</p>
                <p className="t-body muted" style={{ margin: 0 }}>
                  Open a player on the Draft board or use “Add Item” above.
                </p>
                <button type="button" onClick={loadSampleData} className="button">
                  Load sample items
                </button>
                <p className="t-meta faint" style={{ margin: 0, maxWidth: '20rem' }}>
                  Samples are illustrative fiction, not real reporting. They are
                  labelled "sample" wherever they appear.
                </p>
              </>
            ) : (
              <p className="t-body muted" style={{ margin: 0 }}>No items match the current filters.</p>
            )}
          </div>
        ) : (
          <div className="rt-card-list" style={{ maxWidth: '48rem' }}>
            <p className="t-meta muted" style={{ margin: 0 }}>
              {displayed.length} item{displayed.length !== 1 ? 's' : ''}
              {showArchived ? ' archived' : ''}
            </p>
            {displayed.map((item) => (
              <ResearchCard
                key={item.id}
                item={item}
                onPin={pinItem}
                onArchive={archiveItem}
                onDelete={deleteItem}
              />
            ))}
          </div>
        )}
      </ScreenSection>

      <AboutThisData>
        <span>Notes live in this browser. Imported news comes from ESPN and Pro Football Talk through the app's server relay, tagged only to players on your watchlist or draft plan.</span>
        <span>“Summarize my news” sends those already-imported articles to a local model through the same relay; it only appears when the relay is configured.</span>
        <span>Defense vs position scores nflverse game logs with your league's rules, one season at a time.</span>
      </AboutThisData>
    </div>
  )
}
