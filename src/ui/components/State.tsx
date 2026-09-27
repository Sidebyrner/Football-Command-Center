/**
 * Loading, error, freshness and coverage — the ports of `LoadingPlaceholder`,
 * `InlineErrorBanner`, `FreshnessBanner` and `CoverageNote`, so every screen
 * says these things the same way.
 */
import { AlertTriangle, Clock, Info, Link2, RefreshCcw } from 'lucide-react'
import type { Provenance } from '@data/fetched'
import { freshnessLabel, isDegraded } from '@models/league/Freshness'
import { useApp } from '@ui/app/AppContext'

/** Placeholder cards shaped like content, shimmering rather than spinning. */
export function LoadingPlaceholder({ label = 'Loading…', cards = 4 }: { label?: string; cards?: number }) {
  return (
    <div className="loading-stack" role="status" aria-label={label}>
      {Array.from({ length: cards }, (_, i) => (
        <div className="card skeleton" key={i} aria-hidden>
          <div className="skeleton-line" style={{ width: '55%' }} />
          <div className="skeleton-line small" style={{ width: '80%' }} />
          <div className="skeleton-line small" style={{ width: i % 2 === 0 ? '65%' : '35%' }} />
        </div>
      ))}
    </div>
  )
}

/** A refresh that failed while older content is on screen: say so above it. */
export function InlineErrorBanner({ message }: { message: string }) {
  return (
    <div className="card inline-error" role="alert">
      <RefreshCcw size={16} color="var(--caution)" aria-hidden />
      <div>
        <div className="t-meta" style={{ fontWeight: 600 }}>Couldn’t refresh — showing what was loaded before</div>
        <div className="t-micro muted clamp-2">{message}</div>
      </div>
    </div>
  )
}

/** Nothing loaded and the load failed. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card error-state" role="alert">
      <AlertTriangle size={20} color="var(--sit)" aria-hidden />
      <div className="t-body">Couldn’t load this screen</div>
      <div className="t-meta muted">{message}</div>
      {onRetry && <button type="button" className="button" onClick={onRetry}>Try again</button>}
    </div>
  )
}

/** How fresh the data is — nothing when it's live. */
export function FreshnessBanner({ provenance }: { provenance: Provenance }) {
  const label = freshnessLabel(provenance)
  if (!label) return null
  const degraded = isDegraded(provenance)
  const Icon = degraded ? AlertTriangle : Clock
  return (
    <div className="freshness t-meta" style={{ color: degraded ? 'var(--caution)' : 'var(--text-2)' }}>
      <Icon size={13} aria-hidden /> {label}
    </div>
  )
}

/** A statement of scope, not an error. */
export function CoverageNote({ text }: { text: string }) {
  return (
    <div className="coverage-note t-meta muted">
      <Info size={13} aria-hidden /> <span>{text}</span>
    </div>
  )
}

/** Shown on every screen until a league is connected. */
export function NeedsSetup() {
  const { openScreen } = useApp()
  return (
    <div className="card empty-state">
      <Link2 size={28} color="var(--accent)" aria-hidden />
      <div className="t-title">Connect your league</div>
      <div className="t-body muted">Add your Sleeper username in Settings to load your league.</div>
      <button type="button" className="button primary" onClick={() => openScreen('settings')}>Open Settings</button>
    </div>
  )
}
