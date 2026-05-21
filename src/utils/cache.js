export function cacheSet(key, data, ttlMs) {
  const entry = { data, expiresAt: Date.now() + ttlMs }
  try {
    localStorage.setItem(key, JSON.stringify(entry))
  } catch {
    // quota exceeded — ignore
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
  localStorage.removeItem(key)
}

export const TTL = {
  PLAYERS: 24 * 60 * 60 * 1000,   // 24 hours
  TRENDING: 15 * 60 * 1000,        // 15 minutes
  ODDS: 10 * 60 * 1000,            // 10 minutes
  ROSTER: 5 * 60 * 1000,           // 5 minutes
}
