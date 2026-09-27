/**
 * The demo league — a port of the native app's Debug `DemoMode`. Visitors
 * without a Sleeper league can try every screen on the same generated league
 * the native app uses: Sleeper responses from `public/demo/routes.json`
 * (exported from `apple/App/Demo/DemoLeagueData.swift` by
 * `scripts/export-demo-league.mjs`), the site's bundled data files, a fixed
 * clock, and a throwaway in-memory cache so demo data never touches a real one.
 */
import { Cache, MemoryStore } from './cache'
import { SleeperClient } from './SleeperClient'
import { SleeperService } from './SleeperService'
import { StaticDataStore, siteBundle } from './StaticDataStore'
import { FetchTransport, makeResponse, type HTTPRequest, type HTTPResponse, type HTTPTransport } from './transport'

/** Sunday 2025-10-19 2:30pm ET: the London and 1pm games are on, the late ones aren't. */
export const DEMO_NOW = Date.parse('2025-10-19T18:30:00Z')

/** Already configured, so the app opens straight onto the screens. */
export const DEMO_SETTINGS = { sleeperUsername: 'connor', userID: 'u1', leagueID: 'L1', rosterID: 1 } as const

/** Serves the demo routes by URL path; anything else is a 404, as on the phone. */
export class DemoTransport implements HTTPTransport {
  constructor(
    private readonly routes: Readonly<Record<string, string>>,
    /** A short delay, so loading states are visible rather than instantaneous. */
    private readonly latencyMs = 250,
  ) {}

  async send(request: HTTPRequest): Promise<HTTPResponse> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs))
    const path = new URL(request.url).pathname
    const body = Object.prototype.hasOwnProperty.call(this.routes, path) ? this.routes[path] : undefined
    return body === undefined ? makeResponse(404, 'null') : makeResponse(200, body)
  }
}

/** Loads the routes file shipped with the site. */
export async function loadDemoRoutes(base: string = import.meta.env?.BASE_URL ?? '/'): Promise<Record<string, string>> {
  const response = await fetch(`${base}demo/routes.json`)
  if (!response.ok) throw new Error(`demo routes: HTTP ${response.status}`)
  return (await response.json()) as Record<string, string>
}

/** The demo's services: no network beyond the site itself. */
export function makeDemoServices(routes: Readonly<Record<string, string>>, latencyMs = 250) {
  const transport = new DemoTransport(routes, latencyMs)
  const cache = new Cache(new MemoryStore())
  return {
    sleeper: new SleeperService(new SleeperClient({ transport, retries: 0 }), cache),
    staticData: new StaticDataStore({ cache, transport, baseURL: null, bundled: siteBundle(new FetchTransport()) }),
    now: () => DEMO_NOW,
    settings: DEMO_SETTINGS,
  }
}

/** `?demo` in the address opens the demo league. */
export const isDemoRequested = (search: string = globalThis.location?.search ?? '') => new URLSearchParams(search).has('demo')
