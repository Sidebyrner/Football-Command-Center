import { useMemo } from 'react'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine, Label,
} from 'recharts'
import { Gauge } from 'lucide-react'
import { ScreenSection } from '@ui/components/Screen'
import { AXIS_TICK, GRID_STROKE, HIGHLIGHT, NEUTRAL, FAINT, ChartTooltipBox } from '../shared/chartTheme'
import {
  BLOWOUT_SPREAD, GAME_SCRIPTS, SCRIPT_ORDER, classifyGameScript, medianTotal as medianOf,
} from '../../utils/gameScript'

function EnvTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const g = payload[0].payload
  return (
    <ChartTooltipBox>
      <p style={{ fontWeight: 600 }}>{g.away} @ {g.home}{g.mine ? ' · your players' : ''}</p>
      <p className="muted">
        O/U {g.total} · {g.favorite} by {g.margin}
      </p>
      <p className="faint">
        implied {g.away} {g.awayImplied?.toFixed(1)} · {g.home} {g.homeImplied?.toFixed(1)}
      </p>
      <p style={{ marginTop: 4, fontWeight: 600 }}>{g.quadrant}</p>
    </ChartTooltipBox>
  )
}

/**
 * Both halves of a game's script in one view. An implied team total alone
 * can't tell you whether a 27-point projection comes from a track meet or from
 * a favorite grinding out a lead — and those two produce opposite fantasy
 * outcomes for the same player.
 *
 * Reads the odds payload the page already fetched. Costs nothing extra.
 */
export default function GameEnvironmentScatter({ games, myTeamAbbrs }) {
  const { rows, medianTotal } = useMemo(() => {
    const out = []
    for (const g of games) {
      const { total, homeSpread, awaySpread, homeImplied, awayImplied } = g.line
      if (total == null || homeSpread == null) continue
      const margin = Math.abs(homeSpread)
      out.push({
        home: g.homeAbbr, away: g.awayAbbr, total, margin,
        homeImplied, awayImplied,
        favorite: homeSpread < 0 ? g.homeAbbr : g.awayAbbr,
        mine: myTeamAbbrs.has(g.homeAbbr) || myTeamAbbrs.has(g.awayAbbr),
        awaySpread,
      })
    }
    if (!out.length) return { rows: [], medianTotal: null }
    const mid = medianOf(out.map((r) => r.total))
    return {
      rows: out.map((r) => ({ ...r, quadrant: classifyGameScript(r.total, r.margin, mid)?.label ?? null })),
      medianTotal: mid,
    }
  }, [games, myTeamAbbrs])

  if (rows.length < 2) return null

  return (
    <ScreenSection title="Game environment this week" icon={Gauge} hue="var(--hue-market)">
      <figure className="card" style={{ margin: 0, minWidth: 0 }} aria-label="Each game's total against its spread">
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ left: 0, right: 16, top: 12, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            type="number" dataKey="total" name="Total" domain={['dataMin - 2', 'dataMax + 2']}
            tick={AXIS_TICK} tickLine={false}
          >
            <Label value="game total (O/U)" position="insideBottom" offset={-10} fill={FAINT} fontSize={10} />
          </XAxis>
          <YAxis
            type="number" dataKey="margin" name="Spread" domain={[0, 'dataMax + 1.5']}
            tick={AXIS_TICK} tickLine={false} width={44}
          >
            <Label value="spread" angle={-90} position="insideLeft" fill={FAINT} fontSize={10} />
          </YAxis>
          <ZAxis range={[110, 110]} />
          <ReferenceLine x={medianTotal} stroke={GRID_STROKE} strokeDasharray="4 4" />
          <ReferenceLine y={BLOWOUT_SPREAD} stroke={GRID_STROKE} strokeDasharray="4 4" />
          <Tooltip content={<EnvTooltip />} cursor={{ strokeDasharray: '3 3', stroke: GRID_STROKE }} />
          <Scatter data={rows}>
            {rows.map((r) => (
              <Cell key={`${r.away}-${r.home}`} fill={r.mine ? HIGHLIGHT : NEUTRAL} stroke={r.mine ? 'var(--text)' : 'none'} strokeWidth={r.mine ? 2 : 0} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      </figure>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        {SCRIPT_ORDER.map((key) => {
          const s = GAME_SCRIPTS[key]
          return (
            <div key={key} className="inset">
              <p className="t-meta" style={{ margin: 0, fontWeight: 600 }}>
                {s.label} <span className="faint" style={{ fontWeight: 400 }}>· {s.axis}</span>
              </p>
              <p className="t-caption muted" style={{ margin: '2px 0 0' }}>{s.blurb}</p>
            </div>
          )
        })}
      </div>

      <p className="t-meta muted" style={{ margin: 0 }}>
        Split at a {BLOWOUT_SPREAD}-point spread and this week's median total ({medianTotal}).
        The vertical line moves with the board; the horizontal one doesn't — a touchdown is a
        touchdown. Ringed indigo dots are games your players are in; plain grey dots are the rest.
      </p>
    </ScreenSection>
  )
}
