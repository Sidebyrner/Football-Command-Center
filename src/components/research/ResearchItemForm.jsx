import { useState } from 'react'
import { X } from 'lucide-react'
import { TAGS } from '../../utils/researchTags'
import { tagToken } from './ResearchCard'
import '../../screens/tools/researchTools.css'

const EMPTY = { title: '', body: '', url: '', tags: [] }

/**
 * Inline add/edit form for a research item.
 *
 * Props:
 *   player     - optional { id, name, team, position } — pre-fills player fields
 *   initial    - optional initial field values for editing
 *   onSave(fields) - called with the form data on submit
 *   onCancel() - called when the form is dismissed
 */
export default function ResearchItemForm({ player, initial, onSave, onCancel }) {
  const [fields, setFields] = useState(() => ({ ...EMPTY, ...initial }))
  const [playerName, setPlayerName] = useState(player?.name ?? initial?.playerName ?? '')

  function toggleTag(value) {
    setFields((f) => ({
      ...f,
      tags: f.tags.includes(value) ? f.tags.filter((t) => t !== value) : [...f.tags, value],
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!fields.title.trim()) return
    onSave({
      title: fields.title.trim(),
      body: fields.body.trim() || null,
      url: fields.url.trim() || null,
      tags: fields.tags,
      playerId: player?.id ?? initial?.playerId ?? null,
      playerName: playerName.trim() || null,
      playerTeam: player?.team ?? initial?.playerTeam ?? null,
      playerPosition: player?.position ?? initial?.playerPosition ?? null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="card rt-stack" aria-label="New research item">
      {/* Title */}
      <label className="rt-label">
        <span className="t-meta muted">Title</span>
        <input
          type="text"
          placeholder="Title (required)"
          value={fields.title}
          onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
          autoFocus
          required
          className="rt-field w-full"
        />
      </label>

      {/* Player name (only shown when no player context is pre-filled) */}
      {!player && (
        <label className="rt-label">
          <span className="t-meta muted">Player</span>
          <input
            type="text"
            placeholder="Player name (optional)"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="rt-field w-full"
          />
        </label>
      )}

      {/* Notes / body */}
      <label className="rt-label">
        <span className="t-meta muted">Notes</span>
        <textarea
          placeholder="Notes or excerpt (optional)"
          value={fields.body}
          onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))}
          rows={3}
          className="rt-field w-full"
        />
      </label>

      {/* URL */}
      <label className="rt-label">
        <span className="t-meta muted">Source URL</span>
        <input
          type="url"
          placeholder="https://… (optional)"
          value={fields.url}
          onChange={(e) => setFields((f) => ({ ...f, url: e.target.value }))}
          className="rt-field w-full"
        />
      </label>

      {/* Tags */}
      <fieldset className="rt-label" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="t-meta muted" style={{ marginBottom: 'var(--space-xs)' }}>Tags</legend>
        <div className="rt-row" style={{ gap: 6 }}>
          {TAGS.map((tag) => {
            const active = fields.tags.includes(tag.value)
            return (
              <button
                key={tag.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTag(tag.value)}
                className="rt-tag-toggle t-micro"
                style={{ '--tag': tagToken(tag.value) }}
              >
                {tag.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* Actions */}
      <div className="rt-row">
        <button type="submit" disabled={!fields.title.trim()} className="button primary">
          Save
        </button>
        <button type="button" onClick={onCancel} className="button rt-button">
          <X size={14} aria-hidden /> Cancel
        </button>
      </div>
    </form>
  )
}
