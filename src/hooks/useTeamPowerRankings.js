// Season-mode team grading, shared between Trade Analyzer and Power
// Rankings — extracted from TradeAnalyzer.jsx so both pages compute this
// exactly once, the same way. Grades every team's real current roster
// (computeAllTeamGrades in season mode: average score + roster-construction,
// no draft pick-number concept) and resolves IDP player identity, which the
// main board's player pool doesn't cover.

import { useMemo } from 'react'
import { computeAllTeamGrades } from '../utils/teamGrades'
import { useDraftPlayers } from './useDraftPlayers'
import { useCohorts } from './useCohorts'
import { usePlayerScores } from './usePlayerScores'
import { useLeagueTeamRosters } from './useLeagueTeamRosters'
import { useLeagueRosterSettings } from './useLeagueRosterSettings'
import { useMissingPlayerMeta } from './useMissingPlayerMeta'
import { isMyTeam } from '../utils/leagueTeams'

/**
 * @returns {{ teams: Array, playersById: Record<string, object>, loading: boolean, error: string|null }}
 *   `teams` is sorted by composite score descending, same shape
 *   computeAllTeamGrades produces (score, grade, valueScore,
 *   constructionScore, lineupScore, neededPositions, benchByPosition,
 *   rosterId, starterIds, ...). `scores` and `slotTemplate` are the composed
 *   inputs, re-exported for callers that need them directly.
 */
export function useTeamPowerRankings(leagueId, sleeperUserId) {
  const { players, loading: playersLoading } = useDraftPlayers()
  const { cohorts } = useCohorts()
  const { scores, loading: scoring } = usePlayerScores(players, cohorts)
  const { teams: rosters, loading: rostersLoading, error: rostersError } = useLeagueTeamRosters(leagueId)
  const { slotTemplate, loading: settingsLoading } = useLeagueRosterSettings(leagueId)

  const playersById = useMemo(() => {
    const map = {}
    for (const p of players) map[p.id] = p
    return map
  }, [players])

  // Real rosters in an IDP league will always include LB/DL/DB — none of
  // which are in the main board's player pool. Resolve them separately.
  const missingIds = useMemo(() => {
    const ids = new Set()
    for (const t of rosters) for (const id of t.playerIds) if (!playersById[id]) ids.add(id)
    return [...ids]
  }, [rosters, playersById])
  const idpMeta = useMissingPlayerMeta(missingIds)
  const mergedPlayersById = useMemo(() => ({ ...playersById, ...idpMeta }), [playersById, idpMeta])

  const teamsInput = useMemo(
    () => rosters.map((t) => ({ ...t, isMe: isMyTeam(t, sleeperUserId) })),
    [rosters, sleeperUserId]
  )

  const teams = useMemo(() => {
    if (!slotTemplate || !teamsInput.length) return []
    return computeAllTeamGrades(teamsInput, { scores, playersById: mergedPlayersById, slotTemplate })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  }, [teamsInput, scores, mergedPlayersById, slotTemplate])

  const loading = playersLoading || scoring || rostersLoading || settingsLoading

  // scores and slotTemplate are exposed additively for the Matchup Planner,
  // which needs the same composed data plus the per-player scores and the
  // league's slot shape. Existing callers ignore the extra keys.
  return { teams, playersById: mergedPlayersById, scores, slotTemplate, loading, error: rostersError }
}
