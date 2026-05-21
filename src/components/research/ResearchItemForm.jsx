import { useState } from 'react'
import { X } from 'lucide-react'
import { TAGS } from '../../utils/researchTags'

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
    <form
      onSubmit={handleSubmit}
      className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 flex flex-col gap-2.5"
    >
      {/* Title */}
      <input
        type="text"
        placeholder="Title (required)"
        value={fields.title}
        onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
        autoFocus
        className="w-full px-2.5 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
      />

      {/* Player name (only shown when no player context is pre-filled) */}
      {!player && (
        <input
          type="text"
          placeholder="Player name (optional)"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className="w-full px-2.5 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        />
      )}

      {/* Notes / body */}
      <textarea
        placeholder="Notes or excerpt (optional)"
        value={fields.body}
        onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))}
        rows={3}
        className="w-full px-2.5 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors resize-none"
      />

      {/* URL */}
      <input
        type="url"
        placeholder="Source URL (optional)"
        value={fields.url}
        onChange={(e) => setFields((f) => ({ ...f, url: e.target.value }))}
        className="w-full px-2.5 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
      />

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5">
        {TAGS.map((tag) => {
          const active = fields.tags.includes(tag.value)
          return (
            <button
              key={tag.value}
              type="button"
              onClick={() => toggleTag(tag.value)}
              className="px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wide transition-colors"
              style={
                active
                  ? { color: tag.color, backgroundColor: tag.bg, borderColor: tag.color, border: `1px solid ${tag.color}` }
                  : { color: 'var(--color-text-faint)', backgroundColor: 'transparent', border: '1px solid var(--color-border)' }
              }
            >
              {tag.label}
            </button>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="submit"
          disabled={!fields.title.trim()}
          className="px-3 py-1.5 text-xs font-semibold bg-[var(--color-accent)] text-black rounded disabled:opacity-40 hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1"
        >
          <X size={12} /> Cancel
        </button>
      </div>
    </form>
  )
}
