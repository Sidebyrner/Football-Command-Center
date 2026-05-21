// Evaluation Engine — weekly start/sit model + draft value model.
// Separated from scoring profile and mock metrics so each layer is replaceable.

import { getFormatImpact } from './scoringProfile'
import { getPlayerMetrics, percentileRank, POSITION_DEFAULTS } from '../data/mockPlayerMetrics'

// ── Normalization helpers ─────────────────────────────────────────────────────
function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v))
}

// Normalize a metric against a peer array — returns 0–1 percentile.
function norm(value, peerValues) {
  if (value == null || isNaN(value)) return null
  return percentileRank(value, peerValues)
}

// Build a peer array for a position field from the POSITION_DEFAULTS.
// In production this would come from real season data; here we generate a
// synthetic distribution around the default mean.
function syntheticPeers(mean, stdFactor = 0.30, count = 30) {
  const std = mean * stdFactor
  return Array.from({ length: count }, (_, i) => {
    const z = (i / (count - 1)) * 4 - 2 // -2 to +2 std
    return Math.max(0, mean + z * std)
  })
}

function getPositionPeers(position) {
  const d = POSITION_DEFAULTS[position] ?? POSITION_DEFAULTS.WR
  return {
    targetShare: syntheticPeers(d.targetShare || 0.15),
    yprr: syntheticPeers(d.yprr || 1.5),
    airYardsShare: syntheticPeers(d.airYardsShare || 0.18),
    redZoneTargets: syntheticPeers(d.redZoneTargets || 1.0),
    qbRating: syntheticPeers(d.qbRating || 90, 0.12),
    firstReadTargetRate: syntheticPeers(d.firstReadTargetRate || 0.25),
    adot: syntheticPeers(d.adot || 9.0),
    trueCatchRate: syntheticPeers(d.trueCatchRate || 0.70, 0.10),
    olPassProtection: syntheticPeers(d.olPassProtection || 0.57, 0.12),
    separation: syntheticPeers(d.separation || 2.5),
    completionPct: syntheticPeers(d.completionPct || 0.64, 0.08),
    intRate: syntheticPeers(d.intRate || 0.022, 0.30),
    sackRate: syntheticPeers(d.sackRate || 0.07, 0.30),
    rushingAttempts: syntheticPeers(d.rushingAttempts || 4, 0.40),
    seasonRushYards: syntheticPeers(d.seasonRushYards || 300, 0.40),
    impliedTeamTotal: syntheticPeers(d.impliedTeamTotal || 22, 0.15),
    opponentDefRank: syntheticPeers(d.opponentDefRank || 16, 0.30),
  }
}

// ── Injury modifier ──────────────────────────────────────────────────────────
function injuryModifier(injuryStatus) {
  const s = (injuryStatus || '').toLowerCase()
  if (s === 'out' || s === 'ir' || s === 'pup') return 0
  if (s === 'doubtful') return 0.25
  if (s === 'questionable') return 0.75
  return 1.0
}

// ── Weekly Evaluation ────────────────────────────────────────────────────────
const WEEKLY_WEIGHTS = {
  QB: {
    qbRating: 12,
    completionPct: 10,
    impliedTeamTotal: 10,
    olPassProtection: 8,
    rushingAttempts: 7,
    sackRatePenalty: 6,   // inverted — lower is better
    intRatePenalty: 8,    // inverted
  },
  RB: {
    last4Snaps: 12,
    impliedTeamTotal: 10,
    olPassProtection: 9,
    opponentDefRankFavor: 8,  // inverted rank (rank 32 = easiest = best)
    targetShare: 7,
    trueCatchRate: 5,
    redZoneTargets: 9,
  },
  WR: {
    targetShare: 10,
    yprr: 9,
    qbRating: 8,
    airYardsShare: 8,
    redZoneTargets: 7,
    firstReadTargetRate: 7,
    adot: 6,
    trueCatchRate: 6,
    olPassProtection: 5,
    separation: 4,
  },
  TE: {
    targetShare: 11,
    redZoneTargets: 10,
    yprr: 8,
    qbRating: 8,
    trueCatchRate: 7,
    firstReadTargetRate: 7,
    adot: 5,
    airYardsShare: 4,
  },
  K: {
    impliedTeamTotal: 15,
    opponentDefRankFavor: 10,
  },
  DEF: {
    opponentDefRankFavor: 12,
    impliedTeamTotal: 8,
  },
}

