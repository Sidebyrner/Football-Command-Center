import { describe, expect, it } from 'vitest'
import { SleeperClient } from '@data/SleeperClient'
import { SleeperService } from '@data/SleeperService'
import { Cache, MemoryStore } from '@data/cache'
import { InMemorySecretStore } from '@data/secretStore'
import {
  ACCENT_THEMES, DEFAULT_ACCENT_THEME, decodeAppSettings, encodeAppSettings, InMemorySettingsStore, makeAppSettings,
  parseSwiftURL, type AppSettings,
} from '../AppSettings'
import { SettingsModel } from '../SettingsModel'
import { StubTransport } from '../../../../tests/stubTransport'

/** Port of AppearanceSettingsTests: accent themes and the relay address, as stored settings. */
function model(settings: AppSettings = makeAppSettings()) {
  const store = new InMemorySettingsStore(settings)
  const sleeper = new SleeperService(
    new SleeperClient({ baseURL: 'https://api.example.test/v1', transport: new StubTransport(), retries: 0 }),
    new Cache(new MemoryStore()),
  )
  return { model: new SettingsModel(sleeper, store, new InMemorySecretStore()), store }
}

/** `JSONDecoder().decode(AppSettings.self, from:)`. */
const decode = (json: string) => decodeAppSettings(JSON.parse(json))

describe('Appearance settings', () => {
  // MARK: - Accent theme

  it('a new install uses the default theme', () => {
    expect(makeAppSettings().accentTheme, 'clear of every status colour').toBe('indigo')
  })

  it('a chosen theme persists', () => {
    const { model: m, store } = model()
    m.setAccentTheme('teal')
    expect(store.load().accentTheme).toBe('teal')
    expect(m.settings.accentTheme).toBe('teal')
  })

  /** Settings saved before themes existed must still load — with the league intact. */
  it('settings saved before themes existed still load', () => {
    const settings = decode('{"sleeperUsername":"connor","userID":"u1","leagueID":"L1","rosterID":3}')

    expect(settings.leagueID).toBe('L1')
    expect(settings.rosterID).toBe(3)
    expect(settings.accentTheme).toBe(DEFAULT_ACCENT_THEME)
    expect(settings.hasSeenPlanningIntro).toBe(false)
  })

  /** A theme a later version removed falls back rather than failing. */
  it('an unknown theme falls back to the default', () => {
    const settings = decode('{"leagueID":"L1","rosterID":1,"accentTheme":"neonMagenta"}')

    expect(settings.accentTheme).toBe(DEFAULT_ACCENT_THEME)
    expect(settings.leagueID, 'the rest of the settings survive').toBe('L1')
  })

  it('themes round-trip', () => {
    for (const theme of ACCENT_THEMES) {
      const data = JSON.stringify(encodeAppSettings(makeAppSettings({ accentTheme: theme })))
      expect(decode(data).accentTheme).toBe(theme)
    }
  })

  // MARK: - Relay address

  it('a bare host gets https', () => {
    const { model: m, store } = model()
    expect(m.setRelayURLText('  relay.example.com  ')).toBe(true)
    expect(store.load().relayBaseURL).toBe('https://relay.example.com')
    expect(m.relayError).toBeUndefined()
  })

  it('an explicit scheme and port are kept', () => {
    const { model: m, store } = model()
    expect(m.setRelayURLText('http://192.168.1.20:3001')).toBe(true)
    expect(store.load().relayBaseURL).toBe('http://192.168.1.20:3001')
  })

  /** A non-web scheme would make every request fail, so it is refused with a message rather than saved. */
  it('a non-web address is refused', () => {
    const { model: m, store } = model(makeAppSettings({ relayBaseURL: 'https://kept.example.com' }))
    expect(m.setRelayURLText('ftp://files.example.com')).toBe(false)
    expect(m.relayError).toBeDefined()
    expect(parseSwiftURL(store.load().relayBaseURL!)?.host, 'the previous address is kept').toBe('kept.example.com')
  })

  it('clearing the field removes the relay', () => {
    const { model: m, store } = model(makeAppSettings({ relayBaseURL: 'https://relay.example.com' }))
    expect(m.setRelayURLText('   ')).toBe(true)
    expect(store.load().relayBaseURL).toBeUndefined()
  })

  it('the planning intro is remembered', () => {
    const { model: m, store } = model()
    m.markPlanningIntroSeen()
    expect(store.load().hasSeenPlanningIntro).toBe(true)
  })
})

/**
 * Web-only checks on the Swift JSON shape, so an exported settings file moves
 * between iOS and web. Not in the Swift suite; they pin behaviour of Swift's
 * custom `init(from:)` read off the source.
 */
describe('AppSettings JSON parity', () => {
  it('encodes only present optionals, under the CodingKeys', () => {
    expect(encodeAppSettings(makeAppSettings({ leagueID: 'L1', rosterID: 2, relayBaseURL: 'https://r.example.com' }))).toEqual({
      leagueID: 'L1', rosterID: 2, relayBaseURL: 'https://r.example.com',
      accentTheme: 'indigo', themeVersion: 2, hasSeenPlanningIntro: false, gradeWeights: {},
    })
  })

  it('reads Swift’s escaped slashes', () => {
    expect(decode('{"relayBaseURL":"https:\\/\\/relay.example.com"}').relayBaseURL).toBe('https://relay.example.com')
  })

  it('amber saved under version 1 moves to the default once; amber under version 2 stays', () => {
    expect(decode('{"accentTheme":"amber"}').accentTheme).toBe('indigo')
    expect(decode('{"accentTheme":"amber","themeVersion":1}').accentTheme).toBe('indigo')
    expect(decode('{"accentTheme":"amber","themeVersion":2}').accentTheme).toBe('amber')
    expect(decode('{"accentTheme":"teal","themeVersion":1}').accentTheme).toBe('teal')
    expect(decode('{}').themeVersion).toBe(2)
  })

  it('unreadable newer fields default; a wrong-typed identity field fails the decode', () => {
    const s = decode('{"leagueID":"L1","hasSeenPlanningIntro":"yes","gradeWeights":{"a":"x"},"themeVersion":"2"}')
    expect(s.hasSeenPlanningIntro).toBe(false)
    expect(s.gradeWeights).toEqual({})
    expect(() => decode('{"rosterID":"3"}')).toThrow()
    expect(decode('{"gradeWeights":{"grade":0.5}}').gradeWeights).toEqual({ grade: 0.5 })
  })
})
