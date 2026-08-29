// localStorage TTL cache.
//
// NOTE: localStorage caps around 5 MB per origin. Sleeper's /players/nfl payload
// is itself ~5 MB, so the raw blob does NOT reliably fit. Callers should cache a
// trimmed projection of large payloads, not the payload. cacheSet reports
// failure rather than swallowing it — a silent quota error looks exactly like a
// working cache while re-downloading megabytes on every page load.

/**
 * @returns {boolean} true if the value was persisted.
 */
export function cacheSet(key, data, ttlMs) {
  const entry = { data, expiresAt: Date.now() + ttlMs }
  try {
    localStorage.setItem(key, JSON.stringify(entry))
    return true
  } catch (err) {
    // Quota exceeded, or storage disabled (private mode / blocked cookies).
    // Drop our own stale entry so the next attempt has room.
    try { localStorage.removeItem(key) } catch {}
    if (import.meta.env?.DEV) {
      console.warn(`[cache] could not persist "${key}" (${err?.name ?? 'error'}). ` +
        'Data will be refetched next load.')
    }
    return false
  }
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw)
    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(key)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export function cacheClear(key) {
  try { localStorage.removeItem(key) } catch {}
}

export const TTL = {
  PLAYERS: 24 * 60 * 60 * 1000,      // 24 hours — Sleeper asks for once-daily at most
  TRENDING: 15 * 60 * 1000,          // 15 minutes
  ODDS: 10 * 60 * 1000,              // 10 minutes
  ROSTER: 5 * 60 * 1000,             // 5 minutes
  LIVE_DRAFT: 8 * 1000,              // 8 seconds — a stale board mid-draft is worse than none
  NFLVERSE: 7 * 24 * 60 * 60 * 1000, // 7 days (preprocessed static file)
}
