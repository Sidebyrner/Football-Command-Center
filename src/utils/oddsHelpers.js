// Shared odds-line math — used by the Odds page (every game) and Sit/Start
// (just the games touching your roster's players). Kept separate from
// oddsApi.js (which only fetches) so both pages parse a game the same way.

import { calcImpliedTotal } from './playerHelpers'
import { abbrFromOddsTeamName } from './nflTeams'

// The Odds API returns one entry per bookmaker; use whichever bookmaker in
// the list happens to carry a given market first rather than requiring a
// specific book — coverage varies by book and by week.
export function findMarket(game, key) {
  for (const bk of game.bookmakers ?? []) {
    const m = bk.markets?.find((mm) => mm.key === key)
    if (m) return m
  }
  return null
}

export function gameLine(game) {
  const spreads = findMarket(game, 'spreads')
  const totals = findMarket(game, 'totals')
  const total = totals?.outcomes?.find((o) => o.name === 'Over')?.point ?? null
  const homeSpread = spreads?.outcomes?.find((o) => o.name === game.home_team)?.point ?? null
  const awaySpread = spreads?.outcomes?.find((o) => o.name === game.away_team)?.point ?? null
  return {
    total,
    homeSpread,
    awaySpread,
    homeImplied: total != null && homeSpread != null ? calcImpliedTotal(total, homeSpread) : null,
    awayImplied: total != null && awaySpread != null ? calcImpliedTotal(total, awaySpread) : null,
  }
}

/**
 * This team's next game in the fetched odds list and its implied total.
 * @returns {{ implied: number|null, opponent: string|null, commenceTime: string }|null}
 */
export function impliedTotalForTeam(games, teamAbbr) {
  if (!teamAbbr) return null
  for (const g of games ?? []) {
    const homeAbbr = abbrFromOddsTeamName(g.home_team)
    const awayAbbr = abbrFromOddsTeamName(g.away_team)
    if (homeAbbr !== teamAbbr && awayAbbr !== teamAbbr) continue
    const line = gameLine(g)
    return {
      implied: homeAbbr === teamAbbr ? line.homeImplied : line.awayImplied,
      opponent: homeAbbr === teamAbbr ? awayAbbr : homeAbbr,
      commenceTime: g.commence_time,
    }
  }
  return null
}

/**
 * Builds the "implied total for one NFL team" resolver, preferring live Odds
 * API lines and falling back to the free recorded ones from the preprocessed
 * schedule.
 *
 * Pure, and separate from useImpliedTotals, because the Odds page already
 * holds both datasets — calling the hook there would spin up a second useOdds
 * instance and risk a duplicate paid fetch against a 500/month quota. The
 * hook uses this too, so the preference order is still defined once.
 *
 * @param {Array} odds - useOdds' `odds`
 * @param {Record<string, {impliedTotal?: number}>} scheduleByTeam - nflverse-keyed
 * @returns {(teamAbbr: string) => number|null}
 */
export function makeImpliedResolver(odds, scheduleByTeam, toScheduleKey = (t) => t) {
  const hasLive = (odds?.length ?? 0) > 0
  return (teamAbbr) => {
    if (!teamAbbr) return null
    if (hasLive) {
      const live = impliedTotalForTeam(odds, teamAbbr)?.implied
      if (live != null) return live
    }
    return scheduleByTeam?.[toScheduleKey(teamAbbr)]?.impliedTotal ?? null
  }
}

/**
 * Vegas-implied scoring environment for a fantasy lineup this week: the sum
 * of implied totals across the DISTINCT NFL teams represented among the
 * given starters — stacking two starters from the same NFL team must not
 * double-count that team's implied total, it's a team-level number.
 *
 * The source is injected, because there are two: live lines from The Odds API
 * (needs a key) and the recorded lines nfldata ships with the preprocessed
 * schedule (free). Rather than keep a second copy of the distinct-team
 * accounting for the free path, callers hand in a resolver and decide which
 * source — or which order of preference — applies. useImpliedTotals does that
 * preferring live and falling back to recorded.
 *
 * @param {string[]} starterIds - Sleeper's "0" empty-slot placeholder is
 *   filtered here; callers don't need to pre-clean it.
 * @param {Record<string, {team?: string}>} playersById
 * @param {(teamAbbr: string) => number|null} impliedForTeam
 * @returns {{ total: number|null, teamCount: number, missing: string[] }}
 *   `total` is null only when no starter resolved to any line at all.
 *   `missing` names the NFL teams that had none (bye week, or nothing
 *   loaded) — stated, not silently treated as zero.
 */
export function lineupImpliedTotal(starterIds, playersById, impliedForTeam) {
  const nflTeams = new Set()
  for (const id of starterIds ?? []) {
    if (!id || id === '0') continue
    const team = playersById[id]?.team
    if (team) nflTeams.add(team)
  }

  let total = 0
  let matched = 0
  const missing = []
  for (const team of nflTeams) {
    const v = impliedForTeam(team)
    if (v != null) {
      total += v
      matched++
    } else {
      missing.push(team)
    }
  }

  return { total: matched ? total : null, teamCount: nflTeams.size, missing }
}
