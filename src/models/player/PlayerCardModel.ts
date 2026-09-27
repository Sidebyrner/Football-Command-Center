/**
 * The Player Card — a port of FCApp `PlayerCardModel.swift`: everything the
 * app knows about one player, each section from a named source, and the two
 * projections held side by side with how each has done.
 */
import { projectCommandCenter, type CommandCenterInputs, type CommandCenterProjection } from '@core/CommandCenterProjection'
import type { PracticeReport } from '@core/InSeasonFiles'
import {
  computeWeightedGrade, DEFAULT_GRADE_WEIGHT, GRADE_KEY, SITUATION, SITUATION_METRICS,
  type PlayerGrade, type SituationChip, type SituationMetric, type WeightedGrade,
} from '@core/PlayerGrade'
import { IDP, type Position } from '@core/Position'
import { weekLines } from '@core/Schedule'
import {
  defensiveSnapShare, offensiveSnapShare, played, scoreLine, targets,
  type SleeperPlayerNews, type SleeperProjection,
} from '@data/insightsModels'
import { hasInjuryDesignation } from '@data/playerIndex'
import type { SleeperService } from '@data/SleeperService'
import type { Availability, LeagueContext } from '../league/LeagueContext'
import { Observable } from '../Observable'
import { CommandCenterProjector } from './CommandCenterProjector'
import { DefenseLookup } from './DefenseLookup'
import { GradeContext } from './GradeContext'

/** One week of a player's log. `id` is the week. */
export interface PlayerLogWeek {
  week: number
  opponent?: string
  played: boolean
  /** Points under the league's rules; `undefined` when there is no line. */
  points?: number
  snapShare?: number
  targets?: number
  rushAttempts?: number
  expectedPoints?: number
  /** What Rotowire projected for him that week, in the league's scoring. */
  projected?: number
}

/** One past week, the two projections made for it, and what happened. */
export interface CalibrationWeek {
  week: number
  actual: number
  rotowire?: number
  /** Reconstructed from data before that week, without the matchup term. */
  commandCenter?: number
}

/** Mean absolute error of each projection over the weeks both exist. */
export interface CalibrationSummary {
  weeks: number
  rotowireError?: number
  commandCenterError?: number
}

/** Where the player stands on the depth chart and the injury report. */
export interface PlayerStatus {
  availability: Availability
  byeWeek?: number
  sleeperTag?: string
  bodyPart?: string
  report?: PracticeReport
  depthRank?: number
  depthChartTeam?: string
  opponent?: string
  impliedTotal?: number
}

const isSituationMetric = (key: string): key is SituationMetric =>
  (SITUATION_METRICS as readonly string[]).includes(key)

export class PlayerCardModel extends Observable {
  readonly id: string
  readonly context: LeagueContext
  status?: PlayerStatus
  log: PlayerLogWeek[] = []
  news: SleeperPlayerNews[] = []
  newsUnavailable = false
  rotowireThisWeek?: number
  commandCenter?: CommandCenterProjection
  calibration: CalibrationWeek[] = []
  calibrationSummary?: CalibrationSummary
  grade?: PlayerGrade
  chips: SituationChip[] = []
  weighted?: WeightedGrade
  private _showWeighted = false
  private _weights: Record<string, number>

  readonly name: string
  readonly position?: Position
  readonly team?: string

  private projectionsByWeek = new Map<number, SleeperProjection>()

  constructor(
    playerID: string,
    context: LeagueContext,
    private readonly sleeper: SleeperService | undefined,
    weights: Record<string, number> = {},
    private readonly onWeightsChange: (weights: Record<string, number>) => void = () => {},
  ) {
    super()
    this.id = playerID
    this.context = context
    // Swift's `didSet` doesn't run in `init`: no callback for the initial weights.
    this._weights = weights
    this.name = context.playerName(playerID) ?? playerID
    this.position = context.position(playerID)
    this.team = context.nflTeam(playerID)
    this.buildSynchronousParts()
  }

