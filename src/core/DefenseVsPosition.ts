/**
 * Defense-vs-position under the league's own scoring — a port of FCCore
 * `DefenseVsPosition`. Points allowed to position P by defense D is the sum of
 * every P player's points against D, divided by the **games** D played.
 */
import { nflverseTeam } from './NFLTeams'
import { COVERED_BY_WEEKLY_DATA, type Position } from './Position'
import { scoreWeek } from './ScoringEngine'
import type { ScoringProfile } from './ScoringProfile'
import type { WeeklyFile } from './WeeklyStats'

export interface DefenseCell {
  /** Games this defense played in the window — the denominator. */
  games: number
  /** Player-weeks that faced it; kept so a thin sample is visible. */
  playerWeeks: number
  totalPoints: number
  perGame?: number
  /** 1 is the *softest* defense; `undefined` under the sample-size floor. */
  rank?: number
  /** Above (+) or below (−) the league average; `undefined` exactly when `rank` is. */
  vsLeagueAverage?: number
}

export interface DefenseVsPositionTable {
  /** Defense (nflverse code) → position → cell. */
  byDefense: Record<string, Partial<Record<Position, DefenseCell>>>
  leagueAverage: Partial<Record<Position, number>>
  /** Ranked defenses per position, softest first. */
  ranked: Partial<Record<Position, string[]>>
  weeks: number[]
  minimumGames: number
}

export const DEFAULT_MINIMUM_GAMES = 4

export const EMPTY_DVP: DefenseVsPositionTable = { byDefense: {}, leagueAverage: {}, ranked: {}, weeks: [], minimumGames: DEFAULT_MINIMUM_GAMES }

export const defenseCount = (t: DefenseVsPositionTable) => Object.keys(t.byDefense).length

export function dvpCell(t: DefenseVsPositionTable, defense: string | undefined, position: Position | undefined): DefenseCell | undefined {
  if (!defense || !position) return undefined
  return t.byDefense[nflverseTeam(defense) ?? defense]?.[position]
}

export const dvpCovers = (t: DefenseVsPositionTable, position: Position) =>
  Object.values(t.byDefense).some((cells) => (cells[position]?.playerWeeks ?? 0) > 0)

/** One scored player-week against one defense. `NaN` points = played, unscored. */
export interface DefenseFacing {
  week: number
  position: Position
  defense: string
  points: number
}

export const facing = (week: number, position: Position, defense: string, points: number): DefenseFacing =>
  ({ week, position, defense: nflverseTeam(defense) ?? defense, points })

/** From the weekly file, under one profile. */
export function computeDvPFromWeekly(
  file: WeeklyFile, profile: ScoringProfile,
  options: { positions?: ReadonlySet<Position>; weekRange?: [number, number]; minimumGames?: number } = {},
): DefenseVsPositionTable {
  const positions = options.positions ?? COVERED_BY_WEEKLY_DATA
  const lines: DefenseFacing[] = []
  for (const player of file.allPlayers()) {
    const position = player.position
    if (!position || !positions.has(position)) continue
    for (const row of player.rows) {
      if (options.weekRange && (row.week < options.weekRange[0] || row.week > options.weekRange[1])) continue
      if (!row.opponent) continue
      const points = scoreWeek(row, profile, position).points
      lines.push(facing(row.week, position, row.opponent, points ?? NaN))
    }
  }
  return computeDvP(lines, positions, options.minimumGames)
}

/** From already-scored player-weeks — the path Sleeper's lines take, the only one with IDP. */
export function computeDvP(lines: readonly DefenseFacing[], positions: ReadonlySet<Position>, minimumGames = DEFAULT_MINIMUM_GAMES): DefenseVsPositionTable {
  const totals = new Map<string, Map<Position, { points: number; playerWeeks: number }>>()
  const weeksByDefense = new Map<string, Set<number>>()
  const weeksSeen = new Set<number>()
  for (const line of lines) {
    if (!positions.has(line.position)) continue
    const defense = nflverseTeam(line.defense) ?? line.defense
    weeksSeen.add(line.week)
    if (!weeksByDefense.has(defense)) weeksByDefense.set(defense, new Set())
    weeksByDefense.get(defense)!.add(line.week)
    if (!Number.isFinite(line.points)) continue
    if (!totals.has(defense)) totals.set(defense, new Map())
    const bucket = totals.get(defense)!.get(line.position) ?? { points: 0, playerWeeks: 0 }
    bucket.points += line.points
    bucket.playerWeeks += 1
    totals.get(defense)!.set(line.position, bucket)
  }

  type Rate = { games: number; playerWeeks: number; total: number; rate?: number }
  const perGame = new Map<string, Map<Position, Rate>>()
  for (const [defense, weeks] of weeksByDefense) {
    const games = weeks.size
    const cells = new Map<Position, Rate>()
    for (const position of positions) {
      const bucket = totals.get(defense)?.get(position)
      cells.set(position, {
        games, playerWeeks: bucket?.playerWeeks ?? 0, total: bucket?.points ?? 0,
        rate: bucket && games > 0 ? bucket.points / games : undefined,
      })
    }
    perGame.set(defense, cells)
  }

  const table: DefenseVsPositionTable = { byDefense: {}, leagueAverage: {}, ranked: {}, weeks: [...weeksSeen].sort((a, b) => a - b), minimumGames }
  for (const position of positions) {
    const eligible: [string, number][] = []
    for (const [defense, cells] of perGame) {
      const c = cells.get(position)
      if (c?.rate !== undefined && c.games >= minimumGames) eligible.push([defense, c.rate])
    }
    // Softest first; ties by code so ranks are stable.
    eligible.sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) : b[1] - a[1]))
    const mean = eligible.length ? eligible.reduce((s, e) => s + e[1], 0) / eligible.length : undefined
    if (mean !== undefined) table.leagueAverage[position] = mean
    table.ranked[position] = eligible.map((e) => e[0])
    const rankBy = new Map(eligible.map((e, i) => [e[0], i + 1]))
    for (const [defense, cells] of perGame) {
      const c = cells.get(position)
      if (!c) continue
      const rank = rankBy.get(defense)
      const cell: DefenseCell = { games: c.games, playerWeeks: c.playerWeeks, totalPoints: c.total }
      if (c.rate !== undefined) cell.perGame = c.rate
      if (rank !== undefined) {
        cell.rank = rank
        if (c.rate !== undefined && mean !== undefined) cell.vsLeagueAverage = c.rate - mean
      }
      ;(table.byDefense[defense] ??= {})[position] = cell
    }
  }
  return table
}
