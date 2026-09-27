/**
 * Where a value came from — a port of FCData `Provenance`. "Cached from four
 * hours ago" is a materially different claim from "live", so provenance is part
 * of every return type and a caller has to destructure it to get the value.
 */
export type Provenance =
  | { kind: 'live' }
  | { kind: 'cached'; age: number }
  /** The fetch failed and an **expired** entry was served. The UI must label this. */
  | { kind: 'staleCache'; age: number; failure: string }
  /** Read from the copy shipped with the site. */
  | { kind: 'bundled' }

export const live: Provenance = { kind: 'live' }

/** True when the UI owes the user a visible "as of" note. */
export function needsFreshnessLabel(p: Provenance): boolean {
  return p.kind !== 'live'
}

/** Age in seconds, when there is one. */
export function provenanceAge(p: Provenance): number | undefined {
  return p.kind === 'cached' || p.kind === 'staleCache' ? p.age : undefined
}

export interface Fetched<T> {
  value: T
  provenance: Provenance
}

/** Re-wraps the value while carrying provenance across unchanged. */
export function mapFetched<A, B>(f: Fetched<A>, transform: (a: A) => B): Fetched<B> {
  return { value: transform(f.value), provenance: f.provenance }
}
