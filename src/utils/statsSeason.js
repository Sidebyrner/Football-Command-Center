// Which season's weekly production to score against.
//
// Early in a year the current season has a week or two of games — too thin to
// average: one game is a noisy floor and ceiling and a meaningless season pace.
// So the stats season is the newest season in the weekly manifest with at least
// three weeks of games, falling back to the newest available. Three matches the
// minimum games a player needs to set a positional line. Same rule as the iOS app.

export const MIN_WEEKS_FOR_STATS_SEASON = 3

/** Weeks of games a manifest entry covers (18 for a complete season). */
export function weeksPlayed(entry) {
  return Number(entry?.weeks ?? entry?.latestWeek ?? 0)
}

/**
 * @param {Array<{season:number, weeks?:number, latestWeek?:number}>} manifestSeasons
 * @param {number|string|null} scheduleSeason the season Sleeper says is current
 * @returns {{ statsSeason: number|null, currentSeasonWeeks: number }}
 */
export function pickStatsSeason(manifestSeasons, scheduleSeason) {
  const current = scheduleSeason == null ? null : Number(scheduleSeason)
  const eligible = (manifestSeasons ?? [])
    .filter((s) => current == null || Number(s.season) <= current)
    .sort((a, b) => Number(b.season) - Number(a.season))
  const currentSeasonWeeks = weeksPlayed((manifestSeasons ?? []).find((s) => Number(s.season) === current))
  const choice = eligible.find((s) => weeksPlayed(s) >= MIN_WEEKS_FOR_STATS_SEASON) ?? eligible[0]
  return { statsSeason: choice ? Number(choice.season) : null, currentSeasonWeeks }
}

/** What the page says when production isn't from the current season, or null. */
export function statsSeasonNote({ statsSeason, scheduleSeason, currentSeasonWeeks }) {
  if (statsSeason == null || scheduleSeason == null || Number(statsSeason) === Number(scheduleSeason)) return null
  if (!currentSeasonWeeks) {
    return `Production is from ${statsSeason}, not ${scheduleSeason} — there's no ${scheduleSeason} weekly data yet. It's the best available evidence, but it's last year's.`
  }
  return `Production is from ${statsSeason} until ${scheduleSeason} has ${MIN_WEEKS_FOR_STATS_SEASON} weeks of games (it has ${currentSeasonWeeks}) — a week or two is too thin to average.`
}
