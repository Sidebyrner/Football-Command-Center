/**
 * Research source adapters.
 *
 * Each adapter is an async function that returns ResearchItem[].
 * Currently implemented: mock seed data, RSS via the server proxy (B1/B2).
 * Stub: Sleeper news (no public endpoint yet).
 *
 * To add a new source in the future:
 *   1. Export an async fetchXxx() function here
 *   2. Normalize its output to the ResearchItem shape via createItem()
 *   3. Call it from useResearchStore or a dedicated hook
 */

import { createItem } from './researchStore'
import { API_BASE, hasApiProxy } from './apiBase'

// ---------------------------------------------------------------------------
// Mock adapter
// Realistic seed content — shapes the feed for new users and demos the UI.
// Treated identically to user-saved items after first load.
// ---------------------------------------------------------------------------

const MOCK_SEED = [
  {
    id: 'mock-0',
    playerName: 'CeeDee Lamb',
    playerTeam: 'DAL',
    playerPosition: 'WR',
    title: 'Lamb expects expanded slot role in new offensive scheme',
    body: 'Reports from minicamp indicate Lamb will see increased usage as a route runner out of the slot following the coordinator hire. Target projection sits at 160+ for 2026. No injury concerns.',
    source: 'mock',
    tags: ['role-change', 'offense'],
    publishedAt: '2026-05-01T14:00:00Z',
  },
  {
    id: 'mock-1',
    playerName: 'Travis Kelce',
    playerTeam: 'KC',
    playerPosition: 'TE',
    title: 'Retirement chatter surfaces — Kelce yet to commit to 2026 season',
    body: 'Multiple reports from KC insiders suggest Kelce is weighing his options. No public commitment to return as of May. Elevated risk; monitor through July before drafting.',
    source: 'mock',
    tags: ['contract', 'general'],
    publishedAt: '2026-04-28T09:00:00Z',
  },
  {
    id: 'mock-2',
    playerName: 'Bijan Robinson',
    playerTeam: 'ATL',
    playerPosition: 'RB',
    title: 'Robinson locked in as every-down back after Allgeier release',
    body: 'Atlanta released Tyler Allgeier in March, clearing Robinson for full three-down usage. Projected 280+ carries in 2026 with pass-catching upside. Scheme-dependent — watch OC hire.',
    source: 'mock',
    tags: ['depth-chart', 'role-change'],
    publishedAt: '2026-04-15T11:00:00Z',
  },
  {
    id: 'mock-3',
    playerName: 'Jayden Daniels',
    playerTeam: 'WAS',
    playerPosition: 'QB',
    title: "Daniels Year 2 leap — rushing floor makes him a QB1 anchor",
    body: "Washington's new coordinator is designing the offense around Daniels' legs. 700+ rushing yard floor projected. Offense ranked top-5 in early projected points totals for 2026.",
    source: 'mock',
    tags: ['offense', 'coaching'],
    publishedAt: '2026-05-10T16:00:00Z',
  },
  {
    id: 'mock-4',
    playerName: 'Sam LaPorta',
    playerTeam: 'DET',
    playerPosition: 'TE',
    title: 'LaPorta target share concern — Detroit adds WR depth in draft',
    body: "Detroit drafted two receivers in rounds 1 and 2. LaPorta's share may dip from 23% to ~18%. Still a strong TE2, but temper expectations from his Year 1 pace.",
    source: 'mock',
    tags: ['depth-chart', 'offense'],
    publishedAt: '2026-05-05T08:30:00Z',
  },
  {
    id: 'mock-5',
    playerName: 'Josh Allen',
    playerTeam: 'BUF',
    playerPosition: 'QB',
    title: 'Allen rushing volume projected to decline in age-30 season',
    body: "New staff has signaled a more conservative approach to Allen's designed runs. Scrambles will remain situational. Passing volume expected to rise to compensate — ceiling unchanged.",
    source: 'mock',
    tags: ['coaching', 'role-change'],
    publishedAt: '2026-04-22T12:00:00Z',
  },
  {
    id: 'mock-6',
    playerName: 'Drake London',
    playerTeam: 'ATL',
    playerPosition: 'WR',
    title: 'London entering breakout trajectory with Penix entering Year 2',
    body: 'London-Penix connection tested well in OTAs. London projects as the clear WR1 in Atlanta with Pitts shifting to an in-line TE-only role. Undervalued at current ADP.',
    source: 'mock',
    tags: ['camp-buzz', 'offense'],
    publishedAt: '2026-05-14T10:00:00Z',
  },
  {
    id: 'mock-7',
    playerName: 'Justin Jefferson',
    playerTeam: 'MIN',
    playerPosition: 'WR',
    title: 'Jefferson extension locked in — fully guaranteed through 2029',
    body: 'New contract removes any holdout risk. Jefferson is a top-3 pick in any format. No injury history since 2023 hamstring. Draft with confidence at current price.',
    source: 'mock',
    tags: ['contract'],
    publishedAt: '2026-03-18T18:00:00Z',
  },
]

/** Returns seeded mock ResearchItem[] for first-time store initialization. */
export function getMockItems() {
  const now = new Date().toISOString()
  return MOCK_SEED.map((seed) =>
    createItem({
      createdAt: seed.publishedAt ?? now,
      updatedAt: seed.publishedAt ?? now,
      ...seed,
    })
  )
}

// ---------------------------------------------------------------------------
// Sleeper adapter (stub)
// Sleeper's public API does not expose a player news or transaction news
// endpoint. This stub is wired as the correct call site for when one appears.
// ---------------------------------------------------------------------------

/**
 * Fetch Sleeper-native news for a player.
 * @param {string} _playerId - Sleeper player_id
 * @returns {Promise<ResearchItem[]>}
 */
export async function fetchSleeperNews(_playerId) {
  // Sleeper public API has no /players/{id}/news endpoint as of 2026.
  // Implement here when available; normalize to ResearchItem via createItem().
  return []
}

// ---------------------------------------------------------------------------
// RSS adapter — relayed through server/'s /api/news route (see B1/B2 in the
// deploy plan). A browser cannot fetch arbitrary external feeds directly
// (CORS), so this always goes through the proxy; there is no direct-fetch
// fallback to degrade to, unlike odds. Without a configured proxy, or if it
// is unreachable, this returns [] rather than throwing — matching
// fetchSleeperNews's existing no-op contract, so a stopped container silently
// yields no news rather than breaking the Research page.
// ---------------------------------------------------------------------------

/**
 * Fetch and normalize one server-side feed alias into ResearchItem[].
 * @param {string} feedAlias - a key from server/src/routes/news.js's FEEDS map
 *   (e.g. 'espn_nfl'), NOT an arbitrary URL — the server only relays known,
 *   allowlisted feeds, so this can never be pointed at anything else.
 * @returns {Promise<ResearchItem[]>}
 */
export async function fetchRSSFeed(feedAlias) {
  if (!hasApiProxy) return []

  let res
  try {
    res = await fetch(`${API_BASE}/api/news?feed=${encodeURIComponent(feedAlias)}`)
  } catch {
    return []
  }
  if (!res.ok) return []

  const body = await res.json()
  return (body.items ?? []).map((entry) =>
    createItem({
      title: entry.title,
      body: entry.body,
      url: entry.url,
      source: 'rss',
      sourceId: entry.sourceId,
      publishedAt: entry.publishedAt,
      tags: [],
    })
  )
}
