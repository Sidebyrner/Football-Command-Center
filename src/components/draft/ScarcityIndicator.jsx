import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { getPositionColor } from '../../utils/playerHelpers'

const POSITIONS = ['QB', 'RB', 'WR', 'TE']
const THIN_THRESHOLD = 2

/**
 * "Getting thin at RB" style alerts. Reuses the tier already computed by
 * evaluationEngine.js's draftTier() for every player (tier 1 = Elite,
 * tier 2 = Strong — see usePlayerScores' scores[playerId].tier) rather than
 * inventing a separate scarcity threshold. Counts undrafted players still in
 * tiers 1-2 per position; only positions actually running low are shown.
 */
export default function ScarcityIndicator({ players, scores, draftedIds }) {
  const thin = useMemo(() => {
    const counts = {}
    for (const pos of POSITIONS) counts[pos] = 0
    for (const p of players) {
      if (!POSITIONS.includes(p.position)) continue
      if (draftedIds.has(p.id)) continue
      const s = scores[p.id]
      if (s?.available && s.tier <= 2) counts[p.position]++
    }
    return POSITIONS
      .map((pos) => ({ pos, count: counts[pos] }))
      .filter(({ count }) => count <= THIN_THRESHOLD)
  }, [players, scores, draftedIds])

  if (thin.length === 0) return null

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs bg-[var(--color-caution)]/10 border-b border-[var(--color-caution)]/30 overflow-x-auto">
      <AlertTriangle size={12} className="text-[var(--color-caution)] flex-shrink-0" />
      <span className="text-[var(--color-caution)] font-medium flex-shrink-0">Thinning:</span>
      <div className="flex items-center gap-3">
        {thin.map(({ pos, count }) => (
          <span
            key={pos}
            className="flex items-center gap-1 flex-shrink-0 whitespace-nowrap"
          >
            <span className="font-semibold" style={{ color: getPositionColor(pos) }}>{pos}</span>
            <span className="text-[var(--color-text-faint)] tabular-nums">
              {count === 0 ? 'none left in top tiers' : `${count} left in top tiers`}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
