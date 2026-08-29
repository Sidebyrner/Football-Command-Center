// Evaluation Engine — weekly start/sit model + draft value model.
//
// Every factor is a percentile against a REAL cohort of qualifying players at
// the same position last season (see services/cohortService.js). Metrics that
// nflverse does not publish — YPRR, separation, OL grade, first-read rate,
// red-zone targets, snap share, implied team total, opponent rank — are not
// modelled at all. They are not defaulted, not simulated, not filled with a
// position average. A factor either has real data behind it or it is absent
// from the weighting, and `coverage` reports how much of the weight was real.

import { getFormatImpact } from './scoringProfile'
import { percentileRank } from './percentile'
import { getCohort } from '../services/cohortService'

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v))
}

// Metrics where a lower value is better — percentile is inverted.
const INVERTED = new Set(['intRate', 'sackRate'])

// ── Weights ───────────────────────────────────────────────────────────────────
// Weekly leans on per-game rate and efficiency; draft leans on season volume.
// Shaped by the position philosophies in To-Dos/ (RB: volume is king;
// WR: target share and air yards lead).

const WEEKLY_WEIGHTS = {
  QB: { qbRating: 12, completionPct: 9, yardsPerAttempt: 9, intRate: 8, sackRate: 6, rushingAttempts: 7, adotQb: 5 },
  RB: { touchesPerGame: 12, rushingAttempts: 10, rushingFirstDowns: 8, yardsPerCarry: 7, targetShare: 7, targetsPerGame: 6, trueCatchRate: 4 },
  WR: { targetShare: 11, targetsPerGame: 9, airYardsShare: 8, wopr: 8, yardsPerTarget: 7, receivingFirstDowns: 6, trueCatchRate: 6, adot: 5, racr: 4 },
  TE: { targetShare: 12, targetsPerGame: 9, wopr: 8, receivingFirstDowns: 7, trueCatchRate: 7, yardsPerTarget: 6, airYardsShare: 5, adot: 4, racr: 4 },
  K:  { fgPct: 10, fantasyPointsPerGame: 10 },
}

const DRAFT_WEIGHTS = {
  QB: { qbRating: 12, yardsPerAttempt: 10, completionPct: 9, rushingAttempts: 9, intRate: 8, seasonRushYards: 7, sackRate: 6, adotQb: 5 },
  RB: { touchesPerGame: 12, seasonRushYards: 11, rushingAttempts: 10, rushingFirstDowns: 8, targetShare: 7, targetsPerGame: 6, yardsPerCarry: 6, trueCatchRate: 4 },
  WR: { targetShare: 12, targetsPerGame: 10, airYardsShare: 9, wopr: 9, receivingFirstDowns: 7, yardsPerTarget: 7, trueCatchRate: 5, adot: 5, racr: 4 },
  TE: { targetShare: 13, targetsPerGame: 10, wopr: 9, receivingFirstDowns: 8, trueCatchRate: 7, yardsPerTarget: 6, airYardsShare: 5, adot: 4, racr: 4 },
  K:  { fgPct: 10, fantasyPointsPerGame: 10 },
}

// Positions with no modellable inputs from our data sources.
const UNMODELLED = new Set(['DEF'])

// ── Injury ────────────────────────────────────────────────────────────────────
function injuryModifier(injuryStatus) {
  const s = (injuryStatus || '').toLowerCase()
  if (s === 'out' || s === 'ir' || s === 'pup') return 0
  if (s === 'doubtful') return 0.25
  if (s === 'questionable') return 0.75
  return 1.0
}

// ── Scoring-profile weight adjustments ───────────────────────────────────────
// Nudges weights toward what the league actually pays for. Only touches
// metrics that exist in the weight table for that position.
function applyProfile(weights, profile) {
  const w = { ...weights }
  const bump = (key, by) => { if (w[key] != null) w[key] = Math.max(0, w[key] + by) }

  const ppr = profile?.receptionPoints ?? 0
  if (ppr === 0) {
    // Non-PPR: raw volume matters less, yards-per-opportunity more.
    bump('targetsPerGame', -2)
    bump('targetShare', -1)
    bump('yardsPerTarget', +2)
    bump('yardsPerCarry', +1)
  } else if (ppr >= 1) {
    // Full PPR: catches are points.
    bump('targetsPerGame', +2)
    bump('trueCatchRate', +1)
  }

  if ((profile?.receivingFirstDown ?? 0) >= 1) bump('receivingFirstDowns', +2)
  if ((profile?.rushingFirstDown ?? 0) >= 1) bump('rushingFirstDowns', +2)
  if ((profile?.passingFirstDown ?? 0) >= 1) bump('completionPct', +1)
  if ((profile?.incompletion ?? 0) <= -1) {
    bump('completionPct', +2)
    bump('sackRate', +1)
  }
  if ((profile?.interception ?? 0) <= -4) bump('intRate', +2)

  return w
}

// ── Scoring ───────────────────────────────────────────────────────────────────
// Only metrics with BOTH a real value and a real cohort contribute. Everything
// else is reported as missing and excluded from the denominator.
function score(metrics, position, weights, cohorts) {
  let total = 0
  let usedWeight = 0
  let allWeight = 0
  const contributions = []
  const missing = []

  for (const [key, weight] of Object.entries(weights)) {
    allWeight += weight
    const value = metrics?.[key]
    const cohort = getCohort(cohorts, position, key)

    if (value == null || isNaN(value) || !cohort) {
      missing.push(key)
      continue
    }

    let pct = percentileRank(value, cohort)
    if (INVERTED.has(key)) pct = 1 - pct

    const contribution = clamp(pct) * weight
    total += contribution
    usedWeight += weight
    contributions.push({ key, value: clamp(pct), raw: value, weight, contribution, missing: false })
  }

  return {
    raw: usedWeight > 0 ? clamp(total / usedWeight) : null,
    coverage: allWeight > 0 ? usedWeight / allWeight : 0,
    contributions,
    missing,
  }
}

