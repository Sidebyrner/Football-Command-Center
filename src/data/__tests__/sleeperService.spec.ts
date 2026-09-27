import { describe, expect, it } from 'vitest'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService, SleeperCacheKey } from '@data/SleeperService'
import { Cache, CacheTTL, MemoryStore } from '@data/cache'
import { needsFreshnessLabel } from '@data/fetched'
import type { PlayerIndex } from '@data/playerIndex'
import { StubTransport, ok } from '../../../tests/stubTransport'

const make = (t: StubTransport, cache = new Cache(new MemoryStore())) =>
  new SleeperService(new SleeperClient({ baseURL: 'https://api.example.test/v1', transport: t, retries: 0 }), cache)

/** Port of SleeperServiceTests: fresh cache → network → stale cache → error. */
describe('SleeperService', () => {
  it('reads live first, then cached', async () => {
    const t = new StubTransport().json('/league/L1', '{"league_id":"L1","name":"Test"}')
    const service = make(t)
    const first = await service.league('L1')
    expect(first.provenance.kind).toBe('live')
    expect(needsFreshnessLabel(first.provenance)).toBe(false)
    const second = await service.league('L1')
    expect(second.provenance.kind).toBe('cached')
    expect(needsFreshnessLabel(second.provenance)).toBe(true)
    expect(t.requestCount).toBe(1)
  })

  it('bypasses a fresh entry when forced', async () => {
    const t = new StubTransport().json('/league/L1', '{"league_id":"L1","name":"Test"}')
    const service = make(t)
    await service.league('L1')
    expect((await service.league('L1', true)).provenance.kind).toBe('live')
    expect(t.requestCount).toBe(2)
  })

  it('falls back to a labelled stale entry when the fetch fails', async () => {
    const t = new StubTransport().on('/league/L1', ok('{"league_id":"L1","name":"Test"}'), new Error('offline'))
    const cache = new Cache(new MemoryStore())
    const service = make(t, cache)
    const { value } = await service.league('L1')
    // Age the entry past its TTL.
    await cache.store(value, SleeperCacheKey.league('L1'), CacheTTL.roster, Date.now() - (CacheTTL.roster + 60) * 1000)

    const offline = await service.league('L1')
    expect(offline.provenance.kind).toBe('staleCache')
    expect(offline.provenance.kind === 'staleCache' && offline.provenance.age).toBeGreaterThan(CacheTTL.roster)
    expect(offline.value.leagueID).toBe('L1')
  })

  it('throws when the fetch fails with nothing cached', async () => {
    await expect(make(new StubTransport().fail('/league/L1')).league('L1')).rejects.toThrow()
  })

  it("reuses a live read's entry for a completed week", async () => {
    const t = new StubTransport().json('/matchups/3', '[{"roster_id":1,"points":102.5}]')
    const service = make(t)
    await service.matchups('L1', 3)
    expect((await service.completedMatchups('L1', 3)).provenance.kind).toBe('cached')
    expect(t.requestCount).toBe(1)
  })

  it('never caches the username lookup', async () => {
    const t = new StubTransport().json('/user/', '{"user_id":"u1","username":"connor"}')
    const service = make(t)
    await service.user('connor')
    await service.user('connor')
    expect(t.requestCount).toBe(2)
  })

  it('caches the player index on the daily TTL', async () => {
    const t = new StubTransport().json('/players/nfl', '{"4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true}}')
    const service = make(t)
    const first = await service.playerIndex()
    expect(first.provenance.kind).toBe('live')
    expect(Object.keys(first.value.players)).toHaveLength(1)
    expect((await service.playerIndex()).provenance.kind).toBe('cached')
    expect(t.requestCount).toBe(1)
  })
})

/** Port of PlayerIndexMaxAgeTests: game-day freshness for injury tags. */
describe('player index maxAge', () => {
  const payload = '{"4034":{"full_name":"Christian McCaffrey","position":"RB","team":"SF","active":true,"injury_status":"Questionable"}}'
  const hour = 60 * 60

  async function setup() {
    const t = new StubTransport().json('/players/nfl', payload)
    const cache = new Cache(new MemoryStore())
    const service = make(t, cache)
    await service.playerIndex()
    const age = async (seconds: number) => {
      const hit = await cache.load<PlayerIndex>(SleeperCacheKey.players, { allowingStale: true })
      await cache.store(hit!.value, SleeperCacheKey.players, CacheTTL.players, Date.now() - seconds * 1000)
    }
    return { t, cache, service, age }
  }

  it('reuses a young copy on a game day', async () => {
    const { t, service, age } = await setup()
    await age(hour)
    await service.playerIndex(false, 3 * hour)
    expect(t.requestCount).toBe(1)
  })

  it('refetches an older copy on a game day', async () => {
    const { t, service, age } = await setup()
    await age(4 * hour)
    expect((await service.playerIndex(false, 3 * hour)).provenance.kind).toBe('live')
    expect(t.requestCount).toBe(2)
  })

  it('keeps the same copy on an ordinary day', async () => {
    const { t, service, age } = await setup()
    await age(4 * hour)
    await service.playerIndex()
    expect(t.requestCount).toBe(1)
  })

  it('falls back to the cached copy when the early refetch fails', async () => {
    const { cache, age } = await setup()
    await age(4 * hour)
    const offline = make(new StubTransport().fail('/players/nfl'), cache)
    const fetched = await offline.playerIndex(false, 3 * hour)
    expect(Object.keys(fetched.value.players)).toHaveLength(1)
    expect(fetched.provenance.kind).not.toBe('live')
  })
})
