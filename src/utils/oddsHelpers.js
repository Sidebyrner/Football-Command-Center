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
