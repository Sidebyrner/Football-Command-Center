// Falls back to Sleeper's raw player index for any drafted/rostered player id
// that isn't in the app's main player pool — currently that's every IDP
// (LB/DL/DB) player, since useDraftPlayers.js filters the live board down to
// QB/RB/WR/TE/K/DEF. Without this, an IDP pick would render as a blank row
// instead of a name. This does NOT add IDP players to the main board or
// score them — it only resolves identity for players that show up in real
// picks/rosters, same graceful "no model for this position" treatment
// evaluateDraft already gives DEF when it can't be scored.

import { useState, useEffect, useRef } from 'react'
import { getPlayerMeta } from '../services/sleeperService'

function normalizeRawPlayer(id, raw) {
  if (!raw) return null
  const name = raw.full_name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || id
  return { id, name, position: raw.position, team: raw.team || 'FA' }
}

/**
 * @param {string[]} missingIds - ids not present in the caller's main playersById
 * @returns {Record<string, {id, name, position, team}>}
 */
export function useMissingPlayerMeta(missingIds) {
  const [resolved, setResolved] = useState({})
  const inFlight = useRef(new Set())
  const key = missingIds.join(',')

  useEffect(() => {
    const toFetch = missingIds.filter((id) => id && !resolved[id] && !inFlight.current.has(id))
    if (!toFetch.length) return
    let cancelled = false
    for (const id of toFetch) inFlight.current.add(id)

    Promise.all(
      toFetch.map((id) => getPlayerMeta(id).then((raw) => [id, normalizeRawPlayer(id, raw)]))
    )
      .then((entries) => {
        if (cancelled) return
        setResolved((prev) => {
          const next = { ...prev }
          for (const [id, player] of entries) if (player) next[id] = player
          return next
        })
      })
      .finally(() => { for (const id of toFetch) inFlight.current.delete(id) })

    return () => { cancelled = true }
    // Deliberately keyed on the joined id string, not the array reference —
    // callers rebuild `missingIds` every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return resolved
}