  /** Swift `@Published var weights { didSet { … } }`. Assign a new record to change it. */
  get weights(): Record<string, number> { return this._weights }
  set weights(value: Record<string, number>) {
    this._weights = value
    this.weighted = computeWeightedGrade(this.grade, this.chips, value)
    this.onWeightsChange(value)
    this.changed()
  }

  get showWeighted(): boolean { return this._showWeighted }
  set showWeighted(value: boolean) { this._showWeighted = value; this.changed() }

  /** The network parts: news and a season of per-player projections. Both fail soft. */
  async load(): Promise<void> {
    const sleeper = this.sleeper
    if (!sleeper) return
    const newsRead = sleeper.playerNews(this.id).catch(() => undefined)
    const projectionsRead = sleeper.playerProjections(this.id, this.context.scheduleSeason).catch(() => undefined)
    const fetchedNews = await newsRead
    this.news = fetchedNews?.value ?? []
    this.newsUnavailable = fetchedNews === undefined
    this.changed()
    const projections = await projectionsRead
    if (projections) {
      this.projectionsByWeek = projections.value
      this.buildLog()
      this.buildCalibration()
      this.changed()
    }
  }

  // MARK: - Building

  private get scoring(): Record<string, number> { return this.context.league.scoringSettings ?? {} }

  private buildSynchronousParts(): void {
    const { context, id, team, position } = this
    const player = context.players.players[id]
    const lines = weekLines(context.schedule, context.currentWeek)
    const gsis = context.gsisIDsBySleeper.get(id)
    const depthRank = gsis !== undefined && position !== undefined
      ? context.inSeason.depthCharts?.rank(gsis, team, position)
      : undefined
    this.status = {
      availability: context.availabilityOf(id),
      byeWeek: context.seasonWeeks.find((w) => context.byeCalendar.isOnBye(team, w)),
      sleeperTag: player && hasInjuryDesignation(player) ? player.injuryStatus : undefined,
      bodyPart: player?.injuryBodyPart,
      report: context.practiceReport(id),
      depthRank,
      depthChartTeam: team,
      opponent: team !== undefined ? lines[team]?.opponent : undefined,
      impliedTotal: team !== undefined ? lines[team]?.impliedTotal : undefined,
    }

    this.rotowireThisWeek = context.projectedPoints(id)
    const defense = DefenseLookup.build(context)
    this.commandCenter = new CommandCenterProjector(context, defense).project(id)

    const grades = GradeContext.build(context)
    this.grade = grades.grade(id)
    this.chips = grades.chips(id)
    this.weighted = computeWeightedGrade(this.grade, this.chips, this._weights)

    this.buildLog()
    this.buildCalibration()
  }

  private buildLog(): void {
    const { context, id, position } = this
    const scoring = this.scoring
    const gsis = context.gsisIDsBySleeper.get(id)
    const usage = (gsis !== undefined ? context.inSeason.usage?.weeks(gsis) : undefined) ?? []
    const usageByWeek = new Map<number, (typeof usage)[number]>()
    for (const u of usage) if (!usageByWeek.has(u.week)) usageByWeek.set(u.week, u)
    // Weeks come from the dictionary keys the context fetched under, never
    // from a line's own `week` field — the key is what was actually asked
    // for and is authoritative even if a source's own field disagrees.
    const weeks = new Set<number>(context.inSeason.weekStats.keys())
    for (const w of this.projectionsByWeek.keys()) if (w <= context.currentWeek) weeks.add(w)
    const isIDP = position !== undefined ? IDP.has(position) : false
    this.log = [...weeks].sort((a, b) => b - a).map((week) => {
      const line = context.inSeason.weekStats.get(week)?.get(id)
      const projection = this.projectionsByWeek.get(week)
      return {
        week,
        opponent: line?.opponent ?? projection?.opponent,
        played: line ? played(line) : false,
        points: line ? scoreLine(line, scoring).points : undefined,
        snapShare: line ? (isIDP ? defensiveSnapShare(line) : offensiveSnapShare(line)) : undefined,
        targets: line ? targets(line) : undefined,
        rushAttempts: line?.stats.rush_att,
        expectedPoints: usageByWeek.get(week)?.expectedPoints,
        projected: projection ? scoreLine(projection, scoring).points : undefined,
      }
    })
  }

