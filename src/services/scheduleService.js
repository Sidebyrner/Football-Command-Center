// NFL schedule — who plays whom, per week.
//
// Emitted by scripts/preprocess-nflverse.mjs from nfldata's games.csv. Without
// it, the only source of "who does BUF play in week 1" is the paid Odds API,
// which would mean the matchup planner couldn't name your opponent without a
// key. This file is ~27 KB and costs nothing.
//
// It also carries nfldata's own market lines (spreadLine, totalLine) as a free
// fallback when no Odds API key is configured. Those are NOT live odds — they
// are the lines nfldata last recorded — so anything built on them must say so.

const cache = new Map()
const promises = new Map()

export async function loadSchedule(season) {
  const key = String(season)
  if (cache.has(key)) return cache.get(key)
  if (promises.has(key)) return promises.get(key)

  const p = fetch(`/data/schedule-${key}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`No schedule for ${key} (${r.status})`)
      return r.json()
    })
    .then((file) => { cache.set(key, file); promises.delete(key); return file })
    .catch((err) => { promises.delete(key); throw err })

  promises.set(key, p)
  return p
}

/**
 * Flatten one week into a per-team view.
 * @returns {{ byTeam: Record<abbr, {opponent, isHome, kickoff, spreadLine, totalLine, impliedTotal}>,
 *             games: Array }}
 *
 * `spreadLine` follows nfldata's convention — POSITIVE means the HOME team is
 * favored, the opposite sign from The Odds API's home_spread. The conversion
 * happens here, once, rather than at every call site.
 */
export function weekView(scheduleFile, week) {
  const games = scheduleFile?.byWeek?.[String(week)] ?? []
  const byTeam = {}
  for (const g of games) {
    const total = g.totalLine
    const line = g.spreadLine
    // implied = total/2 ± margin/2. Home favored by `line` means home is
    // expected to score half the margin more than an even split.
    const homeImplied = total != null && line != null ? total / 2 + line / 2 : null
    const awayImplied = total != null && line != null ? total / 2 - line / 2 : null
    byTeam[g.home] = {
      opponent: g.away, isHome: true, kickoff: g.kickoff, time: g.time,
      spreadLine: line == null ? null : -line, // to Odds-API sign: negative = favored
      totalLine: total, impliedTotal: homeImplied,
    }
    byTeam[g.away] = {
      opponent: g.home, isHome: false, kickoff: g.kickoff, time: g.time,
      spreadLine: line == null ? null : line,
      totalLine: total, impliedTotal: awayImplied,
    }
  }
  return { byTeam, games }
}
