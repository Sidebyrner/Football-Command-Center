import { useMemo } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, Star, TrendingUp, TrendingDown } from 'lucide-react'
import { getStatusLabel } from '../../utils/playerHelpers'
import { injuryTone } from './injuryTone'
import { PositionChip } from '@ui/components/Player'
import { POSITION_ORDER } from '../../hooks/useDraftPlayers'
import TableSkeleton from './TableSkeleton'

const COLUMNS = [
  { key: 'name', label: 'Player', align: 'left', sortable: true },
  { key: 'position', label: 'Pos', align: 'left', sortable: true },
  { key: 'team', label: 'Team', align: 'left', sortable: true },
  { key: 'adp', label: 'ADP', align: 'right', sortable: true, title: 'FantasyPros expert consensus rank — lower is better' },
  { key: 'score', label: 'Score', align: 'right', sortable: true, title: 'This league\'s scoring rules vs. real 2025 production — ranked only within position' },
  { key: 'value', label: 'Value', align: 'right', sortable: true, title: 'Positional rank gained vs. ADP under this league\'s scoring — positive means this model rates the player above where the market has them' },
  { key: 'bye', label: 'Bye', align: 'right', sortable: true },
  { key: 'injuryStatus', label: 'Injury', align: 'left', sortable: true },
  { key: 'trending', label: 'Trend', align: 'left', sortable: true },
  { key: 'research', label: '', srLabel: 'Research', align: 'center', sortable: false },
  { key: 'watchlist', label: '', srLabel: 'Watchlist', align: 'center', sortable: false },
]

