// Pulls the league's real scoring rules from Sleeper and adopts them.
//
// Replaces the hardcoded DEFAULT_PROFILE, which asserted a specific and unusual
// ruleset (non-PPR, -1 per incompletion, IDP) that may bear no relation to the
// user's actual league. Sleeper publishes the real thing for free.

import { useState, useCallback } from 'react'
import { getLeagueScoringSettings } from '../services/sleeperService'
import { profileFromSleeperScoring } from '../utils/sleeperScoring'
import useScoringProfileStore from '../store/useScoringProfileStore'

export function useLeagueScoring() {
  const applyLeagueScoring = useScoringProfileStore((s) => s.applyLeagueScoring)
  const setSyncError = useScoringProfileStore((s) => s.setSyncError)
  const [loading, setLoading] = useState(false)

  const syncFromLeague = useCallback(async (leagueId, leagueName) => {
    if (!leagueId) return null
    setLoading(true)
    try {
      const scoring = await getLeagueScoringSettings(leagueId)
      if (!scoring || Object.keys(scoring).length === 0) {
        setSyncError('This league returned no scoring settings.')
        return null
      }
      const result = profileFromSleeperScoring(scoring, leagueName)
      applyLeagueScoring(result)
      return result
    } catch (err) {
      setSyncError(err.message)
      return null
    } finally {
      setLoading(false)
    }
  }, [applyLeagueScoring, setSyncError])

  return { syncFromLeague, loading }
}
