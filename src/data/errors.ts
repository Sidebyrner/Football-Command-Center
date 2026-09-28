/**
 * Failures this layer can produce. Every kind names what could not be reached
 * or decoded, so the UI can say *which* data is missing — a port of FCData
 * `DataLayerError`.
 */
export type DataLayerErrorKind =
  | { kind: 'notHTTP'; url?: string }
  | { kind: 'httpStatus'; status: number; path: string }
  | { kind: 'undecodable'; path: string; underlying: string }
  | { kind: 'badURL'; path: string }
  | { kind: 'noFallbackAvailable'; resource: string }
  | { kind: 'timeout'; path: string }
  /** The endpoint refused the credentials it was given (401/403). The fix is to sign in again, not to retry. */
  | { kind: 'unauthorized'; path: string }

export class DataLayerError extends Error {
  constructor(readonly detail: DataLayerErrorKind) {
    super(describe(detail))
    this.name = 'DataLayerError'
  }

  get status(): number | undefined {
    return this.detail.kind === 'httpStatus' ? this.detail.status : undefined
  }
}

function describe(d: DataLayerErrorKind): string {
  switch (d.kind) {
    case 'notHTTP': return `Not an HTTP response: ${d.url ?? 'unknown URL'}`
    case 'httpStatus': return `HTTP ${d.status} from ${d.path}`
    case 'undecodable': return `Could not decode ${d.path}: ${d.underlying}`
    case 'badURL': return `Could not build a URL for ${d.path}`
    case 'noFallbackAvailable': return `No bundled or cached copy of ${d.resource}`
    case 'timeout': return `Timed out waiting for ${d.path}`
    case 'unauthorized': return `Not authorised for ${d.path}`
  }
}
