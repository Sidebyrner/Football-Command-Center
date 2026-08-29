// Loads the positional percentile cohorts once per session.
// The underlying service memoises the fetch, so mounting this in many drawers
// costs one network request total.

import { useState, useEffect } from 'react'
import { loadCohorts } from '../services/cohortService'

export function useCohorts() {
  const [cohorts, setCohorts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadCohorts()
      .then((c) => { if (!cancelled) { setCohorts(c); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  return { cohorts, loading, error }
}
