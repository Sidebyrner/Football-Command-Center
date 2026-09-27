import { AlertTriangle } from 'lucide-react'

function Tile({ label, value, hint, accent }) {
  return (
    <div className="border border-[var(--color-border)] rounded bg-[var(--color-surface-2)] px-3 py-2">
      <p className="text-[9px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</p>
      <p
        className="text-lg font-bold tabular-nums"
        style={{ color: accent ? 'var(--color-accent)' : 'var(--color-text)' }}
      >
        {value ?? '—'}
      </p>
      {hint && <p className="text-[9px] text-[var(--color-text-faint)] leading-tight">{hint}</p>}
    </div>
  )
}

// A coefficient of variation is only meaningful relative to the position; these
// bands are rough and labeled as such rather than presented as a grade.
function volatilityLabel(cv) {
  if (cv == null) return null
  if (cv < 0.45) return 'steady week to week'
  if (cv < 0.75) return 'normal swing'
  return 'boom or bust'
}

/**
 * What a player ACTUALLY produced, distributionally — floor, median, ceiling
 * from his real weeks under this league's scoring.
 *
 * Deliberately labeled "Actual" and dated, because the 0-100 score elsewhere in
 * the drawer is a percentile RANK of his season profile. Presenting them as
 * interchangeable is exactly the overclaim this app removed once already.
 */
export default function ConsistencyPanel({ scored, distribution, season, profileName, seasonMeta }) {
  const d = distribution ?? {}
  if (!d.n) return null

  const thin = d.n < 6
  const stale = seasonMeta && !seasonMeta.complete

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2 gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
          Actual production
        </h3>
        <span className="text-[10px] text-[var(--color-text-faint)]">
          {season} · {d.n} week{d.n === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Floor" value={d.floor?.toFixed(1)} hint="p20 — bad week" />
        <Tile label="Median" value={d.median?.toFixed(1)} hint="typical week" accent />
        <Tile label="Ceiling" value={d.ceiling?.toFixed(1)} hint="p80 — good week" />
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2">
        <Tile label="Per game" value={scored?.perGame?.toFixed(1)} hint="mean" />
        <Tile label="Std dev" value={d.stdev?.toFixed(1)} hint="spread" />
        <Tile label="Volatility" value={d.cv?.toFixed(2)} hint={volatilityLabel(d.cv)} />
      </div>

      <p className="text-[10px] text-[var(--color-text-muted)] mt-2 leading-snug">
        This is what he <span className="text-[var(--color-text)]">did</span>, in{' '}
        <span className="text-[var(--color-text)]">{profileName ?? 'your league'}</span> points. The
        0–100 score above is something else — how his season profile{' '}
        <span className="text-[var(--color-text)]">ranks</span> against his position. They answer
        different questions and will disagree.
      </p>

      {thin && (
        <p className="text-[10px] text-[var(--color-caution)] mt-1.5 flex items-start gap-1">
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          Only {d.n} game{d.n === 1 ? '' : 's'} — a floor and ceiling off this few weeks is noise, not a range.
        </p>
      )}
      {stale && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
          {season} is still in progress ({seasonMeta.weeks} week{seasonMeta.weeks === 1 ? '' : 's'} of data).
        </p>
      )}
      {scored?.unsupported?.length > 0 && (
        <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
          Your league scores {scored.unsupported.join(', ')}, which this dataset doesn't
          break out — those points are missing from every week above, not zero.
        </p>
      )}
    </div>
  )
}
