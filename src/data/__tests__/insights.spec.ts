import { describe, expect, it } from 'vitest'
import { POSITIONS } from '@core/Position'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService, SleeperCacheKey } from '@data/SleeperService'
import { Cache, MemoryStore } from '@data/cache'
import {
  decodeProjection, linePlayerName, linePosition, newsPublishedAt, newsSourceLabel, offensiveSnapShare, played,
  projectionSourceLabel, redZoneTargets, targets,
} from '@data/insightsModels'
import { opponentOf, scoreOf } from '@data/gameScore'
import { fixtureText } from '../../../tests/swiftFixtures'
import { StubTransport, ok, status } from '../../../tests/stubTransport'

const client = (transport: StubTransport) =>
  new SleeperClient({ baseURL: 'https://api.example.test/v1', insightsBaseURL: 'https://api.example.test', transport, retries: 0 })

/** Port of SleeperInsightsTests, against the real recorded payloads. */
describe('Sleeper insights routes', () => {
  it('decodes real projections for every position', async () => {
    const t = new StubTransport().json('/projections/nfl/2026/3', fixtureText('FCData', 'projections-2026-w3.json'))
    const projections = await client(t).projections(2026, 3)
    expect(projections.length).toBeGreaterThan(100)
    const positions = new Set(projections.map(linePosition))
    for (const p of POSITIONS) expect(positions.has(p), `no ${p} projection decoded`).toBe(true)

    const gibbs = projections.find((p) => p.player && linePlayerName(p.player) === 'Jahmyr Gibbs')!
    expect(gibbs.week).toBe(3)
    expect(gibbs.opponent).toBe('NYJ')
    expect(projectionSourceLabel(gibbs)).toBe('Rotowire via Sleeper')
    expect(gibbs.stats.rush_att ?? 0).toBeGreaterThan(10)

    const url = t.urls[0]!
    expect(url.startsWith('https://api.example.test/projections/')).toBe(true)
    expect(url).toContain('position%5B%5D=DEF')
    expect(url).toContain('position%5B%5D=LB')
  })

  it('decodes real week stats including defense and snaps', async () => {
    const t = new StubTransport().json('/stats/nfl/2026/2', fixtureText('FCData', 'stats-2026-w2.json'))
    const stats = await client(t).weekStats(2026, 2)
    const jsn = stats.find((s) => s.player && linePlayerName(s.player) === 'Jaxon Smith-Njigba')!
    expect(played(jsn)).toBe(true)
    expect(targets(jsn)).toBe(11)
    expect(redZoneTargets(jsn)).toBe(3)
    expect(offensiveSnapShare(jsn)).toBeCloseTo(47 / 70, 3)

    const defenses = stats.filter((s) => linePosition(s) === 'DEF')
    expect(defenses.length).toBeGreaterThan(0)
    expect(defenses[0]!.stats.fan_pts_allow_rb).toBeDefined()
    const idp = stats.filter((s) => linePosition(s) === 'LB')
    expect(idp.some((s) => s.stats.idp_tkl !== undefined)).toBe(true)
  })

  it('decodes player news', async () => {
    const t = new StubTransport().json('/players/nfl/4046/news', fixtureText('FCData', 'news-4046.json'))
    const news = await client(t).playerNews('4046', 3)
    expect(news).toHaveLength(3)
    expect(newsSourceLabel(news[0]!)).toBe('FantasyPros via Sleeper')
    expect(news[0]!.metadata?.title).toBeDefined()
    expect(newsPublishedAt(news[0]!)).toBeInstanceOf(Date)
    expect(news[0]!.metadata?.analysis).toBeDefined()
  })

  it('drops null stats rather than failing the line', () => {
    const line = decodeProjection(JSON.parse('{"player_id":"1","week":3,"stats":{"rush_yd":42.5,"rec_td":null},"player":{"position":"RB"},"company":"rotowire"}'))
    expect(line.stats).toEqual({ rush_yd: 42.5 })
    expect(linePosition(line)).toBe('RB')
  })

  it('caches projections per week and honours maxAge', async () => {
    const t = new StubTransport().json('/projections/nfl/2026/3', fixtureText('FCData', 'projections-2026-w3.json'))
    const service = new SleeperService(client(t), new Cache(new MemoryStore()))
    expect((await service.projections(2026, 3)).provenance.kind).toBe('live')
    expect((await service.projections(2026, 3)).provenance.kind).toBe('cached')
    expect(t.requestCount).toBe(1)
    await service.projections(2026, 3, false, 0)
    expect(t.requestCount).toBe(2)
  })

  it('serves stale projections, labelled, when the route fails', async () => {
    const t = new StubTransport().on('/projections/nfl/2026/3', ok(fixtureText('FCData', 'projections-2026-w3.json')), status(500))
    const service = new SleeperService(client(t), new Cache(new MemoryStore()))
    await service.projections(2026, 3)
    expect((await service.projections(2026, 3, true)).provenance.kind).toBe('staleCache')
  })

  it('caches completed-week stats on the long lifetime', async () => {
    const t = new StubTransport().json('/stats/nfl/2026/2', fixtureText('FCData', 'stats-2026-w2.json'))
    const cache = new Cache(new MemoryStore())
    await new SleeperService(client(t), cache).weekStats(2026, 2, true)
    const hit = await cache.load(SleeperCacheKey.weekStats(2026, 2))
    expect(hit).toBeDefined()
    expect((hit!.expiresAt - hit!.storedAt) / 1000).toBe(7 * 24 * 60 * 60)
  })
})

