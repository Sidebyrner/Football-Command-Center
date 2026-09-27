// Sleeper service — primary fantasy context layer.
// All league-native data comes from here. Do not replace with third-party sources.

import { sleeperApi } from '../utils/sleeperApi.js'
import { cacheGet, cacheGetEntry, cacheSet, TTL } from '../utils/cache.js'
import { distinctFantasyPositions } from '../utils/slotEligibility.js'

const KEYS = {
  PLAYERS: 'sleeper-players-v1',
  TRENDING: 'sleeper-trending-v1',
  NFL_STATE: 'sleeper-nfl-state-v1',
  league: (id) => `sleeper-league-${id}`,
  rosters: (id) => `sleeper-rosters-${id}`,
  users: (id) => `sleeper-users-${id}`,
  matchups: (id, week) => `sleeper-matchups-${id}-${week}`,
  transactions: (id, week) => `sleeper-transactions-${id}-${week}`,
  drafts: (id) => `sleeper-drafts-${id}`,
  draftPicks: (draftId) => `sleeper-picks-${draftId}`,
}

async function cached(key, ttl, fetcher) {
  const hit = cacheGet(key)
  if (hit) return hit
  const data = await fetcher()
  cacheSet(key, data, ttl)
  return data
}

// ── League context ────────────────────────────────────────────────────────────

export function getLeagueSettings(leagueId) {
  return cached(KEYS.league(leagueId), TTL.ROSTER, () => sleeperApi.getLeague(leagueId))
}

export async function getLeagueScoringSettings(leagueId) {
  const league = await getLeagueSettings(leagueId)
  return league?.scoring_settings ?? {}
}

export function getLeagueRosters(leagueId) {
  return cached(KEYS.rosters(leagueId), TTL.ROSTER, () => sleeperApi.getRosters(leagueId))
}

export function getLeagueUsers(leagueId) {
  return cached(KEYS.users(leagueId), TTL.ROSTER, () => sleeperApi.getUsers(leagueId))
}

export function getLeagueMatchups(leagueId, week) {
  return cached(KEYS.matchups(leagueId, week), TTL.ROSTER, () =>
    sleeperApi.getMatchups(leagueId, week)
  )
}

// A completed week's scores never change again, so the 5-minute roster TTL is
// wrong for them — season-history aggregates would re-fetch every past week
// every 5 minutes. Same cache key as the live variant (so a week already
// fetched live is reused), just written with a long TTL.
export function getLeagueMatchupsHistorical(leagueId, week) {
  return cached(KEYS.matchups(leagueId, week), TTL.NFLVERSE, () =>
    sleeperApi.getMatchups(leagueId, week)
  )
}

// Current NFL week straight from Sleeper, so season features don't depend on
// the hand-typed currentWeek in Settings staying up to date.
export function getNflState() {
  return cached(KEYS.NFL_STATE, TTL.TRENDING, () => sleeperApi.getNflState())
}

export function getLeagueTransactions(leagueId, week) {
  return cached(KEYS.transactions(leagueId, week), TTL.ROSTER, () =>
    sleeperApi.getTransactions(leagueId, week)
  )
}

// ── Drafts ────────────────────────────────────────────────────────────────────

// force bypasses the 5-minute cache — used while polling pre-draft, where a
// draft that didn't exist yet (or hadn't started) needs to be noticed sooner
// than the next natural cache expiry.
export function getLeagueDrafts(leagueId, force = false) {
  const key = KEYS.drafts(leagueId)
  if (!force) {
    const hit = cacheGet(key)
    if (hit) return Promise.resolve(hit)
  }
  return sleeperApi.getDrafts(leagueId).then((data) => {
    cacheSet(key, data, TTL.ROSTER)
    return data
  })
}

export function getDraftPicks(draftId) {
  return cached(KEYS.draftPicks(draftId), TTL.ROSTER, () => sleeperApi.getDraftPicks(draftId))
}

