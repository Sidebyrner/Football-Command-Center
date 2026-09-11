import { AlertTriangle, CalendarX } from 'lucide-react'
import { getStatusColor, getStatusLabel } from '../../utils/playerHelpers'

/**
 * "Can I still fix something before kickoff" — the first thing on the page.
 * Flags starters on bye (a guaranteed zero, so listed first), starters whose
 * injury status isn't clean, and slots still unset on Sleeper (the "0"
 * placeholder RosterCard already filters out). Renders nothing when there's
 * nothing to flag, same convention ScarcityIndicator.jsx already uses.
 */
export default function LineupAlerts({ myTeam, playersById, currentWeek }) {
  if (!myTeam) return null

  const realStarterIds = myTeam.starterIds.filter((id) => id && id !== '0')
  const emptyStarterCount = myTeam.starterIds.length - realStarterIds.length
  const starters = realStarterIds.map((id) => playersById[id]).filter(Boolean)

  // Bye weeks reach players via FantasyPros ADP data, which doesn't cover
  // IDP — so an LB/DL/DB would silently never be flagged. A bye is a property
  // of the NFL team, not the player, so derive team -> bye from whoever does
  // carry it and fall back to that. Costs nothing and closes the IDP hole.
  const byeByTeam = {}
  for (const p of Object.values(playersById)) {
    if (p?.team && p.bye != null) byeByTeam[p.team] ??= p.bye
  }
  const byeFor = (p) => p.bye ?? byeByTeam[p.team] ?? null

  // A starter on bye scores nothing at all — more urgent than any injury tag.
  const onBye = currentWeek ? starters.filter((p) => byeFor(p) === currentWeek) : []
  const injured = starters.filter((p) => getStatusColor(p.injuryStatus) !== 'var(--color-start)')

  if (onBye.length === 0 && injured.length === 0 && emptyStarterCount === 0) return null

  return (
    <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-caution)]/5 px-6 py-3 space-y-1.5">
      {onBye.map((p) => (
        <div key={`bye-${p.id}`} className="flex items-center gap-2 text-xs">
          <CalendarX size={13} className="flex-shrink-0 text-[var(--color-sit)]" />
          <span className="text-[var(--color-text)] font-medium">{p.name}</span>
          <span className="text-[var(--color-sit)]">on bye this week — starting them scores 0</span>
        </div>
      ))}

      {emptyStarterCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-caution)]">
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span>
            {emptyStarterCount} starter slot{emptyStarterCount > 1 ? 's' : ''} not set yet on Sleeper.
          </span>
        </div>
      )}

      {injured.map((p) => (
        <div key={`inj-${p.id}`} className="flex items-center gap-2 text-xs">
          <AlertTriangle size={13} className="flex-shrink-0" style={{ color: getStatusColor(p.injuryStatus) }} />
          <span className="text-[var(--color-text)] font-medium">{p.name}</span>
          <span style={{ color: getStatusColor(p.injuryStatus) }}>{getStatusLabel(p.injuryStatus)}</span>
        </div>
      ))}
    </div>
  )
}
