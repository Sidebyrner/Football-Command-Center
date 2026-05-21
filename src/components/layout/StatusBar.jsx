import { Activity } from 'lucide-react'

export default function StatusBar({ oddsQuota, lastUpdated }) {
  const remaining = oddsQuota?.remaining
  const quotaColor =
    remaining === null ? 'var(--color-text-faint)' :
    remaining > 200 ? 'var(--color-start)' :
    remaining > 50 ? 'var(--color-caution)' : 'var(--color-sit)'

  return (
    <div className="h-8 flex items-center justify-between px-6 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-faint)]">
      <div className="flex items-center gap-1.5">
        <Activity size={11} />
        <span>Sleeper API</span>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-start)]" />
      </div>

      <div className="flex items-center gap-4">
        {remaining !== null && (
          <span style={{ color: quotaColor }}>
            Odds API: {remaining} credits remaining
          </span>
        )}
        {lastUpdated && (
          <span>Updated {lastUpdated}</span>
        )}
      </div>
    </div>
  )
}
