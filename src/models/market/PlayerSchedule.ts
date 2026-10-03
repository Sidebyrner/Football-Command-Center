/**
 * A player's remaining games: the recorded closing line for each, and how
 * soft each opponent has been against his position — a port of FCApp
 * `PlayerSchedule`. Pure — built from the context and a defense table.
 */
import type { Position } from '@core/Position'
import { gameOpponent, gamesInWeek, weekLines, type TeamGameLine } from '@core/Schedule'
import type { LeagueContext } from '../league/LeagueContext'
import type { DefenseLookup, DefenseSource } from '../player/DefenseLookup'

export type LineSource =
  /** nfldata's recorded closing lines, carried in the schedule file. */
  | 'recordedClosing'
  /** A live feed laid over the recorded lines — the relay odds follow-up. */
  | 'live'

export interface PlayerScheduleWeek {
  week: number
  isBye: boolean
  opponent?: string
  isHome?: boolean
  /** From his team's side: negative means favored. */
  spread?: number
  total?: number
  impliedTotal?: number
  /** `undefined` when no line is recorded for the game yet. */
  lineSource?: LineSource
  /** The opponent's rank against his position, 1 = softest; `undefined` below the sample floor. */
  defenseRank?: number
  defensePerGame?: number
  defenseVsAverage?: number
}

export const weekHasLine = (w: PlayerScheduleWeek) => w.spread !== undefined || w.total !== undefined

export interface PlayerSchedule {
  playerID: string
  team?: string
  position?: Position
  currentWeek: number
  /** The rest of the regular season, current week first. */
  weeks: PlayerScheduleWeek[]
  /**
   * Mean points his opponents allow to his position, over the league average:
   * 1.0 is average, above 1 softer. `undefined` without enough data.
   */
  strengthOfSchedule?: number
  /** Games that went into the strength of schedule. */
  strengthOfScheduleGames: number
  /** Weeks with a line, so the panel can say how far the lines reach. */
  coveredWeeks: number[]
  leagueAverage?: number
  defenseSource?: DefenseSource
}

export const PLAYER_SCHEDULE_LINES_LABEL = 'Recorded closing lines'

export const scheduleByeWeek = (s: PlayerSchedule) => s.weeks.find((w) => w.isBye)?.week

/**
 * @param liveLines lines by week and team that replace the recorded ones when
 *   present — where live odds plug in later.
 */
export function buildPlayerSchedule(
  playerID: string,
  context: LeagueContext,
  defense: DefenseLookup,
  liveLines: ReadonlyMap<number, Readonly<Record<string, TeamGameLine>>> = new Map(),
  /** The weeks to cover — the rest of the regular season unless asked for others, such as the playoffs. */
  scheduleWeeks: readonly number[] = context.remainingWeeks,
): PlayerSchedule {
  const team = context.nflTeam(playerID)
  const position = context.position(playerID)
  const weeks: PlayerScheduleWeek[] = []
  for (const week of scheduleWeeks) {
    if (context.byeCalendar.isOnBye(team, week)) {
      weeks.push({ week, isBye: true })
      continue
    }
    const live = team !== undefined ? own(liveLines.get(week), team) : undefined
    const recorded = team !== undefined ? own(weekLines(context.schedule, week), team) : undefined
    const line = live ?? recorded
    const game = team !== undefined ? gamesInWeek(context.schedule, week).find((g) => g.home === team || g.away === team) : undefined
    const opponent = line?.opponent ?? (team !== undefined && game ? gameOpponent(game, team) : undefined)
    const isHome: boolean | undefined = line?.isHome ?? (team !== undefined && game ? game.home === team : undefined)
    const cell = defense.cell(opponent, position)
    const hasLine = line?.spread !== undefined || line?.total !== undefined
    weeks.push({
      week, isBye: false, opponent, isHome,
      spread: line?.spread, total: line?.total, impliedTotal: line?.impliedTotal,
      lineSource: hasLine ? (live !== undefined ? 'live' : 'recordedClosing') : undefined,
      defenseRank: cell?.rank, defensePerGame: cell?.perGame, defenseVsAverage: cell?.vsLeagueAverage,
    })
  }

  const average = defense.leagueAverage(position)
  const allowed = weeks.map((w) => w.defensePerGame).filter((v): v is number => v !== undefined)
  const strength = average !== undefined && average > 0 && allowed.length > 0
    ? allowed.reduce((s, v) => s + v, 0) / allowed.length / average
    : undefined

  return {
    playerID, team, position, currentWeek: context.currentWeek,
    weeks, strengthOfSchedule: strength, strengthOfScheduleGames: allowed.length,
    coveredWeeks: weeks.filter(weekHasLine).map((w) => w.week), leagueAverage: average,
    defenseSource: defense.source(position),
  }
}

function own(lines: Readonly<Record<string, TeamGameLine>> | undefined, team: string): TeamGameLine | undefined {
  return lines && Object.prototype.hasOwnProperty.call(lines, team) ? lines[team] : undefined
}

/** Swift's `PlayerSchedule.build` / `.linesLabel`, under the type's own name. */
export const PlayerSchedule = {
  linesLabel: PLAYER_SCHEDULE_LINES_LABEL,
  build: buildPlayerSchedule,
  byeWeek: scheduleByeWeek,
} as const
