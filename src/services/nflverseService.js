// nflverse service — supplemental football stats layer.
// Provides historical season stats NOT available from Sleeper's open API.
// Data is preprocessed by scripts/preprocess-nflverse.mjs into a compact JSON
// file served from public/data/nflverse-seasons.json.
//
// Join key: gsis_id (present on Sleeper player objects as player.gsis_id)
// Output shape: { [gsis_id]: { "2024": { ...stats }, "2023": { ...stats } } }

const DATA_URL = '/data/nflverse-seasons.json'

// Module-level in-memory cache — avoids re-fetching the full index per session.
let _index = null
let _loadPromise = null

async function loadIndex() {
  if (_index !== null) return _index
  if (_loadPromise) return _loadPromise

  _loadPromise = fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`nflverse data not found (${r.status}). Run: npm run preprocess-nflverse`)
      return r.json()
    })
    .then((data) => {
      _index = data
      _loadPromise = null
      return data
    })
    .catch((err) => {
      _loadPromise = null
      throw err
    })

  return _loadPromise
}

// Returns season history for a player by their NFL GSIS ID.
// Shape: { "2024": { games, passing_yards, ... }, "2023": { ... } } | null
export async function getPlayerSeasonHistory(gsisId) {
  if (!gsisId) return null
  const index = await loadIndex()
  return index[gsisId] ?? null
}

// Returns a single season's stats for a player.
export async function getPlayerSeason(gsisId, season) {
  if (!gsisId) return null
  const history = await getPlayerSeasonHistory(gsisId)
  return history?.[String(season)] ?? null
}

// Returns { isLoaded, playerCount } metadata about the current data file.
export async function getNflverseDataMeta() {
  try {
    const index = await loadIndex()
    return {
      isLoaded: true,
      playerCount: Object.keys(index).length,
    }
  } catch {
    return { isLoaded: false, playerCount: 0 }
  }
}

// Map nflverse season stats → evaluation engine metric format.
// Only maps fields that nflverse actually provides; omits PFF/NGS-only metrics
// so the eval engine keeps its mock fallbacks for those.
export function toEvalMetrics(seasonStats) {
  if (!seasonStats) return null

  const {
    games = 1,
    attempts = 0,
    completions = 0,
    passing_yards = 0,
    interceptions = 0,
    sacks = 0,
    carries = 0,
    rushing_yards = 0,
    targets = 0,
    receptions = 0,
    receiving_yards = 0,
    receiving_air_yards = 0,
    target_share,
    air_yards_share,
    wopr,
    racr,
  } = seasonStats

  const g = Math.max(games, 1)

  const metrics = {}

  if (target_share != null) metrics.targetShare = target_share
  if (air_yards_share != null) metrics.airYardsShare = air_yards_share
  if (wopr != null) metrics.wopr = wopr
  if (racr != null) metrics.racr = racr

  if (targets > 0) {
    metrics.adot = receiving_air_yards / targets
    metrics.trueCatchRate = receptions / targets
  }

  if (attempts > 0) {
    metrics.completionPct = completions / attempts
    metrics.intRate = interceptions / attempts
    metrics.sackRate = sacks / (attempts + sacks)
  }

  if (g > 0) {
    if (carries > 0) metrics.rushingAttempts = carries / g
    if (rushing_yards > 0) metrics.seasonRushYards = rushing_yards
  }

  return metrics
}
