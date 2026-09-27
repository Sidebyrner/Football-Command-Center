import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import useAppStore from '../../store/useAppStore'
import '../../screens/tools/researchTools.css'

/**
 * The Odds API key, set right where it's used. The old Settings page that
 * held it is gone and the new Settings doesn't carry web-only keys, so the
 * Odds tool owns it — stored the same way as before (useAppStore, this
 * browser only).
 *
 * With no key it's an open form; with one it's a one-line "saved" row with
 * Change and Remove.
 */
export default function OddsKeyField() {
  const oddsApiKey = useAppStore((s) => s.oddsApiKey)
  const setOddsApiKey = useAppStore((s) => s.setOddsApiKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const hintId = useId()

  function save(e) {
    e.preventDefault()
    const key = draft.trim()
    if (!key) return
    setOddsApiKey(key)
    setDraft('')
    setEditing(false)
  }

  if (oddsApiKey && !editing) {
    return (
      <div className="rt-row t-meta muted" aria-label="Odds API key">
        <KeyRound size={14} aria-hidden />
        <span>Odds API key saved in this browser (ends …{oddsApiKey.slice(-4)}).</span>
        <button type="button" className="button rt-button t-meta" onClick={() => setEditing(true)}>Change</button>
        <button type="button" className="button rt-button t-meta" onClick={() => setOddsApiKey('')}>Remove</button>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="rt-stack" style={{ gap: 'var(--space-s)' }}>
      <label htmlFor={inputId} className="t-meta" style={{ fontWeight: 600 }}>Odds API key</label>
      <div className="rt-row">
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key from the-odds-api.com"
          aria-describedby={hintId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rt-field"
          style={{ flex: '1 1 220px' }}
        />
        <button type="submit" className="button primary" disabled={!draft.trim()}>Save key</button>
        {editing && (
          <button type="button" className="button" onClick={() => { setEditing(false); setDraft('') }}>Cancel</button>
        )}
      </div>
      <p id={hintId} className="t-meta muted" style={{ margin: 0 }}>
        Free tier: 500 requests a month from{' '}
        <a href="https://the-odds-api.com" target="_blank" rel="noopener noreferrer" className="rt-link">the-odds-api.com</a>.
        Stored in this browser only — it isn't part of Settings or synced anywhere.
      </p>
    </form>
  )
}
