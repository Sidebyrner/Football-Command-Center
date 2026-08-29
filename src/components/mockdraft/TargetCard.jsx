import { useState } from 'react'
import { ChevronUp, ChevronDown, X, Plus, CornerDownRight } from 'lucide-react'
import PlayerPicker from './PlayerPicker'

/**
 * One draft target: your priority, your note, and the fallbacks to pivot to if
 * this player is gone. Drafted players are struck through from the live draft
 * feed so the card tells you at a glance whether the plan still holds.
 */
export default function TargetCard({
  target, index, isFirst, isLast, players, draftedIds, pickByPlayer,
  onMove, onRemove, onNote, onAddFallback, onRemoveFallback,
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [addingFallback, setAddingFallback] = useState(false)
  const [noteDraft, setNoteDraft] = useState(target.note ?? '')

  const isGone = draftedIds?.has(target.playerId) ?? false
  const takenBy = pickByPlayer?.[target.playerId]

  // The first fallback still on the board — what you actually pivot to.
  const liveFallback = target.fallbacks.find((f) => !draftedIds?.has(f.playerId))

  function saveNote() {
    onNote(noteDraft)
    setEditingNote(false)
  }

  return (
    <li className={`rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 ${isGone ? 'opacity-55' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-faint)] w-4 flex-shrink-0 pt-0.5">
          {index + 1}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-xs font-semibold text-[var(--color-text)] ${isGone ? 'line-through' : ''}`}>
              {target.playerName}
            </span>
            <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">
              {target.playerTeam}
              {target.adp != null && ` · ADP ${Math.round(target.adp)}`}
              {target.bye != null && ` · Bye ${target.bye}`}
            </span>
            {isGone && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-sit)]/15 text-[var(--color-sit)]">
                {takenBy ? `GONE — ${takenBy.by}` : 'GONE'}
              </span>
            )}
          </div>

          {/* Note */}
          {editingNote ? (
            <div className="mt-1.5">
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onBlur={saveNote}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveNote()
                  if (e.key === 'Escape') { setNoteDraft(target.note ?? ''); setEditingNote(false) }
                }}
                rows={2}
                autoFocus
                placeholder="Why this player? Ceiling, role, risk…"
                className="w-full text-[11px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
          ) : (
            <button
              onClick={() => setEditingNote(true)}
              className="mt-0.5 text-left text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {target.note || <span className="text-[var(--color-text-faint)] italic">Add a note…</span>}
            </button>
          )}

          {/* Fallbacks */}
          {target.fallbacks.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {target.fallbacks.map((f) => {
                const fGone = draftedIds?.has(f.playerId) ?? false
                const isPivot = !isGone ? false : liveFallback?.playerId === f.playerId
                return (
                  <li key={f.playerId} className="flex items-center gap-1.5 group">
                    <CornerDownRight size={10} className="text-[var(--color-text-faint)] flex-shrink-0" />
                    <span className={`text-[11px] ${
                      fGone ? 'text-[var(--color-text-faint)] line-through'
                        : isPivot ? 'text-[var(--color-accent)] font-semibold'
                        : 'text-[var(--color-text-muted)]'
                    }`}>
                      {f.playerName}
                    </span>
                    <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">
                      {f.adp != null && `${Math.round(f.adp)}`}
                    </span>
                    {isPivot && (
                      <span className="text-[9px] font-semibold text-[var(--color-accent)]">← PIVOT HERE</span>
                    )}
                    <button
                      onClick={() => onRemoveFallback(f.playerId)}
                      className="opacity-0 group-hover:opacity-100 text-[var(--color-text-faint)] hover:text-[var(--color-sit)] transition-all"
                      aria-label={`Remove fallback ${f.playerName}`}
                    >
                      <X size={10} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {addingFallback ? (
            <div className="mt-1.5">
              <PlayerPicker
                players={players}
                position={target.playerPosition}
                excludeIds={new Set([target.playerId, ...target.fallbacks.map((f) => f.playerId)])}
                placeholder={`Fallback ${target.playerPosition}…`}
                onSelect={onAddFallback}
                onClose={() => setAddingFallback(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setAddingFallback(true)}
              className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
            >
              <Plus size={9} />
              Fallback
            </button>
          )}
        </div>

        {/* Reorder / remove */}
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <button
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            aria-label="Move up"
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={isLast}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            aria-label="Move down"
          >
            <ChevronDown size={13} />
          </button>
          <button
            onClick={onRemove}
            className="text-[var(--color-text-faint)] hover:text-[var(--color-sit)] transition-colors mt-0.5"
            aria-label={`Remove ${target.playerName}`}
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </li>
  )
}