function SortIcon({ col, sort }) {
  if (sort.col !== col) return <ChevronsUpDown size={12} style={{ opacity: 0.4 }} aria-hidden />
  return sort.dir === 'asc'
    ? <ChevronUp size={12} color="var(--accent)" aria-hidden />
    : <ChevronDown size={12} color="var(--accent)" aria-hidden />
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
  if (col === 'adp' || col === 'bye' || col === 'score' || col === 'value') {
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
  if (!value) return <span className="faint">—</span>
  const isAdd = value === 'add'
  const Icon = isAdd ? TrendingUp : TrendingDown
  return (
    <span className={`dd-trend ${isAdd ? 'add' : 'drop'}`}>
      <Icon size={12} aria-hidden /> {isAdd ? 'Add' : 'Drop'}
    </span>
  )
}

// A name-matched ADP is a best-effort join, not a confirmed one — mark it so a
// mismatched player can be spotted rather than silently trusted on draft day.
function AdpCell({ player }) {
  if (player.adp == null) return <span className="faint">—</span>
  const uncertain = player.matchedBy === 'name'
  return (
    <span
      style={uncertain ? { color: 'var(--caution)' } : undefined}
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

// Dimmed below 50% real-data coverage — mirrors the ThinScore treatment in
// EvalPanel, so a number on the board never looks more confident here than it
// does in the drawer for the same player.
const MIN_CONFIDENT_COVERAGE = 0.5

function ScoreCell({ player }) {
  if (player.score == null) {
    return <span className="faint" title="No score — insufficient real data for this player">—</span>
  }
  const thin = (player.scoreCoverage ?? 1) < MIN_CONFIDENT_COVERAGE
  return (
    <span
      className={thin ? 'faint' : undefined}
      style={thin ? undefined : { color: 'var(--text)', fontWeight: 600 }}
      title={thin ? `Low data coverage (${Math.round((player.scoreCoverage ?? 0) * 100)}%)` : undefined}
    >
      {player.score}
    </span>
  )
}

function ValueCell({ player }) {
  if (player.value == null) {
    return <span className="faint">—</span>
  }
  if (player.value === 0) {
    return <span className="faint">0</span>
  }
  const positive = player.value > 0
  return (
    <span
      style={{ color: positive ? 'var(--start)' : 'var(--sit)', fontWeight: 600 }}
      title={
        positive
          ? `This league's rules rank this player ${player.value} spots above where consensus ADP has them (within position)`
          : `This league's rules rank this player ${Math.abs(player.value)} spots below where consensus ADP has them (within position)`
      }
    >
      {positive ? '+' : ''}{player.value}
    </span>
  )
}

function InjuryCell({ status }) {
  const color = injuryTone(status)
  const label = getStatusLabel(status)
  return (
    <span className="dd-status-dot">
      <span className="dd-dot" style={{ background: color }} aria-hidden />
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
  scores = {},
  scoring = false,
  valueDeltas = {},
  footer,
}) {
  // Flatten the scores/valueDeltas maps onto each row so the comparator can
  // read them like any other field. `score` stays null (not 0) when the
  // engine declined to score the player — unavailable must sort and render
  // distinctly from "scored zero".
  const withComputed = useMemo(() => {
    return players.map((p) => {
      const result = scores[p.id]
      return {
        ...p,
        score: result?.available ? result.score : null,
        scoreCoverage: result?.available ? result.coverage : null,
        value: valueDeltas[p.id] ?? null,
      }
    })
  }, [players, scores, valueDeltas])

  const sorted = sortPlayers(withComputed, sort)

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
    <section className="card dd-table-card" aria-label="Player board">
      <div className="dd-table-scroll" tabIndex={0} aria-label="Player board, scrolls sideways">
        <table className="dd-table" aria-busy={loading || undefined}>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const alignClass = col.align === 'right' ? 'num' : col.align === 'center' ? 'center' : ''
                const active = sort.col === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    title={col.title}
                    className={`t-micro ${alignClass}`}
                    aria-sort={col.sortable && active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        className={`dd-th dd-sort${active ? ' on' : ''}`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <SortIcon col={col.key} sort={sort} />
                      </button>
                    ) : (
                      <span className="dd-th">
                        {col.label}
                        {col.srLabel && <span className="dd-sr-only">{col.srLabel}</span>}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={20} />
            ) : isEmpty ? (
              <tr>
                <td colSpan={COLUMNS.length} className="dd-table-empty t-body">
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
                    className={isDrafted ? 'drafted' : undefined}
                  >
                    {/* Player name — a real button so the drawer opens from the keyboard */}
                    <td>
                      <button
                        type="button"
                        className={`dd-name-button${isDrafted ? ' dd-strike' : ''}`}
                        onClick={(e) => { e.stopPropagation(); onSelectPlayer?.(p) }}
                        aria-label={`${p.name}${isDrafted ? ', drafted' : ''} — open details`}
                      >
                        {p.name}
                      </button>
                      {pick && (
                        <span className={`dd-tag${pick.isMine ? ' mine' : ''}`} title={`Pick ${pick.pickNo ?? '?'} — ${pick.by}`}>
                          {pick.isMine ? 'Yours' : pick.by}
                        </span>
                      )}
                    </td>

                    {/* Position */}
                    <td>
                      <PositionChip position={p.position} />
                    </td>

                    {/* Team */}
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.team}</td>

                    {/* Consensus rank (ADP) */}
                    <td className="num">
                      <AdpCell player={p} />
                    </td>

                    {/* Model score — within-position percentile composite under
                        this league's scoring rules. Never compare across positions. */}
                    <td className="num">
                      <ScoreCell player={p} />
                    </td>

                    {/* Value vs. ADP — positional rank delta */}
                    <td className="num">
                      <ValueCell player={p} />
                    </td>

                    {/* Bye week */}
                    <td className="num">
                      {p.bye != null ? p.bye : <span className="faint">—</span>}
                    </td>

                    {/* Injury */}
                    <td>
                      <InjuryCell status={p.injuryStatus} />
                    </td>

                    {/* Trending */}
                    <td>
                      <TrendBadge value={p.trending} />
                    </td>

                    {/* Research indicator */}
                    <td className="center">
                      {researchCount > 0 ? (
                        <span className="dd-research-badge" title={`${researchCount} saved research item${researchCount === 1 ? '' : 's'}`}>
                          <span aria-hidden>{researchCount > 9 ? '9+' : researchCount}</span>
                          <span className="dd-sr-only">{researchCount} research items</span>
                        </span>
                      ) : null}
                    </td>

                    {/* Watchlist */}
                    <td className="center">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggleWatch(p.id) }}
                        className={`dd-icon-button${isWatched ? ' on' : ''}`}
                        aria-label={isWatched ? `Remove ${p.name} from watchlist` : `Add ${p.name} to watchlist`}
                        aria-pressed={isWatched}
                      >
                        <Star size={15} fill={isWatched ? 'currentColor' : 'none'} aria-hidden />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {((!loading && !isEmpty) || footer) && (
        <div className="dd-table-footer t-meta">
          {!loading && !isEmpty && `${sorted.length.toLocaleString()} player${sorted.length !== 1 ? 's' : ''}`}
          {!loading && !isEmpty && footer && ' · '}
          {footer}
        </div>
      )}
    </section>
  )
}
