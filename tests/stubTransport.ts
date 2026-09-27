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
