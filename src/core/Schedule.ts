/**
 * `public/data/schedule-{season}.json` — a port of FCCore `Schedule` and
 * `GameLines`. Team codes are nflverse's (`LA`, not `LAR`).
 */
import { nflverseTeam } from './NFLTeams'

/**
 * One scheduled game. `spreadLine` and `totalLine` are **recorded closing
 * lines** — label them as recorded, never as live.
 */
export interface ScheduledGame {
  home?: string
  away?: string
  kickoff?: string
  time?: string
  spreadLine?: number
  totalLine?: number
}

export const gameOpponent = (g: ScheduledGame, team: string) =>
  g.home === team ? g.away : g.away === team ? g.home : undefined

export interface ScheduleFile {
  byWeek: Record<string, ScheduledGame[]>
  _meta?: { generated?: string; season?: number; games?: number; weeks?: number[]; source?: string }
}

export function decodeSchedule(json: unknown): ScheduleFile {
  const o = json as ScheduleFile
  if (!o || typeof o.byWeek !== 'object' || o.byWeek === null) throw new Error('schedule: expected byWeek')
  return o
}

export const gamesInWeek = (s: ScheduleFile, week: number) => s.byWeek[String(week)] ?? []

export function weeksAscending(s: ScheduleFile): { week: number; games: ScheduledGame[] }[] {
  return Object.entries(s.byWeek)
    .filter(([k]) => /^[+-]?\d+$/.test(k))
    .map(([k, games]) => ({ week: Number(k), games }))
    .sort((a, b) => a.week - b.week)
}

/** One team's side of one game. */
export interface TeamGameLine {
  team: string
  opponent: string
  isHome: boolean
  kickoff?: string
  time?: string
  /** Odds API convention: negative means this team is favoured. */
  spread?: number
  total?: number
  /** Points this team is expected to score; only when both lines exist. */
  impliedTotal?: number
}

/**
 * Every team playing in a week, keyed by nflverse code. The schedule's
 * `spreadLine` is positive when the **home** team is favoured; it's flipped
 * to the Odds API convention once, here.
 */
export function weekLines(schedule: ScheduleFile, week: number): Record<string, TeamGameLine> {
  const out: Record<string, TeamGameLine> = {}
  for (const g of gamesInWeek(schedule, week)) {
    if (g.home === undefined || g.away === undefined) continue
    const total = g.totalLine ?? undefined
    const line = g.spreadLine ?? undefined
    const both = total !== undefined && line !== undefined
    out[g.home] = {
      team: g.home, opponent: g.away, isHome: true, kickoff: g.kickoff, time: g.time,
      spread: line === undefined ? undefined : -line, total, impliedTotal: both ? total / 2 + line / 2 : undefined,
    }
    out[g.away] = {
      team: g.away, opponent: g.home, isHome: false, kickoff: g.kickoff, time: g.time,
      spread: line, total, impliedTotal: both ? total / 2 - line / 2 : undefined,
    }
  }
  return out
}

/**
 * The scoring environment for a lineup: the sum of implied totals over the
 * **distinct** teams among the starters. Teams with no line are named, not zeroed.
 */
export function lineupEnvironment(teams: (string | undefined)[], lines: Record<string, TeamGameLine>) {
  const distinct = new Set(teams.filter((t): t is string => t !== undefined).map((t) => nflverseTeam(t) ?? t))
  let total: number | undefined
  const missing: string[] = []
  for (const team of [...distinct].sort()) {
    const implied = lines[team]?.impliedTotal
    if (implied !== undefined) total = (total ?? 0) + implied
    else missing.push(team)
  }
  return { total, teamCount: distinct.size, missing }
}
