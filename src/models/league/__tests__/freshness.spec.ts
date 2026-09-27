import { describe, expect, it } from 'vitest'
import { freshnessExplanation, freshnessLabel, isDegraded } from '../Freshness'
import { weakestProvenance, type Provenance } from '@data/fetched'

const live: Provenance = { kind: 'live' }
const bundled: Provenance = { kind: 'bundled' }
const cached = (age: number): Provenance => ({ kind: 'cached', age })
const staleCache = (age: number, failure: string): Provenance => ({ kind: 'staleCache', age, failure })

/** Port of FreshnessTests: freshness is a claim the UI makes. */
describe('Freshness', () => {
  it('live data owes no label', () => {
    expect(freshnessLabel(live)).toBeUndefined()
    expect(freshnessExplanation(live)).toBeUndefined()
    expect(isDegraded(live)).toBe(false)
  })

  it('cached data says when it was fetched', () => {
    expect(freshnessLabel(cached(30))).toBe('Updated just now')
    expect(freshnessLabel(cached(600))).toBe('Updated 10 minutes ago')
    expect(freshnessLabel(cached(7_200))).toBe('Updated 2 hours ago')
    expect(freshnessLabel(cached(172_800))).toBe('Updated 2 days ago')
  })

  it('singular and plural agree', () => {
    expect(freshnessLabel(cached(3_600))).toBe('Updated 1 hour ago')
    expect(freshnessLabel(cached(86_400))).toBe('Updated 1 day ago')
  })

  it('stale data says it is offline', () => {
    expect(freshnessLabel(staleCache(7_200, 'offline'))).toBe('Offline — showing data from 2 hours ago')
    expect(isDegraded(staleCache(1, 'x'))).toBe(true)
  })

  it('bundled data says where it came from without alarm', () => {
    expect(freshnessLabel(bundled)).toBe('Shipped with the app')
    expect(isDegraded(bundled)).toBe(false)
  })

  it('weakest provenance wins', () => {
    expect(weakestProvenance([live, live])).toEqual(live)
    expect(weakestProvenance([live, cached(10)])).toEqual(cached(10))
    expect(weakestProvenance([cached(10), bundled])).toEqual(bundled)
    const stale = staleCache(10, 'offline')
    expect(weakestProvenance([live, bundled, stale])).toEqual(stale)
  })

  it('weakest of nothing is live', () => {
    expect(weakestProvenance([])).toEqual(live)
  })

  it('negative ages do not produce nonsense', () => {
    expect(freshnessLabel(cached(-5))).toBe('Updated just now')
  })
})
