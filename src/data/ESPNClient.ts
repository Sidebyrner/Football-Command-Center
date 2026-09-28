/**
 * Client for ESPN's fantasy football API — a port of FCData `ESPNClient`.
 *
 * Unofficial, undocumented, read-only. Public leagues answer the browser
 * directly (ESPN's API is CORS-open). Private leagues need the user's cookies,
 * and a page cannot set a `Cookie` header, so those requests go through the
 * site's own proxy (`netlify/functions/espn.mjs`), which forwards the two
 * cookie values it is handed and nothing else. Either way the credentials are
 * sent to one place, never logged, and every response decodes leniently.
 */
import { cookieHeader, type ESPNCredentials } from './espnCredentials'
import { DataLayerError } from './errors'
import { decodeESPNLeague, type ESPNLeague } from './espnModels'
import { FetchTransport, isOK, type HTTPResponse, type HTTPTransport } from './transport'

export const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl'
/** The site's proxy, relative to its origin. */
export const ESPN_PROXY_PATH = '/.netlify/functions/espn'

/** The request headers the proxy reads the cookies from. */
export const ESPN_PROXY_HEADERS = { s2: 'x-espn-s2', swid: 'x-espn-swid' } as const

export interface ESPNClientOptions {
  credentials?: ESPNCredentials
  /** ESPN itself, for public leagues (and tests). */
  baseURL?: string
  /** Where private-league requests go. `undefined` sends the cookies straight to ESPN (tests only). */
  proxyURL?: string
  transport?: HTTPTransport
  retries?: number
}

export class ESPNClient {
  private readonly credentials?: ESPNCredentials
  private readonly baseURL: string
  private readonly proxyURL?: string
  private readonly transport: HTTPTransport
  private readonly retries: number

  constructor(options: ESPNClientOptions = {}) {
    this.credentials = options.credentials
    this.baseURL = options.baseURL ?? ESPN_BASE_URL
    this.proxyURL = options.proxyURL
    this.transport = options.transport ?? new FetchTransport()
    this.retries = options.retries ?? 1
  }

  get isSignedIn(): boolean { return this.credentials !== undefined }

  // MARK: - Endpoints

  /** Settings, members and teams — and the cheapest way to learn whether the cookies still work. */
  league(id: string, season: number): Promise<ESPNLeague> {
    return this.get(id, season, 'view=mSettings&view=mTeam')
  }

  /** Every team with its full roster. */
  rosters(id: string, season: number): Promise<ESPNLeague> {
    return this.get(id, season, 'view=mRoster&view=mTeam')
  }

  /** One week's matchups with each side's lineup and per-player points. */
  matchups(id: string, season: number, week: number): Promise<ESPNLeague> {
    return this.get(id, season, `view=mMatchupScore&view=mBoxscore&view=mTeam&scoringPeriodId=${week}`)
  }

  // MARK: - Plumbing

  private async get(id: string, season: number, query: string): Promise<ESPNLeague> {
    const path = `/seasons/${season}/segments/0/leagues/${encodeURIComponent(id)}?${query}`
    const response = await this.send(path)
    try {
      return decodeESPNLeague(JSON.parse(response.body))
    } catch (error) {
      throw new DataLayerError({ kind: 'undecodable', path, underlying: String((error as Error).message ?? error) })
    }
  }

  private async send(path: string): Promise<HTTPResponse> {
    const reported = path.split('?')[0]!
    const headers: Record<string, string> = { accept: 'application/json' }
    let url: string
    if (this.credentials && this.proxyURL !== undefined) {
      // The proxy adds the Cookie header; the page only names the values.
      url = `${this.proxyURL}?path=${encodeURIComponent(path)}`
      headers[ESPN_PROXY_HEADERS.s2] = this.credentials.espnS2
      headers[ESPN_PROXY_HEADERS.swid] = this.credentials.swid
    } else {
      url = this.baseURL + path
      if (this.credentials) headers.cookie = cookieHeader(this.credentials)
    }

    let lastError: unknown = new DataLayerError({ kind: 'badURL', path: reported })
    for (let attempt = 0; attempt <= Math.max(0, this.retries); attempt++) {
      try {
        const response = await this.transport.send({ url, headers })
        // Report the path only — never the request, whose headers are the secret.
        if (response.status === 401 || response.status === 403) {
          throw new DataLayerError({ kind: 'unauthorized', path: reported })
        }
        if (!isOK(response)) throw new DataLayerError({ kind: 'httpStatus', status: response.status, path: reported })
        return response
      } catch (error) {
        lastError = error
        if (error instanceof DataLayerError) {
          if (error.detail.kind === 'unauthorized') throw error
          const status = error.status
          if (status !== undefined && status >= 400 && status < 500) throw error
        }
        if (attempt >= this.retries) throw error
      }
    }
    throw lastError
  }
}