/** Port of SleeperScoresTests. */
describe('Sleeper live scores', () => {
  const scores = () => client(new StubTransport().json('/scores/nfl/regular/2026/2', fixtureText('FCData', 'scores-2026-w2.json'))).scores(2026, 2)

  it('reads a final', async () => {
    const game = (await scores()).find((g) => g.home === 'ARI')!
    expect(game.status).toBe('complete')
    expect(game.away).toBe('SEA')
    expect(game.awayScore).toBe(31)
    expect(game.homeScore).toBe(7)
    expect(game.quarter).toBe('F')
    expect(game.possession).toBeUndefined()
    expect(game.isRedZone).toBe(false)
    expect(game.spread.SEA).toBe(-4.5)
    expect(game.spread.updated_at).toBeUndefined()
    expect(game.winChance.SEA).toBeCloseTo(67.74, 9)
    expect(scoreOf(game, 'SEA')).toBe(31)
    expect(opponentOf(game, 'ARI')).toBe('SEA')
  })

  it('reads a game before kickoff', async () => {
    const game = (await scores()).find((g) => g.home === 'BUF')!
    expect(game.status).toBe('pregame')
    expect(game.homeScore).toBeUndefined()
    expect(game.quarterNumber).toBeUndefined()
    expect(game.quarter).toBeUndefined()
    expect(game.startTime).toBeDefined()
    expect(game.forecastWindMph).toBe(12)
    expect(game.channel).toBe('FOX')
  })

  it('reads a game in progress', async () => {
    const game = (await scores()).find((g) => g.home === 'ATL')!
    expect(game.status).toBe('inProgress')
    expect(game.quarter).toBe('3')
    expect(game.quarterNumber).toBe(3)
    expect(game.timeRemaining).toBe('7:42')
    expect(game.possession).toBe('ATL')
    expect(game.downAndDistance).toBe('3rd & 4')
    expect(game.yardLine).toBe('12')
    expect(game.isRedZone).toBe(true)
    expect(game.homeScore).toBe(17)
  })

  it('keeps the last scores when a live tick fails', async () => {
    const t = new StubTransport().on('/scores/nfl/regular/2026/2', ok(fixtureText('FCData', 'scores-2026-w2.json')), new Error('offline'))
    const service = new SleeperService(client(t), new Cache(new MemoryStore()))
    expect((await service.scores(2026, 2)).value).toHaveLength(3)
    expect((await service.scores(2026, 2, true)).value).toHaveLength(3)
  })
})
