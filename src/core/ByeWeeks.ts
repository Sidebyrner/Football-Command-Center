/**
 * Which teams are off in which week, derived from the schedule by absence —
 * a port of FCCore `ByeCalendar`. Exact, and it covers every position. Team
 * codes are nflverse's; normalise Sleeper teams with `nflverseTeam` first.
 */
import { weeksAscending, type ScheduleFile } from './Schedule'

export class ByeCalendar {
  /** Every team the schedule mentions, sorted. */
  readonly teams: string[]
  /** A team's first bye week. */
  readonly byTeam: Record<string, number> = {}
  /** Teams off in a week, sorted; weeks with no byes are absent. */
  readonly byWeek: Record<number, string[]> = {}

  constructor(schedule: ScheduleFile) {
    const all = new Set<string>()
    for (const games of Object.values(schedule.byWeek)) {
      for (const g of games) {
        if (g.home) all.add(g.home)
        if (g.away) all.add(g.away)
      }
    }
    for (const { week, games } of weeksAscending(schedule)) {
      const playing = new Set<string>()
      for (const g of games) {
        if (g.home) playing.add(g.home)
        if (g.away) playing.add(g.away)
      }
      // A week with no games isn't covered by the file — not 32 byes.
      if (playing.size === 0) continue
      const off = [...all].filter((t) => !playing.has(t)).sort()
      if (off.length === 0) continue
      this.byWeek[week] = off
      for (const team of off) if (this.byTeam[team] === undefined) this.byTeam[team] = week
    }
    this.teams = [...all].sort()
  }

  byeTeams(week: number): Set<string> {
    return new Set(this.byWeek[week] ?? [])
  }

  /** Pass a team already normalised with `nflverseTeam`. */
  isOnBye(team: string | undefined, week: number): boolean {
    return team !== undefined && (this.byWeek[week]?.includes(team) ?? false)
  }
}
