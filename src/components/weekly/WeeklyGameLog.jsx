import { useMemo } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, ReferenceArea, ReferenceLine,
} from 'recharts'
import { ACCENT_HEX, NEUTRAL_HEX, BORDER_RGBA, TEXT_MUTED_HEX, TEXT_FAINT_HEX } from '../../utils/chartColors'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function LogTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg max-w-[220px]">
      <p className="font-semibold text-[var(--color-text)]">
        Week {row.week} {row.opp ? <span className="text-[var(--color-text-muted)]">vs {row.opp}</span> : null}
      </p>
      <p className="text-[var(--color-text)] tabular-nums mb-1">{row.points.toFixed(1)} pts</p>
      {row.breakdown.slice(0, 3).map((c) => (
        <p key={c.key} className="text-[10px] text-[var(--color-text-muted)] flex justify-between gap-3">
          <span>{c.label}{c.units ? ` (${c.units})` : ''}</span>
          <span className="tabular-nums">{c.points > 0 ? '+' : ''}{c.points.toFixed(1)}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * Week-by-week fantasy points a player ACTUALLY scored, under this league's
 * rules. The shaded band is the p20-p80 range of those same weeks — a range he
 * produced, not evaluationEngine's modelled floor/ceiling, which is estimated
 * from season-long rate stats. Two different claims, deliberately not merged.
 *
 * p20/p80 rather than min/max so one early injury exit and one garbage-time TD
 * don't define the range.
 */
export default function WeeklyGameLog({ scored, distribution, season, profileName }) {
  const rows = useMemo(() => scored?.weeks ?? [], [scored])

  if (!rows.length) return null

  const { floor, ceiling, median } = distribution ?? {}

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Weekly points · {season}
        </h3>
        <span className="text-[10px] text-[var(--color-text-faint)] truncate">
          scored by {profileName ?? 'your league profile'}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={rows} margin={{ left: -12, right: 8, top: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} vertical={false} />
          {floor != null && ceiling != null && (
            <ReferenceArea
              y1={floor}
              y2={ceiling}
              fill={ACCENT_HEX}
              fillOpacity={0.07}
              stroke="none"
            />
          )}
          {median != null && (
            <ReferenceLine y={median} stroke={TEXT_FAINT_HEX} strokeDasharray="4 4" />
          )}
          <XAxis dataKey="week" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: BORDER_RGBA }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<LogTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="points" radius={[3, 3, 0, 0]}>
            {rows.map((r) => {
              // Boom weeks earn the accent; bust weeks fade. Everything between
              // is neutral, so the eye lands on the tails.
              const isBoom = ceiling != null && r.points >= ceiling
              const isBust = floor != null && r.points <= floor
              return (
                <Cell
                  key={r.week}
                  fill={isBoom ? ACCENT_HEX : NEUTRAL_HEX}
                  fillOpacity={isBust ? 0.45 : 1}
                />
              )
            })}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
        Shaded band = the middle 60% of his actual weeks (p20–p80). Dashed line = median.
      </p>
    </div>
  )
}
