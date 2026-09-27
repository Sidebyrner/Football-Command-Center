import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { API_BASE, hasApiProxy } from '../../utils/apiBase'
import '../../screens/tools/researchTools.css'

const MAX_ARTICLES = 20

/**
 * On-demand summary of imported news, scoped to players the user is
 * actually watching or has targeted — relayed through server/'s
 * /api/ai/news-summary route to a local LM Studio model. Sends only
 * already-fetched, already-player-tagged article text (see
 * matchRelevantPlayer in src/utils/researchAdapters.js); the model never
 * sees anything this app didn't itself pull from a real feed.
 */
export default function NewsSummaryPanel({ items, relevantPlayerIds }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  async function handleGenerate() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setSummary(null)
    try {
      const articles = items
        .filter((i) => !i.isArchived && i.playerId && relevantPlayerIds.has(i.playerId))
        .sort((a, b) => new Date(b.publishedAt ?? b.createdAt) - new Date(a.publishedAt ?? a.createdAt))
        .slice(0, MAX_ARTICLES)
        .map((i) => ({ playerName: i.playerName, title: i.title, body: i.body, source: i.source }))

      if (articles.length === 0) {
        setError('No imported news is tagged to a watchlisted or planned player yet — import news, then try again.')
        return
      }

      const res = await fetch(`${API_BASE}/api/ai/news-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setSummary(body.summary)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // No proxy at all -> nothing to call; degrade to fully hidden rather than
  // a button that can only ever error, same principle as the Odds page.
  if (!hasApiProxy) return null

  return (
    <div className="card rt-stack">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleGenerate}
        disabled={loading}
        aria-expanded={open}
        className="button rt-button"
        style={{ justifyContent: 'flex-start' }}
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Sparkles size={14} color="var(--accent)" aria-hidden />
        )}
        <span>{open ? 'Hide summary' : 'Summarize my news'}</span>
        <span className="t-meta faint ml-auto" style={{ fontWeight: 400 }}>via local LLM</span>
      </button>

      {open && (
        <div aria-live="polite">
          {loading && (
            <p className="t-meta muted" style={{ margin: 0 }}>
              Thinking… local inference can take a bit longer than the rest of this app.
            </p>
          )}
          {error && <p className="t-meta" style={{ margin: 0, color: 'var(--sit)' }}>{error}</p>}
          {summary && !loading && (
            <p className="t-body" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{summary}</p>
          )}
        </div>
      )}
    </div>
  )
}
