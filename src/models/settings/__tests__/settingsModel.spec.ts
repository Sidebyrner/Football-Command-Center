import { describe, expect, it } from 'vitest'
import { InMemorySecretStore } from '@data/secretStore'
import { InMemoryKeyValueStorage } from '@models/workspaces/KeyValueStorage'
import {
  InMemorySettingsStore, isConfigured, KeyValueSettingsStore, makeAppSettings, parseSwiftURL, type AppSettings,
} from '../AppSettings'
import { SettingsModel, usableRelay } from '../SettingsModel'
import { makeHarness, standardTransport, TestLeague } from '../../../../tests/appHarness'
import { StubTransport } from '../../../../tests/stubTransport'

/** Port of SettingsModelTests: the username → league → team flow (step 2 of the build order). */
function make(transport: StubTransport, settings: AppSettings = makeAppSettings()) {
  const { sleeper } = makeHarness(transport)
  const store = new InMemorySettingsStore(settings)
  return { model: new SettingsModel(sleeper, store, new InMemorySecretStore()), store }
}

function userTransport(): StubTransport {
  return standardTransport()
    .json('/user/connor', '{"user_id":"u1","username":"connor"}')
    .json('/user/u1/leagues/nfl/2025', `[${TestLeague.leagueJSON()}]`)
}

const host = (url: string | undefined) => (url === undefined ? undefined : parseSwiftURL(url)?.host)

