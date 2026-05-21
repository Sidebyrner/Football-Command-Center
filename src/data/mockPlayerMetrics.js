// Mock advanced metrics layer — isolated so real feeds can replace this later.
// Each entry is keyed by Sleeper player_id where known, or by a canonical name slug.
// All values are realistic but synthetic for UI/model development.

// ── Type reference (not enforced at runtime) ──────────────────────────────────
// interface PlayerMetrics {
//   playerId: string
//   season: number
//   // Receiving / route metrics
//   targetShare: number          // 0–1
//   airYardsShare: number        // 0–1
//   yprr: number                 // yards per route run
//   adot: number                 // average depth of target (yards)
//   trueCatchRate: number        // catchable targets caught, 0–1
//   firstReadTargetRate: number  // % of routes as first read, 0–1
//   separation: number           // avg separation at catch (feet)
//   redZoneTargets: number       // per game
//   // QB metrics
//   qbRating: number             // 0–158.3 passer rating
//   completionPct: number        // 0–1
//   sackRate: number             // sacks / dropbacks 0–1
//   intRate: number              // ints / attempts 0–1
//   rushingAttempts: number      // per game
//   // OL / team context
//   olPassProtection: number     // 0–1 composite
//   teamPassRate: number         // 0–1
//   impliedTeamTotal: number     // expected points scored
//   opponentDefRank: number      // 1–32 (1=toughest)
//   // Usage trend
//   last4TargetShare: number     // recent form, 0–1
//   last4Snaps: number           // snap % last 4 weeks
//   // Season totals (proxy inputs)
//   seasonTargets: number
//   seasonReceptions: number
//   seasonRecYards: number
//   seasonRecTDs: number
//   seasonRushAttempts: number
//   seasonRushYards: number
//   seasonRushTDs: number
//   // Mock data flag
//   isMock: true
// }

const SEASON = 2026

function mock(playerId, overrides = {}) {
  return {
    playerId,
    season: SEASON,
    targetShare: 0.18,
    airYardsShare: 0.20,
    yprr: 1.8,
    adot: 10.5,
    trueCatchRate: 0.70,
    firstReadTargetRate: 0.30,
    separation: 2.5,
    redZoneTargets: 1.2,
    qbRating: 92,
    completionPct: 0.65,
    sackRate: 0.07,
    intRate: 0.022,
    rushingAttempts: 0,
    olPassProtection: 0.58,
    teamPassRate: 0.55,
    impliedTeamTotal: 23.5,
    opponentDefRank: 16,
    last4TargetShare: 0.18,
    last4Snaps: 0.72,
    seasonTargets: 80,
    seasonReceptions: 55,
    seasonRecYards: 720,
    seasonRecTDs: 5,
    seasonRushAttempts: 5,
    seasonRushYards: 30,
    seasonRushTDs: 0,
    isMock: true,
    ...overrides,
  }
}

// ── Position-specific mock cohorts ───────────────────────────────────────────
// These are template profiles for each position that get applied to players
// without specific overrides.

