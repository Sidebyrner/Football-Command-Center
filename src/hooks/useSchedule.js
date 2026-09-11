// This week's NFL slate from the free preprocessed schedule file. Lets the
// matchup planner name every starter's opponent with no Odds API key.

import { useState, useEffect, useMemo } from 'react'
import { loadSchedule, weekView } from '../services/scheduleService'

export function useSchedule(season, week) {
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!season) { setFile(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    loadSchedule(season)
      .then((f) => { if (!cancelled) { setFile(f); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setFile(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [season])

  const view = useMemo(() => (file ? weekView(file, week) : { byTeam: {}, games: [] }), [file, week])

  return { byTeam: view.byTeam, games: view.games, loading, error, hasSchedule: !!file }
}
