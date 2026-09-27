import { useMemo } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ScatterChart, Scatter, ReferenceLine, ZAxis, LabelList,
} from 'recharts'
import { AXIS_TICK, CURSOR_FILL, GRID_STROKE, ChartTooltipBox, gradeColor } from '../shared/chartTheme'

function shorten(name, max = 14) {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function RankBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const t = payload[0].payload
  return (
    <ChartTooltipBox>
      <p style={{ fontWeight: 600 }}>{t.name}</p>
      <p className="muted">Grade {t.grade} · Score {t.score}</p>
    </ChartTooltipBox>
  )
}

function QuadrantTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const t = payload[0].payload
  return (
    <ChartTooltipBox>
      <p style={{ fontWeight: 600 }}>{t.name}</p>
      <p className="muted">Grade {t.grade}</p>
      <p className="muted">Value {t.valueScore} · Construction {t.constructionScore}</p>
    </ChartTooltipBox>
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
    return <p className="card t-body muted" style={{ margin: 0 }}>No graded teams yet.</p>
  }

  const barHeight = Math.max(200, ranked.length * 36)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <figure className="card" style={{ margin: 0, minWidth: 0 }} aria-label="Teams ranked by power score, with each team's grade">
        <figcaption className="t-micro muted" style={{ marginBottom: 'var(--space-s)' }}>
          Ranked by score
        </figcaption>
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart data={ranked} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} />
            <YAxis type="category" dataKey="shortName" width={96} tick={AXIS_TICK} />
            <Tooltip content={<RankBarTooltip />} cursor={CURSOR_FILL} />
            <Bar dataKey="score" radius={[0, 3, 3, 0]}>
              {ranked.map((t) => <Cell key={t.id} fill={gradeColor(t.grade)} />)}
              {/* The grade printed at the bar's end, so colour isn't the only signal. */}
              <LabelList dataKey="grade" position="right" fill="var(--text-2)" fontSize={11} fontWeight={700} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </figure>

      <figure className="card" style={{ margin: 0, minWidth: 0 }} aria-label="Each team's value score against its roster construction score">
        <figcaption className="t-micro muted" style={{ marginBottom: 'var(--space-xs)' }}>
          Value vs. roster construction
        </figcaption>
        <p className="t-meta muted" style={{ margin: '0 0 var(--space-s)' }}>
          Right = beating expected value. Up = starter slots actually filled, not stacked at one
          position. Two teams can share a score and land in very different spots here.
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis type="number" dataKey="valueScore" domain={[0, 100]} name="Value" tick={AXIS_TICK} />
            <YAxis type="number" dataKey="constructionScore" domain={[0, 100]} name="Construction" tick={AXIS_TICK} />
            <ZAxis range={[110, 110]} />
            <ReferenceLine x={50} stroke={GRID_STROKE} />
            <ReferenceLine y={50} stroke={GRID_STROKE} />
            <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: '3 3', stroke: GRID_STROKE }} />
            <Scatter data={ranked}>
              {ranked.map((t) => <Cell key={t.id} fill={gradeColor(t.grade)} stroke="var(--card)" strokeWidth={1} />)}
              <LabelList dataKey="grade" position="top" fill="var(--text-2)" fontSize={10} fontWeight={700} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </figure>
    </div>
  )
}