function topFactors(contributions, n = 4) {
  return [...contributions].sort((a, b) => b.contribution - a.contribution).slice(0, n)
}

function unavailable(mode, position, reason) {
  return {
    mode, available: false, reason, score: null, coverage: 0,
    topFactors: [], missingFactors: [], formatImpact: [], metrics: null, position,
  }
}

// ── Weekly ────────────────────────────────────────────────────────────────────
function weeklyDesignation(raw, injuryStatus) {
  if (injuryModifier(injuryStatus) === 0) return 'Out'
  const adj = raw * injuryModifier(injuryStatus)
  if (adj >= 0.75) return 'Strong Start'
  if (adj >= 0.58) return 'Start'
  if (adj >= 0.42) return 'Fringe'
  if (adj >= 0.28) return 'Sit'
  return 'High Risk / High Upside'
}

export function evaluateWeekly(player, profile, metrics, cohorts) {
  const position = player?.position
  if (UNMODELLED.has(position)) {
    return unavailable('weekly', position, `No statistical model for ${position} — team defense inputs are not in our data sources.`)
  }
  const base = WEEKLY_WEIGHTS[position]
  if (!base) return unavailable('weekly', position, `No weekly model for position ${position}.`)
  if (!cohorts) return unavailable('weekly', position, 'Cohort data not loaded. Run: npm run preprocess-nflverse')
  if (!metrics) {
    return unavailable('weekly', position, 'No historical stats for this player — rookies and players with no recorded season cannot be scored.')
  }

  const weights = applyProfile(base, profile)
  const { raw, coverage, contributions, missing } = score(metrics, position, weights, cohorts)

  if (raw == null) {
    return unavailable('weekly', position, 'None of this model’s inputs are available for this player.')
  }

  const injMod = injuryModifier(player.injuryStatus)

  return {
    mode: 'weekly',
    available: true,
    score: Math.round(clamp(raw * injMod) * 100),
    coverage,
    designation: weeklyDesignation(raw, player.injuryStatus),
    topFactors: topFactors(contributions),
    missingFactors: missing,
    formatImpact: getFormatImpact(profile, position),
    metrics,
    injuryModifier: injMod,
    position,
  }
}

// ── Draft ─────────────────────────────────────────────────────────────────────
function draftTier(s) {
  if (s >= 82) return { tier: 1, label: 'Tier 1 — Elite' }
  if (s >= 68) return { tier: 2, label: 'Tier 2 — Strong' }
  if (s >= 54) return { tier: 3, label: 'Tier 3 — Solid' }
  if (s >= 40) return { tier: 4, label: 'Tier 4 — Depth' }
  return { tier: 5, label: 'Tier 5 — Speculative' }
}

// Floor/ceiling from real signals only: games played is our durability proxy,
// air-yards share our explosiveness proxy. No snap-share data exists here.
function floorCeiling(raw, metrics) {
  const games = metrics.games ?? 17
  const availability = clamp(games / 17)
  const floor = Math.round(clamp(raw * (0.6 + 0.4 * availability) * 0.85) * 100)
  const explosive = (metrics.adot ?? 0) > 12 || (metrics.airYardsShare ?? 0) > 0.25 ? 0.15 : 0
  const ceiling = Math.round(clamp(raw * (1.2 + explosive)) * 100)
  return { floor, ceiling }
}

function riskFlags(metrics, player) {
  const flags = []
  if (player.injuryStatus) flags.push('injury status')
  if ((metrics.games ?? 17) < 12) flags.push(`only ${metrics.games} games played`)
  if ((metrics.intRate ?? 0) > 0.03) flags.push('turnover-prone')
  if ((metrics.sackRate ?? 0) > 0.09) flags.push('sack-prone')
  if (player.team === 'FA') flags.push('unsigned')
  if (player.yearsExp === 0) flags.push('rookie — no NFL history')

  const level = flags.length === 0 ? 'Low'
    : flags.length === 1 ? 'Moderate'
    : flags.length === 2 ? 'High' : 'Very High'
  return { risk: level, riskFlags: flags }
}

export function evaluateDraft(player, profile, metrics, cohorts) {
  const position = player?.position
  if (UNMODELLED.has(position)) {
    return unavailable('draft', position, `No statistical model for ${position} — team defense inputs are not in our data sources.`)
  }
  const base = DRAFT_WEIGHTS[position]
  if (!base) return unavailable('draft', position, `No draft model for position ${position}.`)
  if (!cohorts) return unavailable('draft', position, 'Cohort data not loaded. Run: npm run preprocess-nflverse')
  if (!metrics) {
    return unavailable('draft', position, 'No historical stats for this player — rookies and players with no recorded season cannot be scored.')
  }

  const weights = applyProfile(base, profile)
  const { raw, coverage, contributions, missing } = score(metrics, position, weights, cohorts)

  if (raw == null) {
    return unavailable('draft', position, 'None of this model’s inputs are available for this player.')
  }

  const s = Math.round(clamp(raw) * 100)
  const { tier, label } = draftTier(s)

  return {
    mode: 'draft',
    available: true,
    score: s,
    coverage,
    tier,
    tierLabel: label,
    ...floorCeiling(raw, metrics),
    ...riskFlags(metrics, player),
    topFactors: topFactors(contributions),
    missingFactors: missing,
    formatImpact: getFormatImpact(profile, position),
    metrics,
    position,
  }
}
