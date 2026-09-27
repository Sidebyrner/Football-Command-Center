/**
 * Percentile rank against a real cohort — a port of FCCore `Percentile`.
 * The fraction of ascending `sortedPeers` at or below `value`, 0…1. An empty
 * cohort answers 0.5, but callers shouldn't ask.
 */
export function percentileRank(value: number, sortedPeers: readonly number[]): number {
  if (sortedPeers.length === 0 || !Number.isFinite(value)) return 0.5
  let low = 0
  let high = sortedPeers.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sortedPeers[mid]! <= value) low = mid + 1
    else high = mid
  }
  return low / sortedPeers.length
}
