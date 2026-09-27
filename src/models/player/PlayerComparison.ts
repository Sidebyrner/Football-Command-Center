/**
 * Two to four players side by side, from their Player Card models plus the
 * Waiver Board's usage columns — a port of FCApp `PlayerComparison.swift`.
 * Pure given the models' current state.
 */
import { formatNumber } from '@core/numeric'
import type { Position } from '@core/Position'
import { roundAwayFromZero } from '@core/rounding'
import type { WaiverRow } from '../market/WaiverBoardModel'
import { LinkBus } from '../workspaces/LinkBus'
import type { DefenseLookup } from './DefenseLookup'
import type { PlayerCardModel, PlayerLogWeek } from './PlayerCardModel'

/** Swift `PlayerComparison.Metric`, in `allCases` order. */
export const COMPARISON_METRICS = [
  'pointsPerGame', 'expectedPointsLast4', 'snapShare', 'targetShare', 'redZoneTouches',
  'projectedThisWeek', 'restOfSeason', 'gradeScore', 'opponentRank',
] as const
export type ComparisonMetric = (typeof COMPARISON_METRICS)[number]

export const COMPARISON_METRIC_LABEL: Readonly<Record<ComparisonMetric, string>> = {
  pointsPerGame: 'Pts/gm this season',
  expectedPointsLast4: 'xFP, last 4',
  snapShare: 'Snap share, last 4',
  targetShare: 'Target share, last 4',
  redZoneTouches: 'Red zone touches, last 4',
  projectedThisWeek: 'Projected this week',
  restOfSeason: 'Rest of season /gm',
  gradeScore: 'Grade',
  opponentRank: 'Opponent vs position',
}

export const comparisonMetricIsPercent = (m: ComparisonMetric) => m === 'snapShare' || m === 'targetShare'

/** Opponent rank: 1 is the softest defense, so lower is better. */
export const comparisonMetricHigherIsBetter = (m: ComparisonMetric) => m !== 'opponentRank'


export function formatComparisonMetric(m: ComparisonMetric, value: number): string {
  switch (m) {
    case 'snapShare': case 'targetShare': return `${Math.trunc(roundAwayFromZero(value * 100))}%`
    case 'gradeScore': return `${Math.trunc(roundAwayFromZero(value))}`
    case 'opponentRank': return `#${Math.trunc(value)}`
    default: return formatNumber(value, 1)
  }
}

export interface ComparisonPlayer {
  id: string
  name: string
  position?: Position
  team?: string
  opponent?: string
  /** 0…3 — the chart colour. */
  seriesIndex: number
  /** Played weeks, oldest first, the last N. */
  log: PlayerLogWeek[]
  values: Partial<Record<ComparisonMetric, number>>
  /** Worst and best game this season; the estimate is this week's projection, else his average. */
  floor?: number
  expected?: number
  ceiling?: number
}

export class PlayerComparison {
  constructor(
    readonly players: readonly ComparisonPlayer[],
    readonly lastN: number,
    /** Every week any of them played in the window, ascending. */
    readonly weeks: readonly number[],
  ) {}

  values(metric: ComparisonMetric): (number | undefined)[] {
    return this.players.map((p) => p.values[metric])
  }

  /** The column holding the best value on a row; `undefined` when fewer than two players have a value or they're all equal. */
  bestIndex(metric: ComparisonMetric): number | undefined {
    const present: [number, number][] = []
    this.values(metric).forEach((value, index) => { if (value !== undefined) present.push([index, value]) })
    if (present.length < 2 || new Set(present.map(([, v]) => v)).size <= 1) return undefined
    // Swift's `max(by:)` / `min(by:)` keep the first of equal extremes.
    let best = present[0]!
    for (const entry of present.slice(1)) {
      if (comparisonMetricHigherIsBetter(metric) ? best[1] < entry[1] : entry[1] < best[1]) best = entry
    }
    return best[0]
  }

  static build(
    cards: readonly PlayerCardModel[],
    rows: (id: string) => WaiverRow | undefined,
    defense: DefenseLookup,
    lastN: number,
  ): PlayerComparison {
    const weeks = new Set<number>()
    const players = cards.slice(0, LinkBus.compareLimit).map((card, index): ComparisonPlayer => {
      const playedWeeks = card.log.filter((w) => w.played).sort((a, b) => a.week - b.week)
      const window = playedWeeks.slice(-Math.max(lastN, 1))
      for (const w of window) weeks.add(w.week)
      const row = rows(card.id)
      const values: Partial<Record<ComparisonMetric, number>> = {}
      const set = (m: ComparisonMetric, v: number | undefined) => { if (v !== undefined) values[m] = v }
      set('pointsPerGame', card.context.sleeperPointsPerGame(card.id))
      set('expectedPointsLast4', row?.expectedPoints)
      set('snapShare', row?.snapShare)
      set('targetShare', row?.targetShare)
      set('redZoneTouches', row?.redZoneTouches)
      set('projectedThisWeek', card.rotowireThisWeek)
      set('restOfSeason', card.commandCenter?.restOfSeasonPerGame)
      set('gradeScore', card.grade?.score)
      set('opponentRank', defense.cell(card.status?.opponent, card.position)?.rank)
      // Hook: prefer projection bounds once CommandCenterProjection carries them.
      const points = playedWeeks.map((w) => w.points).filter((p): p is number => p !== undefined)
      return {
        id: card.id, name: card.name, position: card.position, team: card.team,
        opponent: card.status?.opponent, seriesIndex: index, log: window, values,
        floor: points.length === 0 ? undefined : Math.min(...points),
        expected: card.rotowireThisWeek ?? values.pointsPerGame,
        ceiling: points.length === 0 ? undefined : Math.max(...points),
      }
    })
    return new PlayerComparison(players, lastN, [...weeks].sort((a, b) => a - b))
  }
}
