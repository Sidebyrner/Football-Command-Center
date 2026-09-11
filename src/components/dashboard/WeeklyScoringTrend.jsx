import { useMemo } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { ACCENT_HEX, NEUTRAL_HEX, BORDER_RGBA, TEXT_MUTED_HEX } from '../../utils/chartColors'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">Week {label}</p>
      <p className="text-[var(--color-text-muted)]">You: {row.mine?.toFixed(1) ?? '—'}</p>
      <p className="text-[var(--color-text-muted)]">League avg: {row.leagueAvg?.toFixed(1) ?? '—'}</p>
      {row.rank != null && (
        <p className="text-[var(--color-text-faint)]">Rank {row.rank} of {row.teamCount}</p>
      )}
    </div>
  )
}

/**
 * Your weekly fantasy output against the field — real results only, no
 * projection. Rank per week comes from the same weekly totals, so it's the
 * actual field you played against, not an estimate of it.
 */
export default function WeeklyScoringTrend({ myTeam, weeklyTotalsByRoster, weeksLoaded, loading }) {
  const data = useMemo(() => {
    if (!myTeam || weeksLoaded.length === 0) return []
    const rosterIds = Object.keys(weeklyTotalsByRoster)

    return weeksLoaded.map((week) => {
      const weekScores = rosterIds
        .map((rid) => ({ rid, pts: weeklyTotalsByRoster[rid]?.[week] }))
        .filter((s) => typeof s.pts === 'number')

      const mine = weeklyTotalsByRoster[myTeam.rosterId]?.[week] ?? null
      const leagueAvg = weekScores.length
        ? weekScores.reduce((sum, s) => sum + s.pts, 0) / weekScores.length
        : null
      const rank = mine == null
        ? null
        : weekScores.filter((s) => s.pts > mine).length + 1

      return { week, mine, leagueAvg, rank, teamCount: weekScores.length }
    })
  }, [myTeam, weeklyTotalsByRoster, weeksLoaded])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Not enough completed weeks yet to chart a trend.
      </p>
    )
  }

  const scored = data.filter((d) => d.rank != null)
  const avgRank = scored.length
    ? (scored.reduce((sum, d) => sum + d.rank, 0) / scored.length).toFixed(1)
    : null

  return (
    <div>
      {avgRank && (
        <p className="text-[10px] text-[var(--color-text-faint)] mb-2">
          Average weekly finish: <span className="text-[var(--color-text)] font-semibold">{avgRank}</span>
          {' '}of {scored[0].teamCount}
        </p>
      )}
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} />
          <XAxis dataKey="week" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip content={<TrendTooltip />} cursor={{ stroke: BORDER_RGBA }} />
          <Legend wrapperStyle={{ fontSize: 11, color: TEXT_MUTED_HEX }} />
          <Line type="monotone" dataKey="mine" name="You" stroke={ACCENT_HEX} strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="leagueAvg" name="League avg" stroke={NEUTRAL_HEX} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
