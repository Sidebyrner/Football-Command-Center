import { useMemo } from 'react'

/**
 * Last few picks, most recent first — the "what just happened" view that
 * scanning the whole player table for newly-greyed rows otherwise replaces.
 */
export default function PickFeed({ picks, pickByPlayer, playersById, limit = 5 }) {
  const recent = useMemo(() => {
    return [...picks]
      .filter((p) => p.player_id)
      .sort((a, b) => (b.pick_no ?? 0) - (a.pick_no ?? 0))
      .slice(0, limit)
      .map((p) => ({
        pickNo: p.pick_no,
        player: playersById[p.player_id],
        by: pickByPlayer[p.player_id]?.by,
      }))
  }, [picks, pickByPlayer, playersById, limit])

  if (recent.length === 0) return null

  return (
    <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center gap-3 overflow-x-auto">
      <span className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] flex-shrink-0">
        Recent
      </span>
      <ul className="flex items-center gap-4">
        {recent.map((pick) => (
          <li key={pick.pickNo} className="flex items-center gap-1.5 text-xs flex-shrink-0 whitespace-nowrap">
            <span className="text-[10px] text-[var(--color-text-faint)] tabular-nums">#{pick.pickNo}</span>
            <span className="text-[var(--color-text)]">{pick.player?.name ?? 'Unknown player'}</span>
            {pick.by && <span className="text-[var(--color-text-faint)]">· {pick.by}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
