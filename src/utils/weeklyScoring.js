// Score a single nflverse weekly stat line into FANTASY POINTS under a league's
// own scoring profile.
//
// Why this exists: everything else in this app scores players on a 0-100
// PERCENTILE RANK (evaluationEngine). That answers "how good is this player's
// season profile relative to his position" — it is not points, it is not
// summable, and it cannot tell you what a player actually did in week 6. This
// file answers the other question, in the only unit that matters on Sunday.
//
// Hard constraints on this file:
//   * It must import NOTHING but scoringProfile.js. scripts/preprocess-nflverse.mjs
//     imports it directly under plain Node, so no fetch, no import.meta.env, and
//     relative imports must carry the .js extension.
//   * Yardage in the profile is stored as YARDS PER POINT (receivingYardsPerPoint:
//     10 means 1 pt per 10 yards) — the reciprocal of Sleeper's points-per-yard.
//     Getting this backwards is silent and catastrophic, so every divide goes
//     through perPoint() which also guards against a zero denominator.
//   * What this dataset cannot express is returned in `unsupported` and never
//     zero-filled. A missing stat is stated, not scored as 0.

import { DEFAULT_PROFILE } from './scoringProfile.js'

/**
 * Profile fields that no amount of weekly player data can produce. Team-defense
 * and IDP scoring live in feeds this app does not ingest; pick-sixes are not
 * broken out of `passing_interceptions`.
 */
export const UNSUPPORTED_BY_WEEKLY_DATA = [
  'pickSix',
  'defSack', 'defInterception', 'defFumbleRecovery', 'defTD', 'defSafety',
  'defPointsAllowed0', 'defPointsAllowed1to6', 'defPointsAllowed7to13',
  'defPointsAllowed14to20', 'defPointsAllowed21to27', 'defPointsAllowed28to34',
  'defPointsAllowedOver35',
  'idpTackle', 'idpSack', 'idpInterception', 'idpFumbleRecovery', 'idpTD',
  'idpPassDefended',
]

// nflverse's own fantasy_points_ppr definition, expressed in our profile shape.
// Used ONLY by validateAgainstReference — scoring a row under this must
// reproduce the row's own fp_ppr_ref to the cent, which is what proves the
// arithmetic below has no sign flips, unit errors, or missing terms.
export const PPR_REFERENCE_PROFILE = {
  ...Object.fromEntries(Object.keys(DEFAULT_PROFILE).map((k) => [k, 0])),
  id: 'nflverse-ppr-reference',
  name: 'nflverse fantasy_points_ppr',
  passingYardsPerPoint: 25,
  passingTD: 4,
  interception: -2,
  rushingYardsPerPoint: 10,
  rushingTD: 6,
  receivingYardsPerPoint: 10,
  receivingTD: 6,
  receptionPoints: 1,
  passing2pt: 2,
  rushing2pt: 2,
  receiving2pt: 2,
  fumbleLost: -2,
  specialTeamsTD: 6,
}

/**
 * Which unsupported rules could actually fire for a player at this position.
 * A pick-six is charged to the passer, so it is the QB's only real exposure;
 * team-defense and IDP scoring never touches an offensive skill player.
 */
export function unsupportedFor(position) {
  if (position === 'QB') return ['pickSix']
  if (position === 'DEF' || position === 'DST' || position == null) return UNSUPPORTED_BY_WEEKLY_DATA
  return []
}

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)

// Yardage divides. A profile field of 0 means "this league does not score
// yards", not "divide by zero" — Infinity here would poison every downstream
// average and chart axis.
function perPoint(yards, yardsPerPoint) {
  const ypp = n(yardsPerPoint)
  if (ypp <= 0) return 0
  return n(yards) / ypp
}

/**
 * Score one decoded weekly row.
 *
 * @param {object} w decoded weekly row (see weeklyStatsService.decodeRow)
 * @param {object} profile a scoring profile (DEFAULT_PROFILE shape)
 * @param {string} position QB/RB/WR/TE/K — drives which terms are relevant
 * @returns {{points: number|null, reason?: string,
 *            breakdown: Array<{key,label,units,points}>,
 *            unsupported: string[]}}
 */
