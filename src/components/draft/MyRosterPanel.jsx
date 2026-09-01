import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Users, AlertTriangle } from 'lucide-react'
import { getPositionColor } from '../../utils/playerHelpers'

const BYE_COLLISION_THRESHOLD = 3

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

/**
 * What the user has actually drafted so far, grouped by position. Collapsed
 * to a chip-row summary by default (position + count) — the moment-to-moment
 * question during a draft is usually "how am I doing at RB," not a full
 * roster readout, so that's what stays visible without a click.
 */
export default function MyRosterPanel({ picks, userId, playersById }) {
  const [expanded, setExpanded] = useState(false)

  const myPicks = useMemo(() => {
    if (!userId) return []
    return picks
      .filter((p) => p.player_id && p.picked_by === userId)
      .map((p) => ({ ...p, player: playersById[p.player_id] }))
      .sort((a, b) => (a.pick_no ?? 0) - (b.pick_no ?? 0))
  }, [picks, userId, playersById])

  const byPosition = useMemo(() => {
    const grouped = {}
    for (const pick of myPicks) {
      const pos = pick.player?.position ?? '?'
      ;(grouped[pos] ??= []).push(pick)
    }
    return grouped
  }, [myPicks])

  // Byes cross position lines (a WR and a RB can share a bye), so this counts
  // across the whole roster, not per position group above.
  const byeCollisions = useMemo(() => {
    const counts = {}
    for (const pick of myPicks) {
      const bye = pick.player?.bye
      if (bye == null) continue
      counts[bye] = (counts[bye] ?? 0) + 1
    }
    return Object.entries(counts)
      .filter(([, count]) => count >= BYE_COLLISION_THRESHOLD)
      .map(([week, count]) => ({ week: Number(week), count }))
      .sort((a, b) => a.week - b.week)
  }, [myPicks])

  if (myPicks.length === 0) return null

  const positions = [
    ...POSITION_ORDER.filter((p) => byPosition[p]),
    ...Object.keys(byPosition).filter((p) => !POSITION_ORDER.includes(p)),
  ]

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <Users size={12} className="text-[var(--color-text-faint)] flex-shrink-0" />
        <span className="text-[var(--color-text-muted)] font-medium flex-shrink-0">My roster</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {positions.map((pos) => (
            <span
              key={pos}
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded tabular-nums"
              style={{ color: getPositionColor(pos), backgroundColor: `${getPositionColor(pos)}20` }}
            >
              {pos} {byPosition[pos].length}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[var(--color-text-faint)] flex-shrink-0">
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {byeCollisions.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 pb-2 text-[10px] text-[var(--color-caution)]">
          <AlertTriangle size={10} className="flex-shrink-0" />
          {byeCollisions.map(({ week, count }) => (
            <span key={week}>{count} players on bye week {week}</span>
          ))}
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2">
          {positions.map((pos) => (
            <div key={pos}>
              <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] mb-1">{pos}</div>
              <ul className="space-y-0.5">
                {byPosition[pos].map((pick) => (
                  <li
                    key={pick.pick_no ?? pick.player_id}
                    className="text-xs text-[var(--color-text)] flex items-center gap-1.5"
                  >
                    <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums w-6 flex-shrink-0">
                      {pick.pick_no ?? '–'}
                    </span>
                    <span className="truncate">{pick.player?.name ?? 'Unknown player'}</span>
                    {pick.player?.bye != null && (
                      <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums flex-shrink-0">
                        bye {pick.player.bye}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
