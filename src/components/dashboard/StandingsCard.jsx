import { useMemo } from 'react'

/**
 * League standings, from data Sleeper already returns with every roster
 * fetch (settings.wins/losses/fpts) — no extra request. Sorted the way a
 * league table is: record first, points for as the tiebreak.
 */
export default function StandingsCard({ teams, loading, error }) {
  const standings = useMemo(() => {
    return [...teams]
      .filter((t) => t.record)
      .sort((a, b) => {
        const winDiff = (b.record.wins ?? 0) - (a.record.wins ?? 0)
        if (winDiff !== 0) return winDiff
        const tieDiff = (b.record.ties ?? 0) - (a.record.ties ?? 0)
        if (tieDiff !== 0) return tieDiff
        return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
      })
  }, [teams])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load standings: {error}</p>
  if (standings.length === 0) return <p className="text-sm text-[var(--color-text-muted)]">No standings yet.</p>

  return (
    <ul className="space-y-1">
      {standings.map((t, i) => (
        <li
          key={t.id}
          className={`flex items-center gap-2 text-xs px-1.5 py-1 rounded ${
            t.isMe ? 'bg-[var(--color-surface-2)]' : ''
          }`}
        >
          <span className="w-4 text-[var(--color-text-faint)] tabular-nums flex-shrink-0">{i + 1}</span>
          <span className="flex-1 min-w-0 truncate text-[var(--color-text)]">
            {t.name}{t.isMe ? ' (you)' : ''}
          </span>
          <span className="tabular-nums text-[var(--color-text)] flex-shrink-0">
            {t.record.wins}-{t.record.losses}{t.record.ties ? `-${t.record.ties}` : ''}
          </span>
          <span className="tabular-nums text-[var(--color-text-faint)] w-14 text-right flex-shrink-0">
            {t.pointsFor.toFixed(1)}
          </span>
        </li>
      ))}
    </ul>
  )
}
