// Actual weekly production for a whole set of players at once.
//
// usePlayerWeekly loads one player for a drawer; the matchup planner needs
// ~30 players across two rosters. Both read the same memoised season file, so
// this is one fetch and one scoring pass, not thirty.
//
// NOT interchangeable with useSeasonMatchupHistory, which also returns weekly
// points but from Sleeper's own matchup records. This hook wins for
// per-player distributions (floor/median/ceiling/CV, last-N form) and covers
// every player whether rostered or not. It cannot answer who was actually
// started in a given week, cannot give roster-level totals, and has no DEF or
// IDP rows at all — nflverse doesn't publish them. Anything that needs those
// goes through useSeasonMatchupHistory instead; the full comparison table is
// in that file's header.

import { useState, useEffect, useMemo } from 'react'
import { loadWeeklySeason } from '../services/weeklyStatsService'
import { decodeRow } from '../services/weeklyStatsService'
import { scoreWeeks, distribution } from '../utils/weeklyScoring'
import useScoringProfileStore from '../store/useScoringProfileStore'

/**
 * @param {string[]} playerIds sleeper ids
 * @param {Record<string, object>} playersById must carry gsisId and position
 * @param {number} season
 * @param {{lastN?: number}} opts lastN restricts to the most recent N weeks —
 *   "form" rather than "season", which is a different basis, not a better one.
 * @returns {{byPlayer: Record<sleeperId, {perGame, floor, median, ceiling, cv, n, weeks}>,
 *            loading, error, season, profileName}}
 */
export function useRosterWeekly(playerIds, playersById, season, { lastN } = {}) {
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

  // Stable key so a new array identity per render doesn't re-score everything.
  const idKey = (playerIds ?? []).join(',')

  const byPlayer = useMemo(() => {
    if (!file) return {}
    const out = {}
    for (const id of playerIds ?? []) {
      if (!id || id === '0') continue
      const p = playersById?.[id]
      const tuples = p?.gsisId ? file.players?.[p.gsisId] : null
      if (!tuples) continue
      let rows = tuples.map((t) => decodeRow(file.fields, t)).sort((a, b) => a.week - b.week)
      if (lastN) rows = rows.slice(-lastN)
      const scored = scoreWeeks(rows, activeProfile, p.position)
      if (!scored.weeks.length) continue
      const d = distribution(scored.weeks)
      out[id] = {
        perGame: scored.perGame, total: scored.total, n: scored.games,
        floor: d.floor, median: d.median, ceiling: d.ceiling, cv: d.cv,
        weeks: scored.weeks,
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, idKey, playersById, activeProfile, lastN])

  return { byPlayer, loading, error, season, profileName: activeProfile?.name ?? null }
}
