/**
 * Scores Sleeper stat lines (projections and actuals) under a league's
 * `scoring_settings` — a port of FCCore `SleeperStatScoring`. The same dot
 * product Sleeper uses, so it's exact for DEF, IDP and kickers too.
 */
import { roundHalfUp } from './rounding'

export interface SleeperScoreComponent {
  /** Sleeper's own key — `rec_yd`, `idp_sack`, `pts_allow_7_13`. */
  key: string
  units: number
  /** Points per unit in this league. */
  rate: number
  points: number
}

export interface SleeperScoredLine {
  points: number
  /** Largest contribution first. */
  components: SleeperScoreComponent[]
  /** Non-zero stats the league doesn't pay for — informational. */
  unscoredKeys: string[]
}

const NON_SCORING = new Set([
  'gp', 'gs', 'gms_active', 'rush_rec_yd', 'anytime_tds', 'first_td',
  'pass_ypa', 'pass_ypc', 'cmp_pct', 'rec_ypr', 'rec_ypt', 'rush_ypa',
  'pass_rtg', 'rec_lng', 'rush_lng', 'pass_lng', 'rec_td_lng', 'rush_td_lng', 'pass_td_lng',
])

/** Ranks, snap counts, games played and Sleeper's own totals. */
export function isNonScoringKey(key: string): boolean {
  if (key.startsWith('pts_') || key.startsWith('pos_rank') || key.startsWith('adp') || key.startsWith('pos_adp')) return true
  if (key.endsWith('_snp') || key.startsWith('tm_')) return true
  return NON_SCORING.has(key)
}

const has = (o: Record<string, number>, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export function scoreSleeperStats(stats: Record<string, number>, scoring: Record<string, number>): SleeperScoredLine {
  const components: SleeperScoreComponent[] = []
  const unscored: string[] = []
  for (const [key, units] of Object.entries(stats)) {
    if (!Number.isFinite(units) || units === 0) continue
    const rate = has(scoring, key) ? scoring[key] : undefined
    if (rate !== undefined && Number.isFinite(rate) && rate !== 0) components.push({ key, units, rate, points: units * rate })
    else if (rate === undefined && !isNonScoringKey(key)) unscored.push(key)
  }
  components.sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
  const total = components.reduce((sum, c) => sum + c.points, 0)
  return { points: roundHalfUp(total, 2), components, unscoredKeys: unscored.sort() }
}

/** Sleeper's default standard scoring (its `pts_std`) — for tests, never a league. */
export const SLEEPER_STANDARD: Readonly<Record<string, number>> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec_yd: 0.1, rec_td: 6, rec_2pt: 2, rec: 0,
  fum_lost: -2,
  st_td: 6, st_fum_rec: 1, st_ff: 1,
  fum_rec_td: 6,
  xpm: 1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5,
  fgmiss: -1, xpmiss: -1,
  def_td: 6, sack: 1, int: 2, ff: 1, fum_rec: 2, safe: 2, blk_kick: 2,
  def_st_td: 6, def_st_ff: 1, def_st_fum_rec: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1,
  pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
}
