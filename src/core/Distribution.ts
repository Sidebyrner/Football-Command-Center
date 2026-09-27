/**
 * Floor, median and ceiling a player **actually produced** — a port of FCCore
 * `Distribution`. Not a modelled range; the UI labels the two differently.
 */
import { roundHalfUp } from './rounding'

export interface Distribution {
  /** 20th percentile of scored weeks. */
  floor?: number
  median?: number
  /** 80th percentile of scored weeks. */
  ceiling?: number
  mean?: number
  standardDeviation?: number
  /** Comparable across volumes; `undefined` when the mean is near zero. */
  coefficientOfVariation?: number
  sampleCount: number
}

export const EMPTY_DISTRIBUTION: Distribution = { sampleCount: 0 }

/** Below this mean, a coefficient of variation is noise dressed as a number. */
export const MINIMUM_MEAN_FOR_COEFFICIENT = 0.5

/** Linear-interpolated percentile over an ascending array. */
export function interpolatedPercentile(ascending: readonly number[], quantile: number): number | undefined {
  if (ascending.length === 0) return undefined
  if (ascending.length === 1) return ascending[0]
  const index = (ascending.length - 1) * quantile
  const low = Math.floor(index)
  const high = Math.ceil(index)
  if (low === high) return ascending[low]
  return ascending[low]! + (ascending[high]! - ascending[low]!) * (index - low)
}

/** p20/p80 rather than min/max: one injury exit shouldn't define a range. */
export function distribution(points: readonly number[]): Distribution {
  const values = points.filter(Number.isFinite)
  if (values.length === 0) return EMPTY_DISTRIBUTION
  const ascending = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length
  const sd = Math.sqrt(variance)
  const r = (v: number | undefined) => (v === undefined ? undefined : roundHalfUp(v, 2))
  return {
    floor: r(interpolatedPercentile(ascending, 0.2)),
    median: r(interpolatedPercentile(ascending, 0.5)),
    ceiling: r(interpolatedPercentile(ascending, 0.8)),
    mean: roundHalfUp(mean, 2),
    standardDeviation: roundHalfUp(sd, 2),
    coefficientOfVariation: mean > MINIMUM_MEAN_FOR_COEFFICIENT ? roundHalfUp(sd / mean, 2) : undefined,
    sampleCount: values.length,
  }
}

export const distributionOfWeeks = (weeks: readonly { points: number }[]) => distribution(weeks.map((w) => w.points))
