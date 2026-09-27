import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'

/** Port of DiskCacheTests. The cache is the piece most able to fail silently. */
describe('Cache', () => {
  const sample = { name: 'Josh Allen', count: 2 }
  const isSample = (v: unknown) => typeof v === 'object' && v !== null && 'name' in v && 'count' in v

  it('stores and reads back', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store(sample, 'sample', 60)
    const hit = await cache.load('sample')
    expect(hit?.value).toEqual(sample)
    expect(hit?.isStale).toBe(false)
  })

  it('treats a miss as undefined', async () => {
    expect(await new Cache(new MemoryStore()).load('never-written')).toBeUndefined()
  })

  it('withholds an expired entry by default', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store({ name: 'old', count: 1 }, 'sample', 60, Date.now() - 120_000)
    expect(await cache.load('sample')).toBeUndefined()
  })

  it('serves an expired entry, flagged, when stale is allowed', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store({ name: 'old', count: 1 }, 'sample', 60, Date.now() - 120_000)
    const hit = await cache.load<typeof sample>('sample', { allowingStale: true })
    expect(hit?.value.name).toBe('old')
    expect(hit?.isStale).toBe(true)
    expect(hit?.age).toBeGreaterThan(100)
  })

  it('reads an entry of the wrong shape as a miss and removes it', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store([1, 2, 3], 'sample', 60)
    expect(await cache.load('sample', { validate: isSample })).toBeUndefined()
    expect(await cache.contains('sample')).toBe(false)
  })

  it('reads a corrupt entry as a miss rather than a throw', async () => {
    const store = new MemoryStore()
    await store.set('sample', 'not an envelope at all')
    expect(await new Cache(store).load('sample')).toBeUndefined()
    expect(await store.has('sample')).toBe(false)
  })

  it('removes one entry', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store({ name: 'x', count: 1 }, 'a', 60)
    await cache.store({ name: 'y', count: 2 }, 'b', 60)
    await cache.remove('a')
    expect(await cache.load('a')).toBeUndefined()
    expect((await cache.load<typeof sample>('b'))?.value.name).toBe('y')
  })

  it('keeps team-abbreviation keys distinct', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store({ name: 'philly', count: 1 }, 'sleeper-roster-PHI', 60)
    await cache.store({ name: 'dallas', count: 2 }, 'sleeper-roster-DAL', 60)
    expect((await cache.load<typeof sample>('sleeper-roster-PHI'))?.value.name).toBe('philly')
    expect((await cache.load<typeof sample>('sleeper-roster-DAL'))?.value.name).toBe('dallas')
  })

  it('hands back a copy, so a caller mutating its value cannot corrupt the cache', async () => {
    const cache = new Cache(new MemoryStore())
    await cache.store({ list: [1] }, 'k', 60)
    const first = await cache.load<{ list: number[] }>('k')
    first!.value.list.push(2)
    expect((await cache.load<{ list: number[] }>('k'))?.value.list).toEqual([1])
  })
})
