import { useState } from 'react'
import { AlertTriangle, FlaskConical, X } from 'lucide-react'
import useAppStore from '../../store/useAppStore'

// Sleeper draft/league IDs are long numeric snowflake-style strings — pulling
// the longest digit run out of a pasted URL or a raw ID covers both without
// needing to parse the URL shape itself.
function parseDraftId(input) {
  const match = input.trim().match(/(\d{10,})/)
  return match ? match[1] : null
}

/**
 * Lets the user point live-draft sync at an arbitrary Sleeper draft — namely
 * a free Sleeper mock draft (bots included) — instead of the real league's
 * draft, for practice reps before the actual draft. Fully independent of the
 * real league state in useAppStore, so there's no way for a practice run to
 * bleed into draft-day data.
 */
export default function PracticeDraftControl() {
  const practiceDraftId = useAppStore((s) => s.practiceDraftId)
  const setPracticeDraftId = useAppStore((s) => s.setPracticeDraftId)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState('')
  const [error, setError] = useState(null)

  function handleSubmit() {
    const id = parseDraftId(input)
    if (!id) {
      setError('Paste a Sleeper mock draft URL or its draft ID.')
      return
    }
    setPracticeDraftId(id)
    setEditing(false)
    setInput('')
    setError(null)
  }

  function cancel() {
    setEditing(false)
    setInput('')
    setError(null)
  }

  if (practiceDraftId) {
    return (
      <div className="dd-practice on t-meta" role="status">
        <FlaskConical size={14} color="var(--accent)" aria-hidden />
        <span className="dd-practice-label">Practice mode</span>
        <span className="dd-truncate muted">following draft {practiceDraftId}</span>
        <button type="button" className="dd-text-button quiet" onClick={() => setPracticeDraftId(null)}>
          <X size={13} aria-hidden />
          Exit practice mode
        </button>
      </div>
    )
  }

  if (!editing) {
    return (
      <button type="button" className="button dd-small" onClick={() => setEditing(true)}>
        <FlaskConical size={14} aria-hidden />
        Practice with a Sleeper mock draft
      </button>
    )
  }

  return (
    <form
      className="dd-practice-form"
      onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
      aria-label="Follow a Sleeper mock draft"
    >
      <label className="dd-sr-only" htmlFor="dd-practice-input">Sleeper mock draft URL or ID</label>
      <input
        id="dd-practice-input"
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
        }}
        placeholder="Paste your Sleeper mock draft URL or ID…"
        className="dd-field"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'dd-practice-error' : undefined}
      />
      <button type="submit" className="button primary dd-small">Follow</button>
      <button type="button" className="dd-icon-button large" onClick={cancel} aria-label="Cancel">
        <X size={15} aria-hidden />
      </button>
      {error && (
        <span id="dd-practice-error" className="dd-practice-error t-meta" role="alert">
          <AlertTriangle size={13} aria-hidden /> {error}
        </span>
      )}
    </form>
  )
}
