import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Pre-draft plan: an ordered list of targets per position, each with your own
// notes and named fallbacks for when someone takes your guy first.
//
// This is the "substitution picks" idea from To-Dos/ — the thing you actually
// want on screen when you are on the clock and your target just went.

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

function emptyTargets() {
  return Object.fromEntries(POSITIONS.map((p) => [p, []]))
}

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function move(list, from, to) {
  if (to < 0 || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const useMockDraftStore = create(
  persist(
    (set, get) => ({
      targets: emptyTargets(),

      /** Add a player as a target for their own position. Ignores duplicates. */
      addTarget(player, note = '') {
        const pos = player.position
        if (!POSITIONS.includes(pos)) return
        set((s) => {
          const list = s.targets[pos] ?? []
          if (list.some((t) => t.playerId === player.id)) return s
          const target = {
            id: genId(),
            playerId: player.id,
            playerName: player.name,
            playerTeam: player.team ?? null,
            playerPosition: pos,
            adp: player.adp ?? null,
            bye: player.bye ?? null,
            note,
            fallbacks: [],
            createdAt: new Date().toISOString(),
          }
          return { targets: { ...s.targets, [pos]: [...list, target] } }
        })
      },

      removeTarget(pos, id) {
        set((s) => ({
          targets: { ...s.targets, [pos]: (s.targets[pos] ?? []).filter((t) => t.id !== id) },
        }))
      },

      updateNote(pos, id, note) {
        set((s) => ({
          targets: {
            ...s.targets,
            [pos]: (s.targets[pos] ?? []).map((t) => (t.id === id ? { ...t, note } : t)),
          },
        }))
      },

      /** Reorder within a position. Priority order is the whole point. */
      moveTarget(pos, id, direction) {
        set((s) => {
          const list = s.targets[pos] ?? []
          const i = list.findIndex((t) => t.id === id)
          if (i === -1) return s
          return { targets: { ...s.targets, [pos]: move(list, i, i + direction) } }
        })
      },

      /** Named backup if this target is gone before your pick. */
      addFallback(pos, id, player) {
        set((s) => ({
          targets: {
            ...s.targets,
            [pos]: (s.targets[pos] ?? []).map((t) => {
              if (t.id !== id) return t
              if (t.fallbacks.some((f) => f.playerId === player.id)) return t
              return {
                ...t,
                fallbacks: [...t.fallbacks, {
                  playerId: player.id,
                  playerName: player.name,
                  playerTeam: player.team ?? null,
                  adp: player.adp ?? null,
                }],
              }
            }),
          },
        }))
      },

      removeFallback(pos, id, playerId) {
        set((s) => ({
          targets: {
            ...s.targets,
            [pos]: (s.targets[pos] ?? []).map((t) =>
              t.id === id ? { ...t, fallbacks: t.fallbacks.filter((f) => f.playerId !== playerId) } : t
            ),
          },
        }))
      },

      /** Order every position by consensus rank, as a starting point to edit. */
      sortByAdp() {
        set((s) => {
          const next = {}
          for (const pos of POSITIONS) {
            next[pos] = [...(s.targets[pos] ?? [])].sort(
              (a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity)
            )
          }
          return { targets: next }
        })
      },

      clearAll() {
        set({ targets: emptyTargets() })
      },

      totalCount() {
        return Object.values(get().targets).reduce((n, l) => n + l.length, 0)
      },
    }),
    { name: 'fcc-mock-draft', version: 1 }
  )
)

export { POSITIONS }
export default useMockDraftStore
