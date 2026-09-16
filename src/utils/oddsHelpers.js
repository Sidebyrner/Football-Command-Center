// Shared odds-line math — used by the Odds page (every game) and Sit/Start
// (just the games touching your roster's players). Kept separate from
// oddsApi.js (which only fetches) so both pages parse a game the same way.

import { calcImpliedTotal } from './playerHelpers.js'
import { abbrFromOddsTeamName, toNflverseTeam } from './nflTeams.js'
import { kickoffDate } from './gameClock.js'

// A rescheduled game can move a day or two (a flexed Sunday to Saturday, a
// storm postponement), but next week's game is at least four days away.
const SAME_GAME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The Odds API's feed is "every upcoming game", not "this week": it carries
 * the next week or two, and drops each game once it kicks off. Read as-is, a
 * team whose week-1 game has started resolves to its week-2 game — a
 * different opponent and a different line under a week-1 label.
 *
 * Keeps only the live games that are one of this week's scheduled games: the
 * same two teams (either way round — neutral-site games don't always agree on
 * who is home) kicking off within a few days of the schedule's time.
 *
 * @param {Array} odds - The Odds API games
 * @param {Array<{home, away, kickoff, time}>} weekGames - this week's schedule (nflverse codes)
 * @returns {Array} the odds games for this week only; empty when no schedule is loaded,
 *   because an unchecked line is exactly the bug this exists to prevent
 */
export function oddsForWeek(odds, weekGames) {
  if (!odds?.length || !weekGames?.length) return []
  const pairKey = (a, b) => [a, b].sort().join('|')
  const kickoffByPair = new Map()
  for (const g of weekGames) {
    kickoffByPair.set(pairKey(g.home, g.away), kickoffDate(g))
  }
  return odds.filter((g) => {
    const home = toNflverseTeam(abbrFromOddsTeamName(g.home_team))
    const away = toNflverseTeam(abbrFromOddsTeamName(g.away_team))
    const key = pairKey(home, away)
    if (!home || !away || !kickoffByPair.has(key)) return false
    const scheduled = kickoffByPair.get(key)
    const commence = new Date(g.commence_time)
    // No kickoff to compare against: the pairing alone is still this week's.
    if (!scheduled || isNaN(commence.getTime())) return true
    return Math.abs(commence - scheduled) <= SAME_GAME_WINDOW_MS
  })
}

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
 * This team's game in the fetched odds list and its line. Pass odds already
 * narrowed with oddsForWeek — this takes the first game it finds.
 *
 * Accepts either team-code dialect (LAR or LA for the Rams).
 * @returns {{ implied: number|null, spread: number|null, total: number|null,
 *   opponent: string|null, commenceTime: string }|null}
 *   `spread` is this team's, in Odds API sign (negative = favored).
 */
export function impliedTotalForTeam(games, teamAbbr) {
  const team = toNflverseTeam(teamAbbr)
  if (!team) return null
  for (const g of games ?? []) {
    const homeAbbr = abbrFromOddsTeamName(g.home_team)
    const awayAbbr = abbrFromOddsTeamName(g.away_team)
    const isHome = toNflverseTeam(homeAbbr) === team
    if (!isHome && toNflverseTeam(awayAbbr) !== team) continue
    const line = gameLine(g)
    return {
      implied: isHome ? line.homeImplied : line.awayImplied,
      spread: isHome ? line.homeSpread : line.awaySpread,
      total: line.total,
      opponent: isHome ? awayAbbr : homeAbbr,
      commenceTime: g.commence_time,
    }
  }
  return null
}

/**
 * The schedule's per-team view with any live line laid over the recorded
 * one, so a row's opponent, spread, total and implied total all describe the
 * same game from the same source. Without this the Odds page's roster rows
 * took the implied total from live odds and the spread and total from the
 * schedule file.
 *
 * @param {Record<string, object>} scheduleByTeam - weekView's byTeam (nflverse-keyed)
 * @param {Array} weekOdds - odds already narrowed with oddsForWeek
 */
export function withLiveLines(scheduleByTeam, weekOdds) {
  if (!scheduleByTeam || !weekOdds?.length) return scheduleByTeam
  const out = {}
  for (const [team, game] of Object.entries(scheduleByTeam)) {
    const live = impliedTotalForTeam(weekOdds, team)
    out[team] = live && live.total != null && live.spread != null
      ? { ...game, spreadLine: live.spread, totalLine: live.total, impliedTotal: live.implied, lineSource: 'live' }
      : { ...game, lineSource: 'schedule' }
  }
  return out
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
