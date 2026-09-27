/**
 * The live-game indicators — a port of `LiveIndicators.swift` (`LiveDot`,
 * `LiveBadge`). The dot pulses unless the viewer prefers reduced motion; the
 * word "LIVE" always carries the meaning, never the colour alone.
 */
import './board.css'

/** A small pulsing dot for a game that may be in progress. */
export function LiveDot({ size = 7 }: { size?: number }) {
  return (
    <span
      className="bt-live-dot"
      role="img"
      aria-label="Game in progress"
      style={{ width: size, height: size }}
    />
  )
}

/** "LIVE" badge for a scoreboard. */
export function LiveBadge() {
  return (
    <span className="bt-live-badge" role="img" aria-label="Games in progress">
      <span className="bt-live-dot" aria-hidden style={{ width: 6, height: 6 }} />
      <span aria-hidden>LIVE</span>
    </span>
  )
}
