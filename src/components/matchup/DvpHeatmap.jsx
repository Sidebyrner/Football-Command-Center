import { useMemo, useState } from 'react'
import { heatColor } from '../../utils/chartColors'
import { getPositionColor } from '../../utils/playerHelpers'

/**
 * Fantasy points each defense allows to each position, in YOUR league's
 * scoring. Rows sorted softest overall first.
 *
 * A DOM grid rather than a Recharts chart: recharts has no heatmap primitive
 * worth the wrapper, and a plain grid can use CSS vars directly instead of the
 * hex twins in chartColors.js.
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

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[420px]">
        {/* header */}
        <div
          className="grid gap-px text-[9px] uppercase tracking-wide text-[var(--color-text-faint)] mb-px"
          style={{ gridTemplateColumns: `56px repeat(${positions.length}, minmax(0, 1fr))` }}
        >
          <div />
          {positions.map((p) => (
            <div key={p} className="text-center py-1" style={{ color: getPositionColor(p) }}>
              {p}
              {leagueAvgByPos[p] != null && (
                <span className="block text-[8px] text-[var(--color-text-faint)] normal-case tracking-normal">
                  avg {leagueAvgByPos[p]}
                </span>
              )}
            </div>
          ))}
        </div>

        {rows.map((r) => (
          <div
            key={r.def}
            className="grid gap-px mb-px"
            style={{ gridTemplateColumns: `56px repeat(${positions.length}, minmax(0, 1fr))` }}
          >
            <div
              className={`text-[10px] font-semibold px-1.5 py-1 flex items-center rounded-l ${
                r.mine ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
              }`}
            >
              {r.def}
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
              return (
                <div
                  key={p}
                  onMouseEnter={() => setHover(key)}
                  onMouseLeave={() => setHover(null)}
                  className="relative text-center py-1 text-[10px] tabular-nums cursor-default"
                  style={{
                    backgroundColor: thin ? 'rgba(71, 85, 105, 0.18)' : heatColor(t),
                    color: thin ? 'var(--color-text-faint)' : '#f8fafc',
                  }}
                >
                  {thin ? '—' : cell.perGame.toFixed(1)}
                  {hover === key && !thin && (
                    <div className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-left shadow-lg">
                      <p className="font-semibold text-[var(--color-text)]">{r.def} vs {p}</p>
                      <p className="text-[var(--color-text-muted)]">
                        {cell.perGame.toFixed(1)}/gm · {cell.vsLeagueAvg > 0 ? '+' : ''}
                        {cell.vsLeagueAvg} vs league avg
                      </p>
                      <p className="text-[var(--color-text-faint)]">
                        rank {cell.rank}/{dvp.ranked[p]?.length ?? '—'} softest · {cell.games} games
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        <div className="flex items-center gap-3 mt-3 text-[9px] text-[var(--color-text-faint)]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: heatColor(-1) }} />
            tough
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: heatColor(0) }} />
            league average
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: heatColor(1) }} />
            soft
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: 'rgba(71, 85, 105, 0.18)' }} />
            under {minGames} games — not ranked
          </span>
        </div>
      </div>
    </div>
  )
}
