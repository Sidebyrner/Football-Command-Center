import { describe, expect, it } from 'vitest'
import { StaticDataStore, StaticResources, IN_SEASON_TTL, type BundledSource, type StaticResource } from '@data/StaticDataStore'
import { Cache, CacheTTL, MemoryStore } from '@data/cache'
import { DataLayerError } from '@data/errors'
import { hasFixture, readFixture } from '../../../tests/swiftFixtures'
import { StubTransport, ok, status } from '../../../tests/stubTransport'

/** The Swift fixtures stand in for the site's bundled `data/` folder. */
const fixtureBundle: BundledSource = async (r) =>
  hasFixture('FCData', `${r.bundledName}.json`) ? readFixture('FCData', `${r.bundledName}.json`) : undefined

const store = (transport = new StubTransport(), baseURL: string | null = null) =>
  new StaticDataStore({ cache: new Cache(new MemoryStore()), transport, baseURL, bundled: fixtureBundle })

type Schedule = { byWeek: Record<string, { home?: string; spreadLine?: number; totalLine?: number }[]> }
const schedule = StaticResources.schedule(2025)
const base = 'https://data.example.test/'

/** Port of StaticDataStoreTests: bundled copy, conditional refresh, fallbacks. */
describe('StaticDataStore', () => {
  it('falls back to the bundled copy, labelled', async () => {
    const s = await store().load<Schedule>(schedule)
    expect(s.provenance.kind).toBe('bundled')
    expect(Object.keys(s.value.byWeek).length).toBeGreaterThan(0)
  })

  it('treats a missing in-season file as an ordinary error', async () => {
    await expect(store().load(StaticResources.injuries(2031))).rejects.toBeInstanceOf(DataLayerError)
  })

  it('decodes the real crosswalk', async () => {
    expect(Object.keys((await store().playerCrosswalk()).value.players).length).toBeGreaterThan(5000)
  })

  it('stores a refresh and reports it live, then serves the cache', async () => {
    const t = new StubTransport().json('schedule-2025.json', '{"byWeek":{"1":[]}}', 200, { ETag: 'v1' })
    const s = store(t, base)
    const first = await s.load<Schedule>(schedule)
    expect(first.provenance.kind).toBe('live')
    expect(Object.keys(first.value.byWeek)).toHaveLength(1)
    expect((await s.load(schedule)).provenance.kind).toBe('cached')
    expect(t.requestCount).toBe(1)
    expect(t.urls[0]).toBe(`${base}schedule-2025.json`)
  })

  it('sends If-None-Match once an ETag is known, and a 304 serves the cache', async () => {
    const t = new StubTransport().on('schedule-2025.json', ok('{"byWeek":{"1":[]}}', { ETag: 'v1' }), status(304))
    const s = store(t, base)
    await s.load(schedule)
    const refreshed = await s.load<Schedule>(schedule, { force: true })
    expect(t.header('If-None-Match', 1)).toBe('v1')
    expect(refreshed.provenance.kind).toBe('cached')
    expect(Object.keys(refreshed.value.byWeek)).toHaveLength(1)
  })

  it('falls back to the stale cache when a refresh fails', async () => {
    const t = new StubTransport().on('schedule-2025.json', ok('{"byWeek":{"1":[]}}', { ETag: 'v1' }), new Error('offline'))
    const s = store(t, base)
    await s.load(schedule)
    const offline = await s.load<Schedule>(schedule, { force: true })
    expect(offline.provenance.kind).toBe('staleCache')
    expect(Object.keys(offline.value.byWeek)).toHaveLength(1)
  })

  it('falls back to the bundle when a refresh fails with nothing cached', async () => {
    const s = await store(new StubTransport().fail('schedule-2025.json'), base).load<Schedule>(schedule)
    expect(s.provenance.kind).toBe('bundled')
    expect(Object.keys(s.value.byWeek).length).toBeGreaterThan(0)
  })

  it('names a missing resource', async () => {
    const error = (await store().load(StaticResources.weekly(1999)).catch((e: unknown) => e)) as DataLayerError
    expect(error.detail).toEqual({ kind: 'noFallbackAvailable', resource: 'weekly-1999' })
  })

  it('ships recorded lines in the bundled schedule', async () => {
    const games = Object.values((await store().load<Schedule>(schedule)).value.byWeek).flat()
    expect(games.filter((g) => g.spreadLine != null && g.totalLine != null).length).toBeGreaterThan(0)
  })

  it('tolerates unknown fields in a refreshed file', async () => {
    const t = new StubTransport().json('schedule-2025.json', '{"byWeek":{"1":[{"home":"SEA","away":"NE","kickoff":"2025-09-07","brand_new_field":{"nested":true}}]},"somethingElse":42}')
    const s = await store(t, base).load<Schedule>(schedule)
    expect(s.provenance.kind).toBe('live')
    expect(s.value.byWeek['1']?.[0]?.home).toBe('SEA')
  })

  it('re-checks an expired resource with its ETag', async () => {
    const t = new StubTransport().on('tiny.json', ok('{"byWeek":{}}', { ETag: 'v1' }), status(304))
    const s = store(t, base)
    const tiny: StaticResource = { bundledName: 'none', remotePath: 'tiny.json', identifier: 'tiny', ttl: 0 }
    await s.load(tiny)
    await new Promise((r) => setTimeout(r, 2))
    await s.load(tiny)
    expect(t.requestCount).toBe(2)
    expect(t.header('If-None-Match', 1)).toBe('v1')
  })

  it('re-checks in-season files twice a day and slow files weekly', () => {
    expect(StaticResources.weeklyIndex.ttl).toBe(IN_SEASON_TTL)
    expect(StaticResources.weekly(2026).ttl).toBe(12 * 60 * 60)
    expect(StaticResources.schedule(2026).ttl).toBe(12 * 60 * 60)
    expect(StaticResources.playerIDs.ttl).toBe(CacheTTL.staticData)
    expect(StaticResources.adp.ttl).toBe(CacheTTL.staticData)
  })

  it('maps every resource onto the public/data layout the site ships', () => {
    expect(StaticResources.weekly(2026).remotePath).toBe('weekly/2026.json')
    expect(StaticResources.weeklyIndex.remotePath).toBe('weekly/index.json')
    expect(StaticResources.teamContext(2026).remotePath).toBe('context-2026.json')
  })
})
