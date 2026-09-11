import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import { getPositionColor } from '../../utils/playerHelpers'
import { useTrendingAdds } from '../../hooks/useTrendingAdds'
import { useMissingPlayerMeta } from '../../hooks/useMissingPlayerMeta'

const MAX_SHOWN = 6

/**
 * Trending adds league-wide, filtered down to players actually available in
 * YOUR league (nobody's roster has them) and flagged when they fill a
 * position you're short at. The Waiver Wire card says what happened; this
 * says what to do about it.
 */
export default function WaiverTargets({ teams, myTeam, playersById }) {
  const { trending, loading, error } = useTrendingAdds()

  // Sleeper's trending list is league-agnostic, so most names won't be in the
  // draft board's filtered pool (and IDP never is) — resolve the gaps.
  const missingIds = useMemo(
    () => trending.map((t) => t.player_id).filter((id) => id && !playersById[id]),
    [trending, playersById]
  )
  const extraMeta = useMissingPlayerMeta(missingIds)

  const rosteredIds = useMemo(() => {
    const set = new Set()
    for (const t of teams) for (const id of t.playerIds) set.add(id)
    return set
  }, [teams])

  const needs = useMemo(() => {
    if (!myTeam) return new Set()
    return new Set([...(myTeam.neededPositions ?? []), ...(myTeam.openFlexEligible ?? [])])
  }, [myTeam])

  const targets = useMemo(() => {
    return trending
      .filter((t) => t.player_id && !rosteredIds.has(t.player_id))
      .map((t) => {
        const p = playersById[t.player_id] ?? extraMeta[t.player_id]
        return p ? { ...p, adds: t.count, fillsNeed: needs.has(p.position) } : null
      })
      .filter(Boolean)
      .sort((a, b) => (b.fillsNeed - a.fillsNeed) || (b.adds - a.adds))
      .slice(0, MAX_SHOWN)
  }, [trending, rosteredIds, playersById, extraMeta, needs])

  if (loading) return <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
  if (error) return <p className="text-sm text-[var(--color-sit)]">Failed to load trending players: {error}</p>
  if (targets.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Nothing trending is currently unrostered in your league.
      </p>
    )
  }

  return (
    <ul className="space-y-1.5">
      {targets.map((p) => (
        <li key={p.id} className="flex items-center gap-2 text-xs">
          <span className="font-semibold w-8 flex-shrink-0" style={{ color: getPositionColor(p.position) }}>
            {p.position ?? '?'}
          </span>
          <span className="flex-1 min-w-0 truncate text-[var(--color-text)]">{p.name}</span>
          {p.fillsNeed && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--color-start)]/15 text-[var(--color-start)] flex-shrink-0">
              FILLS NEED
            </span>
          )}
          <span className="flex items-center gap-1 text-[var(--color-text-faint)] tabular-nums flex-shrink-0">
            <TrendingUp size={10} />
            {p.adds.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  )
}
