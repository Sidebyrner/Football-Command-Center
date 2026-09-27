import { describe, expect, it } from 'vitest'
import { hasFixture, readFixture } from './swiftFixtures'

// The parity suites depend on reading the native fixtures in place.
describe('Swift fixtures', () => {
  it('are reachable from the web tests', () => {
    expect(hasFixture('FCCore', 'qb-dst-k-stream')).toBe(true)
    expect(hasFixture('FCCore', 'rb-stream')).toBe(true)
  })

  it('parse as JSON', () => {
    const scores = readFixture<unknown[]>('FCData', 'scores-2026-w2.json')
    expect(Array.isArray(scores)).toBe(true)
    expect(scores.length).toBeGreaterThan(0)
  })
})
