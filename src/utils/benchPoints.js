// "Points left on the bench" — what your lineup actually scored vs. what the
// best lineup available to you that week would have scored.
//
// The lineup search itself is lineupOptimizer.js's job, not this file's. This
// supplies one basis — points actually scored that week, per Sleeper — and
// reads the result. That optimizer handles overlapping flex eligibility and
// suppresses cosmetic slot shuffles, which a plain greedy fill does not.

import { optimizeLineup } from './lineupOptimizer'

/**
 * Best lineup the roster could have fielded that week, against what it did.
 *
 * @param {{starters: string[], players: string[], playersPoints: Record<string, number>}} weekEntry
 *   one week from useSeasonMatchupHistory's weeklyByRoster
 * @param {{starters, benchCount}} slotTemplate - from parseRosterPositions
 * @param {Record<string, {id, position}>} playersById
 * @returns {{ actual: number, best: number, left: number, benchHeroes: Array<{id, points, delta}>, unranked: string[] }}
 *   `left` is clamped at 0 — a lineup can't beat the best available one.
 *   `benchHeroes` comes from the optimizer's swaps, so it lists only moves
 *   that would actually have gained points, not equal-value reshuffles.
 */
export function benchAnalysisForWeek(weekEntry, slotTemplate, playersById) {
  // A player Sleeper reported no score for is excluded rather than treated as
  // a zero — "didn't play" and "we have no number" are different claims, and
  // the optimizer reports the excluded ones back as `unranked`.
  const valueOf = (id) => {
    const v = weekEntry?.playersPoints?.[id]
    return typeof v === 'number' ? v : null
  }

  const r = optimizeLineup({
    currentStarterIds: weekEntry?.starters ?? [],
    playerIds: weekEntry?.players ?? [],
    template: slotTemplate,
    playersById,
    valueOf,
  })

  const actual = r.currentTotal ?? 0
  const best = r.proposedTotal ?? actual

  return {
    actual,
    best,
    left: Math.max(0, r.gain ?? 0),
    benchHeroes: r.swaps.map((s) => ({ id: s.inId, points: valueOf(s.inId) ?? 0, delta: s.delta })),
    unranked: r.unranked,
  }
}

/**
 * Season roll-up of benchAnalysisForWeek across every loaded week.
 * @param {Record<number, object>} weeksForRoster - weeklyByRoster[myRosterId]
 * @returns {{ totalLeft: number, byWeek: Array<{week, actual, best, left, benchHeroes, unranked}> }}
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
