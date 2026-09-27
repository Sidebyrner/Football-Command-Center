/**
 * Translating a Sleeper league's `scoring_settings` into a profile — a port of
 * FCCore `SleeperScoring`. Anything it can't map is reported, never dropped.
 */
import { roundHalfUp } from './rounding'
import { LEAGUE_DEFAULT, zeroedProfile, type ScoringProfile, type ScoringRule } from './ScoringProfile'

export interface PPRFormat {
  value: number
  label: string
}

export interface SleeperScoringTranslation {
  profile: ScoringProfile
  ppr: PPRFormat
  /** Rules Sleeper sent that the app doesn't model, sorted. */
  unmapped: string[]
  /** Field-goal buckets paid differently inside one of the four tiers. */
  lossyFieldGoalTiers: string[]
}

/** Sleeper key → profile rule, for straight one-to-one values. */
export const SLEEPER_DIRECT_RULES: Readonly<Record<string, ScoringRule>> = {
  pass_td: 'passingTD', pass_fd: 'passingFirstDown', pass_int: 'interception', pass_inc: 'incompletion',
  pass_sack: 'sackTaken', pass_int_td: 'pickSix',
  bonus_pass_yd_300: 'passing300Bonus', bonus_pass_yd_400: 'passing400Bonus', bonus_pass_cmp_25: 'completions25Bonus',
  rush_td: 'rushingTD', rush_fd: 'rushingFirstDown', bonus_rush_yd_100: 'rushing100Bonus', bonus_rush_yd_200: 'rushing200Bonus',
  fum_lost: 'fumbleLost', pass_2pt: 'passing2pt', rush_2pt: 'rushing2pt', rec_2pt: 'receiving2pt', st_td: 'specialTeamsTD',
  rec: 'receptionPoints', rec_td: 'receivingTD', rec_fd: 'receivingFirstDown',
  bonus_rec_yd_100: 'receiving100Bonus', bonus_rec_yd_200: 'receiving200Bonus',
  xpm: 'xp', fgmiss: 'missedFG',
  sack: 'defSack', int: 'defInterception', fum_rec: 'defFumbleRecovery', def_td: 'defTD', safe: 'defSafety',
  pts_allow_0: 'defPointsAllowed0', pts_allow_1_6: 'defPointsAllowed1to6', pts_allow_7_13: 'defPointsAllowed7to13',
  pts_allow_14_20: 'defPointsAllowed14to20', pts_allow_21_27: 'defPointsAllowed21to27',
  pts_allow_28_34: 'defPointsAllowed28to34', pts_allow_35p: 'defPointsAllowedOver35',
  idp_tkl: 'idpTackle', idp_sack: 'idpSack', idp_int: 'idpInterception', idp_fum_rec: 'idpFumbleRecovery',
  idp_def_td: 'idpTD', idp_pass_def: 'idpPassDefended',
}

/** Sleeper's points-per-yard → this profile's yards-per-point. */
export function yardsPerPoint(pointsPerYard: number | undefined): number | undefined {
  if (pointsPerYard === undefined || !(pointsPerYard > 0) || !Number.isFinite(pointsPerYard)) return undefined
  return roundHalfUp(1 / pointsPerYard, 2)
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Builds a profile from a league's own settings, starting from all zeros. */
export function fromSleeper(scoringSettings: Record<string, number>, leagueName = 'League'): SleeperScoringTranslation {
  const profile = zeroedProfile('sleeper-league', `${leagueName} (from Sleeper)`, 'sleeper')
  const unmapped: string[] = []
  const yardageKeys = new Set(['pass_yd', 'rush_yd', 'rec_yd'])
  for (const [key, value] of Object.entries(scoringSettings)) {
    if (!Number.isFinite(value)) continue
    const rule = has(SLEEPER_DIRECT_RULES, key) ? SLEEPER_DIRECT_RULES[key] : undefined
    if (rule) { profile[rule] = value; continue }
    if (yardageKeys.has(key) || key.startsWith('fgm')) continue
    if (value !== 0) unmapped.push(key)
  }
  profile.passingYardsPerPoint = yardsPerPoint(scoringSettings.pass_yd) ?? LEAGUE_DEFAULT.passingYardsPerPoint
  profile.rushingYardsPerPoint = yardsPerPoint(scoringSettings.rush_yd) ?? LEAGUE_DEFAULT.rushingYardsPerPoint
  profile.receivingYardsPerPoint = yardsPerPoint(scoringSettings.rec_yd) ?? LEAGUE_DEFAULT.receivingYardsPerPoint

  // Take the longest bucket in each tier; fall back down when a league omits some.
  const firstPresent = (keys: string[]) => {
    for (const k of keys) if (has(scoringSettings, k) && Number.isFinite(scoringSettings[k])) return scoringSettings[k]
    return undefined
  }
  profile.fg0to39 = firstPresent(['fgm_30_39', 'fgm_20_29', 'fgm_0_19']) ?? 0
  profile.fg40to49 = firstPresent(['fgm_40_49']) ?? 0
  profile.fg50to59 = firstPresent(['fgm_50_59', 'fgm_50p']) ?? 0
  profile.fg60plus = firstPresent(['fgm_60p', 'fgm_50p', 'fgm_50_59']) ?? 0

  const shortTiers = ['fgm_0_19', 'fgm_20_29', 'fgm_30_39']
  const shortValues = shortTiers.filter((k) => has(scoringSettings, k)).map((k) => scoringSettings[k])
  const lossy = new Set(shortValues).size > 1 ? shortTiers : []

  return { profile, ppr: detectPPR(scoringSettings), unmapped: unmapped.sort(), lossyFieldGoalTiers: lossy }
}

/** Swift's `"\(Double)"`: whole numbers keep a `.0`. */
const swiftDouble = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

export function detectPPR(scoringSettings: Record<string, number> | undefined): PPRFormat {
  const rec = scoringSettings?.rec ?? 0
  if (rec >= 1) return { value: rec, label: rec > 1 ? `${swiftDouble(rec)} PPR` : 'Full PPR' }
  if (rec > 0) return { value: rec, label: rec === 0.5 ? 'Half PPR' : `${swiftDouble(rec)} PPR` }
  return { value: 0, label: 'Non-PPR (standard)' }
}
