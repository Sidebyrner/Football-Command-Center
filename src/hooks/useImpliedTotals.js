// One way to ask "what's this team's implied total this week," regardless of
// whether the user has paid for an Odds API key.
//
// Two sources exist: live lines from The Odds API, and the recorded lines
// nfldata ships alongside the preprocessed schedule. Odds.jsx already prefers
// live and falls back to the schedule file; this puts that same preference
// behind one hook so the Dashboard and Power Rankings don't each reimplement
// it — or worse, show "no key" for a number the app can already produce for
// free.

import { useEffect, useMemo } from 'react'
import { useOdds } from './useOdds'
import { useSchedule } from './useSchedule'
import { makeImpliedResolver } from '../utils/oddsHelpers'
import { toNflverseTeam } from '../utils/nflTeams'
import useAppStore from '../store/useAppStore'

/**
 * @param {number} week
 * @returns {{
 *   impliedForTeam: (teamAbbr: string) => number|null,
 *   source: 'live'|'schedule'|null,
 *   loading: boolean,
 * }}
 *   `source` is null when neither is available, so callers can say why a
 *   number is missing instead of rendering a bare dash.
 */
export function useImpliedTotals(week) {
  const oddsApiKey = useAppStore((s) => s.oddsApiKey)
  const season = useAppStore((s) => s.season)

  const { odds, loading: oddsLoading, fetchOdds } = useOdds(oddsApiKey)
  const { byTeam, loading: scheduleLoading } = useSchedule(season, week)

  // useOdds is manual-trigger by design (it's a quota'd call). Deciding that
  // "page load counts as asking" used to be copy-pasted into every page that
  // wanted odds; it lives here now.
  useEffect(() => {
    if (oddsApiKey && odds.length === 0) fetchOdds()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsApiKey])

  return useMemo(() => {
    const hasLive = odds.length > 0
    const hasSchedule = byTeam && Object.keys(byTeam).length > 0

    return {
      // Schedule data is nflverse-keyed (LA, not LAR), so translate on the way in.
      impliedForTeam: makeImpliedResolver(odds, byTeam, toNflverseTeam),
      source: hasLive ? 'live' : hasSchedule ? 'schedule' : null,
      loading: oddsLoading || scheduleLoading,
    }
  }, [odds, byTeam, oddsLoading, scheduleLoading])
}
