// Translate a Sleeper league's own scoring_settings into the app's profile shape.
//
// This replaces guessing (or a hand-uploaded file) with the league's actual
// rules. Sleeper returns scoring as points-per-event, keyed by its own event
// names — see https://docs.sleeper.com league object, `scoring_settings`.
//
// Two conventions differ from our profile and are easy to get backwards:
//   * Sleeper yardage is POINTS PER YARD (pass_yd: 0.04). Our profile stores
//     YARDS PER POINT (passingYardsPerPoint: 25). They are reciprocals.
//   * Sleeper omits keys worth zero, so "absent" means 0, not "unknown".

import { DEFAULT_PROFILE } from './scoringProfile'

// Sleeper event key -> profile field, for straight 1:1 point values.
const DIRECT = {
  pass_td: 'passingTD',
  pass_fd: 'passingFirstDown',
  pass_int: 'interception',
  pass_inc: 'incompletion',
  pass_sack: 'sackTaken',
  pass_int_td: 'pickSix',
  bonus_pass_yd_300: 'passing300Bonus',
  bonus_pass_yd_400: 'passing400Bonus',
  bonus_pass_cmp_25: 'completions25Bonus',

  rush_td: 'rushingTD',
  rush_fd: 'rushingFirstDown',
  bonus_rush_yd_100: 'rushing100Bonus',
  bonus_rush_yd_200: 'rushing200Bonus',

  rec: 'receptionPoints',
  rec_td: 'receivingTD',
  rec_fd: 'receivingFirstDown',
  bonus_rec_yd_100: 'receiving100Bonus',
  bonus_rec_yd_200: 'receiving200Bonus',

  xpm: 'xp',
  fgmiss: 'missedFG',

  sack: 'defSack',
  int: 'defInterception',
  fum_rec: 'defFumbleRecovery',
  def_td: 'defTD',
  safe: 'defSafety',
  pts_allow_0: 'defPointsAllowed0',
  pts_allow_1_6: 'defPointsAllowed1to6',
  pts_allow_7_13: 'defPointsAllowed7to13',
  pts_allow_14_20: 'defPointsAllowed14to20',
  pts_allow_21_27: 'defPointsAllowed21to27',
  pts_allow_28_34: 'defPointsAllowed28to34',
  pts_allow_35p: 'defPointsAllowedOver35',

  idp_tkl: 'idpTackle',
  idp_sack: 'idpSack',
  idp_int: 'idpInterception',
  idp_fum_rec: 'idpFumbleRecovery',
  idp_def_td: 'idpTD',
  idp_pass_def: 'idpPassDefended',
}

// points-per-yard -> yards-per-point, guarding divide-by-zero.
function yardsPerPoint(pointsPerYard) {
  if (!pointsPerYard || pointsPerYard <= 0) return null
  return Math.round((1 / pointsPerYard) * 100) / 100
}

/**
 * PPR format from the per-reception value.
 * @returns {{ value: number, label: string }}
 */
export function detectPpr(scoring) {
  const rec = Number(scoring?.rec ?? 0)
  if (rec >= 1) return { value: rec, label: rec > 1 ? `${rec} PPR` : 'Full PPR' }
  if (rec > 0) return { value: rec, label: rec === 0.5 ? 'Half PPR' : `${rec} PPR` }
  return { value: 0, label: 'Non-PPR (standard)' }
}

/**
 * Build a scoring profile from a Sleeper league.
 *
 * @param {object} scoring  league.scoring_settings
 * @param {string} leagueName
 * @returns {{ profile: object, ppr: object, unmapped: string[] }}
 *          `unmapped` lists scoring rules Sleeper sent that this app does not
 *          model, so the UI can admit the gap instead of implying full fidelity.
 */
export function profileFromSleeperScoring(scoring, leagueName = 'League') {
  if (!scoring || typeof scoring !== 'object') {
    return { profile: null, ppr: detectPpr(null), unmapped: [] }
  }

  // Sleeper omits zero-valued rules, so start from an all-zero base rather than
  // DEFAULT_PROFILE — otherwise an absent rule silently inherits our guess.
  const profile = {}
  for (const key of Object.keys(DEFAULT_PROFILE)) {
    if (typeof DEFAULT_PROFILE[key] === 'number') profile[key] = 0
  }

  const unmapped = []
  for (const [key, raw] of Object.entries(scoring)) {
    const value = Number(raw)
    if (isNaN(value)) continue

    if (DIRECT[key]) { profile[DIRECT[key]] = value; continue }
    if (key === 'pass_yd' || key === 'rush_yd' || key === 'rec_yd') continue // handled below
    if (key.startsWith('fgm')) continue                                      // handled below
    if (value !== 0) unmapped.push(key)
  }

  // Yardage: reciprocal conversion, falling back to the default when the league
  // genuinely scores no yardage.
  profile.passingYardsPerPoint =
    yardsPerPoint(Number(scoring.pass_yd)) ?? DEFAULT_PROFILE.passingYardsPerPoint
  profile.rushingYardsPerPoint =
    yardsPerPoint(Number(scoring.rush_yd)) ?? DEFAULT_PROFILE.rushingYardsPerPoint
  profile.receivingYardsPerPoint =
    yardsPerPoint(Number(scoring.rec_yd)) ?? DEFAULT_PROFILE.receivingYardsPerPoint

  // Field goals: Sleeper buckets by 10 yards, our profile by scoring tier.
  // Take the longest distance in each of our tiers, which is what the tier
  // actually pays for; fall back down the buckets when a league omits some.
  const fg = (...keys) => {
    for (const k of keys) {
      const v = Number(scoring[k])
      if (!isNaN(v) && scoring[k] !== undefined) return v
    }
    return null
  }
  profile.fg0to39 = fg('fgm_30_39', 'fgm_20_29', 'fgm_0_19') ?? 0
  profile.fg40to49 = fg('fgm_40_49') ?? 0
  profile.fg50to59 = fg('fgm_50_59', 'fgm_50p') ?? 0
  profile.fg60plus = fg('fgm_60p', 'fgm_50p', 'fgm_50_59') ?? 0

  profile.id = 'sleeper-league'
  profile.name = `${leagueName} (from Sleeper)`
  profile.source = 'sleeper'
  profile.uploadedAt = new Date().toISOString()

  return { profile, ppr: detectPpr(scoring), unmapped: unmapped.sort() }
}
