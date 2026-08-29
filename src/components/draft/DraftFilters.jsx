import { Search, Star, X, EyeOff } from 'lucide-react'

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

const INJURY_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'questionable', label: 'Questionable' },
  { value: 'doubtful', label: 'Doubtful' },
  { value: 'out', label: 'Out/IR' },
]

const TRENDING_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'add', label: 'Trending Add' },
  { value: 'drop', label: 'Trending Drop' },
]

export default function DraftFilters({ filters, onChange, teams, showDraftedToggle = false }) {
  const { search, positions, team, injury, trending, watchlistOnly, hideDrafted } = filters

  function togglePosition(pos) {
    const next = positions.includes(pos)
      ? positions.filter((p) => p !== pos)
      : [...positions, pos]
    onChange({ ...filters, positions: next })
  }

  function clearAll() {
    onChange({
      search: '',
      positions: [],
      team: '',
      injury: '',
      trending: '',
      watchlistOnly: false,
      hideDrafted: filters.hideDrafted,
    })
  }

  const hasActiveFilters =
    search || positions.length || team || injury || trending || watchlistOnly

  return (
    <div className="flex flex-col gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Row 1: search + dropdowns */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search players…"
            value={search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        </div>

        {/* Team dropdown */}
        <select
          value={team}
          onChange={(e) => onChange({ ...filters, team: e.target.value })}
          className="py-1.5 pl-2.5 pr-7 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer min-w-[90px]"
          style={{ backgroundImage: 'none' }}
        >
          <option value="">All Teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        {/* Injury dropdown */}
        <select
          value={injury}
          onChange={(e) => onChange({ ...filters, injury: e.target.value })}
          className="py-1.5 pl-2.5 pr-7 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer min-w-[120px]"
          style={{ backgroundImage: 'none' }}
        >
          {INJURY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === '' ? 'Injury: All' : o.label}
            </option>
          ))}
        </select>

        {/* Trending dropdown */}
        <select
          value={trending}
          onChange={(e) => onChange({ ...filters, trending: e.target.value })}
          className="py-1.5 pl-2.5 pr-7 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)] transition-colors appearance-none cursor-pointer min-w-[130px]"
          style={{ backgroundImage: 'none' }}
        >
          {TRENDING_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === '' ? 'Trending: All' : o.label}
            </option>
          ))}
        </select>

        {/* Watchlist toggle */}
        <button
          onClick={() => onChange({ ...filters, watchlistOnly: !watchlistOnly })}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border transition-colors ${
            watchlistOnly
              ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-black font-medium'
              : 'bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <Star size={13} />
          Watchlist
        </button>

        {/* Hide drafted — only meaningful while a draft is running */}
        {showDraftedToggle && (
          <button
            onClick={() => onChange({ ...filters, hideDrafted: !hideDrafted })}
            title={hideDrafted ? 'Showing available players only' : 'Showing all players, drafted included'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded border transition-colors ${
              hideDrafted
                ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-black font-medium'
                : 'bg-[var(--color-surface-2)] border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            <EyeOff size={13} />
            Available only
          </button>
        )}

        {/* Clear */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-[var(--color-text-faint)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={12} />
            Clear
          </button>
        )}
      </div>

      {/* Row 2: position pills */}
      <div className="flex flex-wrap gap-1.5">
        {POSITIONS.map((pos) => {
          const active = positions.includes(pos)
          return (
            <button
              key={pos}
              onClick={() => togglePosition(pos)}
              className={`px-2.5 py-0.5 text-xs font-semibold rounded transition-colors ${
                active
                  ? 'text-black'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]'
              }`}
              style={active ? { backgroundColor: positionColor(pos) } : undefined}
            >
              {pos}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function positionColor(pos) {
  const map = {
    QB: '#60a5fa',
    RB: '#34d399',
    WR: '#a78bfa',
    TE: '#fb923c',
    K: '#f472b6',
    DEF: '#94a3b8',
  }
  return map[pos] ?? '#94a3b8'
}
