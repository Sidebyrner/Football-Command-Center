import { AlertTriangle } from 'lucide-react'

function Tile({ label, value, hint, accent }) {
  return (
    <div className="inset" style={{ padding: 'var(--space-s) var(--space-m)' }}>
      <p className="t-micro muted" style={{ margin: 0 }}>{label}</p>
      <p className="t-title" style={{ margin: 0, color: accent ? 'var(--accent)' : 'var(--text)' }}>
        {value ?? '—'}
      </p>
      {hint && <p className="t-caption faint" style={{ margin: 0 }}>{hint}</p>}
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
        <h3 className="t-section" style={{ margin: 0 }}>
          Actual production
        </h3>
        <span className="t-meta faint">
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

      <p className="t-meta muted" style={{ margin: 'var(--space-s) 0 0' }}>
        This is what he <strong style={{ color: 'var(--text)' }}>did</strong>, in{' '}
        <strong style={{ color: 'var(--text)' }}>{profileName ?? 'your league'}</strong> points. The
        0–100 score above is something else — how his season profile{' '}
        <strong style={{ color: 'var(--text)' }}>ranks</strong> against his position. They answer
        different questions and will disagree.
      </p>

      {thin && (
        <p className="t-meta flex items-start gap-1" style={{ margin: '6px 0 0', color: 'var(--caution)' }}>
          <AlertTriangle size={12} className="flex-shrink-0" style={{ marginTop: 1 }} aria-hidden />
          Only {d.n} game{d.n === 1 ? '' : 's'} — a floor and ceiling off this few weeks is noise, not a range.
        </p>
      )}
      {stale && (
        <p className="t-meta faint" style={{ margin: '4px 0 0' }}>
          {season} is still in progress ({seasonMeta.weeks} week{seasonMeta.weeks === 1 ? '' : 's'} of data).
        </p>
      )}
      {scored?.unsupported?.length > 0 && (
        <p className="t-meta faint" style={{ margin: '4px 0 0' }}>
          Your league scores {scored.unsupported.join(', ')}, which this dataset doesn't
          break out — those points are missing from every week above, not zero.
        </p>
      )}
    </div>
  )
}