  /**
   * Each completed week he played: Rotowire's projection for it, the Command
   * Center number rebuilt from only the weeks before it, and what he scored.
   * The matchup term is left out of the rebuild because the defense table
   * would otherwise see the week it is predicting.
   */
  private buildCalibration(): void {
    const { context, id, position } = this
    const scoring = this.scoring
    // Weeks the context actually asked Sleeper for and got a line back for
    // this player, keyed by the request — not by the line's own `week` field.
    const playedWeeks = [...context.inSeason.weekStats.keys()]
      .filter((w) => w < context.currentWeek)
      .filter((w) => { const l = context.inSeason.weekStats.get(w)?.get(id); return l !== undefined && played(l) })
      .sort((a, b) => a - b)
    const gsis = context.gsisIDsBySleeper.get(id)
    const usage = (gsis !== undefined ? context.inSeason.usage?.weeks(gsis) : undefined) ?? []
    const lastSeason = (() => {
      if (!(context.statsSeason < context.scheduleSeason) || gsis === undefined) return undefined
      return context.seasonProfiles.find((p) => p.gsisID === gsis)?.pointsPerGame
    })()

    const out: CalibrationWeek[] = []
    for (const week of playedWeeks) {
      const line = context.inSeason.weekStats.get(week)?.get(id)
      if (!line) continue
      const actual = scoreLine(line, scoring).points
      const beforeWeeks = playedWeeks.filter((w) => w < week)
      const beforeLines = beforeWeeks
        .map((w) => context.inSeason.weekStats.get(w)?.get(id))
        .filter((l): l is NonNullable<typeof l> => l !== undefined)
      const priorPPG = beforeLines.length === 0
        ? undefined
        : beforeLines.reduce((s, l) => s + scoreLine(l, scoring).points, 0) / beforeLines.length
      const usageBefore = usage.filter((u) => u.week < week).map((u) => u.expectedPoints).filter((x): x is number => x !== undefined)
      const recent = usageBefore.slice(-4)
      const inputs: CommandCenterInputs = {
        position,
        thisSeasonPointsPerGame: priorPPG,
        thisSeasonGames: beforeWeeks.length,
        lastSeasonPointsPerGame: lastSeason,
        replacementLine: position !== undefined ? context.baselines[position]?.replacementLine : undefined,
        expectedPointsRecent: usageBefore.length === 0 ? undefined : recent.reduce((s, x) => s + x, 0) / recent.length,
        expectedPointsSeason: usageBefore.length === 0 ? undefined : usageBefore.reduce((s, x) => s + x, 0) / usageBefore.length,
        opponentAllowedPerGame: undefined,
        leagueAverageAllowed: undefined,
      }
      const projection = this.projectionsByWeek.get(week)
      out.push({
        week,
        actual,
        rotowire: projection ? scoreLine(projection, scoring).points : undefined,
        commandCenter: projectCommandCenter(inputs).weekly,
      })
    }
    this.calibration = [...out].sort((a, b) => b.week - a.week)

    const mae = (pairs: [number, number][]) =>
      pairs.length === 0 ? undefined : pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length
    const rotowire = out.filter((w) => w.rotowire !== undefined).map((w): [number, number] => [w.rotowire!, w.actual])
    const command = out.filter((w) => w.commandCenter !== undefined).map((w): [number, number] => [w.commandCenter!, w.actual])
    this.calibrationSummary = out.length === 0
      ? undefined
      : { weeks: out.length, rotowireError: mae(rotowire), commandCenterError: mae(command) }
  }

  resetWeights(): void {
    this.weights = {}
  }

  weight(key: string): number {
    if (Object.hasOwn(this._weights, key)) return this._weights[key]!
    if (key === GRADE_KEY) return DEFAULT_GRADE_WEIGHT
    return isSituationMetric(key) ? SITUATION[key].defaultWeight : 0
  }
}
