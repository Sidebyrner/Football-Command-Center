import { useMemo, useState } from 'react'
import { Rss, Loader2, ExternalLink } from 'lucide-react'
import useResearchStore from '../../store/useResearchStore'
import { useNewsImport } from '../../hooks/useNewsImport'
import NewsSummaryPanel from '../research/NewsSummaryPanel'

const MAX_SHOWN = 6

/**
 * Ties the existing news-import pipeline (matchRelevantPlayer in
 * researchAdapters.js, already generic) to your actual roster instead of
 * just watchlist/draft-plan targets. Imported items land in the same global
 * research store Research.jsx reads — nothing duplicated, just a different
 * relevantPlayers input and a roster-scoped view of the same data.
 */
export default function TeamNews({ myTeam, playersById }) {
  const items = useResearchStore((s) => s.items)
  const { importNews, loading, error, notice, hasApiProxy } = useNewsImport()
  const [importMsg, setImportMsg] = useState(null)

  const relevantPlayers = useMemo(() => {
    if (!myTeam) return []
    return myTeam.playerIds
      .map((id) => playersById[id])
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name }))
  }, [myTeam, playersById])

  const relevantPlayerIds = useMemo(() => new Set(relevantPlayers.map((p) => p.id)), [relevantPlayers])

  const teamItems = useMemo(() => {
    return items
      .filter((i) => !i.isArchived && i.playerId && relevantPlayerIds.has(i.playerId))
      .sort((a, b) => new Date(b.publishedAt ?? b.createdAt) - new Date(a.publishedAt ?? a.createdAt))
      .slice(0, MAX_SHOWN)
  }, [items, relevantPlayerIds])

  async function handleImport() {
    setImportMsg(null)
    const added = await importNews(relevantPlayers)
    if (added > 0) setImportMsg(`Imported ${added} new item${added > 1 ? 's' : ''}.`)
  }

  if (!myTeam || relevantPlayers.length === 0) return null

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Team News
        </h2>
        {hasApiProxy && (
          <button
            onClick={handleImport}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Rss size={12} />}
            Check for team news
          </button>
        )}
      </div>

      <div className="px-4 pb-2 space-y-0.5">
        {error && <p className="text-xs text-[var(--color-sit)] mb-1.5">{error}</p>}
        {importMsg && <p className="text-xs text-[var(--color-start)] mb-1.5">{importMsg}</p>}
        {notice && <p className="text-xs text-[var(--color-text-faint)] mb-1.5">{notice}</p>}

        {teamItems.length === 0 && (
          <p className="text-xs text-[var(--color-text-faint)] pb-2">
            No news imported yet for your roster.
            {hasApiProxy ? ' Click "Check for team news" above.' : ''}
          </p>
        )}

        {teamItems.map((item) => (
          <a
            key={item.id}
            href={item.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-1.5 py-1.5 text-xs hover:bg-[var(--color-surface-2)] rounded px-1 -mx-1 transition-colors"
          >
            <ExternalLink size={11} className="flex-shrink-0 mt-0.5 text-[var(--color-text-faint)]" />
            <span className="min-w-0">
              <span className="text-[var(--color-accent)] font-semibold">{item.playerName}</span>{' '}
              <span className="text-[var(--color-text-muted)]">{item.title}</span>
            </span>
          </a>
        ))}
      </div>

      <NewsSummaryPanel items={items} relevantPlayerIds={relevantPlayerIds} />
    </div>
  )
}
