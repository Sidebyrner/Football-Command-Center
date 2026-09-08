// The league's real starter/bench slot template, parsed from Sleeper's
// roster_positions. Read live rather than assumed, so a settings change
// (e.g. an IDP requirement change) is picked up automatically next load —
// the same trust-the-league-over-a-guess pattern useLeagueScoring already
// established for scoring rules.

import { useState, useEffect } from 'react'
import { getLeagueSettings } from '../services/sleeperService'
import { parseRosterPositions } from '../utils/rosterSlots'

export function useLeagueRosterSettings(leagueId) {
  const [slotTemplate, setSlotTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    getLeagueSettings(leagueId)
      .then((league) => {
        if (cancelled) return
        setSlotTemplate(parseRosterPositions(league?.roster_positions))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [leagueId])

  return { slotTemplate, loading, error }
}
