import { Search, Star, X, EyeOff } from 'lucide-react'
import { positionColor } from '@ui/components/Player'

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
    <section className="card dd-filters" aria-label="Filter players">
      <div className="dd-filter-row">
        <label className="dd-search">
          <Search size={15} aria-hidden />
          <span className="dd-sr-only">Search players</span>
          <input
            type="search"
            placeholder="Search players…"
            value={search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </label>

        <div className="dd-filter-selects">
          <select
            value={team}
            onChange={(e) => onChange({ ...filters, team: e.target.value })}
            className="dd-field"
            aria-label="Team"
          >
            <option value="">All Teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={injury}
            onChange={(e) => onChange({ ...filters, injury: e.target.value })}
            className="dd-field"
            aria-label="Injury status"
          >
            {INJURY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === '' ? 'Injury: All' : o.label}
              </option>
            ))}
          </select>

          <select
            value={trending}
            onChange={(e) => onChange({ ...filters, trending: e.target.value })}
            className="dd-field"
            aria-label="Trending"
          >
            {TRENDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === '' ? 'Trending: All' : o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="dd-chip-row" role="group" aria-label="Positions">
        {POSITIONS.map((pos) => {
          const active = positions.includes(pos)
          return (
            <button
              key={pos}
              type="button"
              onClick={() => togglePosition(pos)}
              aria-pressed={active}
              className={`chip dd-chip t-body${active ? ' chip-on' : ''}`}
            >
              <span className="dd-dot" style={{ background: positionColor(pos) }} aria-hidden />
              {pos}
            </button>
          )
        })}
      </div>

      <div className="dd-chip-row">
        <button
          type="button"
          onClick={() => onChange({ ...filters, watchlistOnly: !watchlistOnly })}
          aria-pressed={watchlistOnly}
          className={`chip dd-chip t-body${watchlistOnly ? ' chip-on' : ''}`}
        >
          <Star size={13} aria-hidden fill={watchlistOnly ? 'currentColor' : 'none'} />
          Watchlist
        </button>

        {/* Hide drafted — only meaningful while a draft is running */}
        {showDraftedToggle && (
          <button
            type="button"
            onClick={() => onChange({ ...filters, hideDrafted: !hideDrafted })}
            aria-pressed={hideDrafted}
            title={hideDrafted ? 'Showing available players only' : 'Showing all players, drafted included'}
            className={`chip dd-chip t-body${hideDrafted ? ' chip-on' : ''}`}
          >
            <EyeOff size={13} aria-hidden />
            Available only
          </button>
        )}

        {hasActiveFilters && (
          <button type="button" onClick={clearAll} className="dd-text-button quiet t-meta">
            <X size={13} aria-hidden />
            Clear filters
          </button>
        )}
      </div>
    </section>
  )
}
