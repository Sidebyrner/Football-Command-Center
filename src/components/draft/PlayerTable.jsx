import { ChevronUp, ChevronDown, ChevronsUpDown, Star } from 'lucide-react'
import { getStatusColor, getStatusLabel, getPositionColor } from '../../utils/playerHelpers'
import { POSITION_ORDER } from '../../hooks/useDraftPlayers'
import TableSkeleton from './TableSkeleton'

const COLUMNS = [
  { key: 'name', label: 'Player', align: 'left', sortable: true },
  { key: 'position', label: 'Pos', align: 'left', sortable: true },
  { key: 'team', label: 'Team', align: 'left', sortable: true },
  { key: 'adp', label: 'ADP', align: 'right', sortable: true, title: 'FantasyPros expert consensus rank — lower is better' },
  { key: 'bye', label: 'Bye', align: 'right', sortable: true },
  { key: 'injuryStatus', label: 'Injury', align: 'left', sortable: true },
  { key: 'trending', label: 'Trend', align: 'left', sortable: true },
  { key: 'research', label: '', align: 'center', sortable: false },
  { key: 'watchlist', label: '', align: 'center', sortable: false },
]

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <ChevronsUpDown size={12} className="opacity-30" />
  return sort.dir === 'asc'
    ? <ChevronUp size={12} className="text-[var(--color-accent)]" />
    : <ChevronDown size={12} className="text-[var(--color-accent)]" />
}

function defaultCompare(a, b, col, dir) {
  const mul = dir === 'asc' ? 1 : -1
  let av = a[col]
  let bv = b[col]

  if (col === 'position') {
    const pa = POSITION_ORDER[av] ?? 99
    const pb = POSITION_ORDER[bv] ?? 99
    return (pa - pb) * mul
  }

  // Numeric columns: nulls always sort last regardless of direction, so an
  // unmatched player never occupies the top of a draft board.
  if (col === 'adp' || col === 'bye') {
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return (av - bv) * mul
  }

  if (typeof av === 'string' || typeof bv === 'string') {
    return ((av ?? '') < (bv ?? '') ? -1 : (av ?? '') > (bv ?? '') ? 1 : 0) * mul
  }

  return 0
}

function sortPlayers(players, sort) {
  return [...players].sort((a, b) => {
    const primary = defaultCompare(a, b, sort.col, sort.dir)
    if (primary !== 0) return primary
    // secondary: consensus rank asc
    if (sort.col !== 'adp') {
      const ra = a.adp ?? 9999
      const rb = b.adp ?? 9999
      if (ra !== rb) return ra - rb
    }
    // tertiary: name asc
    if (sort.col !== 'name') {
      return (a.name ?? '').localeCompare(b.name ?? '')
    }
    return 0
  })
}

