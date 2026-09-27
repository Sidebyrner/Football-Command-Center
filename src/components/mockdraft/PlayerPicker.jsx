import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { PositionChip } from '@ui/components/Player'
import '../draft/draft.css'

/**
 * Type-ahead player search. Used both to add a target and to attach a fallback,
 * so it takes an optional position filter and excludes players already chosen.
 */
export default function PlayerPicker({
  players, onSelect, onClose, position = null, excludeIds = new Set(), placeholder = 'Search players…',
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return []
    return players
      .filter((p) => {
        if (position && p.position !== position) return false
        if (excludeIds.has(p.id)) return false
        return p.name.toLowerCase().includes(q)
      })
      .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity))
      .slice(0, 8)
  }, [players, query, position, excludeIds])

  return (
    <div className="inset dd-picker">
      <div className="dd-search" style={{ background: 'var(--card)' }}>
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.()
            if (e.key === 'Enter' && results[0]) { onSelect(results[0]); onClose?.() }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        {onClose && (
          <button type="button" onClick={onClose} className="dd-icon-button" aria-label="Close search">
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="dd-list-plain" style={{ gap: 2 }}>
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => { onSelect(p); onClose?.() }}
                className="dd-picker-result t-meta"
              >
                <PositionChip position={p.position} />
                <span className="dd-truncate" style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                <span className="faint" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                  {p.team}{p.adp != null && ` · ${Math.round(p.adp)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && results.length === 0 && (
        <p className="t-meta faint" style={{ margin: 0, padding: '0 6px' }}>No matching players.</p>
      )}
    </div>
  )
}
