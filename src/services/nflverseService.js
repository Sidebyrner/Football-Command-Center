// nflverse service — supplemental football stats layer.
// Provides historical season stats NOT available from Sleeper's open API.
// Data is preprocessed by scripts/preprocess-nflverse.mjs into a compact JSON
// file served from public/data/nflverse-seasons.json.
//
// Join key: gsis_id (present on Sleeper player objects as player.gsis_id)
// File shape:   { _meta: {...}, players: { [gsis_id]: { "2025": {...} } } }

const DATA_URL = '/data/nflverse-seasons.json'

// Module-level in-memory cache — avoids re-fetching the full index per session.
let _index = null
let _meta = null
let _loadPromise = null

async function loadIndex() {
  if (_index !== null) return _index
  if (_loadPromise) return _loadPromise

  _loadPromise = fetch(DATA_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`nflverse data not found (${r.status}). Run: npm run preprocess-nflverse`)
      return r.json()
    })
    .then((file) => {
      // `players` is the index; `_meta` is a sibling, never a player entry.
      _index = file.players ?? {}
      _meta = file._meta ?? null
      _loadPromise = null
      return _index
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

// Returns { isLoaded, playerCount, seasons, generated } about the current data file.
export async function getNflverseDataMeta() {
  try {
    const index = await loadIndex()
    return {
      isLoaded: true,
      playerCount: Object.keys(index).length,
      seasons: _meta?.seasons ?? [],
      generated: _meta?.generated ?? null,
    }
  } catch {
    return { isLoaded: false, playerCount: 0, seasons: [], generated: null }
  }
}

// Map an aggregated nflverse season into the metric names the evaluation engine
// scores on. Every key here is backed by real data — metrics nflverse does not
// carry (YPRR, separation, OL grade, first-read rate, red-zone targets) are
// deliberately absent rather than defaulted, so the engine can drop them from
// the weighting instead of scoring a guess.
export function toEvalMetrics(seasonStats) {
  if (!seasonStats) return null
  const s = seasonStats
  const g = Math.max(s.games ?? 0, 1)
  const m = {}

  const put = (key, value) => {
    if (value != null && !isNaN(value) && isFinite(value)) m[key] = value
  }

  // Receiving
  if (s.target_share > 0) put('targetShare', s.target_share)
  if (s.air_yards_share > 0) put('airYardsShare', s.air_yards_share)
  if (s.wopr > 0) put('wopr', s.wopr)
  if (s.racr > 0) put('racr', s.racr)
  if (s.targets > 0) {
    put('adot', s.adot)
    put('trueCatchRate', s.catch_rate)
    put('yardsPerTarget', s.yards_per_target)
    put('targetsPerGame', s.targets_per_game)
    put('receivingFirstDowns', s.receiving_first_downs / g)
  }

  // Passing
  if (s.attempts > 0) {
    put('completionPct', s.completion_pct)
    put('intRate', s.int_rate)
    put('sackRate', s.sack_rate)
    put('yardsPerAttempt', s.yards_per_attempt)
    put('adotQb', s.adot_qb)
    put('qbRating', s.passer_rating)
  }

  // Rushing
  if (s.carries > 0) {
    put('rushingAttempts', s.carries_per_game)
    put('seasonRushYards', s.rushing_yards)
    put('yardsPerCarry', s.yards_per_carry)
    put('rushingFirstDowns', s.rushing_first_downs / g)
  }
  if (s.carries > 0 || s.receptions > 0) put('touchesPerGame', s.touches_per_game)

  // Kicking
  if (s.fg_att > 0) put('fgPct', s.fg_pct)

  put('fantasyPointsPerGame', s.fantasy_points_per_game)
  put('games', s.games)

  return m
}
