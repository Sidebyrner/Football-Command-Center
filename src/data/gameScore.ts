/**
 * One NFL game's live state, from Sleeper's undocumented
 * `/scores/nfl/regular/{season}/{week}` — a port of FCData `SleeperGameScore`.
 * Flattened from Sleeper's `metadata`; every field but the teams is optional
 * because a game before kickoff sends nulls and empty strings.
 */
import { isObject, lossyNumber, lossyString, type JSONObject } from './decode'

export type GameStatus = 'pregame' | 'inProgress' | 'complete'

export interface SleeperGameScore {
  gameID: string
  week?: number
  status: GameStatus
  /** Kickoff, ms since 1970. */
  startTime?: number
  home: string
  away: string
  homeScore?: number
  awayScore?: number
  /** "1"–"4", "OT", "HT", "F". */
  quarter?: string
  quarterNumber?: number
  /** "7:42". */
  timeRemaining?: string
  /** The team with the ball. */
  possession?: string
  /** "3rd & 4". */
  downAndDistance?: string
  yardLine?: string
  yardLineTerritory?: string
  isRedZone: boolean
  /** Points each team is favoured by, negative for the favourite. */
  spread: Record<string, number>
  /** Pregame win chance per team, 0–100. */
  winChance: Record<string, number>
  forecastWindMph?: number
  forecastTempHigh?: number
  forecastDescription?: string
  channel?: string
  /** ms since 1970. */
  updatedAt?: number
}

export const involves = (g: SleeperGameScore, team: string) => g.home === team || g.away === team
export const opponentOf = (g: SleeperGameScore, team: string) =>
  g.home === team ? g.away : g.away === team ? g.home : undefined
export const scoreOf = (g: SleeperGameScore, team: string) =>
  g.home === team ? g.homeScore : g.away === team ? g.awayScore : undefined

const blank = (s: unknown) => (typeof s === 'string' && s !== '' ? s : undefined)
const whole = (v: unknown) => {
  const n = lossyNumber(v)
  return n === undefined ? undefined : Math.trunc(n)
}

function teams(map: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObject(map)) return out
  for (const [k, v] of Object.entries(map)) {
    const n = lossyNumber(v)
    if (k !== 'updated_at' && n !== undefined) out[k] = n
  }
  return out
}

/** `undefined` when the game can't be placed (no teams). */
export function decodeGameScore(json: unknown): SleeperGameScore | undefined {
  if (!isObject(json) || typeof json.game_id !== 'string') throw new Error('score: missing game_id')
  const o: JSONObject = json
  const m = isObject(o.metadata) ? o.metadata : undefined
  const home = m && typeof m.home_team === 'string' ? m.home_team : undefined
  const away = m && typeof m.away_team === 'string' ? m.away_team : undefined
  if (!m || home === undefined || away === undefined) return undefined

  const status: GameStatus =
    m.is_over === true || o.status === 'complete' ? 'complete'
    : m.is_in_progress === true || o.status === 'in_progress' ? 'inProgress'
    : 'pregame'
  const redZoneText = lossyString(m.red_zone)
  const redZone = redZoneText !== undefined && !['', '0', 'false'].includes(redZoneText.toLowerCase())
  const startTime = typeof o.start_time === 'number' ? o.start_time : undefined
  const updatedAt = typeof o.updated_at === 'number' ? o.updated_at : undefined

  const score: SleeperGameScore = {
    gameID: o.game_id as string,
    week: typeof o.week === 'number' && Number.isInteger(o.week) ? o.week : undefined,
    status,
    startTime,
    home,
    away,
    homeScore: whole(m.home_score),
    awayScore: whole(m.away_score),
    quarter: blank(m.quarter),
    quarterNumber: whole(m.quarter_num),
    timeRemaining: blank(m.time_remaining),
    possession: blank(m.possession),
    downAndDistance: blank(m.down_and_distance),
    yardLine: blank(lossyString(m.yard_line)),
    yardLineTerritory: blank(m.yard_line_territory),
    isRedZone: status === 'inProgress' && redZone,
    spread: teams(m.spread),
    winChance: teams(m.moneyline),
    forecastWindMph: lossyNumber(m.forecast_wind_speed),
    forecastTempHigh: lossyNumber(m.forecast_temp_high),
    forecastDescription: blank(m.forecast_description),
    channel: blank(m.channel),
    updatedAt,
  }
  for (const k of Object.keys(score) as (keyof SleeperGameScore)[]) if (score[k] === undefined) delete score[k]
  return score
}
