import { useMemo, useState } from 'react'
import { heatFill } from '../shared/chartTheme'
import { positionColor } from '@ui/components/Player'
import '../../screens/tools/researchTools.css'

/**
 * Fantasy points each defense allows to each position, in YOUR league's
 * scoring. Rows sorted softest overall first.
 *
 * A DOM grid rather than a Recharts chart: recharts has no heatmap primitive
 * worth the wrapper, and a plain grid can use CSS vars directly instead of the
 * hex twins in chartColors.js. Every cell prints its value, and the legend
 * names each colour, so the colour is never the only signal.
 */
export default function DvpHeatmap({ dvp, myTeamAbbrs }) {
  const [hover, setHover] = useState(null)

  const rows = useMemo(() => {
    if (!dvp) return []
    const { byDefense, positions, leagueAvgByPos } = dvp
    // Softness overall = mean of each position's deviation from its own league
    // average, normalized so positions with big raw numbers (QB) don't dominate
    // the sort over positions with small ones (K).
    return Object.entries(byDefense)
      .map(([def, byPos]) => {
        const devs = positions
          .map((p) => {
            const cell = byPos[p]
            const avg = leagueAvgByPos[p]
            if (cell?.perGame == null || !avg) return null
            return (cell.perGame - avg) / avg
          })
          .filter((v) => v != null)
        return {
          def,
          byPos,
          softness: devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : null,
          mine: myTeamAbbrs?.has(def),
        }
      })
      .sort((a, b) => (b.softness ?? -99) - (a.softness ?? -99))
  }, [dvp, myTeamAbbrs])

  if (!rows.length) return null
  const { positions, leagueAvgByPos, minGames } = dvp
  const columns = { gridTemplateColumns: `56px repeat(${positions.length}, minmax(0, 1fr))` }

  return (
    <div className="rt-scroll">
      <div className="rt-heat" role="table" aria-label="Fantasy points allowed per game by each defense to each position, softest defenses first">
        {/* header */}
        <div className="grid" style={{ ...columns, gap: 2 }} role="row">
          <div role="columnheader" className="t-micro faint rt-heat-head" style={{ textAlign: 'left', paddingLeft: 6 }}>Def</div>
          {positions.map((p) => (
            <div key={p} role="columnheader" className="rt-heat-head">
              <span className="t-micro" style={{ color: positionColor(p) }}>{p}</span>
              {leagueAvgByPos[p] != null && (
                <span className="block t-caption faint">avg {leagueAvgByPos[p]}</span>
              )}
            </div>
          ))}
        </div>

        {rows.map((r) => (
          <div key={r.def} className="grid" style={{ ...columns, gap: 2 }} role="row">
            <div role="rowheader" className={`rt-heat-def${r.mine ? ' mine' : ''}`}>
              {r.def}
              {r.mine && <span className="sr-only"> (your opponent)</span>}
            </div>
            {positions.map((p) => {
              const cell = r.byPos[p]
              const avg = leagueAvgByPos[p]
              const thin = !cell || cell.games < minGames || cell.perGame == null
              // Normalize the deviation to ±35% of the league average, which
              // puts realistic spreads across the full color range without a
              // single outlier flattening everything else.
              const t = thin || !avg ? null : Math.max(-1, Math.min(1, (cell.perGame - avg) / (avg * 0.35)))
              const key = `${r.def}-${p}`
              const label = thin
                ? `${r.def} vs ${p}: under ${minGames} games, not ranked`
                : `${r.def} vs ${p}: ${cell.perGame.toFixed(1)} per game, ${cell.vsLeagueAvg > 0 ? '+' : ''}${cell.vsLeagueAvg} vs league average, rank ${cell.rank} of ${dvp.ranked[p]?.length ?? '—'} softest, ${cell.games} games`
              return (
                <div
                  key={p}
                  role="cell"
                  tabIndex={thin ? -1 : 0}
                  aria-label={label}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(key)}
                  onBlur={() => setHover(null)}
                  className={`rt-heat-cell${thin ? ' thin' : ''}`}
                  style={thin ? undefined : { background: heatFill(t) }}
                >
                  <span aria-hidden>{thin ? '—' : cell.perGame.toFixed(1)}</span>
                  {hover === key && !thin && (
                    <div className="rt-tooltip" aria-hidden>
                      <p style={{ fontWeight: 600 }}>{r.def} vs {p}</p>
                      <p className="muted">
                        {cell.perGame.toFixed(1)}/gm · {cell.vsLeagueAvg > 0 ? '+' : ''}
                        {cell.vsLeagueAvg} vs league avg
                      </p>
                      <p className="faint">
                        rank {cell.rank}/{dvp.ranked[p]?.length ?? '—'} softest · {cell.games} games
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="rt-row t-caption muted" style={{ marginTop: 'var(--space-s)', gap: 'var(--space-m)' }} aria-label="Heatmap legend">
        <span className="rt-row" style={{ gap: 4 }}>
          <span className="rt-swatch" style={{ background: heatFill(-1) }} />
          tough (fewer points than average)
        </span>
        <span className="rt-row" style={{ gap: 4 }}>
          <span className="rt-swatch" style={{ background: heatFill(0) }} />
          league average
        </span>
        <span className="rt-row" style={{ gap: 4 }}>
          <span className="rt-swatch" style={{ background: heatFill(1) }} />
          soft (more points than average)
        </span>
        <span className="rt-row" style={{ gap: 4 }}>
          <span className="rt-swatch" style={{ background: 'var(--inset)' }} />
          — under {minGames} games, not ranked
        </span>
      </div>
    </div>
  )
}
