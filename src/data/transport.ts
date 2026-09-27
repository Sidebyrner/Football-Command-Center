import { DataLayerError } from './errors'

/**
 * The seam between this layer and the network — a port of FCData
 * `HTTPTransport`. Everything goes through here, so the whole layer is testable
 * with a stub and no network.
 */
export interface HTTPRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT'
  headers?: Record<string, string>
  body?: string
}

export interface HTTPResponse {
  status: number
  body: string
  /** Lower-cased header names. */
  headers: Record<string, string>
}

export interface HTTPTransport {
  send(request: HTTPRequest): Promise<HTTPResponse>
}

export const isOK = (r: HTTPResponse) => r.status >= 200 && r.status < 300
/** A `304` carries no body; the caller falls back to what it already has. */
export const isNotModified = (r: HTTPResponse) => r.status === 304

export function makeResponse(status: number, body: string, headers: Record<string, string> = {}): HTTPResponse {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return { status, body, headers: lower }
}

/**
 * `fetch`-backed transport. A hung request is worse than a failed one — a
 * failure surfaces and can retry — so it times out, 8 s by default, as the
 * phone does.
 */
export class FetchTransport implements HTTPTransport {
  constructor(private readonly timeoutMs = 8000) {}

  async send(request: HTTPRequest): Promise<HTTPResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(request.url, {
        method: request.method ?? 'GET',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        cache: 'no-store',
      })
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value })
      return { status: response.status, body: response.status === 304 ? '' : await response.text(), headers }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw new DataLayerError({ kind: 'timeout', path: request.url })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
