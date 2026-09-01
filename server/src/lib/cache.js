// In-memory TTL cache — server-side mirror of src/utils/cache.js semantics,
// minus the localStorage quota problem that function was built to fix.
// One process, one Map; no cross-restart persistence needed for proxy data
// that re-fetches cheaply from upstream anyway.

const store = new Map()

/**
 * @returns {boolean} true if the value was stored.
 */
export function cacheSet(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs })
  return true
}

export function cacheGet(key) {
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key)
    return null
  }
  return entry.data
}

// Mirrors src/utils/cache.js TTL values by intent, not by import — the server
// and client are separate deployables and shouldn't share a module boundary
// for a handful of constants.
export const TTL = {
  ODDS: 10 * 60 * 1000,      // 10 minutes — matches the client's TTL.ODDS
  NEWS: 15 * 60 * 1000,      // 15 minutes — feeds don't update faster than this
}