export const POSITION_DEFAULTS = {
  QB: mock('_qb', {
    targetShare: 0,
    airYardsShare: 0,
    yprr: 0,
    adot: 0,
    trueCatchRate: 0,
    firstReadTargetRate: 0,
    redZoneTargets: 0,
    qbRating: 90,
    completionPct: 0.64,
    sackRate: 0.07,
    intRate: 0.024,
    rushingAttempts: 4.5,
    olPassProtection: 0.57,
    teamPassRate: 0.57,
    impliedTeamTotal: 23.5,
    opponentDefRank: 16,
    last4TargetShare: 0,
    last4Snaps: 1.0,
    seasonTargets: 0,
    seasonReceptions: 0,
    seasonRecYards: 0,
    seasonRecTDs: 0,
    seasonRushAttempts: 65,
    seasonRushYards: 310,
    seasonRushTDs: 3,
  }),
  RB: mock('_rb', {
    targetShare: 0.10,
    airYardsShare: 0.05,
    yprr: 1.1,
    adot: 4.5,
    trueCatchRate: 0.82,
    firstReadTargetRate: 0.15,
    separation: 3.0,
    redZoneTargets: 0.6,
    olPassProtection: 0.56,
    teamPassRate: 0.52,
    impliedTeamTotal: 22,
    opponentDefRank: 16,
    last4TargetShare: 0.10,
    last4Snaps: 0.62,
    seasonTargets: 55,
    seasonReceptions: 45,
    seasonRecYards: 350,
    seasonRecTDs: 2,
    seasonRushAttempts: 180,
    seasonRushYards: 820,
    seasonRushTDs: 7,
  }),
  WR: mock('_wr', {
    targetShare: 0.17,
    airYardsShare: 0.19,
    yprr: 1.75,
    adot: 11.0,
    trueCatchRate: 0.68,
    firstReadTargetRate: 0.28,
    separation: 2.6,
    redZoneTargets: 1.1,
    seasonTargets: 95,
    seasonReceptions: 60,
    seasonRecYards: 780,
    seasonRecTDs: 5,
    seasonRushAttempts: 3,
    seasonRushYards: 18,
    seasonRushTDs: 0,
  }),
  TE: mock('_te', {
    targetShare: 0.14,
    airYardsShare: 0.11,
    yprr: 1.4,
    adot: 7.5,
    trueCatchRate: 0.73,
    firstReadTargetRate: 0.22,
    separation: 2.1,
    redZoneTargets: 1.4,
    seasonTargets: 72,
    seasonReceptions: 52,
    seasonRecYards: 560,
    seasonRecTDs: 6,
    seasonRushAttempts: 0,
    seasonRushYards: 0,
    seasonRushTDs: 0,
  }),
  K: mock('_k', {
    impliedTeamTotal: 22,
    olPassProtection: 0,
    targetShare: 0,
    airYardsShare: 0,
    yprr: 0,
    adot: 0,
    trueCatchRate: 0,
    firstReadTargetRate: 0,
    separation: 0,
    redZoneTargets: 0,
  }),
  DEF: mock('_def', {
    impliedTeamTotal: 0,
    targetShare: 0,
    airYardsShare: 0,
    yprr: 0,
    adot: 0,
    trueCatchRate: 0,
    firstReadTargetRate: 0,
    separation: 0,
    redZoneTargets: 0,
  }),
}

// ── Specific player overrides for realism ────────────────────────────────────
// Keyed by Sleeper player_id where reliable, otherwise by name-slug.
// Add real entries here as real data feeds become available.
const OVERRIDES = {
  // QB elite tier
  '4046': { qbRating: 112, completionPct: 0.69, sackRate: 0.05, intRate: 0.015, rushingAttempts: 6, olPassProtection: 0.70, impliedTeamTotal: 27.5, opponentDefRank: 14 }, // Lamar-like
  '4881': { qbRating: 108, completionPct: 0.67, sackRate: 0.06, intRate: 0.018, rushingAttempts: 3, olPassProtection: 0.68, impliedTeamTotal: 26 },
  // WR elite
  '7553': { targetShare: 0.29, airYardsShare: 0.36, yprr: 2.8, adot: 14.0, trueCatchRate: 0.74, firstReadTargetRate: 0.45, separation: 3.2, redZoneTargets: 2.1, impliedTeamTotal: 27.5 },
  '6786': { targetShare: 0.27, airYardsShare: 0.33, yprr: 2.6, adot: 12.5, trueCatchRate: 0.72, firstReadTargetRate: 0.40, separation: 3.0, redZoneTargets: 1.8 },
  // RB workhorse
  '4034': { seasonRushAttempts: 260, seasonRushYards: 1280, seasonRushTDs: 11, targetShare: 0.14, last4Snaps: 0.78 },
}

// ── Public API ────────────────────────────────────────────────────────────────
export function getPlayerMetrics(playerId, position) {
  const base = POSITION_DEFAULTS[position] ?? POSITION_DEFAULTS.WR
  const override = OVERRIDES[playerId] ?? {}
  return { ...base, playerId, ...override }
}

// Returns percentile rank (0–1) for a value within an array of peer values.
export function percentileRank(value, peers) {
  if (!peers.length) return 0.5
  const sorted = [...peers].sort((a, b) => a - b)
  let lo = 0, hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo / sorted.length
}
