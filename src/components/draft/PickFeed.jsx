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
    <section className="card dd-panel" aria-label="Recent picks">
      <div className="dd-feed">
        <span className="t-micro faint" style={{ flex: 'none' }}>Recent</span>
        <ul>
          {recent.map((pick) => (
            <li key={pick.pickNo} className="t-meta">
              <span className="faint">#{pick.pickNo}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600 }}>{pick.player?.name ?? 'Unknown player'}</span>
              {pick.by && <span className="faint">· {pick.by}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
