// Defense-vs-position, computed under the league's ACTIVE scoring profile.
// See weeklyAggregates.js for why this is runtime rather than pre-baked.

import { useState, useEffect, useMemo } from 'react'
import { loadWeeklySeason } from '../services/weeklyStatsService'
import { defenseVsPosition } from '../utils/weeklyAggregates'
import useScoringProfileStore from '../store/useScoringProfileStore'

export function useDefenseVsPosition(season, { weekRange, minGames } = {}) {
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!season) { setFile(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadWeeklySeason(season)
      .then((f) => { if (!cancelled) { setFile(f); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setFile(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [season])

  const lo = weekRange?.[0]
  const hi = weekRange?.[1]
  const dvp = useMemo(
    () => (file ? defenseVsPosition(file, activeProfile, {
      weekRange: lo != null && hi != null ? [lo, hi] : undefined,
      minGames,
    }) : null),
    [file, activeProfile, lo, hi, minGames]
  )

  return {
    dvp,
    loading,
    error,
    seasonMeta: file?._meta ?? null,
    profileName: activeProfile?.name ?? null,
  }
}
