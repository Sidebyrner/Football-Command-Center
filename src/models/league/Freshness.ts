/**
 * Turns a `Provenance` into the words the UI shows — a port of FCApp
 * `Freshness`. Every screen rendering cached or bundled data owes the user a
 * visible note, and it should read the same everywhere.
 */
import type { Provenance } from '@data/fetched'

/** Short label for a header or chip; `undefined` when live. */
export function freshnessLabel(p: Provenance): string | undefined {
  switch (p.kind) {
    case 'live': return undefined
    case 'cached': return `Updated ${relativeAge(p.age)}`
    case 'staleCache': return `Offline — showing data from ${relativeAge(p.age)}`
    case 'bundled': return 'Shipped with the app'
  }
}

/** The longer form, for a detail row. */
export function freshnessExplanation(p: Provenance): string | undefined {
  switch (p.kind) {
    case 'live': return undefined
    case 'cached': return `Last refreshed ${relativeAge(p.age)}.`
    case 'staleCache': return `Could not reach Sleeper, so this is the copy from ${relativeAge(p.age)}.`
    case 'bundled': return 'This is the copy bundled at build time and may be behind.'
  }
}

/** Only stale data after a failed fetch is drawn as a warning. */
export const isDegraded = (p: Provenance) => p.kind === 'staleCache'

/** Coarse, the way a person would say it. */
export function relativeAge(ageSeconds: number): string {
  const s = Math.max(0, Math.trunc(ageSeconds))
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? '' : 's'} ago`
  if (s < 90) return 'just now'
  if (s < 3600) return n(Math.trunc(s / 60), 'minute')
  if (s < 86_400) return n(Math.trunc(s / 3600), 'hour')
  return n(Math.trunc(s / 86_400), 'day')
}