function normalizeWeeklyFactors(metrics, position, peers) {
  const m = metrics
  const p = peers

  // Opponent def rank: rank 32 is easiest (good), rank 1 is hardest (bad).
  // Invert so higher = better matchup.
  const matchupScore = norm(33 - (m.opponentDefRank || 16), syntheticPeers(17))

  // For penalty metrics: lower value = higher normalized score.
  const sackRatePenaltyScore = m.sackRate != null ? 1 - norm(m.sackRate, p.sackRate) : null
  const intRatePenaltyScore = m.intRate != null ? 1 - norm(m.intRate, p.intRate) : null

  return {
    targetShare: norm(m.targetShare, p.targetShare),
    yprr: norm(m.yprr, p.yprr),
    qbRating: norm(m.qbRating, p.qbRating),
    airYardsShare: norm(m.airYardsShare, p.airYardsShare),
    redZoneTargets: norm(m.redZoneTargets, p.redZoneTargets),
    firstReadTargetRate: norm(m.firstReadTargetRate, p.firstReadTargetRate),
    adot: norm(m.adot, p.adot),
    trueCatchRate: norm(m.trueCatchRate, p.trueCatchRate),
    olPassProtection: norm(m.olPassProtection, p.olPassProtection),
    separation: norm(m.separation, p.separation),
    completionPct: norm(m.completionPct, p.completionPct),
    impliedTeamTotal: norm(m.impliedTeamTotal, p.impliedTeamTotal),
    last4Snaps: norm(m.last4Snaps, syntheticPeers(0.65, 0.20)),
    rushingAttempts: norm(m.rushingAttempts, p.rushingAttempts),
    opponentDefRankFavor: matchupScore,
    sackRatePenalty: sackRatePenaltyScore,
    intRatePenalty: intRatePenaltyScore,
  }
}

// Apply scoring-profile modifiers to the weekly weights.
// E.g. if first-down bonuses are high, bump metrics that predict first downs.
function applyProfileToWeeklyWeights(weights, profile) {
  const w = { ...weights }

  // High passing first-down value → up-weight target-share-like metrics
  if ((profile.passingFirstDown ?? 0) >= 1) {
    if (w.firstReadTargetRate) w.firstReadTargetRate += 1
    if (w.adot) w.adot += 1
  }
  // Incompletion penalty → extra weight on completion pct / sack risk
  if ((profile.incompletion ?? 0) <= -1) {
    if (w.sackRatePenalty) w.sackRatePenalty += 2
    if (w.intRatePenalty) w.intRatePenalty += 2
  }
  // Non-PPR → down-weight pure target-volume metrics slightly
  if ((profile.receptionPoints ?? 0) === 0) {
    if (w.targetShare) w.targetShare -= 1
    if (w.yprr) w.yprr += 1
  }
  // Rushing first-down value for RBs
  if ((profile.rushingFirstDown ?? 0) >= 1) {
    if (w.last4Snaps) w.last4Snaps += 1
  }
  // Big kicker bonuses
  if ((profile.fg60plus ?? 0) >= 6) {
    if (w.impliedTeamTotal) w.impliedTeamTotal += 3
  }

  return w
}

function weeklyScore(factors, weights) {
  let total = 0
  let totalWeight = 0
  const contributions = []

  for (const [key, weight] of Object.entries(weights)) {
    const value = factors[key]
    if (value == null) {
      contributions.push({ key, value: null, weight, contribution: null, missing: true })
      continue
    }
    const w = Math.max(0, weight)
    const contribution = clamp(value) * w
    total += contribution
    totalWeight += w
    contributions.push({ key, value: clamp(value), weight: w, contribution, missing: false })
  }

  const raw = totalWeight > 0 ? total / totalWeight : 0.5
  return { raw: clamp(raw), contributions }
}

function weeklyDesignation(score, injuryStatus) {
  const mod = injuryModifier(injuryStatus)
  if (mod === 0) return 'Out'
  const adj = score * mod
  if (adj >= 0.75) return 'Strong Start'
  if (adj >= 0.58) return 'Start'
  if (adj >= 0.42) return 'Fringe'
  if (adj >= 0.28) return 'Sit'
  return 'High Risk / High Upside'
}

// Merge real nflverse metrics over mock defaults.
// Only overrides fields that nflverse actually provides.
function mergeMetrics(mockMetrics, realMetrics) {
  if (!realMetrics) return mockMetrics
  return { ...mockMetrics, ...realMetrics, isMock: false }
}

export function evaluateWeekly(player, profile, realMetrics = null) {
  const position = player.position
  const metrics = mergeMetrics(getPlayerMetrics(player.id, position), realMetrics)
  const peers = getPositionPeers(position)
  const baseWeights = WEEKLY_WEIGHTS[position] ?? WEEKLY_WEIGHTS.WR
  const weights = applyProfileToWeeklyWeights(baseWeights, profile)
  const factors = normalizeWeeklyFactors(metrics, position, peers)
  const { raw, contributions } = weeklyScore(factors, weights)
  const injMod = injuryModifier(player.injuryStatus)
  const adjustedRaw = clamp(raw * injMod)
  const score = Math.round(adjustedRaw * 100)

  const missingFactors = contributions.filter((c) => c.missing).map((c) => c.key)
  const topFactors = contributions
    .filter((c) => !c.missing && c.contribution != null)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)

  const designation = weeklyDesignation(raw, player.injuryStatus)
  const formatImpact = getFormatImpact(profile, position)

  return {
    mode: 'weekly',
    score,
    designation,
    topFactors,
    missingFactors,
    formatImpact,
    metrics,
    injuryModifier: injMod,
  }
}

// ── Draft Value Evaluation ────────────────────────────────────────────────────

