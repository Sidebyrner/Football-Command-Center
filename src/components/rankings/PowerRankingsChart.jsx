import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ScatterChart, Scatter, ReferenceLine, ZAxis,
} from 'recharts'
import { GRADE_COLOR_HEX, BORDER_RGBA, TEXT_MUTED_HEX } from '../../utils/chartColors'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function shorten(name, max = 14) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function RankBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const t = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{t.name}</p>
      <p className="text-[var(--color-text-muted)]">Grade {t.grade} · Score {t.score}</p>
    </div>
  )
}

function QuadrantTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const t = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{t.name}</p>
      <p className="text-[var(--color-text-muted)]">Grade {t.grade}</p>
      <p className="text-[var(--color-text-muted)]">Value {t.valueScore} · Construction {t.constructionScore}</p>
    </div>
  )
}

/**
 * Two views of the same season-mode team grades (from useTeamPowerRankings):
 * a ranked bar chart (the direct "how strong is each team" answer) and a
 * value-vs-construction scatter (the insight a ranked list can't give — two
 * teams can land on the same score for opposite reasons: stacked talent on
 * an imbalanced bench, vs. a deep, well-built-but-unspectacular roster).
 * Both point-in-time only — no history exists to plot a trend over.
 */
export default function PowerRankingsChart({ teams }) {
  const ranked = useMemo(
    () => teams.filter((t) => t.score != null).map((t) => ({ ...t, shortName: shorten(t.name) })),
    [teams]
  )

  if (ranked.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">No graded teams yet.</p>
  }

  const barHeight = Math.max(200, ranked.length * 36)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
          Ranked by score
        </h3>
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart data={ranked} layout="vertical" margin={{ left: 8, right: 20, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} />
            <YAxis type="category" dataKey="shortName" width={96} tick={AXIS_TICK} />
            <Tooltip content={<RankBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="score" radius={[0, 3, 3, 0]}>
              {ranked.map((t) => <Cell key={t.id} fill={GRADE_COLOR_HEX[t.grade] ?? TEXT_MUTED_HEX} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
          Value vs. roster construction
        </h3>
        <p className="text-[10px] text-[var(--color-text-faint)] mb-2 leading-relaxed">
          Right = beating expected value. Up = starter slots actually filled, not stacked at one
          position. Two teams can share a score and land in very different spots here.
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} />
            <XAxis type="number" dataKey="valueScore" domain={[0, 100]} name="Value" tick={AXIS_TICK} />
            <YAxis type="number" dataKey="constructionScore" domain={[0, 100]} name="Construction" tick={AXIS_TICK} />
            <ZAxis range={[110, 110]} />
            <ReferenceLine x={50} stroke={BORDER_RGBA} />
            <ReferenceLine y={50} stroke={BORDER_RGBA} />
            <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3', stroke: BORDER_RGBA }} />
            <Scatter data={ranked}>
              {ranked.map((t) => <Cell key={t.id} fill={GRADE_COLOR_HEX[t.grade] ?? TEXT_MUTED_HEX} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
