import { useMemo } from 'react'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, Cell, ReferenceLine, Label,
} from 'recharts'
import { ACCENT_HEX, NEUTRAL_HEX, BORDER_RGBA, TEXT_MUTED_HEX, TEXT_FAINT_HEX } from '../../utils/chartColors'
import {
  BLOWOUT_SPREAD, GAME_SCRIPTS, SCRIPT_ORDER, classifyGameScript, medianTotal as medianOf,
} from '../../utils/gameScript'

const AXIS_TICK = { fill: TEXT_MUTED_HEX, fontSize: 11 }

function EnvTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const g = payload[0].payload
  return (
    <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[var(--color-text)]">{g.away} @ {g.home}</p>
      <p className="text-[var(--color-text-muted)] tabular-nums">
        O/U {g.total} · {g.favorite} by {g.margin}
      </p>
      <p className="text-[var(--color-text-faint)] tabular-nums">
        implied {g.away} {g.awayImplied?.toFixed(1)} · {g.home} {g.homeImplied?.toFixed(1)}
      </p>
      <p className="text-[var(--color-accent)] mt-1">{g.quadrant}</p>
    </div>
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
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)] mb-2">
        Game environment this week
      </h2>

      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ left: 0, right: 16, top: 12, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BORDER_RGBA} />
          <XAxis
            type="number" dataKey="total" name="Total" domain={['dataMin - 2', 'dataMax + 2']}
            tick={AXIS_TICK} tickLine={false}
          >
            <Label value="game total (O/U)" position="insideBottom" offset={-10} fill={TEXT_FAINT_HEX} fontSize={10} />
          </XAxis>
          <YAxis
            type="number" dataKey="margin" name="Spread" domain={[0, 'dataMax + 1.5']}
            tick={AXIS_TICK} tickLine={false} width={44}
          >
            <Label value="spread" angle={-90} position="insideLeft" fill={TEXT_FAINT_HEX} fontSize={10} />
          </YAxis>
          <ZAxis range={[110, 110]} />
          <ReferenceLine x={medianTotal} stroke={BORDER_RGBA} strokeDasharray="4 4" />
          <ReferenceLine y={BLOWOUT_SPREAD} stroke={BORDER_RGBA} strokeDasharray="4 4" />
          <Tooltip content={<EnvTooltip />} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={rows}>
            {rows.map((r) => (
              <Cell key={`${r.away}-${r.home}`} fill={r.mine ? ACCENT_HEX : NEUTRAL_HEX} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        {SCRIPT_ORDER.map((key) => {
          const s = GAME_SCRIPTS[key]
          return (
            <div key={key} className="border border-[var(--color-border)] rounded px-2 py-1.5 bg-[var(--color-surface)]">
              <p className="text-[10px] font-semibold text-[var(--color-text)]">
                {s.label} <span className="text-[var(--color-text-faint)] font-normal">· {s.axis}</span>
              </p>
              <p className="text-[9px] text-[var(--color-text-muted)] leading-tight mt-0.5">{s.blurb}</p>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-[var(--color-text-faint)] mt-1.5">
        Split at a {BLOWOUT_SPREAD}-point spread and this week's median total ({medianTotal}).
        The vertical line moves with the board; the horizontal one doesn't — a touchdown is a
        touchdown. Highlighted dots are games your players are in.
      </p>
    </div>
  )
}
