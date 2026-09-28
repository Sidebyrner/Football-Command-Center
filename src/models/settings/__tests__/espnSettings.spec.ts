import { describe, expect, it } from 'vitest'
import { Cache, MemoryStore } from '@data/cache'
import { ESPNClient } from '@data/ESPNClient'
import { ESPNLeagueService } from '@data/ESPNLeagueService'
import { SwitchableLeagueSource } from '@data/LeagueDataSource'
import { InMemorySecretStore } from '@data/secretStore'
import { decodeAppSettings, encodeAppSettings, InMemorySettingsStore, isConfigured, makeAppSettings, type AppSettings } from '../AppSettings'
import { parseESPNLeagueID, SettingsModel } from '../SettingsModel'
import { makeHarness } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'
import { fixtureText } from '../../../../tests/swiftFixtures'

/** Port of ESPNSettingsTests: sign in → league id → team, sign-out, and a rejected cookie. */
const SWID = '{AAAAAAAA-0000-0000-0000-00000000AB12}'

function make(leagueStatus = 200, settings: AppSettings = makeAppSettings()) {
  const transport = new StubTransport().json('/state/nfl', '{"week":3,"season":"2026","season_type":"regular"}')
  if (leagueStatus === 200) transport.json('/leagues/987654', fixtureText('FCData', 'espn-league.json'))
  else transport.json('/leagues/987654', '{"messages":["no"]}', leagueStatus)
  const { sleeper, staticData } = makeHarness(transport)
  const store = new InMemorySettingsStore(settings)
  const secrets = new InMemorySecretStore()
  const source = new SwitchableLeagueSource(sleeper)
  const model = new SettingsModel(sleeper, store, new InMemorySecretStore(), {
    espnSecrets: secrets,
    leagueSource: source,
    makeESPNSource: (credentials) => new ESPNLeagueService({
      client: new ESPNClient({ credentials, transport, retries: 0 }),
      cache: new Cache(new MemoryStore()),
      season: async () => 2026,
      playerIndex: async () => undefined,
      crosswalk: async () => (await staticData.playerCrosswalk()).value,
    }),
  })
  return { model, store, secrets, source, transport }
}

describe('ESPN settings', () => {
  it('switching to ESPN asks for sign-in and clears the league', () => {
    const rig = make(200, makeAppSettings({ sleeperUsername: 'connor', userID: 'u1', leagueID: 'L1', rosterID: 1 }))
    expect(rig.model.stage).toBe('ready')
    rig.model.setProvider('espn')
    expect(rig.model.stage).toBe('needsESPNSignIn')
    expect(rig.store.load().provider).toBe('espn')
    expect(rig.store.load().leagueID).toBeUndefined()
    expect(rig.store.load().rosterID).toBeUndefined()
    // The Sleeper username survives a round trip.
    rig.model.setProvider('sleeper')
    expect(rig.model.stage).toBe('needsUsername')
    expect(rig.model.username).toBe('connor')
  })

  it("sign in, then a league URL, picks the user's team", async () => {
    const rig = make()
    rig.model.setProvider('espn')
    rig.model.saveESPNCredentials({ espnS2: 's2-value', swid: SWID })
    expect(rig.model.stage).toBe('needsESPNLeague')
    expect(rig.model.hasESPNCredentials).toBe(true)
    expect(rig.model.espnAccountSuffix).toBe('AB12')
    expect(rig.secrets.load()).toBeDefined()
    expect(rig.source.current).toBeInstanceOf(ESPNLeagueService)

    rig.model.espnLeagueText = 'https://fantasy.espn.com/football/team?leagueId=987654&teamId=2'
    await rig.model.connectESPNLeague()

    expect(rig.model.errorMessage).toBeUndefined()
    expect(rig.model.stage).toBe('ready')
    expect(rig.store.load().leagueID).toBe('987654')
    // Owner ids are matched case-insensitively: the fixture's team owner is the SWID in lower case.
    expect(rig.store.load().rosterID).toBe(1)
    expect(rig.model.teams.map((t) => t.manager)).toEqual(['Byrne Notice', 'Waiver Wire'])

    // The cookies went to ESPN, and only to ESPN.
    for (const request of rig.transport.requests) {
      const cookie = request.headers?.cookie
      if (request.url.includes('/leagues/')) expect(cookie).toBe(`espn_s2=s2-value; SWID=${SWID}`)
      else expect(cookie).toBeUndefined()
    }
  })

  it('sign-out forgets the cookies and the league', async () => {
    const rig = make()
    rig.model.setProvider('espn')
    rig.model.saveESPNCredentials({ espnS2: 's2-value', swid: SWID })
    rig.model.espnLeagueText = '987654'
    await rig.model.connectESPNLeague()
    expect(rig.model.stage).toBe('ready')

    rig.model.signOutESPN()

    expect(rig.model.stage).toBe('needsESPNSignIn')
    expect(rig.model.hasESPNCredentials).toBe(false)
    expect(rig.secrets.load()).toBeUndefined()
    expect(rig.store.load().leagueID).toBeUndefined()
    expect(rig.source.current).not.toBeInstanceOf(ESPNLeagueService)
  })

  it('a rejected cookie sends the user back to sign-in', async () => {
    const rig = make(401)
    rig.model.setProvider('espn')
    rig.model.saveESPNCredentials({ espnS2: 'stale', swid: SWID })
    rig.model.espnLeagueText = '987654'
    await rig.model.connectESPNLeague()
    expect(rig.model.stage).toBe('needsESPNSignIn')
    expect(rig.model.errorMessage).toContain('Sign in again')
    expect(rig.store.load().leagueID).toBeUndefined()
  })

  it('an unknown league is said plainly', async () => {
    const rig = make(404)
    rig.model.setProvider('espn')
    rig.model.saveESPNCredentials({ espnS2: 's2', swid: SWID })
    rig.model.espnLeagueText = '987654'
    await rig.model.connectESPNLeague()
    expect(rig.model.stage).toBe('needsESPNLeague')
    expect(rig.model.errorMessage).toBe('ESPN has no league with that id this season.')
  })

  it('a configured ESPN install without cookies asks to sign in', () => {
    const rig = make(200, makeAppSettings({ provider: 'espn', leagueID: '987654', rosterID: 1 }))
    expect(rig.model.stage).toBe('needsESPNSignIn')
    expect(isConfigured(rig.model.settings)).toBe(true)
  })

  it('parses a league id or any ESPN address', () => {
    expect(parseESPNLeagueID(' 987654 ')).toBe('987654')
    expect(parseESPNLeagueID('https://fantasy.espn.com/football/league?leagueId=987654')).toBe('987654')
    expect(parseESPNLeagueID('fantasy.espn.com/football/team?leagueId=42&teamId=3&seasonId=2026')).toBe('42')
    expect(parseESPNLeagueID('my league')).toBeUndefined()
    expect(parseESPNLeagueID('https://fantasy.espn.com/football/team?teamId=3')).toBeUndefined()
    expect(parseESPNLeagueID('')).toBeUndefined()
  })

  it('settings saved before ESPN decode as Sleeper, and the provider round-trips', () => {
    const old = decodeAppSettings(JSON.parse('{"sleeperUsername":"connor","userID":"u1","leagueID":"L1","rosterID":4,"accentTheme":"indigo","themeVersion":2}'))
    expect(old.provider).toBe('sleeper')
    expect(old.leagueID).toBe('L1')
    const espn = decodeAppSettings(encodeAppSettings({ ...old, provider: 'espn' }))
    expect(espn.provider).toBe('espn')
  })
})
