import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { getPositionColor } from '../../utils/playerHelpers'

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
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <div className="flex items-center gap-2">
        <Search size={13} className="text-[var(--color-text-faint)] flex-shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.()
            if (e.key === 'Enter' && results[0]) { onSelect(results[0]); onClose?.() }
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none"
        />
        {onClose && (
          <button onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]" aria-label="Close search">
            <X size={13} />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { onSelect(p); onClose?.() }}
                className="w-full flex items-center gap-2 px-1.5 py-1 rounded text-left hover:bg-[var(--color-surface)] transition-colors"
              >
                <span
                  className="text-[9px] font-bold px-1 py-0.5 rounded flex-shrink-0"
                  style={{ color: getPositionColor(p.position), backgroundColor: `${getPositionColor(p.position)}20` }}
                >
                  {p.position}
                </span>
                <span className="text-xs text-[var(--color-text)] truncate flex-1">{p.name}</span>
                <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums flex-shrink-0">
                  {p.team}{p.adp != null && ` · ${Math.round(p.adp)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && results.length === 0 && (
        <p className="mt-2 px-1.5 text-[10px] text-[var(--color-text-faint)]">No matching players.</p>
      )}
    </div>
  )
}
