const BASE = 'https://api.the-odds-api.com/v4'

export async function fetchNFLOdds(apiKey) {
  const url = `${BASE}/sports/americanfootball_nfl/odds?apiKey=${apiKey}&regions=us&markets=totals,spreads&oddsFormat=american`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error ${res.status}`)
  const data = await res.json()
  const remaining = res.headers.get('x-requests-remaining')
  const used = res.headers.get('x-requests-used')
  return { data, remaining: remaining ? Number(remaining) : null, used: used ? Number(used) : null }
}

export async function fetchPlayerProps(apiKey, eventId) {
  const url = `${BASE}/sports/americanfootball_nfl/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=player_reception_yds,player_rush_yds,player_pass_tds&oddsFormat=american`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error ${res.status}`)
  return res.json()
}