const DRAFT_WEIGHTS = {
  QB: {
    qbRating: 12,
    completionPct: 10,
    rushingAttempts: 9,       // scramble/dual-threat value
    impliedTeamTotal: 10,
    olPassProtection: 8,
    intRatePenalty: 9,
    sackRatePenalty: 7,
  },
  RB: {
    seasonRushYards: 12,
    last4Snaps: 10,
    impliedTeamTotal: 9,
    olPassProtection: 10,
    redZoneTargets: 8,
    targetShare: 7,
    trueCatchRate: 4,
  },
  WR: {
    targetShare: 11,
    airYardsShare: 10,
    yprr: 9,
    firstReadTargetRate: 8,
    redZoneTargets: 8,
    qbRating: 8,
    adot: 6,
    trueCatchRate: 5,
    separation: 5,
  },
  TE: {
    targetShare: 12,
    redZoneTargets: 11,
    trueCatchRate: 8,
    firstReadTargetRate: 8,
    qbRating: 7,
    yprr: 7,
    airYardsShare: 7,
  },
  K: {
    impliedTeamTotal: 14,
    opponentDefRankFavor: 8,
  },
  DEF: {
    opponentDefRankFavor: 12,
    impliedTeamTotal: 6,
  },
}

function applyProfileToDraftWeights(weights, profile) {
  const w = { ...weights }

  if ((profile.passingFirstDown ?? 0) >= 1) {
    if (w.completionPct) w.completionPct += 1
    if (w.firstReadTargetRate) w.firstReadTargetRate += 1
  }
  if ((profile.incompletion ?? 0) <= -1) {
    if (w.intRatePenalty) w.intRatePenalty += 2
    if (w.sackRatePenalty) w.sackRatePenalty += 1
  }
  if ((profile.receptionPoints ?? 0) === 0) {
    if (w.yprr) w.yprr += 2
    if (w.targetShare && w.targetShare > 2) w.targetShare -= 1
  }
  if ((profile.rushingFirstDown ?? 0) >= 1) {
    if (w.seasonRushYards) w.seasonRushYards += 1
    if (w.last4Snaps) w.last4Snaps += 1
  }
  if ((profile.fg60plus ?? 0) >= 6) {
    if (w.impliedTeamTotal) w.impliedTeamTotal += 2
  }

  return w
}

function draftTier(score) {
  if (score >= 82) return { tier: 1, label: 'Tier 1 — Elite' }
  if (score >= 68) return { tier: 2, label: 'Tier 2 — Strong' }
  if (score >= 54) return { tier: 3, label: 'Tier 3 — Solid' }
  if (score >= 40) return { tier: 4, label: 'Tier 4 — Depth' }
  return { tier: 5, label: 'Tier 5 — Speculative' }
}

function floorCeiling(raw, metrics, position) {
  // Floor = low-end weekly contribution; ceiling = high-end upside
  const snapStability = metrics.last4Snaps ?? 0.6
  const floor = Math.round(clamp(raw * snapStability * 0.8) * 100)
  const explosiveBonus = metrics.adot > 12 || metrics.airYardsShare > 0.25 ? 0.15 : 0
  const ceiling = Math.round(clamp(raw + raw * (0.25 + explosiveBonus)) * 100)
  return { floor, ceiling }
}

function riskLabel(metrics, player) {
  const flags = []
  if (player.injuryStatus && player.injuryStatus !== 'Probable') flags.push('injury')
  if ((metrics.intRate ?? 0) > 0.03) flags.push('turnover-prone')
  if ((metrics.sackRate ?? 0) > 0.09) flags.push('sack-risk')
  if ((metrics.last4Snaps ?? 1) < 0.55) flags.push('role-uncertainty')
  if (player.team === 'FA') flags.push('unsigned')

  if (flags.length === 0) return 'Low'
  if (flags.length === 1) return 'Moderate'
  if (flags.length === 2) return 'High'
  return 'Very High'
}

export function evaluateDraft(player, profile, realMetrics = null) {
  const position = player.position
  const metrics = mergeMetrics(getPlayerMetrics(player.id, position), realMetrics)
  const peers = getPositionPeers(position)
  const baseWeights = DRAFT_WEIGHTS[position] ?? DRAFT_WEIGHTS.WR
  const weights = applyProfileToDraftWeights(baseWeights, profile)
  const factors = normalizeWeeklyFactors(metrics, position, peers)
  const { raw, contributions } = weeklyScore(factors, weights)
  const score = Math.round(clamp(raw) * 100)

  const { floor, ceiling } = floorCeiling(raw, metrics, player)
  const risk = riskLabel(metrics, player)
  const { tier, label: tierLabel } = draftTier(score)
  const formatImpact = getFormatImpact(profile, position)

  const missingFactors = contributions.filter((c) => c.missing).map((c) => c.key)
  const topFactors = contributions
    .filter((c) => !c.missing && c.contribution != null)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)

  return {
    mode: 'draft',
    score,
    tier,
    tierLabel,
    floor,
    ceiling,
    risk,
    topFactors,
    missingFactors,
    formatImpact,
    metrics,
  }
}
