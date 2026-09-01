const BASE = 'https://api.sleeper.app/v1'
const TIMEOUT_MS = 8_000

// A hung/slow request during a live draft is worse than a failed one — at
// least a failure surfaces and can retry. One retry, short timeout: this is
// a personal draft-day tool polling every few seconds, not a general-purpose
// client that needs backoff tuning.
async function get(path, { retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(`${BASE}${path}`, { signal: controller.signal })
      if (!res.ok) throw new Error(`Sleeper API error ${res.status}: ${path}`)
      return await res.json()
    } catch (err) {
      if (attempt >= retries) throw err
    } finally {
      clearTimeout(timer)
    }
  }
}

export const sleeperApi = {
  getUser: (username) => get(`/user/${username}`),
  getLeagues: (userId, season) => get(`/user/${userId}/leagues/nfl/${season}`),
  getLeague: (leagueId) => get(`/league/${leagueId}`),
  getRosters: (leagueId) => get(`/league/${leagueId}/rosters`),
  getUsers: (leagueId) => get(`/league/${leagueId}/users`),
  getMatchups: (leagueId, week) => get(`/league/${leagueId}/matchups/${week}`),
  getPlayers: () => get(`/players/nfl`),
  getTrendingAdds: () => get(`/players/nfl/trending/add?limit=25`),
  getTrendingDrops: () => get(`/players/nfl/trending/drop?limit=25`),
  getTransactions: (leagueId, week) => get(`/league/${leagueId}/transactions/${week}`),
  getDrafts: (leagueId) => get(`/league/${leagueId}/drafts`),
  getDraftPicks: (draftId) => get(`/draft/${draftId}/picks`),
  getTradedPicks: (leagueId) => get(`/league/${leagueId}/traded_picks`),
  getDraft: (draftId) => get(`/draft/${draftId}`),
}
