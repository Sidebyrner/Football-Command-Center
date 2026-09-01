import { useState } from 'react'
import { FlaskConical, X } from 'lucide-react'
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
      <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-[var(--color-accent)]/15 border-b border-[var(--color-accent)]/30">
        <FlaskConical size={12} className="text-[var(--color-accent)] flex-shrink-0" />
        <span className="font-semibold text-[var(--color-accent)]">PRACTICE MODE</span>
        <span className="text-[var(--color-text-faint)] tabular-nums truncate">
          following draft {practiceDraftId}
        </span>
        <button
          onClick={() => setPracticeDraftId(null)}
          className="ml-auto flex-shrink-0 flex items-center gap-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
        >
          <X size={12} />
          Exit practice mode
        </button>
      </div>
    )
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full px-4 py-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors text-left"
      >
        Practice with a Sleeper mock draft →
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder="Paste your Sleeper mock draft URL or ID…"
        className="flex-1 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)]"
      />
      <button
        onClick={handleSubmit}
        className="flex-shrink-0 text-xs px-2.5 py-1 rounded bg-[var(--color-accent)] text-black font-semibold hover:bg-[var(--color-accent-hover)] transition-colors"
      >
        Follow
      </button>
      <button
        onClick={cancel}
        className="flex-shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
        aria-label="Cancel"
      >
        <X size={13} />
      </button>
      {error && <span className="text-[10px] text-[var(--color-sit)] flex-shrink-0">{error}</span>}
    </div>
  )
}
