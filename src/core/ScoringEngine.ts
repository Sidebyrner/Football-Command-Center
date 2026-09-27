/**
 * Scores nflverse weekly stat lines under a league's profile — a port of FCCore
 * `ScoringEngine` and `ScoringValidation`. What it can't express is returned in
 * `unsupported`, never zero-filled.
 */
import type { Position } from './Position'
import { finite, roundHalfUp } from './rounding'
import { LEAGUE_DEFAULT, PPR_REFERENCE, RULE_LABELS, type ScoringProfile, type ScoringRule } from './ScoringProfile'
import type { WeeklyFile, WeeklyRow } from './WeeklyStats'

export interface ScoreComponent {
  rule: ScoringRule
  label: string
  /** How many of the thing happened. */
  units: number
  points: number
}

/** `points === undefined` means unscorable, and `reason` says why — not zero. */
export interface WeekScore {
  points?: number
  reason?: string
  breakdown: ScoreComponent[]
  /** Rules this league pays for that the data can't produce, for this position. */
  unsupported: ScoringRule[]
}

export interface ScoredWeek {
  week: number
  team?: string
  opponent?: string
  points: number
  breakdown: ScoreComponent[]
}

export interface SeasonScore {
  weeks: ScoredWeek[]
  total: number
  games: number
  /** `undefined` rather than zero when no week could be scored. */
  pointsPerGame?: number
  unsupported: ScoringRule[]
}

/** Rules no weekly *player* data can produce. */
export const UNSUPPORTED_BY_WEEKLY_DATA: readonly ScoringRule[] = [
  'pickSix',
  'defSack', 'defInterception', 'defFumbleRecovery', 'defTD', 'defSafety',
  'defPointsAllowed0', 'defPointsAllowed1to6', 'defPointsAllowed7to13',
  'defPointsAllowed14to20', 'defPointsAllowed21to27', 'defPointsAllowed28to34', 'defPointsAllowedOver35',
  'idpTackle', 'idpSack', 'idpInterception', 'idpFumbleRecovery', 'idpTD', 'idpPassDefended',
]

/** Which unsupported rules could actually fire for this position. */
export function unsupportedRules(position: Position | undefined): readonly ScoringRule[] {
  if (position === undefined || position === 'DEF') return UNSUPPORTED_BY_WEEKLY_DATA
  return position === 'QB' ? ['pickSix'] : []
}

/** Yardage divide; a zero rate means "not scored", never infinity. */
export function perPoint(yards: number, ypp: number): number {
  const rate = finite(ypp)
  return rate > 0 ? finite(yards) / rate : 0
}

export function scoreWeek(row: WeeklyRow | undefined, profile: ScoringProfile = LEAGUE_DEFAULT, position?: Position): WeekScore {
  if (!row) return { reason: 'No stat line', breakdown: [], unsupported: [] }
  if (position === 'DEF') {
    return { reason: 'Team defense is not in the nflverse player stats file', breakdown: [], unsupported: [...UNSUPPORTED_BY_WEEKLY_DATA] }
  }
  const components: ScoreComponent[] = []
  const add = (rule: ScoringRule, units: number, points: number) => {
    if (points !== 0) components.push({ rule, label: RULE_LABELS[rule], units, points })
  }
  const n = (s: Parameters<WeeklyRow['number']>[0]) => row.number(s)

  // Passing
  const passYards = n('passYards')
  add('passingYardsPerPoint', passYards, perPoint(passYards, profile.passingYardsPerPoint))
  add('passingTD', n('passTD'), n('passTD') * profile.passingTD)
  add('passingFirstDown', n('passFirstDowns'), n('passFirstDowns') * profile.passingFirstDown)
  add('interception', n('interceptions'), n('interceptions') * profile.interception)
  add('sackTaken', n('sacks'), n('sacks') * profile.sackTaken)
  const incompletions = Math.max(0, n('attempts') - n('completions'))
  add('incompletion', incompletions, incompletions * profile.incompletion)
  add('passing2pt', n('pass2pt'), n('pass2pt') * profile.passing2pt)
  // Bonuses stack: a 410-yard game pays both.
  if (passYards >= 300) add('passing300Bonus', 1, profile.passing300Bonus)
  if (passYards >= 400) add('passing400Bonus', 1, profile.passing400Bonus)
  if (n('completions') >= 25) add('completions25Bonus', 1, profile.completions25Bonus)

  // Rushing
  const rushYards = n('rushYards')
  add('rushingYardsPerPoint', rushYards, perPoint(rushYards, profile.rushingYardsPerPoint))
  add('rushingTD', n('rushTD'), n('rushTD') * profile.rushingTD)
  add('rushingFirstDown', n('rushFirstDowns'), n('rushFirstDowns') * profile.rushingFirstDown)
  add('rushing2pt', n('rush2pt'), n('rush2pt') * profile.rushing2pt)
  if (rushYards >= 100) add('rushing100Bonus', 1, profile.rushing100Bonus)
  if (rushYards >= 200) add('rushing200Bonus', 1, profile.rushing200Bonus)

  // Receiving
  const recYards = n('recYards')
  add('receptionPoints', n('receptions'), n('receptions') * profile.receptionPoints)
  add('receivingYardsPerPoint', recYards, perPoint(recYards, profile.receivingYardsPerPoint))
  add('receivingTD', n('recTD'), n('recTD') * profile.receivingTD)
  add('receivingFirstDown', n('recFirstDowns'), n('recFirstDowns') * profile.receivingFirstDown)
  add('receiving2pt', n('rec2pt'), n('rec2pt') * profile.receiving2pt)
  if (recYards >= 100) add('receiving100Bonus', 1, profile.receiving100Bonus)
  if (recYards >= 200) add('receiving200Bonus', 1, profile.receiving200Bonus)

  // Turnovers and special teams
  const fumblesLost = n('rushFumblesLost') + n('recFumblesLost') + n('sackFumblesLost')
  add('fumbleLost', fumblesLost, fumblesLost * profile.fumbleLost)
  add('specialTeamsTD', n('specialTeamsTD'), n('specialTeamsTD') * profile.specialTeamsTD)

  // Kicking: the 0-39 tier is the sum of three ten-yard buckets.
  const shortFG = n('fg0to19') + n('fg20to29') + n('fg30to39')
  add('fg0to39', shortFG, shortFG * profile.fg0to39)
  add('fg40to49', n('fg40to49'), n('fg40to49') * profile.fg40to49)
  add('fg50to59', n('fg50to59'), n('fg50to59') * profile.fg50to59)
  add('fg60plus', n('fg60plus'), n('fg60plus') * profile.fg60plus)
  add('xp', n('extraPointsMade'), n('extraPointsMade') * profile.xp)
  add('missedFG', n('fgMissed'), n('fgMissed') * profile.missedFG)

  const points = components.reduce((sum, c) => sum + c.points, 0)
  return {
    points: roundHalfUp(points, 2),
    breakdown: components.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    unsupported: unsupportedRules(position).filter((r) => profile[r] !== 0),
  }
}

