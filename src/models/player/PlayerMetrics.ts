/**
 * Every player's weekly metrics for one league context, with leaderboards
 * built on first use — a port of FCApp `PlayerMetrics`.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { IDP, type Position } from '@core/Position'
import type { UsageWeek } from '@core/InSeasonFiles'
import { airYards, defensiveSnapShare, linePosition, offensiveSnapShare, played, redZoneCarries, redZoneTargets, scoreLine, targets, type SleeperWeekStat } from '@data/insightsModels'
import { roundAwayFromZero } from '@core/rounding'
import { formatNumber } from '@core/numeric'
import type { LeagueContext } from '../league/LeagueContext'

export const PLAYER_METRICS = [
  'fantasyPoints', 'snapShare', 'targets', 'targetShare', 'receptions', 'receivingYards', 'airYards',
  'carries', 'rushingYards', 'redZoneTouches', 'expectedPoints', 'yardsAfterContact', 'tackles', 'sacks',
] as const
export type PlayerMetric = (typeof PLAYER_METRICS)[number]

interface MetricInfo {
  label: string
  /** What follows the number: "pts", "tgt", "yds". */
  unit: string
  /** Positions it means something for; `undefined` is every position. */
  positions?: ReadonlySet<Position>
  source: string
  isPercent?: boolean
  /** Counting stats Sleeper omits when zero — a played game with no key is a real 0. */
  zeroWhenAbsent?: boolean
}

const RECEIVERS: ReadonlySet<Position> = new Set(['RB', 'WR', 'TE'])
const LINES = "Sleeper's weekly lines"
export const METRIC: Readonly<Record<PlayerMetric, MetricInfo>> = {
  fantasyPoints: { label: 'Fantasy points', unit: 'pts', source: "Sleeper's lines in your scoring" },
  snapShare: { label: 'Snap share', unit: '', source: LINES, isPercent: true },
  targets: { label: 'Targets', unit: 'tgt', positions: RECEIVERS, source: LINES, zeroWhenAbsent: true },
  targetShare: { label: 'Target share', unit: '', positions: RECEIVERS, source: LINES, isPercent: true },
  receptions: { label: 'Receptions', unit: 'rec', positions: RECEIVERS, source: LINES, zeroWhenAbsent: true },
  receivingYards: { label: 'Receiving yards', unit: 'yds', positions: RECEIVERS, source: LINES, zeroWhenAbsent: true },
  airYards: { label: 'Air yards', unit: 'yds', positions: RECEIVERS, source: LINES, zeroWhenAbsent: true },
  carries: { label: 'Carries', unit: 'car', positions: new Set(['QB', 'RB', 'WR']), source: LINES, zeroWhenAbsent: true },
  rushingYards: { label: 'Rushing yards', unit: 'yds', positions: new Set(['QB', 'RB', 'WR']), source: LINES, zeroWhenAbsent: true },
  redZoneTouches: { label: 'Red zone touches', unit: 'RZ', positions: RECEIVERS, source: LINES, zeroWhenAbsent: true },
  expectedPoints: { label: 'Expected points (xFP)', unit: 'pts', positions: new Set(['QB', 'RB', 'WR', 'TE']), source: 'ffopportunity via nflverse' },
  yardsAfterContact: { label: 'Yards after contact', unit: 'yds/att', positions: new Set(['RB']), source: 'PFR via nflverse' },
  tackles: { label: 'Tackles', unit: 'tkl', positions: IDP, source: LINES, zeroWhenAbsent: true },
  sacks: { label: 'Sacks', unit: 'sk', positions: IDP, source: LINES, zeroWhenAbsent: true },
}

export const metricApplies = (m: PlayerMetric, position: Position | undefined) => {
  const ps = METRIC[m].positions
  return ps === undefined ? true : position !== undefined && ps.has(position)
}


export function formatMetric(m: PlayerMetric, value: number): string {
  if (METRIC[m].isPercent) return `${Math.trunc(roundAwayFromZero(value * 100))}%`
  if (m === 'receivingYards' || m === 'airYards' || m === 'rushingYards') return String(Math.trunc(roundAwayFromZero(value)))
  return formatNumber(value, Math.abs(value) < 10 ? 1 : 0)
}

export interface MetricPoint {
  week: number
  value: number
}

export interface MetricSummary {
  games: number
  seasonAverage: number
  lastGame?: number
  lastWeek?: number
  lastThreeAverage?: number
  /** Last three over the season average; positive is trending up. */
  trend?: number
  /** 1 = best at his position among players with two or more games. */
  rank?: number
  rankOf: number
  positionAverage?: number
}

export const MINIMUM_GAMES_FOR_RANK = 2

export class PlayerMetricsIndex {
  private readonly scoring: Readonly<Record<string, number>>
  /** Targets thrown by each team each week, from every Sleeper line. */
  private readonly teamTargets = new Map<number, Map<string, number>>()
  private readonly usageCache = new Map<string, Map<number, UsageWeek>>()
  private readonly seriesCache = new Map<string, MetricPoint[]>()
  private readonly leaderboards = new Map<string, { id: string; average: number }[]>()

  constructor(readonly context: LeagueContext) {
    this.scoring = context.league.scoringSettings ?? {}
    for (const [week, lines] of context.inSeason.weekStats) {
      const byTeam = new Map<string, number>()
      for (const line of lines.values()) {
        const tgt = targets(line)
        if (!line.team || tgt === undefined) continue
        const team = nflverseTeam(line.team) ?? line.team
        byTeam.set(team, (byTeam.get(team) ?? 0) + tgt)
      }
      this.teamTargets.set(week, byTeam)
    }
  }

