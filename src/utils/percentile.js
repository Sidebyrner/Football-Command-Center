/**
 * Percentile rank of `value` within `peers`.
 *
 * `peers` MUST be sorted ascending — the cohort files from
 * scripts/preprocess-nflverse.mjs are pre-sorted so this stays an O(log n)
 * binary search on the hot path (every factor of every player).
 *
 * Returns 0–1: the fraction of the cohort at or below `value`.
 */
export function percentileRank(value, peers) {
  if (!peers || peers.length === 0) return 0.5
  let lo = 0
  let hi = peers.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (peers[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo / peers.length
}
