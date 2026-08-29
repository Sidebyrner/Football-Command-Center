// Scores every player on the board, not just whichever one is open in the
// drawer. Before this hook, evaluateDraft only ran inside PlayerDrawer — the
// model never influenced the primary surface, sorting, or filtering.
//
// Reuses getPlayerSeasonHistory's existing memoized index fetch (one network
// round trip total, shared with usePlayerStats) rather than duplicating it.

import { useState, useEffect } from 'react'
import { getPlayerSeasonHistory, toEvalMetrics } from '../services/nflverseService'
import { evaluateDraft } from '../utils/evaluationEngine'
import useScoringProfileStore from '../store/useScoringProfileStore'

async function scoreOne(player, profile, cohorts) {
  if (!player.gsisId) {
    return evaluateDraft(player, profile, null, cohorts)
  }
  const history = await getPlayerSeasonHistory(player.gsisId)
  const seasons = history ? Object.keys(history).map(Number).sort((a, b) => b - a) : []
  const metrics = seasons.length ? toEvalMetrics(history[String(seasons[0])]) : null
  return evaluateDraft(player, profile, metrics, cohorts)
}

/**
 * @param {Array} players  from useDraftPlayers
 * @param {object|null} cohorts  from useCohorts — scoring waits for this
 * @returns {{ scores: Record<string, DraftResult>, loading: boolean }}
 */
export function usePlayerScores(players, cohorts) {
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const [scores, setScores] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!players?.length || !cohorts) {
      setLoading(!cohorts) // still waiting on cohorts; empty player list just means nothing to score
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all(
      players.map((p) => scoreOne(p, activeProfile, cohorts).then((result) => [p.id, result]))
    ).then((entries) => {
      if (cancelled) return
      setScores(Object.fromEntries(entries))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [players, activeProfile, cohorts])

  return { scores, loading }
}