// Live variant for an in-progress draft. The 5-minute roster TTL is far too
// long here — a board that is five minutes stale during a draft will show
// players as available after they have been taken.
export function getDraftPicksLive(draftId) {
  return cached(KEYS.draftPicks(draftId), TTL.LIVE_DRAFT, () => sleeperApi.getDraftPicks(draftId))
}

export function getDraft(draftId) {
  return sleeperApi.getDraft(draftId)
}

// ── Player metadata (master player index) ────────────────────────────────────
// Sleeper /players/nfl is the source of truth for all player identity fields.
//
// The raw payload is ~5 MB and localStorage caps at ~5 MB per origin, so the
// raw blob can't be cached: the write fails silently and every call downloads
// it again. (It was also stored under the very key useDraftPlayers evicts on
// every load.) What's cached is a trimmed identity index — name, position,
// team, injury tag, active — keyed by player id, and concurrent callers share
// one in-flight request instead of starting a download each.

// v3 adds fantasyPositions; v2 entries lack it and are rebuilt.
const PLAYER_INDEX_KEY = 'sleeper-player-index-v3'
let playerIndexPromise = null

/** Reduces Sleeper's raw player map to what identity lookups need. */
export function trimPlayerIndex(raw) {
  const out = {}
  for (const [id, p] of Object.entries(raw ?? {})) {
    if (!p) continue
    const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || null
    const fantasyPositions = distinctFantasyPositions(p.position, p.fantasy_positions)
    out[id] = {
      name,
      position: p.position ?? null,
      // Slot eligibility, only when the position doesn't already imply it
      // (see utils/slotEligibility.js) — the key is absent for most players.
      ...(fantasyPositions ? { fantasyPositions } : {}),
      team: p.team ?? null,
      injuryStatus: p.injury_status ?? null,
      active: p.active === true,
    }
  }
  return out
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.force]
 * @param {number} [opts.maxAgeMs] refetch when the cached index is older than
 *   this, even inside its TTL — see playersMaxAge in utils/gameClock.js.
 * @returns {Promise<Record<string, {name, position, fantasyPositions, team, injuryStatus, active}>>}
 */
export function getPlayerIndex({ force = false, maxAgeMs = TTL.PLAYERS } = {}) {
  if (!force) {
    const hit = cacheGetEntry(PLAYER_INDEX_KEY)
    if (hit && hit.ageMs < maxAgeMs) return Promise.resolve(hit.data)
  }
  if (!playerIndexPromise) {
    playerIndexPromise = sleeperApi.getPlayers()
      .then((raw) => {
        const index = trimPlayerIndex(raw)
        cacheSet(PLAYER_INDEX_KEY, index, TTL.PLAYERS)
        return index
      })
      .finally(() => { playerIndexPromise = null })
  }
  return playerIndexPromise
}

/** @deprecated kept for existing callers; returns the trimmed index. */
export function getAllPlayers(force = false) {
  return getPlayerIndex({ force })
}

/** A single player's identity, in Sleeper's field names for existing callers. */
export async function getPlayerMeta(playerId) {
  const p = (await getPlayerIndex())?.[playerId]
  if (!p) return null
  return { player_id: playerId, full_name: p.name, position: p.position, fantasy_positions: p.fantasyPositions, team: p.team, injury_status: p.injuryStatus, active: p.active }
}

// ── Trending ──────────────────────────────────────────────────────────────────

export async function getTrendingPlayers(type = 'add') {
  const key = KEYS.TRENDING
  const hit = cacheGet(key)
  if (hit) return type === 'add' ? hit.adds : hit.drops

  const [adds, drops] = await Promise.all([
    sleeperApi.getTrendingAdds(),
    sleeperApi.getTrendingDrops(),
  ])
  const trending = { adds, drops }
  cacheSet(key, trending, TTL.TRENDING)
  return type === 'add' ? adds : drops
}