function TrendBadge({ value }) {
  if (!value) return <span className="text-[var(--color-text-faint)] text-xs">—</span>
  const isAdd = value === 'add'
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded ${
        isAdd
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-rose-500/15 text-rose-400'
      }`}
    >
      {isAdd ? '▲' : '▼'} {isAdd ? 'Add' : 'Drop'}
    </span>
  )
}

// A name-matched ADP is a best-effort join, not a confirmed one — mark it so a
// mismatched player can be spotted rather than silently trusted on draft day.
function AdpCell({ player }) {
  if (player.adp == null) return <span className="text-[var(--color-text-faint)]">—</span>
  const uncertain = player.matchedBy === 'name'
  return (
    <span
      className={uncertain ? 'text-[var(--color-caution)]' : undefined}
      title={
        uncertain
          ? 'Matched by name, not player ID — verify before drafting'
          : player.adpSd
            ? `Consensus ${player.adp} (± ${player.adpSd})`
            : undefined
      }
    >
      {Math.round(player.adp)}
      {uncertain && '*'}
    </span>
  )
}

function InjuryCell({ status }) {
  const color = getStatusColor(status)
  const label = getStatusLabel(status)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span
        className="inline-block rounded-full flex-shrink-0"
        style={{ width: 7, height: 7, backgroundColor: color }}
      />
      {label}
    </span>
  )
}

export default function PlayerTable({
  players,
  loading,
  sort,
  onSort,
  watchlist,
  onToggleWatch,
  onSelectPlayer,
  researchIndex,
  draftedIds = null,
  pickByPlayer = {},
}) {
  const sorted = sortPlayers(players, sort)

  function handleSort(col) {
    if (!COLUMNS.find((c) => c.key === col)?.sortable) return
    if (sort.col === col) {
      onSort({ col, dir: sort.dir === 'asc' ? 'desc' : 'asc' })
    } else {
      onSort({ col, dir: 'asc' })
    }
  }

  const isEmpty = !loading && players.length === 0

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-sm border-collapse min-w-[760px]">
        <thead>
          <tr className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable && handleSort(col.key)}
                title={col.title}
                className={`px-3 py-2 text-xs font-semibold text-[var(--color-text-faint)] uppercase tracking-wide whitespace-nowrap select-none ${
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                } ${col.sortable ? 'cursor-pointer hover:text-[var(--color-text)] transition-colors' : ''}`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && <SortIcon col={col.key} sort={sort} />}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <TableSkeleton rows={20} />
          ) : isEmpty ? (
            <tr>
              <td colSpan={COLUMNS.length} className="px-4 py-16 text-center text-[var(--color-text-faint)] text-sm">
                No players match the current filters.
              </td>
            </tr>
          ) : (
            sorted.map((p) => {
              const isWatched = watchlist.has(p.id)
              const isDrafted = draftedIds?.has(p.id) ?? false
              const pick = pickByPlayer?.[p.id]
              const researchCount =
                (researchIndex?.[p.id] || 0) +
                (researchIndex?.[`name:${p.name.toLowerCase()}`] || 0)

              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectPlayer?.(p)}
                  className={`border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors cursor-pointer ${
                    isDrafted ? 'opacity-45' : ''
                  }`}
                >
                  {/* Player name */}
                  <td className="px-3 py-2 font-medium text-[var(--color-text)] whitespace-nowrap">
                    <span className={isDrafted ? 'line-through' : undefined}>{p.name}</span>
                    {pick && (
                      <span
                        className={`ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded align-middle ${
                          pick.isMine
                            ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                            : 'bg-[var(--color-surface-2)] text-[var(--color-text-faint)]'
                        }`}
                        title={`Pick ${pick.pickNo ?? '?'} — ${pick.by}`}
                      >
                        {pick.isMine ? 'YOURS' : pick.by}
                      </span>
                    )}
                  </td>

                  {/* Position */}
                  <td className="px-3 py-2">
                    <span
                      className="text-xs font-bold px-1.5 py-0.5 rounded"
                      style={{
                        color: getPositionColor(p.position),
                        backgroundColor: `${getPositionColor(p.position)}20`,
                      }}
                    >
                      {p.position}
                    </span>
                  </td>

                  {/* Team */}
                  <td className="px-3 py-2 text-[var(--color-text-muted)] tabular-nums">
                    {p.team}
                  </td>

                  {/* Consensus rank (ADP) */}
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                    <AdpCell player={p} />
                  </td>

                  {/* Bye week */}
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                    {p.bye != null ? p.bye : <span className="text-[var(--color-text-faint)]">—</span>}
                  </td>

                  {/* Injury */}
                  <td className="px-3 py-2">
                    <InjuryCell status={p.injuryStatus} />
                  </td>

                  {/* Trending */}
                  <td className="px-3 py-2">
                    <TrendBadge value={p.trending} />
                  </td>

                  {/* Research indicator */}
                  <td className="px-3 py-2 text-center">
                    {researchCount > 0 ? (
                      <span className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-full bg-[var(--color-accent)] text-black tabular-nums">
                        {researchCount > 9 ? '9+' : researchCount}
                      </span>
                    ) : null}
                  </td>

                  {/* Watchlist */}
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleWatch(p.id) }}
                      className={`transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] rounded ${
                        isWatched
                          ? 'text-[var(--color-accent)]'
                          : 'text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]'
                      }`}
                      aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                    >
                      <Star size={14} fill={isWatched ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      {!loading && !isEmpty && (
        <div className="px-4 py-2 text-xs text-[var(--color-text-faint)] border-t border-[var(--color-border)]">
          {sorted.length.toLocaleString()} player{sorted.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
