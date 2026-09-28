// The site's ESPN proxy: the one place the user's ESPN cookies pass through.
//
// A browser page cannot set a `Cookie` header, and ESPN's own cookies are
// third-party to this site, so a private league can only be read by something
// that adds the header on the page's behalf. This function does exactly that
// and nothing else: GET only, one allow-listed ESPN path prefix, the two cookie
// values copied from request headers into the upstream `Cookie`, the JSON body
// returned as is. It keeps no state and writes nothing to the logs.

const UPSTREAM = 'https://lm-api-reads.fantasy.espn.com'
const ALLOWED_PREFIX = '/apis/v3/games/ffl/seasons/'

export default async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  // The page passes ESPN's path, query included; this host only ever sees
  // the fantasy football league routes.
  const rel = path.startsWith('/apis/') ? path : `/apis/v3/games/ffl${path}`
  if (!rel.startsWith(ALLOWED_PREFIX) || rel.includes('..')) {
    return new Response('Bad path', { status: 400 })
  }

  const s2 = request.headers.get('x-espn-s2')
  const swid = request.headers.get('x-espn-swid')
  const headers = { accept: 'application/json', 'user-agent': 'lineup-lab-web' }
  if (s2 && swid) headers.cookie = `espn_s2=${s2}; SWID=${swid}`

  let upstream
  try {
    upstream = await fetch(UPSTREAM + rel, { headers, redirect: 'manual' })
  } catch {
    return new Response(JSON.stringify({ error: 'ESPN unreachable' }), { status: 502, headers: { 'content-type': 'application/json' } })
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      // A private league's data is the user's; never let a shared cache keep it.
      'cache-control': 'no-store',
    },
  })
}

export const config = { path: '/.netlify/functions/espn' }
