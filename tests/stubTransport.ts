import { makeResponse, type HTTPRequest, type HTTPResponse, type HTTPTransport } from '@data/transport'

/**
 * A transport that answers from a script instead of the network — the port of
 * the Swift tests' `StubTransport`. Responses are handed out in order per URL
 * fragment; the last one repeats.
 */
export class StubTransport implements HTTPTransport {
  private scripted: { match: string; results: (HTTPResponse | Error)[] }[] = []
  readonly requests: HTTPRequest[] = []

  on(match: string, ...results: (HTTPResponse | Error)[]): this {
    this.scripted.push({ match, results })
    return this
  }

  json(match: string, body: string, status = 200, headers: Record<string, string> = {}): this {
    return this.on(match, makeResponse(status, body, headers))
  }

  fail(match: string, error: Error = new Error('offline')): this {
    return this.on(match, error)
  }

  /** Puts a new answer in front of an existing route for the same fragment. */
  override(match: string, body: string, status = 200): this {
    this.scripted = this.scripted.filter((e) => e.match !== match)
    this.scripted.unshift({ match, results: [makeResponse(status, body)] })
    return this
  }

  /** Swaps a route's answer while keeping its place in the order. */
  replace(match: string, body: string, status = 200): this {
    const i = this.scripted.findIndex((e) => e.match === match)
    if (i < 0) return this.json(match, body, status)
    this.scripted[i] = { match, results: [makeResponse(status, body)] }
    return this
  }

  /** Every URL path requested, in order. */
  requestedPaths(): string[] { return this.requests.map((r) => new URL(r.url, 'https://x.test').pathname) }

  get requestCount() { return this.requests.length }
  get urls() { return this.requests.map((r) => r.url) }
  header(name: string, index: number) { return this.requests[index]?.headers?.[name] }

  async send(request: HTTPRequest): Promise<HTTPResponse> {
    this.requests.push(request)
    for (const entry of this.scripted) {
      if (!request.url.includes(entry.match) || entry.results.length === 0) continue
      const result = entry.results.length === 1 ? entry.results[0]! : entry.results.shift()!
      if (result instanceof Error) throw result
      return result
    }
    throw new Error(`unscripted: ${request.url}`)
  }
}

export const ok = (body: string, headers: Record<string, string> = {}) => makeResponse(200, body, headers)
export const status = (code: number, body = '') => makeResponse(code, body)
