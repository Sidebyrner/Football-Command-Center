import { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts'
import { BORDER_RGBA, TEXT_MUTED_HEX, ACCENT_HEX, heatColor } from '../../utils/chartColors'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function DvpTooltip({ active, payload, position }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{r.def} vs {position}</p>
      <p className="text-[var(--color-text-muted)] tabular-nums">{r.perGame.toFixed(1)} pts allowed per game</p>
      <p className="text-[var(--color-text-faint)] tabular-nums">
        {r.vsLeagueAvg > 0 ? '+' : ''}{r.vsLeagueAvg} vs league average · {r.games} games
      </p>
    </div>
  )
}

/**
 * The same data as the heatmap, one position at a time. Reads better than a
 * 32x5 grid when you already know which position you're deciding about — which
 * is the usual case on a Sunday morning.
 */
export default function DvpRankedList({ dvp, position, myTeamAbbrs }) {
  const rows = useMemo(() => {
    if (!dvp) return []
    return Object.entries(dvp.byDefense)
      .map(([def, byPos]) => ({ def, ...byPos[position], mine: myTeamAbbrs?.has(def) }))
      .filter((r) => r.perGame != null && r.games >= dvp.minGames)
      .sort((a, b) => b.perGame - a.perGame)
  }, [dvp, position, myTeamAbbrs])

  if (!rows.length) {
    return (
      <p className="text-xs text-[var(--color-text-faint)]">
        Not enough games yet to rank defenses against {position}.
      </p>
    )
  }

  const avg = dvp.leagueAvgByPos[position]
  const height = Math.max(220, rows.length * 20)

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} />
          <YAxis type="category" dataKey="def" width={44} tick={AXIS_TICK} />
          <Tooltip content={<DvpTooltip position={position} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          {avg != null && <ReferenceLine x={avg} stroke={ACCENT_HEX} strokeDasharray="4 4" />}
          <Bar dataKey="perGame" radius={[0, 3, 3, 0]}>
            {rows.map((r) => (
              <Cell
                key={r.def}
                fill={heatColor(avg ? Math.max(-1, Math.min(1, (r.perGame - avg) / (avg * 0.35))) : 0)}
                stroke={r.mine ? ACCENT_HEX : undefined}
                strokeWidth={r.mine ? 1.5 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
        Longer bar = more points allowed = better matchup for your {position}.
        {avg != null && <> Dashed line is the league average ({avg}).</>}
        {myTeamAbbrs?.size > 0 && ' Outlined bars are defenses your players face this season.'}
      </p>
    </div>
  )
}
