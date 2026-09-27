/**
 * A league's scoring rules as data — a port of FCCore `ScoringProfile`.
 *
 * Yardage is **yards per point** (`receivingYardsPerPoint: 10` = a point per
 * ten yards), the reciprocal of Sleeper's points-per-yard. Getting that
 * backwards is silent and catastrophic, so every divide goes through one
 * guarded helper in the engine.
 */

/** Every rule, in the Swift declaration order (`ScoringRule.allCases`). */
export const SCORING_RULES = [
  'passingYardsPerPoint', 'passingTD', 'passingFirstDown', 'incompletion', 'sackTaken', 'interception', 'pickSix',
  'passing300Bonus', 'passing400Bonus', 'completions25Bonus',
  'rushingYardsPerPoint', 'rushingTD', 'rushingFirstDown', 'rushing100Bonus', 'rushing200Bonus',
  'receptionPoints', 'receivingYardsPerPoint', 'receivingTD', 'receivingFirstDown', 'receiving100Bonus', 'receiving200Bonus',
  'fumbleLost', 'passing2pt', 'rushing2pt', 'receiving2pt', 'specialTeamsTD',
  'fg0to39', 'fg40to49', 'fg50to59', 'fg60plus', 'xp', 'missedFG',
  'defSack', 'defInterception', 'defFumbleRecovery', 'defTD', 'defSafety',
  'defPointsAllowed0', 'defPointsAllowed1to6', 'defPointsAllowed7to13', 'defPointsAllowed14to20',
  'defPointsAllowed21to27', 'defPointsAllowed28to34', 'defPointsAllowedOver35',
  'idpTackle', 'idpSack', 'idpInterception', 'idpFumbleRecovery', 'idpTD', 'idpPassDefended',
] as const

export type ScoringRule = (typeof SCORING_RULES)[number]

export const RULE_LABELS: Readonly<Record<ScoringRule, string>> = {
  passingYardsPerPoint: 'Pass yards', passingTD: 'Pass TD', passingFirstDown: 'Pass 1st downs',
  incompletion: 'Incompletions', sackTaken: 'Sacks taken', interception: 'Interceptions', pickSix: 'Pick six',
  passing300Bonus: '300+ pass yds', passing400Bonus: '400+ pass yds', completions25Bonus: '25+ completions',
  rushingYardsPerPoint: 'Rush yards', rushingTD: 'Rush TD', rushingFirstDown: 'Rush 1st downs',
  rushing100Bonus: '100+ rush yds', rushing200Bonus: '200+ rush yds',
  receptionPoints: 'Receptions', receivingYardsPerPoint: 'Rec yards', receivingTD: 'Rec TD',
  receivingFirstDown: 'Rec 1st downs', receiving100Bonus: '100+ rec yds', receiving200Bonus: '200+ rec yds',
  fumbleLost: 'Fumbles lost', passing2pt: 'Pass 2-pt', rushing2pt: 'Rush 2-pt', receiving2pt: 'Rec 2-pt',
  specialTeamsTD: 'Return TD',
  fg0to39: 'FG 0-39', fg40to49: 'FG 40-49', fg50to59: 'FG 50-59', fg60plus: 'FG 60+', xp: 'Extra points', missedFG: 'Missed FG',
  defSack: 'DEF sacks', defInterception: 'DEF interceptions', defFumbleRecovery: 'DEF fumble recoveries',
  defTD: 'DEF TD', defSafety: 'DEF safety',
  defPointsAllowed0: 'Shutout', defPointsAllowed1to6: '1-6 allowed', defPointsAllowed7to13: '7-13 allowed',
  defPointsAllowed14to20: '14-20 allowed', defPointsAllowed21to27: '21-27 allowed',
  defPointsAllowed28to34: '28-34 allowed', defPointsAllowedOver35: '35+ allowed',
  idpTackle: 'IDP tackles', idpSack: 'IDP sacks', idpInterception: 'IDP interceptions',
  idpFumbleRecovery: 'IDP fumble recoveries', idpTD: 'IDP TD', idpPassDefended: 'IDP passes defended',
}

/**
 * Where a profile came from, so the UI can say whether these are the league's
 * real rules. `reference` is nflverse's PPR definition, for the gate only.
 */
export type ScoringSource = 'bundledDefault' | 'sleeper' | 'reference'

export type ScoringProfile = { id: string; name: string; source: ScoringSource } & Record<ScoringRule, number>

/**
 * Every rule zeroed. Sleeper omits rules worth nothing, so absent means zero —
 * starting a translation from the default would let a rule inherit our guess.
 */
export function zeroedProfile(id: string, name: string, source: ScoringSource): ScoringProfile {
  const p = { id, name, source } as ScoringProfile
  for (const rule of SCORING_RULES) p[rule] = 0
  return p
}

const withRules = (base: ScoringProfile, rules: Partial<Record<ScoringRule, number>>): ScoringProfile =>
  Object.freeze({ ...base, ...rules })

/** Mirrors the user's league — a fallback and reference, never the truth. */
export const LEAGUE_DEFAULT: ScoringProfile = withRules(zeroedProfile('default-2026', 'League Default (2026)', 'bundledDefault'), {
  passingYardsPerPoint: 20, passingTD: 6, passingFirstDown: 1, incompletion: -1, sackTaken: -1,
  interception: -5, pickSix: -10, passing300Bonus: 3, passing400Bonus: 6, completions25Bonus: 3,
  rushingYardsPerPoint: 10, rushingTD: 6, rushingFirstDown: 1, rushing100Bonus: 3, rushing200Bonus: 6,
  receptionPoints: 0, // NOT PPR
  receivingYardsPerPoint: 10, receivingTD: 6, receivingFirstDown: 1, receiving100Bonus: 3, receiving200Bonus: 6,
  fumbleLost: -2, passing2pt: 2, rushing2pt: 2, receiving2pt: 2, specialTeamsTD: 6,
  fg0to39: 3, fg40to49: 4, fg50to59: 5, fg60plus: 6, xp: 1, missedFG: -2,
  defSack: 1, defInterception: 3, defFumbleRecovery: 2, defTD: 6, defSafety: 2,
  defPointsAllowed0: 12, defPointsAllowed1to6: 9, defPointsAllowed7to13: 6, defPointsAllowed14to20: 3,
  defPointsAllowed21to27: 1, defPointsAllowed28to34: 0, defPointsAllowedOver35: -3,
  idpTackle: 1, idpSack: 3, idpInterception: 5, idpFumbleRecovery: 3, idpTD: 6, idpPassDefended: 1,
})

/** nflverse's `fantasy_points_ppr` — used **only** by the correctness gate. */
export const PPR_REFERENCE: ScoringProfile = withRules(zeroedProfile('nflverse-ppr-reference', 'nflverse fantasy_points_ppr', 'reference'), {
  passingYardsPerPoint: 25, passingTD: 4, interception: -2,
  rushingYardsPerPoint: 10, rushingTD: 6, receivingYardsPerPoint: 10, receivingTD: 6, receptionPoints: 1,
  passing2pt: 2, rushing2pt: 2, receiving2pt: 2, fumbleLost: -2, specialTeamsTD: 6,
})
