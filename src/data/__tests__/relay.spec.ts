import { describe, expect, it } from 'vitest'
import { RelayClient } from '@data/RelayClient'
import { InMemorySecretStore } from '@data/secretStore'
import { StubTransport } from '../../../tests/stubTransport'

const relay = (t: StubTransport) => new RelayClient('https://relay.example.test', t)

/** Port of RelayClientTests: enrichment only, and every call fails soft. */
describe('RelayClient', () => {
  it('reports reachability', async () => {
    expect(await relay(new StubTransport().json('health', '{"ok":true}')).probe()).toBe(true)
    expect(await relay(new StubTransport().fail('health')).probe()).toBe(false)
  })

  it('parses a news feed', async () => {
    const t = new StubTransport().json('api/news', '{"feed":"rotoworld","cached":false,"items":[{"title":"Allen questionable","body":"Limited in practice","url":"https://example.test/1","publishedAt":"2026-09-12T10:00:00Z","sourceId":"1"}]}')
    const feed = await relay(t).news('rotoworld')
    expect(feed?.items).toHaveLength(1)
    expect(feed?.items[0]?.title).toBe('Allen questionable')
    expect(t.urls[0]).toBe('https://relay.example.test/api/news?feed=rotoworld')
  })

  it('returns nothing rather than throwing when unreachable, keyless or malformed', async () => {
    expect(await relay(new StubTransport().fail('api/news')).news('rotoworld')).toBeUndefined()
    expect(await relay(new StubTransport().json('api/odds', '{"error":"no key"}', 503)).odds()).toBeUndefined()
    expect(await relay(new StubTransport().json('api/odds', 'not json')).odds()).toBeUndefined()
  })

  it('escapes event ids in the props path', async () => {
    const t = new StubTransport().json('props', '{"ok":true}')
    await relay(t).props('a b/c')
    expect(t.urls[0]).not.toContain('a b')
  })

  it('sends the token and facts when polishing a pitch', async () => {
    const t = new StubTransport().json('api/ai/trade-pitch', '{"pitch":"  Polished pitch.  "}')
    const pitch = await relay(t).polishTradePitch({ facts: ["You're short at WR in week 9"], draft: 'Draft' }, 's3cret')
    expect(pitch).toBe('Polished pitch.')
    expect(t.header('Authorization', 0)).toBe('Bearer s3cret')
    expect(JSON.parse(t.requests[0]!.body!).facts).toEqual(["You're short at WR in week 9"])
    expect(t.requests[0]!.method).toBe('POST')
  })

  it('fails soft, and says why', async () => {
    expect(await relay(new StubTransport().json('api/ai/trade-pitch', '{"error":"unauthorized"}', 401)).polishTradePitch({ facts: [], draft: 'Draft' })).toBeUndefined()
    const result = (code: number, body = '{"error":"x"}') =>
      relay(new StubTransport().json('api/ai/trade-pitch', body, code)).polishTradePitchResult({ facts: [], draft: 'Draft' }, 't')
    expect(await result(401)).toEqual({ ok: false, failure: { kind: 'unauthorized' } })
    expect(await result(503)).toEqual({ ok: false, failure: { kind: 'server', status: 503 } })
    expect(await result(200, '{"pitch":"   "}')).toEqual({ ok: false, failure: { kind: 'emptyResponse' } })
    expect(await result(200, '{"pitch":"Hi"}')).toEqual({ ok: true, pitch: 'Hi' })
    expect(await relay(new StubTransport().fail('api/ai')).polishTradePitchResult({ facts: [], draft: '' })).toEqual({ ok: false, failure: { kind: 'unreachable' } })
  })

  it('round-trips the in-memory secret store', () => {
    const store = new InMemorySecretStore()
    store.save('abc')
    expect(store.load()).toBe('abc')
    store.save(undefined)
    expect(store.load()).toBeUndefined()
  })
})
