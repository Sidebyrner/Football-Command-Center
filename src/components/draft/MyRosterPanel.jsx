import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Users, AlertTriangle } from 'lucide-react'
import { PositionChip } from '@ui/components/Player'

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
    <section className="card dd-panel" aria-label="My roster">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="dd-disclosure"
        aria-expanded={expanded}
        aria-controls="dd-my-roster"
      >
        <Users size={16} color="var(--hue-team)" aria-hidden />
        <span className="t-section">My roster</span>
        <span className="dd-chip-row">
          {positions.map((pos) => (
            <PositionChip key={pos} position={POSITION_ORDER.includes(pos) ? pos : undefined} label={`${pos} ${byPosition[pos].length}`} />
          ))}
        </span>
        <span className="dd-disclosure-trailing" aria-hidden>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {byeCollisions.length > 0 && (
        <div className="dd-panel-note t-meta">
          <AlertTriangle size={13} aria-hidden />
          {byeCollisions.map(({ week, count }) => (
            <span key={week}>{count} players on bye week {week}</span>
          ))}
        </div>
      )}

      {expanded && (
        <div id="dd-my-roster" className="dd-panel-body">
          <div className="dd-roster-grid">
            {positions.map((pos) => (
              <div key={pos}>
                <div className="t-micro faint" style={{ marginBottom: 4 }}>{pos}</div>
                <ul>
                  {byPosition[pos].map((pick) => (
                    <li key={pick.pick_no ?? pick.player_id} className="dd-roster-pick t-meta">
                      <span className="num">{pick.pick_no ?? '–'}</span>
                      <span className="dd-truncate">{pick.player?.name ?? 'Unknown player'}</span>
                      {pick.player?.bye != null && (
                        <span className="faint" style={{ flex: 'none' }}>bye {pick.player.bye}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
