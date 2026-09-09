import { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { ACCENT_HEX, NEUTRAL_HEX, BORDER_RGBA, TEXT_MUTED_HEX } from '../../utils/chartColors'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function ImpliedTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{row.team}</p>
      <p className="text-[var(--color-text-muted)]">{row.implied.toFixed(1)} implied pts</p>
    </div>
  )
}

/**
 * Week-at-a-glance: every team's implied total this week, ranked, from the
 * same gameLine data the game-card grid below already computes — no new
 * fetch. "Your team" bars highlighted, same relevance-first idea as the
 * cards sorting your games to the top.
 */
export default function ImpliedTotalsChart({ games, myTeamAbbrs }) {
  const rows = useMemo(() => {
    const out = []
    for (const g of games) {
      if (g.line.homeImplied != null) {
        out.push({ team: g.homeAbbr, implied: g.line.homeImplied, mine: myTeamAbbrs.has(g.homeAbbr) })
      }
      if (g.line.awayImplied != null) {
        out.push({ team: g.awayAbbr, implied: g.line.awayImplied, mine: myTeamAbbrs.has(g.awayAbbr) })
      }
    }
    return out.sort((a, b) => b.implied - a.implied)
  }, [games, myTeamAbbrs])

  if (rows.length === 0) return null

  const height = Math.max(200, rows.length * 22)

  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
        Implied team totals this week
      </h2>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} />
          <YAxis type="category" dataKey="team" width={48} tick={AXIS_TICK} />
          <Tooltip content={<ImpliedTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="implied" radius={[0, 3, 3, 0]}>
            {rows.map((r) => <Cell key={r.team} fill={r.mine ? ACCENT_HEX : NEUTRAL_HEX} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
