// One player's week-by-week fantasy points, scored under the league's OWN
// scoring profile.
//
// This is the "actual" signal. It is a different claim from the 0-100 score
// everywhere else in the app, which is a percentile RANK of a season profile —
// that answers "how good is he", this answers "what did he do". The UI must
// never present them as the same number, which is why they carry different
// labels wherever both appear.

import { useState, useEffect, useMemo } from 'react'
import { getPlayerWeeks, getWeeklyManifest } from '../services/weeklyStatsService'
import { scoreWeeks, distribution } from '../utils/weeklyScoring'
import useScoringProfileStore from '../store/useScoringProfileStore'

export function usePlayerWeekly(player, season) {
  const activeProfile = useScoringProfileStore((s) => s.activeProfile)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [seasonMeta, setSeasonMeta] = useState(null)

  const gsisId = player?.gsisId ?? null
  const position = player?.position ?? null

  useEffect(() => {
    if (!gsisId || !season) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([getPlayerWeeks(gsisId, season), getWeeklyManifest().catch(() => null)])
      .then(([weeks, manifest]) => {
        if (cancelled) return
        setRows(weeks)
        setSeasonMeta(manifest?.seasons?.find((s) => s.season === Number(season)) ?? null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setRows([])
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [gsisId, season])

  // Re-scores whenever the league's profile changes — sync your scoring from
  // Sleeper and every number on the chart moves, which is the point.
  const scored = useMemo(
    () => scoreWeeks(rows, activeProfile, position),
    [rows, activeProfile, position]
  )
  const dist = useMemo(() => distribution(scored.weeks), [scored.weeks])

  return {
    weeks: rows,
    scored,
    distribution: dist,
    loading,
    error,
    hasData: scored.weeks.length > 0,
    seasonMeta,
    profileName: activeProfile?.name ?? null,
  }
}

/**
 * Which seasons have weekly data on disk, newest first. Backed by the manifest
 * so nothing ever 404-probes for a season the preprocess script hasn't written
 * (2026's stats aren't published until games are played).
 */
export function useWeeklySeasons() {
  const [seasons, setSeasons] = useState([])
  useEffect(() => {
    let cancelled = false
    getWeeklyManifest()
      .then((m) => { if (!cancelled) setSeasons(m.seasons ?? []) })
      .catch(() => { if (!cancelled) setSeasons([]) })
    return () => { cancelled = true }
  }, [])
  return seasons
}
