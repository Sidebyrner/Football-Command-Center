import { describe, expect, it } from 'vitest'
import { SleeperClient } from '@data/SleeperClient'
import { DataLayerError } from '@data/errors'
import { seasonYear } from '@data/sleeperModels'
import { StubTransport, ok, status } from '../../../tests/stubTransport'

const client = (transport: StubTransport, retries = 1) =>
  new SleeperClient({ baseURL: 'https://api.example.test/v1', transport, retries })

/** Port of SleeperClientTests: retries, errors that name their path, escaping. */
describe('SleeperClient', () => {
  it('decodes the NFL state', async () => {
    const t = new StubTransport().json('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
    const state = await client(t).nflState()
    expect(state.week).toBe(3)
    expect(seasonYear(state)).toBe(2026)
  })

  it('retries once on a server error', async () => {
    const t = new StubTransport().on('/state/nfl', status(500), ok('{"week":5}'))
    expect((await client(t).nflState()).week).toBe(5)
    expect(t.requestCount).toBe(2)
  })

  it('does not retry a client error', async () => {
    const t = new StubTransport().on('/user/', status(404), ok('{"user_id":"u1"}'))
    const error = await client(t).user('nobody').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DataLayerError)
    expect((error as DataLayerError).status).toBe(404)
    expect(t.requestCount).toBe(1)
  })

  it('gives up after the retry budget', async () => {
    const t = new StubTransport().on('/state/nfl', status(503), status(503), status(503))
    await expect(client(t).nflState()).rejects.toThrow()
    expect(t.requestCount).toBe(2)
  })

  it('names the path in a decoding failure', async () => {
    const t = new StubTransport().json('/league/L1', '{"unexpected":"shape"}')
    const error = (await client(t).league('L1').catch((e: unknown) => e)) as DataLayerError
    expect(error.detail.kind).toBe('undecodable')
    expect(error.detail.kind === 'undecodable' && error.detail.path).toContain('L1')
  })

  it('builds league and matchup paths', async () => {
    const t = new StubTransport().json('/league/L1/matchups/7', '[]')
    await client(t).matchups('L1', 7)
    expect(t.urls).toEqual(['https://api.example.test/v1/league/L1/matchups/7'])
  })

  it('escapes usernames in the path', async () => {
    const t = new StubTransport().json('/user/', '{"user_id":"u1"}')
    await client(t).user('a b/c')
    expect(t.urls[0]).not.toContain('a b')
  })

  it('returns the player index already trimmed', async () => {
    const t = new StubTransport().json('/players/nfl', JSON.stringify({
      4034: { full_name: 'Christian McCaffrey', position: 'RB', team: 'SF', active: true },
      PHI: { position: 'DEF', team: 'PHI', active: true },
    }))
    const index = await client(t).playerIndex()
    expect(Object.keys(index.players)).toHaveLength(2)
    expect(index.players.PHI?.positionCode).toBe('DEF')
  })

  it('parses trending', async () => {
    const t = new StubTransport().json('/trending/add', '[{"player_id":"4034","count":5000}]')
    const trending = await client(t).trendingAdds()
    expect(trending[0]).toEqual({ playerID: '4034', count: 5000 })
  })

  it('uses the production hosts by default', async () => {
    const t = new StubTransport().json('/state/nfl', '{}').json('/scores/', '[]')
    const c = new SleeperClient({ transport: t })
    await c.nflState()
    await c.scores(2026, 2)
    expect(t.urls).toEqual([
      'https://api.sleeper.app/v1/state/nfl',
      'https://api.sleeper.app/scores/nfl/regular/2026/2',
    ])
  })
})
