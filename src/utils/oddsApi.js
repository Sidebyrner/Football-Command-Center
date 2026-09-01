import { API_BASE, hasApiProxy } from './apiBase'

const BASE = 'https://api.the-odds-api.com/v4'

async function fetchNFLOddsDirect(apiKey) {
  const url = `${BASE}/sports/americanfootball_nfl/odds?apiKey=${apiKey}&regions=us&markets=totals,spreads&oddsFormat=american`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error ${res.status}`)
  const data = await res.json()
  const remaining = res.headers.get('x-requests-remaining')
  const used = res.headers.get('x-requests-used')
  return { data, remaining: remaining ? Number(remaining) : null, used: used ? Number(used) : null }
}

async function fetchNFLOddsViaProxy() {
  const res = await fetch(`${API_BASE}/api/odds`)
  if (!res.ok) throw new Error(`Proxy odds error ${res.status}`)
  const body = await res.json()
  return { data: body.data, remaining: body.remaining ?? null, used: body.used ?? null }
}

// Proxy first (server holds the key, so it never ships to the browser).
// Falls back to the direct call — which still needs the user's own key from
// Settings — only when the proxy is unset or unreachable, so a stopped
// container degrades this to today's behavior rather than breaking it.
export async function fetchNFLOdds(apiKey) {
  if (hasApiProxy) {
    try {
      return await fetchNFLOddsViaProxy()
    } catch (err) {
      if (!apiKey) throw err
    }
  }
  return fetchNFLOddsDirect(apiKey)
}

async function fetchPlayerPropsDirect(apiKey, eventId) {
  const url = `${BASE}/sports/americanfootball_nfl/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=player_reception_yds,player_rush_yds,player_pass_tds&oddsFormat=american`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Odds API error ${res.status}`)
  return res.json()
}

async function fetchPlayerPropsViaProxy(eventId) {
  const res = await fetch(`${API_BASE}/api/odds/${eventId}/props`)
  if (!res.ok) throw new Error(`Proxy odds error ${res.status}`)
  return res.json()
}

export async function fetchPlayerProps(apiKey, eventId) {
  if (hasApiProxy) {
    try {
      return await fetchPlayerPropsViaProxy(eventId)
    } catch (err) {
      if (!apiKey) throw err
    }
  }
  return fetchPlayerPropsDirect(apiKey, eventId)
}
