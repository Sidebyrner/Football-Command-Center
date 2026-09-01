import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { API_BASE, hasApiProxy } from '../../utils/apiBase'

/**
 * On-demand narrative synthesis of the board's own real numbers — relayed
 * through server/'s /api/ai/strategy-brief route to a local LM Studio
 * model. `players` is already the exact, capped, real-score payload built
 * by DraftDashboard.jsx; this component only handles the request lifecycle
 * and rendering, never touches or reshapes the data itself.
 */
export default function StrategyBriefPanel({ players }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [brief, setBrief] = useState(null)
  const [error, setError] = useState(null)

  async function handleGenerate() {
    setOpen(true)
    setLoading(true)
    setError(null)
    setBrief(null)
    try {
      if (players.length === 0) {
        setError('No scored players available yet to build a brief from.')
        return
      }
      const res = await fetch(`${API_BASE}/api/ai/strategy-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setBrief(body.brief)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!hasApiProxy) return null

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={open ? () => setOpen(false) : handleGenerate}
        disabled={loading}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin text-[var(--color-text-faint)]" />
        ) : (
          <Sparkles size={12} className="text-[var(--color-text-faint)]" />
        )}
        <span className="text-[var(--color-text-muted)] font-medium">
          {open ? 'Hide strategy brief' : 'Generate strategy brief'}
        </span>
        <span className="text-[10px] text-[var(--color-text-faint)] ml-auto">via local LLM</span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading && (
            <p className="text-xs text-[var(--color-text-faint)]">
              Thinking… local inference can take a bit longer than the rest of this app.
            </p>
          )}
          {error && <p className="text-xs text-[var(--color-sit)]">{error}</p>}
          {brief && !loading && (
            <p className="text-xs text-[var(--color-text)] leading-relaxed whitespace-pre-wrap">{brief}</p>
          )}
        </div>
      )}
    </div>
  )
}
