import { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { BarChart as BarIcon } from 'lucide-react'
import { ScreenSection } from '@ui/components/Screen'
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE, HIGHLIGHT, NEUTRAL, ChartTooltipBox } from '../shared/chartTheme'

function ImpliedTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <ChartTooltipBox>
      <p style={{ fontWeight: 600 }}>{row.team}{row.mine ? ' · your players' : ''}</p>
      <p className="muted">{row.implied.toFixed(1)} implied pts</p>
    </ChartTooltipBox>
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
    <ScreenSection title="Implied team totals this week" icon={BarIcon} hue="var(--hue-market)">
      <figure className="card" style={{ margin: 0, minWidth: 0 }} aria-label="Every team's implied points this week, highest first">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} />
          <YAxis type="category" dataKey="team" width={48} tick={AXIS_TICK} />
          <Tooltip content={<ImpliedTooltip />} cursor={CURSOR_FILL} />
          <Bar dataKey="implied" radius={[0, 3, 3, 0]}>
            {rows.map((r) => <Cell key={r.team} fill={r.mine ? HIGHLIGHT : NEUTRAL} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {myTeamAbbrs.size > 0 && (
        <figcaption className="t-meta muted rt-row" style={{ gap: 6, marginTop: 'var(--space-xs)' }}>
          <span className="rt-swatch" style={{ background: HIGHLIGHT }} aria-hidden /> Teams your players are on
          <span className="rt-swatch" style={{ background: NEUTRAL, marginLeft: 8 }} aria-hidden /> Everyone else
        </figcaption>
      )}
      </figure>
    </ScreenSection>
  )
}