export function scoreSeason(rows: WeeklyRow[], profile: ScoringProfile = LEAGUE_DEFAULT, position?: Position): SeasonScore {
  const weeks: ScoredWeek[] = []
  let unsupported: ScoringRule[] = []
  for (const row of rows) {
    const result = scoreWeek(row, profile, position)
    if (result.points === undefined) continue
    unsupported = result.unsupported
    weeks.push({ week: row.week, team: row.team, opponent: row.opponent, points: result.points, breakdown: result.breakdown })
  }
  weeks.sort((a, b) => a.week - b.week)
  const total = weeks.reduce((sum, w) => sum + w.points, 0)
  return {
    weeks,
    total: roundHalfUp(total, 2),
    games: weeks.length,
    pointsPerGame: weeks.length ? roundHalfUp(total / weeks.length, 2) : undefined,
    unsupported,
  }
}

// MARK: - The correctness gate

export interface ScoringGateMismatch {
  gsisID: string
  week: number
  team?: string
  position?: Position
  ours: number
  nflverse: number
  delta: number
}

export interface ScoringGateReport {
  checkedRows: number
  skippedRows: number
  maxDelta: number
  mismatchRows: number
  worst: ScoringGateMismatch[]
  passed: boolean
}

/** Deltas above a cent are real arithmetic disagreements. */
export const REFERENCE_TOLERANCE = 0.01

/**
 * Scores every row under `PPR_REFERENCE` and compares with the row's own
 * `fantasy_points_ppr`. Kickers (nflverse reports 0) and DEF are skipped.
 */
export function validateAgainstReference(file: WeeklyFile, profile: ScoringProfile = PPR_REFERENCE, maximumMismatchesRecorded = 5): ScoringGateReport {
  let checked = 0
  let skipped = 0
  let maxDelta = 0
  let mismatches = 0
  const worst: ScoringGateMismatch[] = []
  for (const player of file.allPlayers()) {
    const position = player.position
    for (const row of player.rows) {
      if (position === 'K' || position === 'DEF') { skipped++; continue }
      const reference = row.value('pprReference')
      if (reference === undefined) { skipped++; continue }
      const points = scoreWeek(row, profile, position).points
      if (points === undefined) { skipped++; continue }
      checked++
      const delta = Math.abs(points - reference)
      if (delta > maxDelta) maxDelta = delta
      if (delta > REFERENCE_TOLERANCE) {
        mismatches++
        if (worst.length < maximumMismatchesRecorded) {
          worst.push({ gsisID: player.gsisID, week: row.week, team: row.team, position, ours: points, nflverse: reference, delta })
        }
      }
    }
  }
  return { checkedRows: checked, skippedRows: skipped, maxDelta: roundHalfUp(maxDelta, 3), mismatchRows: mismatches, worst, passed: mismatches === 0 }
}
