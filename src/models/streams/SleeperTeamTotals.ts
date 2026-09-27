/**
 * Every team's offense by week, and what each defense has faced, summed from
 * Sleeper's weekly lines — a port of FCApp `SleeperTeamTotals`: the team-level
 * inputs the QB, D/ST and K streams need and Sleeper doesn't publish directly.
 */
import { dvpCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import type { Position } from '@core/Position'
import { gameOpponent, weeksAscending, type ScheduleFile } from '@core/Schedule'
import { linePosition, type SleeperWeekStat } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'
import { completedStatWeeks } from './StreamKind'

/** One team's offense in one game. */
export interface TeamOffense {
  passAttempts: number
  completions: number
  sacksTaken: number
  interceptions: number
  pickSixes: number
  rushAttempts: number
  fumblesLost: number
  touchdowns: number
  fieldGoalAttempts: number
}

export const emptyOffense = (): TeamOffense => ({
  passAttempts: 0, completions: 0, sacksTaken: 0, interceptions: 0, pickSixes: 0,
  rushAttempts: 0, fumblesLost: 0, touchdowns: 0, fieldGoalAttempts: 0,
})

export const offenseDropbacks = (o: TeamOffense) => o.passAttempts + o.sacksTaken
export const offensePlays = (o: TeamOffense) => o.passAttempts + o.sacksTaken + o.rushAttempts

export function addOffense(into: TeamOffense, o: TeamOffense): void {
  into.passAttempts += o.passAttempts; into.completions += o.completions; into.sacksTaken += o.sacksTaken
  into.interceptions += o.interceptions; into.pickSixes += o.pickSixes; into.rushAttempts += o.rushAttempts
  into.fumblesLost += o.fumblesLost; into.touchdowns += o.touchdowns; into.fieldGoalAttempts += o.fieldGoalAttempts
}

function nested<V>(outer: Map<string, Map<number, V>>, key: string): Map<number, V> {
  let inner = outer.get(key)
  if (!inner) { inner = new Map(); outer.set(key, inner) }
  return inner
}

export class SleeperTeamTotals {
  /** Completed weeks with lines, ascending. */
  readonly weeks: number[]
  /** team → week → offense. */
  readonly offense = new Map<string, Map<number, TeamOffense>>()
  /** team → week → opponent. */
  readonly opponents = new Map<string, Map<number, string>>()
  /** team → week → the team defense's own line (sacks, INTs, points allowed…). */
  readonly defenseLines = new Map<string, Map<number, SleeperWeekStat>>()

  constructor(context: LeagueContext) {
    this.weeks = completedStatWeeks(context)
    for (const week of this.weeks) {
      for (const line of (context.inSeason.weekStats.get(week) ?? new Map<string, SleeperWeekStat>()).values()) {
        const team = nflverseTeam(line.team)
        if (team === undefined) continue
        const opponent = nflverseTeam(line.opponent)
        if (opponent !== undefined) nested(this.opponents, team).set(week, opponent)
        if (linePosition(line) === 'DEF') {
          nested(this.defenseLines, team).set(week, line)
          continue
        }
        const s = line.stats
        const o = this.offense.get(team)?.get(week) ?? emptyOffense()
        o.passAttempts += s.pass_att ?? 0
        o.completions += s.pass_cmp ?? 0
        o.sacksTaken += s.pass_sack ?? 0
        o.interceptions += s.pass_int ?? 0
        o.pickSixes += s.pass_int_td ?? 0
        o.rushAttempts += s.rush_att ?? 0
        o.fumblesLost += s.fum_lost ?? 0
        // Passing TDs cover the receiving ones; add rushing TDs.
        o.touchdowns += (s.pass_td ?? 0) + (s.rush_td ?? 0)
        o.fieldGoalAttempts += s.fga ?? 0
        nested(this.offense, team).set(week, o)
      }
    }
  }

  /** A team's offense summed over its games, and how many games. */
  offenseTotal(team: string): { total: TeamOffense; games: number } {
    const games = this.offense.get(team) ?? new Map<number, TeamOffense>()
    const total = emptyOffense()
    for (const game of games.values()) addOffense(total, game)
    return { total, games: games.size }
  }

  /** What a defense faced: its opponents' offenses in the games it played. */
  faced(team: string): { total: TeamOffense; games: number } {
    const total = emptyOffense()
    let games = 0
    for (const [week, opponent] of this.opponents.get(team) ?? new Map<number, string>()) {
      const game = this.offense.get(opponent)?.get(week)
      if (!game) continue
      addOffense(total, game)
      games += 1
    }
    return { total, games }
  }

  /** Points and yards an offense scored, read off the defenses it played. */
  scored(team: string): { points: number; yards: number; games: number } {
    let points = 0, yards = 0, games = 0
    for (const [week, opponent] of this.opponents.get(team) ?? new Map<number, string>()) {
      const line = this.defenseLines.get(opponent)?.get(week)
      if (!line) continue
      points += line.stats.pts_allow ?? 0
      yards += line.stats.yds_allow ?? 0
      games += 1
    }
    return { points, yards, games }
  }

  /** League-wide completion, sack and INT rates. */
  get leagueRates(): { comp: number; sack: number; int: number } {
    const all = emptyOffense()
    for (const games of this.offense.values()) for (const game of games.values()) addOffense(all, game)
    if (!(all.passAttempts > 0)) return { comp: 0.655, sack: 0.065, int: 0.022 }
    return {
      comp: all.completions / all.passAttempts,
      sack: all.sacksTaken / Math.max(offenseDropbacks(all), 1),
      int: all.interceptions / all.passAttempts,
    }
  }

  /** Each team's opponent by week for the whole season, from the schedule. */
  static schedule(file: ScheduleFile, team: string): Map<number, string> {
    const out = new Map<number, string>()
    for (const week of weeksAscending(file)) {
      const game = week.games.find((g) => g.home === team || g.away === team)
      const opponent = game ? gameOpponent(game, team) : undefined
      if (opponent !== undefined) out.set(week.week, opponent)
    }
    return out
  }

  /** Each team's home/away by week. */
  static homeMap(file: ScheduleFile, team: string): Map<number, boolean> {
    const out = new Map<number, boolean>()
    for (const week of weeksAscending(file)) {
      const game = week.games.find((g) => g.home === team || g.away === team)
      if (game) out.set(week.week, game.home === team)
    }
    return out
  }

  /**
   * Every defense's generosity to a position, % vs average, from the Sleeper
   * side of the defense-vs-position table.
   */
  static generosity(table: DefenseVsPositionTable, position: Position): { pct: Record<string, number>; games: Record<string, number> } {
    const pct: Record<string, number> = {}, games: Record<string, number> = {}
    const average = table.leagueAverage[position]
    if (average === undefined || !(average > 0)) return { pct, games }
    for (const team of Object.keys(table.byDefense)) {
      const cell = dvpCell(table, team, position)
      if (cell && cell.rank !== undefined && cell.perGame !== undefined) {
        pct[team] = (cell.perGame / average - 1) * 100
        games[team] = cell.games
      }
    }
    return { pct, games }
  }
}
