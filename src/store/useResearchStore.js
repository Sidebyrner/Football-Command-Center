import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createItem } from '../utils/researchStore'
import { getMockItems } from '../utils/researchAdapters'

const useResearchStore = create(
  persist(
    (set) => ({
      // ResearchItem[] — newest first.
      // Starts EMPTY on purpose. This store previously seeded fabricated player
      // news (retirement rumours, depth-chart moves) that persisted to
      // localStorage and rendered identically to notes the user wrote
      // themselves. Invented research is indistinguishable from real research
      // once it is sitting in your feed the night before a draft.
      items: [],

      // { [playerId]: { text: string, updatedAt: string } }
      notes: {},

      addItem(fields) {
        const item = createItem(fields)
        set((s) => ({ items: [item, ...s.items] }))
        return item
      },

      updateItem(id, changes) {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id
              ? { ...item, ...changes, updatedAt: new Date().toISOString() }
              : item
          ),
        }))
      },

      archiveItem(id) {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id
              ? { ...item, isArchived: !item.isArchived, updatedAt: new Date().toISOString() }
              : item
          ),
        }))
      },

      pinItem(id) {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id
              ? { ...item, isSaved: !item.isSaved, updatedAt: new Date().toISOString() }
              : item
          ),
        }))
      },

      deleteItem(id) {
        set((s) => ({ items: s.items.filter((item) => item.id !== id) }))
      },

      /** Explicitly load the demo dataset. Clearly labelled, never automatic. */
      loadSampleData() {
        set((s) => {
          const withoutSamples = s.items.filter((i) => i.source !== 'mock')
          return { items: [...getMockItems(), ...withoutSamples] }
        })
      },

      /** Remove every sample item, keeping the user's own notes. */
      clearSampleData() {
        set((s) => ({ items: s.items.filter((i) => i.source !== 'mock') }))
      },

      updateNote(playerId, text) {
        set((s) => ({
          notes: {
            ...s.notes,
            [playerId]: { text, updatedAt: new Date().toISOString() },
          },
        }))
      },
    }),
    {
      name: 'fcc-research-store',
      version: 2,
      // v1 seeded fabricated news into every user's store. Strip it on upgrade
      // so nobody drafts off invented reports; user-authored notes are kept.
      migrate: (state, version) => {
        if (version < 2 && state?.items) {
          return { ...state, items: state.items.filter((i) => i.source !== 'mock') }
        }
        return state
      },
    }
  )
)

export default useResearchStore

// ---------------------------------------------------------------------------
// Derived selectors (use these to avoid recomputing in components)
// ---------------------------------------------------------------------------

/** Items matching a player by ID or name (archived excluded). */
export function selectPlayerItems(items, playerId, playerName) {
  const nameLower = playerName?.toLowerCase()
  return items.filter(
    (item) =>
      !item.isArchived &&
      (item.playerId === playerId ||
        (nameLower && item.playerName?.toLowerCase() === nameLower))
  )
}

/**
 * Build a lookup { playerId: count, 'name:X': count } for table indicators.
 * Items with playerId are keyed by ID; name-only items by normalized name.
 */
export function buildResearchIndex(items) {
  const index = {}
  for (const item of items) {
    if (item.isArchived) continue
    if (item.playerId) {
      index[item.playerId] = (index[item.playerId] || 0) + 1
    } else if (item.playerName) {
      const k = `name:${item.playerName.toLowerCase()}`
      index[k] = (index[k] || 0) + 1
    }
  }
  return index
}

/** Count of non-archived research items for a given player. */
export function getResearchCount(index, playerId, playerName) {
  let n = 0
  if (playerId) n += index[playerId] || 0
  if (playerName) n += index[`name:${playerName.toLowerCase()}`] || 0
  return n
}
