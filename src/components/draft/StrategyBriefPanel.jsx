import { useState } from 'react'
import { Sparkles, Loader2, AlertTriangle } from 'lucide-react'
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
    <section className="card dd-panel" aria-label="Strategy brief">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleGenerate}
        disabled={loading}
        className="dd-disclosure"
        aria-expanded={open}
      >
        {loading ? (
          <Loader2 size={16} className="dd-spin" color="var(--text-3)" aria-hidden />
        ) : (
          <Sparkles size={16} color="var(--accent)" aria-hidden />
        )}
        <span className="t-section">{open ? 'Hide strategy brief' : 'Generate strategy brief'}</span>
        <span className="dd-disclosure-trailing t-meta">via local LLM</span>
      </button>

      {open && (
        <div className="dd-panel-body" aria-live="polite">
          {loading && (
            <p className="t-meta muted" style={{ margin: 0 }}>
              Thinking… local inference can take a bit longer than the rest of this app.
            </p>
          )}
          {error && (
            <p className="dd-callout-row t-meta" style={{ margin: 0, color: 'var(--sit)' }} role="alert">
              <AlertTriangle size={14} aria-hidden /> <span>{error}</span>
            </p>
          )}
          {brief && !loading && (
            <p className="t-body" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{brief}</p>
          )}
        </div>
      )}
    </section>
  )
}