describe('SettingsModel', () => {
  it('the relay token is saved trimmed and removable', () => {
    const { sleeper } = makeHarness(new StubTransport())
    const secrets = new InMemorySecretStore()
    const model = new SettingsModel(sleeper, new InMemorySettingsStore(makeAppSettings()), secrets)
    expect(model.hasRelayToken).toBe(false)

    model.setRelayToken('  abc123 \n')
    expect(model.hasRelayToken).toBe(true)
    expect(secrets.load()).toBe('abc123')

    model.setRelayToken('')
    expect(model.hasRelayToken).toBe(false)
    expect(secrets.load()).toBeUndefined()
  })

  it('starts at the username step', () => {
    const { model } = make(new StubTransport())
    expect(model.stage).toBe('needsUsername')
    expect(isConfigured(model.settings)).toBe(false)
  })

  /** A configured install skips setup entirely. */
  it('a configured install starts ready', () => {
    const { model } = make(new StubTransport(), makeAppSettings({ sleeperUsername: 'connor', userID: 'u1', leagueID: 'L1', rosterID: 1 }))
    expect(model.stage).toBe('ready')
    expect(model.username).toBe('connor')
  })

  it('looks up leagues for a username', async () => {
    const { model, store } = make(userTransport())
    model.username = 'connor'

    await model.lookUpUser()

    expect(model.stage).toBe('pickingLeague')
    expect(model.leagues.length).toBe(1)
    expect(model.leagues[0]?.name).toBe('Byrne Notice')
    // The username and id are persisted before the league is chosen, so a user
    // who quits mid-setup does not retype it.
    expect(store.load().userID).toBe('u1')
  })

  it('whitespace around a username is ignored', async () => {
    const { model } = make(userTransport())
    model.username = '  connor  '

    await model.lookUpUser()

    expect(model.stage).toBe('pickingLeague')
    expect(model.settings.sleeperUsername).toBe('connor')
  })

  it('an empty username asks rather than calling out', async () => {
    const transport = new StubTransport()
    const { model } = make(transport)
    model.username = '   '

    await model.lookUpUser()

    expect(model.errorMessage).toBe('Enter your Sleeper username.')
    expect(transport.requestCount, 'no request for an empty username').toBe(0)
  })

  /** The most common setup failure by far, so it gets plain words rather than a status code. */
  it('an unknown username is explained plainly', async () => {
    const transport = new StubTransport()
      .json('/state/nfl', TestLeague.nflState)
      .json('/user/nobody', 'null', 404)
    const { model } = make(transport)
    model.username = 'nobody'

    await model.lookUpUser()

    expect(model.errorMessage).toBe('Sleeper has no user called "nobody".')
    expect(model.stage).toBe('needsUsername')
  })

  /** Having no leagues is an answer, not an error — and it names the season searched. */
  it('no leagues names the season searched', async () => {
    const transport = standardTransport()
      .json('/user/connor', '{"user_id":"u1","username":"connor"}')
      .json('/user/u1/leagues/nfl/2025', '[]')
    const { model } = make(transport)
    model.username = 'connor'

    await model.lookUpUser()

    expect(model.errorMessage).toBe('No leagues found for connor in 2025.')
  })

  /** Sleeper knows which roster is the user's, so the app should not make them hunt. */
  it('picking a league auto-selects the user’s own roster', async () => {
    const { model, store } = make(userTransport())
    model.username = 'connor'
    await model.lookUpUser()

    await model.selectLeague(model.leagues[0]!)

    expect(model.stage).toBe('ready')
    expect(store.load().rosterID).toBe(1)
    expect(store.load().leagueID).toBe('L1')
  })

  /** When it cannot be inferred, ask — with the managers' real names. */
  it('an unmatched user is asked which team is theirs', async () => {
    const transport = standardTransport()
      .json('/user/stranger', '{"user_id":"u99","username":"stranger"}')
      .json('/user/u99/leagues/nfl/2025', `[${TestLeague.leagueJSON()}]`)
    const { model } = make(transport)
    model.username = 'stranger'
    await model.lookUpUser()

    await model.selectLeague(model.leagues[0]!)

    expect(model.stage).toBe('pickingTeam')
    expect(model.teams.map((t) => t.rosterID)).toEqual([1, 2])
    expect(model.teams[0]?.manager).toBe('Byrne Notice')
  })

  it('choosing a team completes setup', async () => {
    const transport = standardTransport()
      .json('/user/stranger', '{"user_id":"u99"}')
      .json('/user/u99/leagues/nfl/2025', `[${TestLeague.leagueJSON()}]`)
    const { model, store } = make(transport)
    model.username = 'stranger'
    await model.lookUpUser()
    await model.selectLeague(model.leagues[0]!)

    model.selectTeam(2)

    expect(model.stage).toBe('ready')
    expect(isConfigured(store.load())).toBe(true)
    expect(store.load().rosterID).toBe(2)
  })

  /** Switching leagues keeps the username — retyping it would be busywork. */
  it('switching league keeps the username', () => {
    const { model, store } = make(new StubTransport(), makeAppSettings({ sleeperUsername: 'connor', userID: 'u1', leagueID: 'L1', rosterID: 1 }))

    model.changeLeague()

    expect(model.stage).toBe('needsUsername')
    expect(store.load().sleeperUsername).toBe('connor')
    expect(store.load().leagueID).toBeUndefined()
    expect(store.load().rosterID).toBeUndefined()
    expect(isConfigured(store.load())).toBe(false)
  })

  it('relay URL is optional and persisted', () => {
    const { model, store } = make(new StubTransport())
    expect(store.load().relayBaseURL).toBeUndefined()

    model.setRelayURL('https://relay.example.test')
    expect(host(store.load().relayBaseURL)).toBe('relay.example.test')

    model.setRelayURL(undefined)
    expect(store.load().relayBaseURL).toBeUndefined()
  })

  /** "100.77.38" is a Tailscale address missing a number: the system reads it as a hostname, and plain http to it is blocked by ATS. */
  it('an incomplete IP is rejected with why', () => {
    const { model, store } = make(new StubTransport())
    expect(model.setRelayURLText('http://100.77.38:1234')).toBe(false)
    expect(store.load().relayBaseURL).toBeUndefined()
    expect(model.relayError?.includes('four numbers') ?? false).toBe(true)
    expect(model.setRelayURLText('http://100.77.38.300:1234')).toBe(false)

    expect(model.setRelayURLText('http://100.77.38.12:1234')).toBe(true)
    expect(parseSwiftURL(store.load().relayBaseURL!)?.port).toBe(1234)
    expect(model.relayError).toBeUndefined()
  })

  it('plain http only to local addresses', () => {
    const { model } = make(new StubTransport())
    expect(model.setRelayURLText('http://mac-mini.local:1234')).toBe(true)
    expect(model.setRelayURLText('http://macmini:1234'), 'bare hostnames are local').toBe(true)
    expect(model.setRelayURLText('http://relay.example.com')).toBe(false)
    expect(model.relayError?.includes('https') ?? false).toBe(true)
    expect(model.setRelayURLText('relay.example.com'), 'no scheme becomes https').toBe(true)
  })

  it('a saved relay that can’t work is flagged and not used', () => {
    const { model } = make(new StubTransport())
    const bad = 'http://100.77.38:1234'
    model.setRelayURL(bad)
    model.checkSavedRelay()
    expect(model.relayError).toBeDefined()
    expect(usableRelay(bad)).toBeUndefined()
    expect(usableRelay('https://relay.example.com')).toBeDefined()
  })
})

/** `AppSettings` persistence in its own right (AppSettingsTests). */
describe('AppSettings', () => {
  it('isConfigured needs both a league and a roster', () => {
    expect(isConfigured(makeAppSettings())).toBe(false)
    expect(isConfigured(makeAppSettings({ leagueID: 'L1' }))).toBe(false)
    expect(isConfigured(makeAppSettings({ rosterID: 1 }))).toBe(false)
    expect(isConfigured(makeAppSettings({ leagueID: 'L1', rosterID: 1 }))).toBe(true)
  })

  /** Swift: round-trips through UserDefaults. The web's UserDefaults is a KeyValueStorage. */
  it('round-trips through key-value storage', () => {
    const store = new KeyValueSettingsStore(new InMemoryKeyValueStorage(), 'settings')
    store.save(makeAppSettings({ sleeperUsername: 'connor', userID: 'u1', leagueID: 'L1', rosterID: 3 }))

    const loaded = store.load()
    expect(loaded.sleeperUsername).toBe('connor')
    expect(loaded.rosterID).toBe(3)
  })

  it('an empty store yields defaults', () => {
    const loaded = new KeyValueSettingsStore(new InMemoryKeyValueStorage(), 'absent').load()
    expect(isConfigured(loaded)).toBe(false)
  })
})
