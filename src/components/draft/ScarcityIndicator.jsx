import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Callout } from '@ui/components/Screen'
import { PositionChip } from '@ui/components/Player'

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
    <Callout tone="caution">
      <div className="dd-callout-row t-meta">
        <AlertTriangle size={15} color="var(--caution)" aria-hidden />
        <div>
          <div style={{ fontWeight: 600, color: 'var(--caution)' }}>Thinning in the top tiers</div>
          <div className="dd-thin-list">
            {thin.map(({ pos, count }) => (
              <span key={pos}>
                <PositionChip position={pos} />
                <span className="muted">
                  {count === 0 ? 'none left in top tiers' : `${count} left in top tiers`}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Callout>
  )
}
