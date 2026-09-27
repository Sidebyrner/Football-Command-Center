/**
 * The lineup readiness ring and card — a port of `MyTeam/ReadinessCard.swift`.
 * Counts of slots, never a grade.
 */
import { BadgeCheck } from 'lucide-react'
import { isAllClear, type LineupReadiness } from '@models/team/MyTeamModel'
import './team.css'

/**
 * The readiness counts as a segmented ring — ready, already kicked off,
 * questionable, needing a fix — with the set count in the middle.
 */
export function ReadinessRing({ readiness, size = 72, lineWidth = 9 }: { readiness: LineupReadiness; size?: number; lineWidth?: number }) {
  const segments: [number, string][] = [
    [readiness.ready, 'var(--start)'],
    [readiness.settled, 'color-mix(in srgb, var(--text-2) 45%, transparent)'],
    [readiness.caution, 'var(--caution)'],
    [readiness.problems, 'var(--sit)'],
  ]
  const total = Math.max(1, readiness.slots)
  const radius = (size - lineWidth) / 2
  const circumference = 2 * Math.PI * radius
  let start = 0
  return (
    <span className="bt-ring" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--inset)" strokeWidth={lineWidth} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map(([count, color], index) => {
            const from = start
            start += count
            if (count <= 0) return null
            const length = (count / total) * circumference
            return (
              <circle
                key={index}
                className="bt-ring-segment"
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={color} strokeWidth={lineWidth}
                strokeDasharray={`${length} ${circumference}`}
                strokeDashoffset={-(from / total) * circumference}
              />
            )
          })}
        </g>
      </svg>
      <span className="bt-ring-center">
        <span className="bt-ring-count" style={{ fontSize: size * 0.3 }}>{readiness.ready + readiness.settled}</span>
        <span className="bt-ring-of">of {readiness.slots}</span>
      </span>
    </span>
  )
}

function accessibilitySummary(r: LineupReadiness): string {
  if (isAllClear(r)) return 'Lineup set. Nothing to fix before kickoff.'
  return `${r.ready + r.settled} of ${r.slots} slots set. ${r.problems} need fixing, ${r.caution} questionable. Opens Sit/Start.`
}

function LegendRow({ color, text }: { color: string; text: string }) {
  return (
    <span className="bt-legend-row t-meta muted">
      <span className="bt-legend-dot" style={{ background: color }} aria-hidden />
      {text}
    </span>
  )
}

export function ReadinessCard({ readiness, onFix }: { readiness: LineupReadiness; onFix: () => void }) {
  const clear = isAllClear(readiness)
  return (
    <button type="button" className="card bt-pressable bt-readiness-card" onClick={onFix} aria-label={accessibilitySummary(readiness)}>
      <ReadinessRing readiness={readiness} />
      <span className="bt-readiness-text">
        {clear ? (
          <>
            <span className="t-section bt-readiness-set"><BadgeCheck size={18} aria-hidden /> Lineup set</span>
            <span className="t-body muted">Nothing to fix before kickoff.</span>
          </>
        ) : (
          <>
            <span className="t-section">Lineup readiness</span>
            <span className="bt-legend">
              {readiness.problems > 0 && <LegendRow color="var(--sit)" text={`${readiness.problems} need fixing — empty, bye or out`} />}
              {readiness.caution > 0 && <LegendRow color="var(--caution)" text={`${readiness.caution} questionable`} />}
              {readiness.settled > 0 && <LegendRow color="color-mix(in srgb, var(--text-2) 60%, transparent)" text={`${readiness.settled} already kicked off`} />}
            </span>
            <span className="t-meta bt-accent-link">Fix in Sit/Start →</span>
          </>
        )}
      </span>
    </button>
  )
}
