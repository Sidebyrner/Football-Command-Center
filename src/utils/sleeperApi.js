const BASE = 'https://api.sleeper.app/v1'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Sleeper API error ${res.status}: ${path}`)
  return res.json()
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
