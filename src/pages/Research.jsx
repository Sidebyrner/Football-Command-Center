import { useState, useMemo } from 'react'
import { Plus, BookOpen, Archive } from 'lucide-react'
import Header from '../components/layout/Header'
import ResearchCard from '../components/research/ResearchCard'
import ResearchItemForm from '../components/research/ResearchItemForm'
import useResearchStore from '../store/useResearchStore'
import { TAGS } from '../utils/researchTags'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

export default function Research() {
  const { items, addItem, pinItem, archiveItem, deleteItem } = useResearchStore()

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

  function handleSave(fields) {
    addItem(fields)
    setAddingItem(false)
  }

  return (
    <div className="flex flex-col h-screen">
      <Header title="Research" />

      {/* Filter bar */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] max-w-xs px-2.5 py-1.5 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />

        {/* Position */}
        <select
          value={posFilter}
          onChange={(e) => setPosFilter(e.target.value)}
          className="py-1.5 pl-2.5 pr-6 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer"
          style={{ backgroundImage: 'none' }}
        >
          <option value="">All Positions</option>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        {/* Tag */}
        <select
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="py-1.5 pl-2.5 pr-6 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer min-w-[110px]"
          style={{ backgroundImage: 'none' }}
        >
          <option value="">All Tags</option>
          {TAGS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {/* Archived toggle */}
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border transition-colors ${
            showArchived
              ? 'bg-[var(--color-surface-2)] border-[var(--color-accent)] text-[var(--color-accent)]'
              : 'bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <Archive size={13} />
          <span>Archived</span>
          {archivedCount > 0 && (
            <span className="text-xs tabular-nums text-[var(--color-text-faint)]">({archivedCount})</span>
          )}
        </button>

        {/* Add button */}
        <button
          onClick={() => setAddingItem((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--color-accent)] text-black rounded hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={14} />
          Add Item
        </button>
      </div>

      {/* Add form */}
      {addingItem && (
        <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <ResearchItemForm onSave={handleSave} onCancel={() => setAddingItem(false)} />
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <BookOpen size={32} className="text-[var(--color-text-faint)] mb-3" />
            {showArchived ? (
              <p className="text-sm text-[var(--color-text-faint)]">No archived items.</p>
            ) : activeCount === 0 ? (
              <>
                <p className="text-sm text-[var(--color-text-muted)] mb-1">No research items yet.</p>
                <p className="text-xs text-[var(--color-text-faint)]">
                  Click a player row in the Draft Dashboard or use "Add Item" above.
                </p>
              </>
            ) : (
              <p className="text-sm text-[var(--color-text-faint)]">No items match the current filters.</p>
            )}
          </div>
        ) : (
          <div className="max-w-3xl space-y-2.5">
            <p className="text-xs text-[var(--color-text-faint)] mb-3 tabular-nums">
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
      </div>
    </div>
  )
}
