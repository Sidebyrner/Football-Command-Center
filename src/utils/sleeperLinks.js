// Links into Sleeper. Its API is read-only, so every change this app recommends
// has to be made in Sleeper itself. Same helper as the iOS app's SleeperLinks.

export function sleeperTeamUrl(leagueId) {
  return leagueId ? `https://sleeper.com/leagues/${encodeURIComponent(leagueId)}/team` : null
}
