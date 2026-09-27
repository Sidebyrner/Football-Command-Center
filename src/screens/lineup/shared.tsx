/**
 * Small pieces the three Lineup screens share: the injury badge (Swift
 * `InjuryBadge`), a clock that re-reads the league's own time on an interval
 * (Swift `TimelineView(.periodic…)`), the refresh button that stands in for
 * pull-to-refresh, and the "could not load" state each screen words its own way.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { LeagueContext } from '@models/league/LeagueContext'

/** "Q", "Out", "Doubtful", "IR" beside a name — caution for Questionable, the sit colour otherwise. */
export function InjuryBadge({ label }: { label: string }) {
  const tone = label === 'Q' ? 'var(--caution)' : 'var(--sit)'
  return (
    <span
      className="injury-badge"
      style={{ color: tone, background: `color-mix(in srgb, ${tone} 15%, transparent)` }}
      aria-label={label === 'Q' ? 'Questionable' : label}
    >
      {label}
    </span>
  )
}

/** The league clock, re-read every `everyMs` — for countdowns and "updated 40s ago". */
export function useLeagueNow(context: LeagueContext | undefined, everyMs: number): number {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])
  return context?.now() ?? Date.now()
}

/** The web's pull-to-refresh: a button that re-reads everything that can change this week. */
export function RefreshButton({ onRefresh, busy }: { onRefresh: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      className="lineup-refresh"
      onClick={onRefresh}
      disabled={busy}
      aria-label={busy ? 'Refreshing' : 'Refresh'}
      title="Refresh"
    >
      <RefreshCw size={14} aria-hidden className={busy ? 'spinning' : undefined} />
    </button>
  )
}

/** Nothing loaded and the load failed — worded per screen, as the Swift views do. */
export function LoadFailure({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="card load-failure" role="alert">
      <div className="t-section load-failure-title">
        <AlertTriangle size={18} color="var(--sit)" aria-hidden /> {title}
      </div>
      <div className="t-meta muted">{message}</div>
      <button type="button" className="button" onClick={onRetry}>Try again</button>
    </div>
  )
}

/** Swift's `.formatted(.relative(presentation: .named))` — "2 hours ago", "yesterday". */
export function relativeNamed(date: number, now: number): string {
  const seconds = Math.round((date - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(seconds, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day')
  return rtf.format(Math.round(seconds / (7 * 86_400)), 'week')
}

/** "Sun 1:00 PM" — Swift's `.dateTime.weekday(.abbreviated).hour().minute()`. */
export function weekdayTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
