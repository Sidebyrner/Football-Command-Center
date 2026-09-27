/**
 * The optional relay: news, live odds, AI trade pitches — a port of FCData
 * `RelayClient`.
 *
 * **Everything here is enrichment and every call fails soft.** Read methods
 * return `undefined` on any failure; the caller renders without it. `probe()`
 * is the exception, whose whole job is to report reachability.
 */
import { FetchTransport, isOK, type HTTPResponse, type HTTPTransport } from './transport'
import { isObject } from './decode'

export interface NewsItem {
  title: string
  body?: string
  url?: string
  publishedAt?: string
  sourceId?: string
}

export interface NewsFeed {
  feed?: string
  items: NewsItem[]
  /** Whether the relay served this from its own cache. */
  cached?: boolean
}

function decodeNewsFeed(json: unknown): NewsFeed | undefined {
  if (!isObject(json) || !Array.isArray(json.items)) return undefined
  const items: NewsItem[] = []
  for (const raw of json.items) {
    if (!isObject(raw) || typeof raw.title !== 'string') return undefined
    const item: NewsItem = { title: raw.title }
    for (const k of ['body', 'url', 'publishedAt', 'sourceId'] as const) if (typeof raw[k] === 'string') item[k] = raw[k] as string
    items.push(item)
  }
  const feed: NewsFeed = { items }
  if (typeof json.feed === 'string') feed.feed = json.feed
  if (typeof json.cached === 'boolean') feed.cached = json.cached
  return feed
}

export interface TradePitchRequest {
  /** The deal's facts, one per line. The model may only rephrase these. */
  facts: string[]
  /** The template pitch, so the model polishes rather than starts over. */
  draft: string
}

/** Why a pitch couldn't be polished — each needs a different fix. */
export type PolishFailure =
  | { kind: 'unauthorized' }
  | { kind: 'unreachable' }
  | { kind: 'server'; status: number }
  | { kind: 'emptyResponse' }

export type PolishResult = { ok: true; pitch: string } | { ok: false; failure: PolishFailure }

export class RelayClient {
  private readonly baseURL: string

  constructor(baseURL: string, private readonly transport: HTTPTransport = new FetchTransport(5000)) {
    this.baseURL = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  }

  /** Whether the relay is reachable, so the UI can hide what would fail. */
  async probe(): Promise<boolean> {
    try {
      return isOK(await this.send('health'))
    } catch {
      return false
    }
  }

  /** Aggregated RSS; `undefined` means the news section simply doesn't render. */
  async news(feed: string): Promise<NewsFeed | undefined> {
    const json = await this.softGet('api/news', { feed })
    return json === undefined ? undefined : decodeNewsFeed(json)
  }

  /** Live odds. Needs a paid key on the relay, so `undefined` is routine. */
  odds(): Promise<unknown | undefined> {
    return this.softGet('api/odds')
  }

  /** Player props for one event. */
  props(eventID: string): Promise<unknown | undefined> {
    return this.softGet(`api/odds/${encodeURIComponent(eventID)}/props`)
  }

  /** The remaining relay routes, with the same fail-soft contract. */
  get(path: string, query: Record<string, string> = {}): Promise<unknown | undefined> {
    return this.softGet(path, query)
  }

  /** Rewrites a trade pitch on the relay's model, saying why when it can't. */
  async polishTradePitchResult(request: TradePitchRequest, token?: string): Promise<PolishResult> {
    let response: HTTPResponse
    try {
      response = await this.send('api/ai/trade-pitch', {}, 'POST', JSON.stringify({ facts: request.facts, draft: request.draft }), token)
    } catch {
      return { ok: false, failure: { kind: 'unreachable' } }
    }
    if (response.status === 401 || response.status === 403) return { ok: false, failure: { kind: 'unauthorized' } }
    if (!isOK(response)) return { ok: false, failure: { kind: 'server', status: response.status } }
    let pitch: unknown
    try {
      pitch = (JSON.parse(response.body) as { pitch?: unknown }).pitch
    } catch {
      return { ok: false, failure: { kind: 'emptyResponse' } }
    }
    const trimmed = typeof pitch === 'string' ? pitch.trim() : ''
    return trimmed ? { ok: true, pitch: trimmed } : { ok: false, failure: { kind: 'emptyResponse' } }
  }

  /** `undefined` on any failure — the template pitch is always the fallback. */
  async polishTradePitch(request: TradePitchRequest, token?: string): Promise<string | undefined> {
    const result = await this.polishTradePitchResult(request, token)
    return result.ok ? result.pitch : undefined
  }

  private async softGet(path: string, query: Record<string, string> = {}): Promise<unknown | undefined> {
    try {
      const response = await this.send(path, query)
      return isOK(response) ? JSON.parse(response.body) : undefined
    } catch {
      return undefined
    }
  }

  private send(path: string, query: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET', body?: string, token?: string) {
    const search = new URLSearchParams(query).toString()
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    return this.transport.send({ url: this.baseURL + path + (search ? `?${search}` : ''), method, headers, body })
  }
}
