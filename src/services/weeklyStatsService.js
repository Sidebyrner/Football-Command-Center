// Weekly game logs — the per-week detail nflverse publishes and this app used
// to discard at preprocess time.
//
// File shape (public/data/weekly/{season}.json, written by
// scripts/preprocess-nflverse.mjs):
//   { _meta, fields: string[], meta: { [gsis_id]: {n, p} },
//     players: { [gsis_id]: number[][] } }
//
// Rows are TUPLES positionally matched to `fields`, not objects — 642 KB per
// season instead of ~5 MB. `fields` ships with the data, so decodeRow() is
// driven by the file's own header and a column reordering in the script can
// never silently shift values here.
//
// Deliberately NOT cached in localStorage: 642 KB against a ~5 MB origin budget
// that already holds fcc-draft-players-v2 is how you get QuotaExceededError on
// an unrelated write. Module-level memoisation (same pattern as
// nflverseService.js) is enough — the file is HTTP-cached by the browser.

const MANIFEST_URL = '/data/weekly/index.json'
const seasonCache = new Map() // season -> loaded file
const seasonPromises = new Map()
let _manifest = null
let _manifestPromise = null

export async function getWeeklyManifest() {
  if (_manifest) return _manifest
  if (_manifestPromise) return _manifestPromise
  _manifestPromise = fetch(MANIFEST_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Weekly data manifest not found (${r.status}). Run: npm run preprocess-nflverse`)
      return r.json()
    })
    .then((file) => {
      _manifest = file
      _manifestPromise = null
      return file
    })
    .catch((err) => {
      _manifestPromise = null
      throw err
    })
  return _manifestPromise
}

export async function loadWeeklySeason(season) {
  const key = String(season)
  if (seasonCache.has(key)) return seasonCache.get(key)
  if (seasonPromises.has(key)) return seasonPromises.get(key)

  const p = fetch(`/data/weekly/${key}.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`No weekly data for ${key} (${r.status})`)
      return r.json()
    })
    .then((file) => {
      seasonCache.set(key, file)
      seasonPromises.delete(key)
      return file
    })
    .catch((err) => {
      seasonPromises.delete(key)
      throw err
    })

  seasonPromises.set(key, p)
  return p
}

/** Tuple -> object, driven by the file's own `fields` header. */
export function decodeRow(fields, tuple) {
  const out = {}
  for (let i = 0; i < fields.length; i++) out[fields[i]] = tuple[i]
  return out
}

/** Every decoded week for one player, ascending. Empty array when absent. */
export async function getPlayerWeeks(gsisId, season) {
  if (!gsisId) return []
  const file = await loadWeeklySeason(season)
  const tuples = file.players?.[gsisId]
  if (!tuples) return []
  return tuples.map((t) => decodeRow(file.fields, t)).sort((a, b) => a.week - b.week)
}

/** Name + position for a player as recorded in the weekly file. */
export async function getPlayerWeeklyMeta(gsisId, season) {
  const file = await loadWeeklySeason(season)
  return file.meta?.[gsisId] ?? null
}

/**
 * Freshness reporting for Settings. Static data quietly going stale mid-season
 * is the failure mode of this whole pipeline, so it gets a visible surface.
 * @returns {{isLoaded, seasons: Array, generated: string|null, error: string|null}}
 */
export async function getWeeklyDataMeta() {
  try {
    const m = await getWeeklyManifest()
    return {
      isLoaded: true,
      seasons: m.seasons ?? [],
      generated: m._meta?.generated ?? null,
      error: null,
    }
  } catch (err) {
    return { isLoaded: false, seasons: [], generated: null, error: err.message }
  }
}
