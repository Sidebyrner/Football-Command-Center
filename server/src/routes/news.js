// RSS/Atom news relay.
//
// The client never sends an arbitrary URL here — that would make this route
// an open relay any caller could point at anything. `feed` is a short alias
// resolved against a server-side allowlist only.
//
// NOTE ON FEED URLS: these were never fetched from the CI/build sandbox this
// server was authored in — its egress is restricted to a small allowlist and
// does not reach arbitrary news sites. They are well-known public feeds, but
// verify reachability from the actual deployment host before relying on this
// route, and swap in whichever sources you trust. This is server code, not
// env config, by design — it is not a secret and does not need to be.
const FEEDS = {
  espn_nfl: 'https://www.espn.com/espn/rss/nfl/news',
  pft: 'https://profootballtalk.nbcsports.com/feed/',
}

import { cacheGet, cacheSet, TTL } from '../lib/cache.js'
import { parseFeed } from '../lib/rssParse.js'

export default async function newsRoutes(app) {
  app.get('/api/news', async (req, reply) => {
    const alias = req.query.feed
    if (!alias) {
      return reply.code(400).send({ error: 'Query param "feed" is required', available: Object.keys(FEEDS) })
    }
    const url = FEEDS[alias]
    if (!url) {
      return reply.code(404).send({ error: `Unknown feed alias "${alias}"`, available: Object.keys(FEEDS) })
    }

    const cacheKey = `news:${alias}`
    const cached = cacheGet(cacheKey)
    if (cached) return { feed: alias, items: cached, cached: true }

    let res
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'FootballCommandCenter/1.0' } })
    } catch (err) {
      return reply.code(502).send({ error: `Could not reach feed: ${err.message}` })
    }
    if (!res.ok) {
      return reply.code(502).send({ error: `Feed returned ${res.status}` })
    }

    const xml = await res.text()
    let items
    try {
      items = parseFeed(xml)
    } catch (err) {
      return reply.code(502).send({ error: `Could not parse feed: ${err.message}` })
    }

    cacheSet(cacheKey, items, TTL.NEWS)
    return { feed: alias, items, cached: false }
  })
}
