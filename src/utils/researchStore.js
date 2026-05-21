// Pure utilities for research item construction.
// State management lives in src/store/useResearchStore.js (Zustand + persist).

export function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * ResearchItem shape — all fields that the store and adapters must conform to.
 *
 * @typedef {Object} ResearchItem
 * @property {string}      id
 * @property {string|null} playerId       - Sleeper player_id if known
 * @property {string|null} playerName     - denormalized display name
 * @property {string|null} playerTeam
 * @property {string|null} playerPosition
 * @property {string}      title
 * @property {string|null} body           - article excerpt or user note body
 * @property {string|null} url            - external link (RSS / web)
 * @property {'user'|'sleeper'|'rss'|'mock'} source
 * @property {string|null} sourceId       - original ID from source system
 * @property {string|null} publishedAt    - ISO date from source
 * @property {string[]}    tags
 * @property {string}      createdAt      - ISO date added to this store
 * @property {string}      updatedAt      - ISO date last modified
 * @property {boolean}     isSaved        - pinned/bookmarked
 * @property {boolean}     isArchived
 */

/** Construct a new ResearchItem with required defaults applied. */
export function createItem(fields = {}) {
  const now = new Date().toISOString()
  return {
    id: genId(),
    playerId: null,
    playerName: null,
    playerTeam: null,
    playerPosition: null,
    title: '',
    body: null,
    url: null,
    source: 'user',
    sourceId: null,
    publishedAt: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
    isSaved: false,
    isArchived: false,
    ...fields,
  }
}
