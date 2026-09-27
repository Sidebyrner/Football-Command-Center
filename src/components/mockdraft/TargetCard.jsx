import { useState } from 'react'
import { ChevronUp, ChevronDown, X, Plus, CornerDownRight } from 'lucide-react'
import PlayerPicker from './PlayerPicker'
import '../draft/draft.css'

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
    <li className={`inset dd-target${isGone ? ' gone' : ''}`}>
      <span className="dd-target-rank t-meta">{index + 1}</span>

      <div className="dd-target-main">
        <div className="dd-target-title">
          <span className={`t-body${isGone ? ' dd-strike' : ''}`} style={{ fontWeight: 600 }}>
            {target.playerName}
          </span>
          <span className="t-meta faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {target.playerTeam}
            {target.adp != null && ` · ADP ${Math.round(target.adp)}`}
            {target.bye != null && ` · Bye ${target.bye}`}
          </span>
          {isGone && (
            <span className="dd-tag gone">
              {takenBy ? `Gone — ${takenBy.by}` : 'Gone'}
            </span>
          )}
        </div>

        {/* Note */}
        {editingNote ? (
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
            aria-label={`Note for ${target.playerName}`}
            placeholder="Why this player? Ceiling, role, risk…"
            className="dd-field t-meta"
            style={{ background: 'var(--card)' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingNote(true)}
            className="dd-note-button t-meta"
            aria-label={target.note ? `Edit note for ${target.playerName}: ${target.note}` : `Add a note for ${target.playerName}`}
          >
            {target.note || <span className="placeholder">Add a note…</span>}
          </button>
        )}

        {/* Fallbacks */}
        {target.fallbacks.length > 0 && (
          <ul className="dd-list-plain" style={{ gap: 2 }} aria-label="Fallbacks">
            {target.fallbacks.map((f) => {
              const fGone = draftedIds?.has(f.playerId) ?? false
              const isPivot = !isGone ? false : liveFallback?.playerId === f.playerId
              return (
                <li key={f.playerId} className={`dd-fallback t-meta${fGone ? ' gone' : isPivot ? ' pivot' : ''}`}>
                  <CornerDownRight size={12} className="icon" aria-hidden />
                  <span className="name dd-truncate">{f.playerName}</span>
                  {fGone && <span className="dd-sr-only">(gone)</span>}
                  <span className="faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {f.adp != null && `${Math.round(f.adp)}`}
                  </span>
                  {isPivot && (
                    <span className="t-micro" style={{ color: 'var(--accent)' }}>← Pivot here</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveFallback(f.playerId)}
                    className="dd-icon-button danger"
                    style={{ minWidth: 24, minHeight: 24 }}
                    aria-label={`Remove fallback ${f.playerName}`}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {addingFallback ? (
          <PlayerPicker
            players={players}
            position={target.playerPosition}
            excludeIds={new Set([target.playerId, ...target.fallbacks.map((f) => f.playerId)])}
            placeholder={`Fallback ${target.playerPosition}…`}
            onSelect={onAddFallback}
            onClose={() => setAddingFallback(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingFallback(true)}
            className="dd-text-button quiet t-meta"
            style={{ alignSelf: 'flex-start' }}
            aria-label={`Add a fallback for ${target.playerName}`}
          >
            <Plus size={12} aria-hidden />
            Fallback
          </button>
        )}
      </div>

      {/* Reorder / remove */}
      <div className="dd-target-controls">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={isFirst}
          className="dd-icon-button"
          aria-label={`Move ${target.playerName} up`}
        >
          <ChevronUp size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={isLast}
          className="dd-icon-button"
          aria-label={`Move ${target.playerName} down`}
        >
          <ChevronDown size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="dd-icon-button danger"
          aria-label={`Remove ${target.playerName}`}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </li>
  )
}
