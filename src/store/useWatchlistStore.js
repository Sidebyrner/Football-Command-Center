import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Promoted from ad-hoc localStorage state that lived inside DraftDashboard.jsx
// (a raw `fcc-draft-watchlist` key, read/written by hand) into a real store,
// so the Draft Plan page can read it too — before this, watchlisting a
// player on the board was invisible everywhere else in the app.

const LEGACY_KEY = 'fcc-draft-watchlist'

function loadLegacyWatchlist() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const useWatchlistStore = create(
  persist(
    (set, get) => ({
      // Seeded from the old key only on a genuinely first load — once this
      // store's own persisted key exists, hydration overwrites this and the
      // legacy read becomes a harmless no-op. Existing watchlists are never
      // silently dropped by this migration.
      ids: loadLegacyWatchlist(),

      toggle(playerId) {
        set((s) => ({
          ids: s.ids.includes(playerId)
            ? s.ids.filter((id) => id !== playerId)
            : [...s.ids, playerId],
        }))
      },

      has(playerId) {
        return get().ids.includes(playerId)
      },
    }),
    { name: 'fcc-watchlist-v2' }
  )
)

export default useWatchlistStore
