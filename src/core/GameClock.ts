/**
 * When each team's game kicks off, week by week — a port of FCCore
 * `GameClock`. Sleeper locks a slot at kickoff, so this says which moves are
 * still possible.
 */
import { nflverseTeam } from './NFLTeams'
import { weeksAscending, type ScheduledGame, type ScheduleFile } from './Schedule'

/** nfldata's `gametime` is US Eastern. */
export const SCHEDULE_TIME_ZONE = 'America/New_York'

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHEDULE_TIME_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** Milliseconds the zone is ahead of UTC at a given instant. */
function zoneOffset(instant: number): number {
  const parts = Object.fromEntries(offsetFormatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value]))
  const asUTC = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return asUTC - Math.floor(instant / 1000) * 1000
}

/** Wall-clock time in US Eastern → an instant, handling daylight saving. */
export function easternToInstant(year: number, month: number, day: number, hour: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  let guess = wall - zoneOffset(wall)
  guess = wall - zoneOffset(guess)
  return guess
}

/** Kickoff as ms since 1970, or `undefined` when missing or malformed. */
export function kickoffDate(game: ScheduledGame): number | undefined {
  if (!game.kickoff || !game.time) return undefined
  const day = game.kickoff.split('-').map((s) => (/^\d+$/.test(s) ? Number(s) : NaN)).filter(Number.isFinite)
  const clock = game.time.split(':').map((s) => (/^\d+$/.test(s) ? Number(s) : NaN)).filter(Number.isFinite)
  if (day.length !== 3 || clock.length < 2) return undefined
  return easternToInstant(day[0]!, day[1]!, day[2]!, clock[0]!, clock[1]!)
}

export class KickoffCalendar {
  /** How long after kickoff a game may still be on. Deliberately generous. */
  static readonly LIVE_WINDOW_MS = 4 * 60 * 60 * 1000

  private readonly byWeek = new Map<number, Map<string, number>>()

  constructor(schedule: ScheduleFile) {
    for (const { week, games } of weeksAscending(schedule)) {
      for (const g of games) {
        const date = kickoffDate(g)
        if (date === undefined) continue
        let teams = this.byWeek.get(week)
        if (!teams) this.byWeek.set(week, (teams = new Map()))
        if (g.home) teams.set(g.home, date)
        if (g.away) teams.set(g.away, date)
      }
    }
  }

  /** A team's kickoff that week (Sleeper codes normalised); none on a bye. */
  kickoff(team: string | undefined, week: number): number | undefined {
    const t = nflverseTeam(team)
    return t === undefined ? undefined : this.byWeek.get(week)?.get(t)
  }

  isLocked(team: string | undefined, week: number, now: number): boolean {
    const k = this.kickoff(team, week)
    return k !== undefined && now >= k
  }

  isLive(team: string | undefined, week: number, now: number): boolean {
    const k = this.kickoff(team, week)
    return k !== undefined && now >= k && now < k + KickoffCalendar.LIVE_WINDOW_MS
  }

  /** Distinct kickoff times in a week, soonest first. */
  lockWindows(week: number): number[] {
    return [...new Set(this.byWeek.get(week)?.values() ?? [])].sort((a, b) => a - b)
  }

  /** The next kickoff after `now` among these teams. */
  nextLock(week: number, teams: (string | undefined)[], now: number): number | undefined {
    const upcoming = teams.map((t) => this.kickoff(t, week)).filter((k): k is number => k !== undefined && k > now)
    return upcoming.length ? Math.min(...upcoming) : undefined
  }
}
