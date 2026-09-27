// What the market implies about how a game will be PLAYED, not just how much
// scoring it expects.
//
// An implied team total alone can't distinguish a track meet from a favorite
// grinding out a lead, and those produce opposite outcomes for the same
// player. Two axes do: the total (how much scoring) and the spread (whether
// anyone has to keep throwing).
//
// Lives here rather than inside GameEnvironmentScatter so the scatter's
// legend and the per-player reads on the Odds page can't drift apart.

// A touchdown is the natural competitive/blowout boundary — a real threshold
// rather than the median of whatever happens to be on this week's board.
export const BLOWOUT_SPREAD = 7

export const GAME_SCRIPTS = {
  shootout: {
    key: 'shootout', label: 'Shootout', axis: 'high total, close game',
    blurb: 'Both sides throw. Start everyone; WR ceilings live here.',
  },
  blowout: {
    key: 'blowout', label: 'Blowout', axis: 'high total, big spread',
    blurb: "Favorite's RB grinds the clock; the dog's WRs get garbage time. Fade the dog's RB.",
  },
  grind: {
    key: 'grind', label: 'Grind', axis: 'low total, close game',
    blurb: 'Low ceilings on both sides. The classic fade.',
  },
  slog: {
    key: 'slog', label: 'Slog', axis: 'low total, big spread',
    blurb: "Favorite's RB and little else.",
  },
}

export const SCRIPT_ORDER = ['shootout', 'blowout', 'grind', 'slog']

/**
 * @param {number|null} total - game O/U
 * @param {number|null} margin - absolute spread, in points (sign doesn't matter
 *   here; which side is favored is a separate question, see readForPosition)
 * @param {number|null} medianTotal - this week's median total, the moving half
 *   of the split
 * @returns {{key, label, axis, blurb}|null} null when the lines are missing —
 *   no classification beats a wrong one.
 */
export function classifyGameScript(total, margin, medianTotal) {
  if (total == null || margin == null || medianTotal == null) return null
  const high = total >= medianTotal
  const close = Math.abs(margin) < BLOWOUT_SPREAD
  if (high && close) return GAME_SCRIPTS.shootout
  if (high && !close) return GAME_SCRIPTS.blowout
  if (!high && close) return GAME_SCRIPTS.grind
  return GAME_SCRIPTS.slog
}

/**
 * The same reading, narrowed to one player — because a script cuts opposite
 * ways depending on position and on which side of the spread he's on. A
 * blowout is the best thing that can happen to the favorite's RB and the
 * worst thing that can happen to the dog's.
 *
 * Returns null where there's no read worth stating: IDP production tracks
 * snap volume rather than either axis here, and inventing a line for it would
 * be worse than leaving the cell empty.
 *
 * @param {string} scriptKey
 * @param {string} position
 * @param {boolean} isFavored - is THIS player's team the favorite
 */
export function readForPosition(scriptKey, position, isFavored) {
  if (!scriptKey || !position) return null
  const pass = position === 'QB' || position === 'WR' || position === 'TE'

  switch (scriptKey) {
    case 'shootout':
      if (pass) return 'Both sides throwing — ceilings live here.'
      if (position === 'RB') return 'Scoring game, but the pass may take over late.'
      if (position === 'K') return 'Drives that stall still reach field-goal range.'
      if (position === 'DEF') return 'Worst spot for a defense.'
      return null

    case 'blowout':
      if (position === 'RB') {
        return isFavored ? 'Clock-grinding work as the lead grows.' : 'Game flow abandons the run — the classic fade.'
      }
      if (pass) {
        return isFavored ? 'Lead means fewer pass attempts late.' : 'Garbage-time volume chasing points.'
      }
      if (position === 'K') return isFavored ? 'Plenty of drives, some end in FGs.' : 'Trailing teams go for it instead of kicking.'
      if (position === 'DEF') return isFavored ? 'Leading defense — sacks and picks come to them.' : 'Chasing, and getting thrown on.'
      return null

    case 'grind':
      if (position === 'DEF') return 'Low-scoring game favors the defense.'
      if (position === 'K') return 'Stalled drives mean field-goal attempts.'
      return 'Low ceilings on both sides.'

    case 'slog':
      if (position === 'RB' && isFavored) return "Favorite's RB and little else."
      if (position === 'DEF') return isFavored ? 'Leading in a low-scoring game — the ideal DEF spot.' : 'Low total helps, but they are trailing.'
      if (position === 'K') return 'Few scoring chances of any kind.'
      return 'Little here — low total, and not the side controlling it.'

    default:
      return null
  }
}

/**
 * Median of this week's totals — the moving half of the split. Exported so the
 * scatter and the per-player table classify against the same board.
 */
export function medianTotal(totals) {
  const sorted = (totals ?? []).filter((t) => t != null).sort((a, b) => a - b)
  if (!sorted.length) return null
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
}
