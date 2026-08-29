// The Odds API relay — matches src/utils/oddsApi.js's exact upstream URLs and
// response shape, so B2's client change is "point the existing fetchNFLOdds
// at this route" rather than a rewrite of useOdds.js.

import { cacheGet, cacheSet, TTL } from '../lib/cache.js'

const BASE = 'https://api.the-odds-api.com/v4'

export default async function oddsRoutes(app) {
  app.get('/api/odds', async (req, reply) => {
    const apiKey = process.env.ODDS_API_KEY
    if (!apiKey) {
      return reply.code(503).send({ error: 'Server has no ODDS_API_KEY configured' })
    }

    const cached = cacheGet('odds:nfl')
    if (cached) return { ...cached, cached: true }

    const url = `${BASE}/sports/americanfootball_nfl/odds?apiKey=${apiKey}&regions=us&markets=totals,spreads&oddsFormat=american`
    let res
    try {
      res = await fetch(url)
    } catch (err) {
      return reply.code(502).send({ error: `Could not reach Odds API: ${err.message}` })
    }
    if (!res.ok) {
      return reply.code(502).send({ error: `Odds API error ${res.status}` })
    }

    const data = await res.json()
    const remaining = res.headers.get('x-requests-remaining')
    const used = res.headers.get('x-requests-used')
    const payload = {
      data,
      remaining: remaining ? Number(remaining) : null,
      used: used ? Number(used) : null,
    }

    // Cached by the server, not keyed to any one client — ten people loading
    // the Odds page costs one upstream call, not ten, and stretches the
    // 500/month free-tier quota accordingly.
    cacheSet('odds:nfl', payload, TTL.ODDS)
    return { ...payload, cached: false }
  })

  app.get('/api/odds/:eventId/props', async (req, reply) => {
    const apiKey = process.env.ODDS_API_KEY
    if (!apiKey) {
      return reply.code(503).send({ error: 'Server has no ODDS_API_KEY configured' })
    }
    const { eventId } = req.params
    const cacheKey = `odds:props:${eventId}`
    const cached = cacheGet(cacheKey)
    if (cached) return cached

    const url = `${BASE}/sports/americanfootball_nfl/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=player_reception_yds,player_rush_yds,player_pass_tds&oddsFormat=american`
    let res
    try {
      res = await fetch(url)
    } catch (err) {
      return reply.code(502).send({ error: `Could not reach Odds API: ${err.message}` })
    }
    if (!res.ok) {
      return reply.code(502).send({ error: `Odds API error ${res.status}` })
    }

    const data = await res.json()
    cacheSet(cacheKey, data, TTL.ODDS)
    return data
  })
}
