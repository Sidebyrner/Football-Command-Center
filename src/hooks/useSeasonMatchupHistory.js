// Season-long fantasy matchup history — one shared fetch across weeks
// feeding both "draft value realized" (actual points per player) and
// "weekly scoring trend" (actual points per roster per week), rather than
// each feature re-fetching the same weeks. getLeagueMatchups already existed
// (cached per-week in sleeperService.js) but nothing looped across weeks to
// build season history before this.
//
// NOT interchangeable with useRosterWeekly, which also returns weekly points.
// Pick by what you need:
//
//   this hook (Sleeper matchups)   useRosterWeekly (nflverse weekly file)
//   ---------------------------    --------------------------------------
//   league's own official scoring   scored at runtime from the profile
//   covers DEF and IDP             no DEF/IDP rows exist upstream
//   who was actually STARTED       no concept of a Sleeper lineup
//   roster-level weekly totals     per-player only
//   rostered players only          every player, rostered or not
//   totals only                    floor/median/ceiling/CV, last-N form
//
// So: lineup decisions, team totals, and anything that must include DEF/IDP
// come from here. Player-level distributions and free-agent comparisons come
// from useRosterWeekly.

import { useState, useEffect } from 'react'
import { getLeagueMatchupsHistorical } from '../services/sleeperService'

/**
 * @param {string} leagueId
 * @param {number} throughWeek - last week to include (inclusive). Callers
 *   pass `currentWeek - 1` so the in-progress current week (covered live by
 *   the Matchup card) doesn't pollute a season aggregate with partial data.
 * @returns {{
 *   actualPointsByPlayer: Record<string, number>,
 *   weeklyTotalsByRoster: Record<number, Record<number, number>>,
 *   weeklyByRoster: Record<number, Record<number, {points, starters, players, playersPoints}>>,
 *   weeksLoaded: number[],
 *   loading: boolean,
 *   error: string|null,
 * }}
 */
export function useSeasonMatchupHistory(leagueId, throughWeek) {
  const [actualPointsByPlayer, setActualPointsByPlayer] = useState({})
  const [weeklyTotalsByRoster, setWeeklyTotalsByRoster] = useState({})
  const [weeklyByRoster, setWeeklyByRoster] = useState({})
  const [weeksLoaded, setWeeksLoaded] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!leagueId || !throughWeek || throughWeek < 1) {
      setActualPointsByPlayer({})
      setWeeklyTotalsByRoster({})
      setWeeklyByRoster({})
      setWeeksLoaded([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)

    const weeks = Array.from({ length: throughWeek }, (_, i) => i + 1)

    Promise.all(weeks.map((week) => getLeagueMatchupsHistorical(leagueId, week).then((data) => [week, data])))
      .then((results) => {
        if (cancelled) return

        const pointsByPlayer = {}
        const totalsByRoster = {}
        const weekly = {}
        const loaded = []

        for (const [week, matchups] of results) {
          if (!matchups?.length) continue
          loaded.push(week)
          for (const m of matchups) {
            if (m.roster_id != null) {
              totalsByRoster[m.roster_id] ??= {}
              totalsByRoster[m.roster_id][week] = m.points ?? 0

              // Kept per-week (not just summed) so bench analysis can compare
              // who was actually started against who was available.
              weekly[m.roster_id] ??= {}
              weekly[m.roster_id][week] = {
                points: m.points ?? 0,
                starters: m.starters ?? [],
                players: m.players ?? [],
                playersPoints: m.players_points ?? {},
              }
            }
            for (const [playerId, pts] of Object.entries(m.players_points ?? {})) {
              pointsByPlayer[playerId] = (pointsByPlayer[playerId] ?? 0) + (pts ?? 0)
            }
          }
        }

        setActualPointsByPlayer(pointsByPlayer)
        setWeeklyTotalsByRoster(totalsByRoster)
        setWeeklyByRoster(weekly)
        setWeeksLoaded(loaded.sort((a, b) => a - b))
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [leagueId, throughWeek])

  return { actualPointsByPlayer, weeklyTotalsByRoster, weeklyByRoster, weeksLoaded, loading, error }
}
