// Kickoff times, lineup locks, and the game-day window.
//
// Sleeper locks a player's lineup slot at his game's kickoff, so this is what
// tells the app which moves are still possible. A recommendation to start or sit
// someone whose game has begun isn't advice — Sleeper would reject it.
//
// Same rules as the iOS app's GameClock.swift and GameDayWindow.swift.

import { toNflverseTeam } from './nflTeams.js'

/** The schedule's kickoff times are US Eastern — nfldata's `gametime`. */
export const SCHEDULE_TIME_ZONE = 'America/New_York'

/** How long after kickoff a game may still be in progress. Generous on purpose. */
export const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000

/** The game-day window: inactives and final tags land before, stats trail after. */
export const GAME_DAY_BEFORE_MS = 6 * 60 * 60 * 1000
export const GAME_DAY_AFTER_MS = 4 * 60 * 60 * 1000

/** How young the player index (and its injury tags) must be on a game day. */
export const GAME_DAY_PLAYERS_MAX_AGE_MS = 3 * 60 * 60 * 1000
export const ORDINARY_PLAYERS_MAX_AGE_MS = 24 * 60 * 60 * 1000

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHEDULE_TIME_ZONE,
  timeZoneName: 'longOffset',
})

/** Minutes east of UTC for the schedule time zone at an instant (EDT = -240). */
function easternOffsetMinutes(instantMs) {
  const name = offsetFormatter.formatToParts(new Date(instantMs)).find((p) => p.type === 'timeZoneName')?.value
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '')
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

/**
 * A game's kickoff as a Date, or null when the date or time is missing or
 * malformed. Parsing `${kickoff}T${time}` with `new Date()` treats it as the
 * browser's own time zone, which is wrong for anyone outside Eastern.
 *
 * @param {{kickoff?: string, time?: string}} game
 */
export function kickoffDate(game) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(game?.kickoff ?? '')
  const clock = /^(\d{1,2}):(\d{2})$/.exec(game?.time ?? '')
  if (!day || !clock) return null
  const wallAsUtc = Date.UTC(+day[1], +day[2] - 1, +day[3], +clock[1], +clock[2])
  // Resolve the offset at the actual instant — twice, so a date near a
  // daylight-saving change settles on the right side of it.
  let instant = wallAsUtc - easternOffsetMinutes(wallAsUtc) * 60000
  instant = wallAsUtc - easternOffsetMinutes(instant) * 60000
  return new Date(instant)
}

/** ISO string with the correct offset, for code that stores kickoffs as strings. */
export function kickoffIso(game) {
  return kickoffDate(game)?.toISOString() ?? null
}

/**
 * Week → nflverse team → kickoff, built once from a schedule file.
 * @param {{byWeek: Record<string, Array<{home, away, kickoff, time}>>}} scheduleFile
 */
export function kickoffCalendar(scheduleFile) {
  const byWeek = new Map()
  for (const [weekKey, games] of Object.entries(scheduleFile?.byWeek ?? {})) {
    const teams = new Map()
    for (const g of games ?? []) {
      const date = kickoffDate(g)
      if (!date) continue
      if (g.home) teams.set(g.home, date)
      if (g.away) teams.set(g.away, date)
    }
    byWeek.set(Number(weekKey), teams)
  }

  const kickoff = (team, week) => {
    const code = toNflverseTeam(team)
    return code ? byWeek.get(week)?.get(code) ?? null : null
  }

  return {
    /** A team's kickoff that week; null on bye. Sleeper codes (LAR) are normalised. */
    kickoff,
    /** Whether a team's game has kicked off. A team on bye is never locked. */
    isLocked(team, week, now = new Date()) {
      const k = kickoff(team, week)
      return k != null && now >= k
    },
    /** Whether a team's game may be in progress. */
    isLive(team, week, now = new Date()) {
      const k = kickoff(team, week)
      return k != null && now >= k && now - k < LIVE_WINDOW_MS
    },
    /** Distinct kickoff times in a week, soonest first. */
    lockWindows(week) {
      const times = new Set([...(byWeek.get(week)?.values() ?? [])].map((d) => d.getTime()))
      return [...times].sort((a, b) => a - b).map((t) => new Date(t))
    },
    /** The next kickoff after `now` among the given teams, or null. */
    nextLock(week, teams, now = new Date()) {
      const upcoming = teams.map((t) => kickoff(t, week)).filter((d) => d && d > now)
      return upcoming.length ? new Date(Math.min(...upcoming.map((d) => d.getTime()))) : null
    },
  }
}

/** Whether `now` is within the game-day window of any kickoff that week. */
export function isGameDay(calendar, week, now = new Date()) {
  return calendar.lockWindows(week).some(
    (k) => now >= k.getTime() - GAME_DAY_BEFORE_MS && now <= k.getTime() + GAME_DAY_AFTER_MS
  )
}

/** How old the cached player index may be before refetching. */
export function playersMaxAge(calendar, week, now = new Date()) {
  return calendar && week != null && isGameDay(calendar, week, now)
    ? GAME_DAY_PLAYERS_MAX_AGE_MS
    : ORDINARY_PLAYERS_MAX_AGE_MS
}
