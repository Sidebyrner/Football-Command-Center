// Sleeper service — primary fantasy context layer.
// All league-native data comes from here. Do not replace with third-party sources.

import { sleeperApi } from '../utils/sleeperApi'
import { cacheGet, cacheSet, TTL } from '../utils/cache'

const KEYS = {
  PLAYERS: 'sleeper-players-v1',
  TRENDING: 'sleeper-trending-v1',
  league: (id) => `sleeper-league-${id}`,
  rosters: (id) => `sleeper-rosters-${id}`,
  users: (id) => `sleeper-users-${id}`,
  matchups: (id, week) => `sleeper-matchups-${id}-${week}`,
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

export function getAllPlayers(force = false) {
  const key = KEYS.PLAYERS
  if (!force) {
    const hit = cacheGet(key)
    if (hit) return Promise.resolve(hit)
  }
  return sleeperApi.getPlayers().then((data) => {
    cacheSet(key, data, TTL.PLAYERS)
    return data
  })
}

export async function getPlayerMeta(playerId) {
  const all = await getAllPlayers()
  return all?.[playerId] ?? null
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
