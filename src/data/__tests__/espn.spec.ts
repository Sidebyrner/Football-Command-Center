import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import { DataLayerError } from '@data/errors'
import { ESPNClient } from '@data/ESPNClient'
import { ESPNLeagueService } from '@data/ESPNLeagueService'
import { ESPNPlayerIDMapper, translateLeague, translateMatchups, translateMembers, translateRosters } from '@data/ESPNTranslator'
import { decodeESPNLeague, type ESPNLeague } from '@data/espnModels'
import { describeCredentials, parseCredentials, swidSuffix, type ESPNCredentials } from '@data/espnCredentials'
import { decodeCrosswalk, type PlayerIDCrosswalk } from '@data/playerIdCrosswalk'
import type { PlayerIndex } from '@data/playerIndex'
import { bench } from '@data/sleeperModels'
import { fromSleeper } from '@core/SleeperScoring'
import { parseSlots } from '@core/RosterSlots'
import { fixtureText, readFixture } from '../../../tests/swiftFixtures'
import { StubTransport, ok, status } from '../../../tests/stubTransport'

/** Port of ESPNClientTests: where the cookies go, where they don't, and that a rejection never echoes them. */
describe('ESPNClient', () => {
  const credentials: ESPNCredentials = { espnS2: 's2-secret-value', swid: '{ABCD-1234}' }
  const direct = (t: StubTransport, signedIn = true) =>
    new ESPNClient({ credentials: signedIn ? credentials : undefined, transport: t, retries: 1 })

  it('sends both cookies to the fantasy host when talking to ESPN directly', async () => {
    const t = new StubTransport().json('/leagues/987654', '{"id":987654}')
    await direct(t).league('987654', 2026)
    expect(t.header('cookie', 0)).toBe('espn_s2=s2-secret-value; SWID={ABCD-1234}')
    const url = new URL(t.urls[0]!)
    expect(url.host).toBe('lm-api-reads.fantasy.espn.com')
    expect(url.pathname).toBe('/apis/v3/games/ffl/seasons/2026/segments/0/leagues/987654')
  })

  it('hands the cookie values to the proxy as headers, never as a Cookie', async () => {
    const t = new StubTransport().json('/.netlify/functions/espn', '{"id":987654}')
    const client = new ESPNClient({ credentials, transport: t, proxyURL: '/.netlify/functions/espn' })
    await client.league('987654', 2026)
    expect(t.urls[0]).toContain('/.netlify/functions/espn?path=')
    expect(decodeURIComponent(t.urls[0]!.split('path=')[1]!)).toContain('/seasons/2026/segments/0/leagues/987654')
    expect(t.header('x-espn-s2', 0)).toBe('s2-secret-value')
    expect(t.header('x-espn-swid', 0)).toBe('{ABCD-1234}')
    expect(t.header('cookie', 0)).toBeUndefined()
  })

  it('sends no cookie when signed out, straight to ESPN', async () => {
    const t = new StubTransport().json('/leagues/1', '{"id":1}')
    const client = new ESPNClient({ transport: t, proxyURL: '/.netlify/functions/espn' })
    await client.league('1', 2026)
    expect(t.urls[0]).toContain('lm-api-reads.fantasy.espn.com')
    expect(t.header('cookie', 0)).toBeUndefined()
  })

  it('a rejected cookie is unauthorised, not retried, and not echoed', async () => {
    const t = new StubTransport().json('/leagues/987654', '{"messages":["You are not authorized to view this League."]}', 401)
    let caught: unknown
    try { await direct(t).league('987654', 2026) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(DataLayerError)
    const error = caught as DataLayerError
    expect(error.detail.kind).toBe('unauthorized')
    expect(error.message).not.toContain('s2-secret-value')
    expect(error.message).not.toContain('ABCD-1234')
    expect(t.requestCount).toBe(1)
  })

  it('a server error is retried once', async () => {
    const t = new StubTransport().on('/leagues/5', status(502), ok('{"id":5,"seasonId":2026}'))
    const league = await direct(t).league('5', 2026)
    expect(league.seasonId).toBe(2026)
    expect(t.requestCount).toBe(2)
  })

  it('credentials never print the secret, and parse from what a person pastes', () => {
    expect(describeCredentials(credentials)).toBe('ESPNCredentials(swid: …1234, espnS2: <redacted>)')
    expect(swidSuffix(credentials)).toBe('1234')
    expect(parseCredentials('AEB%2Fabc', 'abcdef12-3456')).toEqual({ espnS2: 'AEB%2Fabc', swid: '{ABCDEF12-3456}' })
    expect(parseCredentials('espn_s2=AEBxyz; SWID={AB12-CD34}', '')).toEqual({ espnS2: 'AEBxyz', swid: '{AB12-CD34}' })
    expect(parseCredentials('"AEBxyz"', '"{ab12-cd34}"')).toEqual({ espnS2: 'AEBxyz', swid: '{AB12-CD34}' })
    expect(parseCredentials('', '{AB12-CD34}')).toBeUndefined()
    expect(parseCredentials('AEBxyz', 'nope')).toBeUndefined()
  })
})

/** Port of ESPNTranslatorTests, on the same fixture league the Swift tests use. */
describe('ESPNTranslator', () => {
  const raw: ESPNLeague = decodeESPNLeague(readFixture('FCData', 'espn-league.json'))
  const crosswalk: PlayerIDCrosswalk = decodeCrosswalk(readFixture('FCData', 'player-ids.json'))
  const mapper = new ESPNPlayerIDMapper(crosswalk, undefined)
  const sleeperID = (name: string) => Object.entries(crosswalk.players).find(([, e]) => e.name === name && e.espnId !== undefined)![0]

  it('the lineup template matches the league', () => {
    const league = translateLeague(raw, '987654')
    expect(league.leagueID).toBe('987654')
    expect(league.name).toBe('Test Private League')
    expect(league.season).toBe('2026')
    expect(league.totalRosters).toBe(2)
    expect(league.rosterPositions).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR'])
    const template = parseSlots(league.rosterPositions)
    expect(template.starters.length).toBe(9)
    expect(template.benchCount).toBe(6)
  })

  it('scoring translates to Sleeper keys', () => {
    const scoring = translateLeague(raw, '987654').scoringSettings ?? {}
    expect(scoring.pass_yd).toBe(0.04)
    expect(scoring.pass_td).toBe(4)
    expect(scoring.pass_int).toBe(-2)
    expect(scoring.rec).toBe(1)
    expect(scoring.rec_td).toBe(6)
    expect(scoring.fum_lost).toBe(-2)
    // ESPN's one 0–39 field-goal bucket fans out to Sleeper's three.
    expect(scoring.fgm_0_19).toBe(3)
    expect(scoring.fgm_20_29).toBe(3)
    expect(scoring.fgm_30_39).toBe(3)
    expect(scoring.fgm_40_49).toBe(4)
    expect(scoring.fgm_50p).toBe(5)
    expect(scoring.sack).toBe(1)
    expect(scoring.pts_allow_0).toBe(5)
    // An unknown stat id is dropped rather than invented.
    expect(Object.values(scoring)).not.toContain(42)
    const translation = fromSleeper(scoring, 'x')
    expect(translation.profile.passingTD).toBe(4)
    expect(translation.profile.interception).toBe(-2)
  })

  it('league rules carry over', () => {
    const settings = translateLeague(raw, '987654').settings
    expect(settings?.playoffWeekStart).toBe(15)
    expect(settings?.playoffTeams).toBe(6)
    expect(settings?.waiverType).toBe(2)
    expect(settings?.waiverBudget).toBe(100)
    expect(settings?.waiverDayOfWeek).toBe(3)
    expect(settings?.reserveSlots).toBe(1)
    expect(settings?.tradeDeadline).toBeUndefined()
  })

  it('members carry team names in either era, joined case-insensitively', () => {
    const members = translateMembers(raw)
    expect(members).toHaveLength(2)
    const connor = members.find((m) => m.userID === '{AAAAAAAA-0000-0000-0000-00000000AB12}')
    expect(connor?.displayName).toBe('connor')
    expect(connor?.teamName).toBe('Byrne Notice')
    const rival = members.find((m) => m.userID === '{BBBBBBBB-0000-0000-0000-000000000002}')
    expect(rival?.teamName).toBe('Waiver Wire')
  })

  it('rosters split starters, bench and IR in slot order', () => {
    const rosters = translateRosters(raw, '987654', mapper)
    expect(rosters).toHaveLength(2)
    const mine = rosters[0]!
    expect(mine.rosterID).toBe(1)
    expect(mine.ownerID).toBe('{AAAAAAAA-0000-0000-0000-00000000AB12}')
    // QB RB RB WR WR TE FLEX DEF K — the second RB slot is empty.
    expect(mine.starters).toEqual([
      sleeperID('Patrick Mahomes'), sleeperID('Bijan Robinson'), '0', sleeperID('CeeDee Lamb'), sleeperID('Brandon Aiyuk'),
      sleeperID('Travis Kelce'), sleeperID("Ja'Marr Chase"), 'KC', sleeperID('Harrison Butker'),
    ])
    expect(mine.reserve).toEqual([sleeperID('Joe Mixon')])
    expect(mine.players).toHaveLength(11)
    expect(bench(mine)).toHaveLength(3)
    expect(bench(mine)).toContain('espn:99999991')
    expect(mine.settings?.wins).toBe(2)
    expect(mine.settings?.fpts).toBe(251.5)
    expect(mine.settings?.fptsAgainst).toBe(200.25)
    expect(mine.settings?.waiverBudgetUsed).toBe(12)
    expect(mine.settings?.waiverPosition).toBe(8)
  })

  it('a team defense becomes its abbreviation', () => {
    expect(mapper.sleeperID(undefined, -16012)).toBe('KC')
    expect(mapper.sleeperID(undefined, -16014)).toBe('LAR')
    expect(mapper.sleeperID(undefined, -16030)).toBe('JAX')
  })

  it("the mapper falls back to Sleeper's espn_id, then a name match", () => {
    const index: PlayerIndex = {
      builtAt: 0,
      players: {
        s1: { id: 's1', name: 'Only On Sleeper', positionCode: 'WR', team: 'CHI', active: true, espnID: 555 },
        s2: { id: 's2', name: 'Name Match', positionCode: 'RB', team: 'DAL', active: true },
        s3: { id: 's3', name: 'Name Match', positionCode: 'RB', team: 'DAL', active: false },
      },
    }
    const m = new ESPNPlayerIDMapper(undefined, index)
    expect(m.sleeperID(undefined, 555)).toBe('s1')
    expect(m.sleeperID({ id: 777, fullName: 'Name Match', proTeamId: 6, defaultPositionId: 2 }, 777)).toBe('s2')
    expect(m.sleeperID({ id: 778, fullName: 'Name Match', proTeamId: 12, defaultPositionId: 2 }, 778)).toBe('espn:778')
  })

  it('matchups pair both sides with points', () => {
    const week3 = translateMatchups(raw, 3, mapper)
    expect(week3).toHaveLength(2)
    expect(new Set(week3.map((m) => m.matchupID))).toEqual(new Set([3]))
    const mine = week3.find((m) => m.rosterID === 1)!
    expect(mine.points).toBe(48.2)
    expect(mine.playersPoints?.[sleeperID('Patrick Mahomes')]).toBe(24.5)
    expect(mine.playersPoints?.KC).toBe(11.4)
    expect(mine.starters).toHaveLength(9)
    expect(mine.starters?.[0]).toBe(sleeperID('Patrick Mahomes'))
    expect(mine.startersPoints?.[0]).toBe(24.5)
    expect(mine.players).toHaveLength(4)
    expect(week3.find((m) => m.rosterID === 2)?.points).toBe(30)
    // A week with only totals still pairs, with no lineups.
    const week1 = translateMatchups(raw, 1, mapper)
    expect(week1).toHaveLength(2)
    expect(week1.find((m) => m.rosterID === 1)?.points).toBe(130.5)
    expect(week1[0]?.starters).toBeUndefined()
  })

  it('the service caches under its own prefix and purges on sign-out', async () => {
    const t = new StubTransport().json('/leagues/987654', fixtureText('FCData', 'espn-league.json'))
    const store = new MemoryStore()
    const service = new ESPNLeagueService({
      client: new ESPNClient({ credentials: { espnS2: 'x', swid: '{Y}' }, transport: t, retries: 0 }),
      cache: new Cache(store),
      season: async () => 2026,
      playerIndex: async () => undefined,
      crosswalk: async () => crosswalk,
    })
    const league = await service.league('987654')
    expect(league.value.name).toBe('Test Private League')
    expect(league.provenance.kind).toBe('live')
    expect((await service.league('987654')).provenance.kind).toBe('cached')
    expect(t.requestCount).toBe(1)
    expect([...store.entries.keys()].every((k) => k.startsWith('espn-'))).toBe(true)
    expect((await service.drafts()).value).toEqual([])
    await service.purgeCache()
    expect(store.entries.size).toBe(0)
  })
})
