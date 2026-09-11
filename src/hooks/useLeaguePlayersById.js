// Position and team for every player rostered anywhere in the league.
//
// useTeamPowerRankings already produces this, but only as a by-product of
// running the whole evaluateDraft pipeline over ~1,500 players. Anything that
// needs names and positions rather than scores — bye outlook, roster status —
// should not pay for that.

import { useMemo } from 'react'
import { useDraftPlayers } from './useDraftPlayers'
import { useMissingPlayerMeta } from './useMissingPlayerMeta'

/**
 * @param {Array<{playerIds: string[]}>} rosters - useLeagueTeamRosters' teams
 * @returns {{ playersById: Record<string, object>, loading: boolean }}
 *   Includes IDP, which useDraftPlayers filters out of the board entirely.
 */
export function useLeaguePlayersById(rosters) {
  const { players, loading } = useDraftPlayers()

  const basePlayersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
  }, [players])

  const missingIds = useMemo(() => {
    const ids = new Set()
    for (const t of rosters ?? []) {
      for (const id of t.playerIds ?? []) {
        if (id && id !== '0' && !basePlayersById[id]) ids.add(id)
      }
    }
    return [...ids]
  }, [rosters, basePlayersById])

  const extra = useMissingPlayerMeta(missingIds)

  const playersById = useMemo(
    () => ({ ...basePlayersById, ...extra }),
    [basePlayersById, extra]
  )

  return { playersById, loading }
}
