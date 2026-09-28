/**
 * The hours around kickoffs when data changes fast — a port of FCApp
 * `GameDayWindow`, `LockCountdown` and `SleeperLinks`.
 */
import type { LeagueContext } from './LeagueContext'
import type { KickoffCalendar } from '@core/GameClock'
import { CacheTTL } from '@data/cache'

/** Inactives and final designations land in the hours before a game. */
export const BEFORE_MS = 6 * 60 * 60 * 1000
/** Games run long; corrections and late news trail them. */
export const AFTER_MS = 4 * 60 * 60 * 1000
/** How young the player index must be inside the window (seconds). */
export const GAME_DAY_PLAYER_INDEX_MAX_AGE = 3 * 60 * 60

export function isGameDayActive(kickoffs: KickoffCalendar, week: number, now: number): boolean {
  return kickoffs.lockWindows(week).some((k) => now >= k - BEFORE_MS && now <= k + AFTER_MS)
}

/** Seconds. */
export function playerIndexMaxAge(kickoffs: KickoffCalendar, week: number, now: number): number {
  return isGameDayActive(kickoffs, week, now) ? GAME_DAY_PLAYER_INDEX_MAX_AGE : CacheTTL.players
}

/** "2h 14m" until a lineup lock, on the app's own clock. */
export function formatCountdown(seconds: number): string {
  if (!(seconds > 0)) return 'now'
  const minutes = Math.trunc(seconds / 60)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.trunc(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`
  const days = Math.trunc(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}

/** "Sun 4:25 PM", in the viewer's time zone. */
export function kickoffLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

/** Sleeper's API is read-only, so every recommended change is made in Sleeper. */
export function sleeperTeamLink(leagueID: string): string {
  return `https://sleeper.com/leagues/${encodeURIComponent(leagueID)}/team`
}

/** The user's team page on whichever platform hosts the league. */
export function teamLink(context: Pick<LeagueContext, 'league' | 'provider' | 'userRosterID'>): string {
  if (context.provider === 'espn') {
    return `https://fantasy.espn.com/football/team?leagueId=${encodeURIComponent(context.league.leagueID)}&teamId=${context.userRosterID}`
  }
  return sleeperTeamLink(context.league.leagueID)
}