  /** The weeks he played, oldest first, with the metric's value each week. */
  series(metric: PlayerMetric, playerID: string): MetricPoint[] {
    const key = `${metric}|${playerID}`
    const cached = this.seriesCache.get(key)
    if (cached) return cached
    const points: MetricPoint[] = []
    for (const week of [...this.context.inSeason.weekStats.keys()].sort((a, b) => a - b)) {
      const line = this.context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line || !played(line)) continue
      const value = this.value(metric, line, week, playerID)
      if (value !== undefined) points.push({ week, value })
    }
    this.seriesCache.set(key, points)
    return points
  }

  summary(metric: PlayerMetric, playerID: string): MetricSummary | undefined {
    const points = this.series(metric, playerID)
    if (points.length === 0) return undefined
    const values = points.map((p) => p.value)
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    const average = avg(values)
    const lastThree = values.slice(-3)
    const lastThreeAverage = lastThree.length ? avg(lastThree) : undefined
    const position = this.context.position(playerID)
    const board = position ? this.leaderboard(metric, position) : []
    const index = board.findIndex((b) => b.id === playerID)
    return {
      games: points.length,
      seasonAverage: average,
      lastGame: points.at(-1)?.value,
      lastWeek: points.at(-1)?.week,
      lastThreeAverage,
      trend: points.length >= 4 && lastThreeAverage !== undefined ? lastThreeAverage - average : undefined,
      rank: index < 0 ? undefined : index + 1,
      rankOf: board.length,
      positionAverage: board.length ? avg(board.map((b) => b.average)) : undefined,
    }
  }

  /** Players at a position with enough games, best season average first. */
  leaderboard(metric: PlayerMetric, position: Position): { id: string; average: number }[] {
    const key = `${metric}|${position}`
    const cached = this.leaderboards.get(key)
    if (cached) return cached
    const ids = new Set<string>()
    for (const lines of this.context.inSeason.weekStats.values()) {
      for (const [id, line] of lines) if (played(line) && linePosition(line) === position) ids.add(id)
    }
    const board: { id: string; average: number }[] = []
    for (const id of ids) {
      const points = this.series(metric, id)
      if (points.length >= MINIMUM_GAMES_FOR_RANK) board.push({ id, average: points.reduce((s, p) => s + p.value, 0) / points.length })
    }
    board.sort((a, b) => (a.average === b.average ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : b.average - a.average))
    this.leaderboards.set(key, board)
    return board
  }

  /** Your players the metric applies to, best season average first. */
  rosterPlayers(metric: PlayerMetric, limit = 6): string[] {
    const team = this.context.userTeam
    if (!team) return []
    return team.roster.map((e) => e.id)
      .filter((id) => metricApplies(metric, this.context.position(id)) && !team.reserveIDs.includes(id))
      .map((id) => [id, this.summary(metric, id)?.seasonAverage] as const)
      .filter((p): p is readonly [string, number] => p[1] !== undefined)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id)
  }

  private value(metric: PlayerMetric, line: SleeperWeekStat, week: number, playerID: string): number | undefined {
    const position = linePosition(line) ?? this.context.position(playerID)
    if (!metricApplies(metric, position)) return undefined
    const s = line.stats
    let raw: number | undefined
    switch (metric) {
      case 'fantasyPoints': raw = scoreLine(line, this.scoring).points; break
      case 'snapShare': raw = position !== undefined && IDP.has(position) ? defensiveSnapShare(line) : offensiveSnapShare(line); break
      case 'targets': raw = targets(line); break
      case 'targetShare': {
        const total = line.team ? this.teamTargets.get(week)?.get(nflverseTeam(line.team) ?? line.team) : undefined
        if (total === undefined || !(total > 0)) return undefined
        return (targets(line) ?? 0) / total
      }
      case 'receptions': raw = s.rec; break
      case 'receivingYards': raw = s.rec_yd; break
      case 'airYards': raw = airYards(line); break
      case 'carries': raw = s.rush_att; break
      case 'rushingYards': raw = s.rush_yd; break
      case 'redZoneTouches': {
        const t = redZoneTargets(line), c = redZoneCarries(line)
        raw = t === undefined && c === undefined ? undefined : (t ?? 0) + (c ?? 0)
        break
      }
      case 'expectedPoints': raw = this.usage(playerID).get(week)?.expectedPoints; break
      case 'yardsAfterContact': raw = this.usage(playerID).get(week)?.yardsAfterContactPerAttempt; break
      case 'tackles': {
        const solo = s.idp_tkl_solo, ast = s.idp_tkl_ast
        raw = solo === undefined && ast === undefined ? undefined : (solo ?? 0) + (ast ?? 0)
        break
      }
      case 'sacks': raw = s.idp_sack; break
    }
    if (raw !== undefined) return raw
    return METRIC[metric].zeroWhenAbsent ? 0 : undefined
  }

  private usage(playerID: string): Map<number, UsageWeek> {
    const cached = this.usageCache.get(playerID)
    if (cached) return cached
    const gsis = this.context.gsisIDsBySleeper.get(playerID)
    const weeks = gsis !== undefined ? this.context.inSeason.usage?.weeks(gsis) ?? [] : []
    const byWeek = new Map<number, UsageWeek>()
    for (const w of weeks) if (!byWeek.has(w.week)) byWeek.set(w.week, w)
    this.usageCache.set(playerID, byWeek)
    return byWeek
  }
}
