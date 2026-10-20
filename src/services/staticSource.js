// Where the original tools' data files come from.
//
// The new screens load the preprocessed nflverse files through StaticDataStore
// (the `data` branch → cache → the copy bundled with the site). These services
// predate it and used to fetch the bundled copy straight from `/data/`, which
// mid-season is weeks out of date. The app's composition root registers its
// store here, so both halves of the app read the same, current files.
//
// Without a registered loader (node tests, or a page mounted outside the app)
// it falls back to the bundled copy, as before.

let _loader = null

/** `loader(name, season?)` resolves to the parsed JSON for that file. */
export function setStaticLoader(loader) {
  _loader = loader
}

/** Thrown when a data file can't be had from anywhere — never a setup step. */
export class StaticDataUnavailable extends Error {
  constructor(label, cause) {
    super(`${label} isn't available right now. Check your connection and try again.`)
    this.name = 'StaticDataUnavailable'
    this.code = 'static-unavailable'
    this.cause = cause
  }
}

const BUNDLED_PATHS = {
  cohorts: () => 'cohorts.json',
  adp: () => 'adp.json',
  playerIDs: () => 'player-ids.json',
  nflverseSeasons: () => 'nflverse-seasons.json',
  weeklyIndex: () => 'weekly/index.json',
  weekly: (season) => `weekly/${season}.json`,
  schedule: (season) => `schedule-${season}.json`,
}

async function loadBundled(name, season) {
  const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/'
  const r = await fetch(`${base}data/${BUNDLED_PATHS[name](season)}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/**
 * One data file by its StaticResources name (`weekly`, `schedule`, `cohorts`…).
 * @param {string} name
 * @param {string} label what the error calls it ("Weekly stats")
 * @param {number|string} [season]
 */
export async function loadStatic(name, label, season) {
  try {
    return _loader ? await _loader(name, season) : await loadBundled(name, season)
  } catch (err) {
    throw new StaticDataUnavailable(label, err)
  }
}
