import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Database } from 'lucide-react'
import { getWeeklyDataMeta } from '../../services/weeklyStatsService'

function ago(iso) {
  if (!iso) return null
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * How current the preprocessed nflverse data is.
 *
 * Everything derived from public/data — weekly points, floor/ceiling,
 * defense-vs-position, the schedule — is only as fresh as the last run of
 * `npm run preprocess-nflverse`. Static files quietly going stale mid-season is
 * the failure mode of this whole pipeline: nothing errors, the numbers just
 * stop describing the present. So it gets a visible surface rather than a
 * comment in a script.
 */
export default function DataFreshness({ currentWeek }) {
  const [meta, setMeta] = useState(null)

  useEffect(() => {
    let cancelled = false
    getWeeklyDataMeta().then((m) => { if (!cancelled) setMeta(m) })
    return () => { cancelled = true }
  }, [])

  if (!meta) return null

  const newest = meta.seasons?.[0]
  const behind = newest && !newest.complete && currentWeek && newest.latestWeek != null
    && newest.latestWeek < Number(currentWeek) - 1

  return (
    <section>
      <h2 className="font-display font-semibold text-sm text-[var(--color-text)] mb-4 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]" />
        Data freshness
      </h2>

      {!meta.isLoaded ? (
        <p className="text-xs text-[var(--color-caution)] flex items-start gap-1.5">
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <span>
            No weekly data on disk — weekly points, floor/ceiling, and
            defense-vs-position will all be empty. Run{' '}
            <code className="text-[var(--color-text)]">npm run preprocess-nflverse</code>.
          </span>
        </p>
      ) : (
        <div className="space-y-1.5">
          {meta.seasons.map((s) => (
            <div key={s.season} className="flex items-center gap-2 text-xs">
              <Database size={11} className="text-[var(--color-text-faint)] flex-shrink-0" />
              <span className="text-[var(--color-text)] font-semibold tabular-nums">{s.season}</span>
              <span className="text-[var(--color-text-muted)]">
                {s.complete
                  ? `complete — all ${s.weeks} weeks`
                  : `through week ${s.latestWeek ?? s.weeks}`}
              </span>
              <span className="text-[var(--color-text-faint)] tabular-nums">
                {Math.round(s.bytes / 1024)} KB
              </span>
            </div>
          ))}

          <p className="text-[10px] text-[var(--color-text-faint)] pt-1 flex items-start gap-1.5">
            {behind ? (
              <AlertTriangle size={11} className="text-[var(--color-caution)] flex-shrink-0 mt-0.5" />
            ) : (
              <CheckCircle size={11} className="text-[var(--color-start)] flex-shrink-0 mt-0.5" />
            )}
            <span>
              Built {ago(meta.generated)}.
              {behind
                ? ` Week ${newest.latestWeek} is the newest on disk but you're on week ${currentWeek} — re-run npm run preprocess-nflverse.`
                : ' Re-run npm run preprocess-nflverse each week to pull in new games.'}
            </span>
          </p>
        </div>
      )}
    </section>
  )
}