export function scoreWeek(w, profile = DEFAULT_PROFILE, position = null) {
  if (!w) return { points: null, reason: 'No stat line', breakdown: [], unsupported: [] }

  // Team defenses are scored from team-level game results this dataset does not
  // carry. Returning null (not 0) keeps a blank cell honest.
  if (position === 'DEF' || position === 'DST') {
    return {
      points: null,
      reason: 'Team defense is not in the nflverse player stats file',
      breakdown: [],
      unsupported: UNSUPPORTED_BY_WEEKLY_DATA,
    }
  }

  const p = profile ?? DEFAULT_PROFILE
  const out = []
  const add = (key, label, units, points) => {
    if (points) out.push({ key, label, units, points })
  }

  // ── Passing ────────────────────────────────────────────────────────────────
  add('passingYards', 'Pass yards', n(w.pass_yd), perPoint(w.pass_yd, p.passingYardsPerPoint))
  add('passingTD', 'Pass TD', n(w.pass_td), n(w.pass_td) * n(p.passingTD))
  add('passingFirstDown', 'Pass 1st downs', n(w.pass_fd), n(w.pass_fd) * n(p.passingFirstDown))
  add('interception', 'Interceptions', n(w.int), n(w.int) * n(p.interception))
  add('sackTaken', 'Sacks taken', n(w.sack), n(w.sack) * n(p.sackTaken))
  // Incompletions are not a column, but attempts - completions is exactly that.
  const incompletions = Math.max(0, n(w.att) - n(w.cmp))
  add('incompletion', 'Incompletions', incompletions, incompletions * n(p.incompletion))
  add('passing2pt', 'Pass 2-pt', n(w.pass_2pt), n(w.pass_2pt) * n(p.passing2pt))

  // Yardage/completion bonuses STACK. Sleeper models bonus_pass_yd_300 and
  // bonus_pass_yd_400 as independent rules (see sleeperScoring.js DIRECT map),
  // so a 410-yard game pays both — it is not a tier where 400 replaces 300.
  if (n(w.pass_yd) >= 300) add('passing300Bonus', '300+ pass yds', 1, n(p.passing300Bonus))
  if (n(w.pass_yd) >= 400) add('passing400Bonus', '400+ pass yds', 1, n(p.passing400Bonus))
  if (n(w.cmp) >= 25) add('completions25Bonus', '25+ completions', 1, n(p.completions25Bonus))

  // ── Rushing ────────────────────────────────────────────────────────────────
  add('rushingYards', 'Rush yards', n(w.rush_yd), perPoint(w.rush_yd, p.rushingYardsPerPoint))
  add('rushingTD', 'Rush TD', n(w.rush_td), n(w.rush_td) * n(p.rushingTD))
  add('rushingFirstDown', 'Rush 1st downs', n(w.rush_fd), n(w.rush_fd) * n(p.rushingFirstDown))
  add('rushing2pt', 'Rush 2-pt', n(w.rush_2pt), n(w.rush_2pt) * n(p.rushing2pt))
  if (n(w.rush_yd) >= 100) add('rushing100Bonus', '100+ rush yds', 1, n(p.rushing100Bonus))
  if (n(w.rush_yd) >= 200) add('rushing200Bonus', '200+ rush yds', 1, n(p.rushing200Bonus))

  // ── Receiving ──────────────────────────────────────────────────────────────
  add('receptionPoints', 'Receptions', n(w.rec), n(w.rec) * n(p.receptionPoints))
  add('receivingYards', 'Rec yards', n(w.rec_yd), perPoint(w.rec_yd, p.receivingYardsPerPoint))
  add('receivingTD', 'Rec TD', n(w.rec_td), n(w.rec_td) * n(p.receivingTD))
  add('receivingFirstDown', 'Rec 1st downs', n(w.rec_fd), n(w.rec_fd) * n(p.receivingFirstDown))
  add('receiving2pt', 'Rec 2-pt', n(w.rec_2pt), n(w.rec_2pt) * n(p.receiving2pt))
  if (n(w.rec_yd) >= 100) add('receiving100Bonus', '100+ rec yds', 1, n(p.receiving100Bonus))
  if (n(w.rec_yd) >= 200) add('receiving200Bonus', '200+ rec yds', 1, n(p.receiving200Bonus))

  // ── Turnovers & special teams ──────────────────────────────────────────────
  const fumblesLost = n(w.rush_fl) + n(w.rec_fl) + n(w.sack_fl)
  add('fumbleLost', 'Fumbles lost', fumblesLost, fumblesLost * n(p.fumbleLost))
  add('specialTeamsTD', 'Return TD', n(w.st_td), n(w.st_td) * n(p.specialTeamsTD))

  // ── Kicking ────────────────────────────────────────────────────────────────
  // The profile has four distance tiers; nflverse has six 10-yard buckets. The
  // 0-39 tier is the sum of three buckets, which is exact. Going the other way
  // (sleeperScoring collapsing Sleeper's own 10-yard buckets into these four)
  // is lossy for leagues that pay differently inside a tier — surfaced in the
  // UI rather than hidden.
  const fgShort = n(w.fg0_19) + n(w.fg20_29) + n(w.fg30_39)
  add('fg0to39', 'FG 0-39', fgShort, fgShort * n(p.fg0to39))
  add('fg40to49', 'FG 40-49', n(w.fg40_49), n(w.fg40_49) * n(p.fg40to49))
  add('fg50to59', 'FG 50-59', n(w.fg50_59), n(w.fg50_59) * n(p.fg50to59))
  add('fg60plus', 'FG 60+', n(w.fg60), n(w.fg60) * n(p.fg60plus))
  add('xp', 'Extra points', n(w.xpm), n(w.xpm) * n(p.xp))
  add('missedFG', 'Missed FG', n(w.fg_miss), n(w.fg_miss) * n(p.missedFG))

  const points = out.reduce((acc, c) => acc + c.points, 0)

  // A rule is only a real gap when the league pays for it AND it could apply to
  // this player. Telling a QB his league scores 16 missing rules — 15 of them
  // team-defense and IDP rules he can never trigger — overstates the gap and
  // trains the reader to ignore the warning.
  const unsupported = unsupportedFor(position).filter((k) => n(p[k]) !== 0)

  return {
    points: Math.round(points * 100) / 100,
    breakdown: out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    unsupported,
  }
}

