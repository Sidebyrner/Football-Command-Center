/**
 * Live-game indicators — the port of `LiveIndicators.swift`: a pulsing dot
 * (static under reduced motion; the colour and its label still say "live"),
 * the "LIVE" scoreboard badge, and `KickoffText.time`.
 */

/** A small pulsing dot for a game that may be in progress. */
export function LiveDot({ size = 7 }: { size?: number }) {
  return (
    <span
      className="live-dot"
      role="img"
      aria-label="Game in progress"
      style={{ width: size, height: size }}
    />
  )
}

/** "LIVE" badge for a scoreboard. */
export function LiveBadge() {
  return (
    <span className="live-badge" role="img" aria-label="Games in progress">
      <span className="live-dot" aria-hidden style={{ width: 6, height: 6 }} />
      <span aria-hidden>LIVE</span>
    </span>
  )
}

/** "4:25 PM" — a slot that hasn't played yet, shown as when it will. */
export function kickoffTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
