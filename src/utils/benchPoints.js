// "Points left on the bench" — what your lineup actually scored vs. what the
// best lineup available to you that week would have scored.
//
// Pure functions, no React/Sleeper imports: callers hand in one week's
// already-fetched matchup entry plus the league's slot template.

import { assignPicksToSlots } from './rosterSlots'

/**
 * Best lineup the roster could have fielded that week.
 *
 * Approximation, deliberately: players are sorted by points scored and then
 * greedily slotted, which is what fantasy sites generally mean by "optimal."
 * It can be a hair under true optimal when a flex-eligible player could have
 * filled either of two slots, so this is labelled "best available" in the UI
 * rather than claimed as provably optimal.
 *
 * @param {{starters: string[], players: string[], playersPoints: Record<string, number>}} weekEntry
 * @param {{starters, benchCount}} slotTemplate - from parseRosterPositions
 * @param {Record<string, {id, position}>} playersById
 * @returns {{ actual: number, best: number, left: number, benchHeroes: Array<{id, points}> }}
 *   `left` is clamped at 0 — a lineup can't beat the best available one, and a
 *   negative would only ever mean missing player metadata, not a real result.
 */
export function benchAnalysisForWeek(weekEntry, slotTemplate, playersById) {
  const pts = (id) => weekEntry?.playersPoints?.[id] ?? 0

  const startedIds = (weekEntry?.starters ?? []).filter((id) => id && id !== '0')
  const actual = startedIds.reduce((sum, id) => sum + pts(id), 0)

  const rosterIds = (weekEntry?.players ?? []).filter((id) => id && id !== '0')
  const byPointsDesc = [...rosterIds].sort((a, b) => pts(b) - pts(a))

  const { slots } = assignPicksToSlots(byPointsDesc, slotTemplate, playersById)
  const bestIds = slots.filter((s) => s.filled).map((s) => s.filled.id)
  const best = bestIds.reduce((sum, id) => sum + pts(id), 0)

  // Who should have started but didn't — the actionable part of the number.
  const startedSet = new Set(startedIds)
  const benchHeroes = bestIds
    .filter((id) => !startedSet.has(id))
    .map((id) => ({ id, points: pts(id) }))
    .sort((a, b) => b.points - a.points)

  return { actual, best, left: Math.max(0, best - actual), benchHeroes }
}

/**
 * Season roll-up of benchAnalysisForWeek across every loaded week.
 * @param {Record<number, object>} weeksForRoster - weeklyByRoster[myRosterId]
 * @returns {{ totalLeft: number, byWeek: Array<{week, actual, best, left, benchHeroes}> }}
 */
export function benchAnalysisForSeason(weeksForRoster, slotTemplate, playersById) {
  const byWeek = Object.entries(weeksForRoster ?? {})
    .map(([week, entry]) => ({
      week: Number(week),
      ...benchAnalysisForWeek(entry, slotTemplate, playersById),
    }))
    .sort((a, b) => a.week - b.week)

  return { totalLeft: byWeek.reduce((sum, w) => sum + w.left, 0), byWeek }
}