/**
 * Score a whole season of decoded rows.
 * @returns {{weeks: Array<{week,opp,team,points,breakdown}>, total, perGame, games, unsupported}}
 */
export function scoreWeeks(rows, profile = DEFAULT_PROFILE, position = null) {
  const weeks = []
  let unsupported = []
  for (const r of rows ?? []) {
    const s = scoreWeek(r, profile, position)
    if (s.points == null) continue
    unsupported = s.unsupported
    weeks.push({ week: r.week, opp: r.opp, team: r.team, points: s.points, breakdown: s.breakdown })
  }
  weeks.sort((a, b) => a.week - b.week)
  const total = weeks.reduce((a, w) => a + w.points, 0)
  return {
    weeks,
    total: Math.round(total * 100) / 100,
    games: weeks.length,
    perGame: weeks.length ? Math.round((total / weeks.length) * 100) / 100 : null,
    unsupported,
  }
}

// Linear-interpolated percentile over an ascending array.
function pct(sortedAsc, q) {
  if (!sortedAsc.length) return null
  if (sortedAsc.length === 1) return sortedAsc[0]
  const idx = (sortedAsc.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

/**
 * Distribution of an already-scored week list. This is a FLOOR AND CEILING THE
 * PLAYER ACTUALLY PRODUCED — not evaluationEngine's modelled floor/ceiling,
 * which is an estimate from season-long rate stats. The two are different
 * claims and the UI must label them differently.
 *
 * p20/p80 rather than min/max: one injury exit and one garbage-time TD should
 * not define a player's range.
 */
export function distribution(scoredWeeks) {
  const pts = (scoredWeeks ?? []).map((w) => w.points).filter((v) => typeof v === 'number')
  if (!pts.length) return { floor: null, median: null, ceiling: null, mean: null, stdev: null, cv: null, n: 0 }
  const asc = [...pts].sort((a, b) => a - b)
  const mean = pts.reduce((a, b) => a + b, 0) / pts.length
  const variance = pts.reduce((a, b) => a + (b - mean) ** 2, 0) / pts.length
  const stdev = Math.sqrt(variance)
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100)
  return {
    floor: r2(pct(asc, 0.2)),
    median: r2(pct(asc, 0.5)),
    ceiling: r2(pct(asc, 0.8)),
    mean: r2(mean),
    stdev: r2(stdev),
    // Coefficient of variation — comparable across players with different
    // volumes, unlike raw stdev. Null when mean is ~0 rather than Infinity.
    cv: mean > 0.5 ? r2(stdev / mean) : null,
    n: pts.length,
  }
}

/**
 * The correctness gate. Scores every supplied row under PPR_REFERENCE_PROFILE
 * and compares to that row's own nflverse fantasy_points_ppr.
 *
 * Kickers are excluded: nflverse reports fantasy_points/_ppr as 0 for K, so a
 * comparison there measures nothing.
 *
 * @param {Array<{row: object, position: string}>} entries
 * @returns {{checkedRows, skipped, maxDelta, mismatchRows, worst: Array}}
 */
export function validateAgainstReference(entries) {
  let checkedRows = 0
  let skipped = 0
  let maxDelta = 0
  let mismatchRows = 0
  const worst = []

  for (const { row, position } of entries ?? []) {
    if (position === 'K' || position === 'DEF' || position === 'DST') { skipped++; continue }
    if (row.fp_ppr_ref == null) { skipped++; continue }
    const { points } = scoreWeek(row, PPR_REFERENCE_PROFILE, position)
    if (points == null) { skipped++; continue }
    const delta = Math.abs(points - row.fp_ppr_ref)
    checkedRows++
    if (delta > maxDelta) maxDelta = delta
    if (delta > 0.01) {
      mismatchRows++
      if (worst.length < 5) {
        worst.push({ week: row.week, team: row.team, position, ours: points, nflverse: row.fp_ppr_ref, delta })
      }
    }
  }

  return { checkedRows, skipped, maxDelta: Math.round(maxDelta * 1000) / 1000, mismatchRows, worst }
}
