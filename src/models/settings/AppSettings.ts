/**
 * What the app remembers between launches: which league, and whose team — a
 * port of FCApp `AppSettings` (plus `AccentTheme` from `Theme/AccentTheme.swift`).
 *
 * The phone keeps these in `UserDefaults` as the `JSONEncoder` output of the
 * `Codable` struct under `fcc.settings.v1`; the web keeps the same JSON, as a
 * string, under the same key in a `KeyValueStorage` (localStorage in the
 * browser). `encodeAppSettings`/`decodeAppSettings` follow Swift's CodingKeys
 * and its lenient `init(from:)`, so an exported settings file moves between
 * iOS and web unchanged. The relay token is never here — it lives in the
 * `SecretStore`.
 */
import { LocalKeyValueStorage, type KeyValueStorage } from '@models/workspaces/KeyValueStorage'
import { LEAGUE_PROVIDERS, type LeagueProvider } from '@data/LeagueDataSource'

// MARK: - Accent theme

/**
 * The accent colour the user picked in Settings. On the phone each case maps
 * to a SwiftUI `Color`; on the web the same hex values are exposed for CSS.
 */
export type AccentTheme = 'indigo' | 'amber' | 'blue' | 'green' | 'purple' | 'red' | 'teal'

/** Swift's `AccentTheme.allCases`, in declaration order. */
export const ACCENT_THEMES: readonly AccentTheme[] = ['indigo', 'amber', 'blue', 'green', 'purple', 'red', 'teal']

/**
 * The default: clear of every status colour, so a button never looks like a
 * warning. (Amber was the web app's accent — also the caution colour, which is
 * why it is no longer the default.)
 */
export const DEFAULT_ACCENT_THEME: AccentTheme = 'indigo'

/** `rawValue.capitalized`. */
export function accentThemeLabel(theme: AccentTheme): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1)
}

/** The Swift `Color(hex:)` values, as CSS hex. */
export const ACCENT_THEME_HEX: Readonly<Record<AccentTheme, string>> = {
  indigo: '#6366F1',
  amber: '#F59E0B',
  blue: '#3B82F6',
  green: '#10B981',
  purple: '#8B5CF6',
  red: '#F43F5E',
  teal: '#14B8A6',
}

/**
 * The status colour this accent shares, if any — said in Settings, since a
 * button that looks like a warning muddies both.
 */
export function accentThemeSharedStatus(theme: AccentTheme): string | undefined {
  switch (theme) {
    case 'amber': return 'caution'
    case 'green': return 'start'
    case 'red': return 'sit'
    default: return undefined
  }
}

/**
 * Reads a stored value, falling back to the default for anything this version
 * does not know — so removing a theme later cannot break an existing
 * install's settings. (`AccentTheme(stored:)`.)
 */
export function accentThemeFromStored(stored: string | undefined): AccentTheme {
  return stored !== undefined && (ACCENT_THEMES as readonly string[]).includes(stored) ? (stored as AccentTheme) : DEFAULT_ACCENT_THEME
}

// MARK: - Settings

/** Which theme defaults the stored accent was chosen under. Version 1 defaulted to amber; version 2 to indigo. */
export const CURRENT_THEME_VERSION = 2

export interface AppSettings {
  /** Which platform `leagueID` and `rosterID` belong to. Settings saved before ESPN existed decode as Sleeper. */
  provider: LeagueProvider
  sleeperUsername?: string
  userID?: string
  leagueID?: string
  /** The roster the user actually manages, which is what "my team" means on every screen. */
  rosterID?: number
  /**
   * Base URL for the optional relay, as Swift's `URL.absoluteString` — kept
   * verbatim as typed (a JS `URL` would add a trailing slash and rewrite short
   * IPv4 forms). Absent means the enrichment features simply don't appear.
   */
  relayBaseURL?: string
  /** The accent colour picked in Settings. */
  accentTheme: AccentTheme
  themeVersion: number
  /** Whether the Planning explainer has been dismissed. */
  hasSeenPlanningIntro: boolean
  /**
   * The user's weights for the optional weighted grade on the Player Card,
   * keyed by `WeightedGrade.gradeKey` and `SituationMetric` raw values. Absent
   * keys use the defaults.
   */
  gradeWeights: Record<string, number>
}

/** `AppSettings(...)` with Swift's defaults. */
export function makeAppSettings(fields: Partial<AppSettings> = {}): AppSettings {
  return {
    ...fields,
    provider: fields.provider ?? 'sleeper',
    accentTheme: fields.accentTheme ?? DEFAULT_ACCENT_THEME,
    themeVersion: fields.themeVersion ?? CURRENT_THEME_VERSION,
    hasSeenPlanningIntro: fields.hasSeenPlanningIntro ?? false,
    gradeWeights: { ...(fields.gradeWeights ?? {}) },
  }
}

/** A value copy, standing in for Swift's struct semantics. */
export function copyAppSettings(settings: AppSettings): AppSettings {
  return { ...settings, gradeWeights: { ...settings.gradeWeights } }
}

/**
 * Whether there is enough here to load a league. Until this is true the app
 * shows Settings and nothing else.
 */
export function isConfigured(settings: AppSettings): boolean {
  return settings.leagueID !== undefined && settings.rosterID !== undefined
}

// MARK: - Coding

/** CodingKeys, in declaration order — also the order `encodeAppSettings` writes. */
export const APP_SETTINGS_CODING_KEYS = [
  'provider', 'sleeperUsername', 'userID', 'leagueID', 'rosterID', 'relayBaseURL',
  'accentTheme', 'themeVersion', 'hasSeenPlanningIntro', 'gradeWeights',
] as const

/**
 * The synthesised `Encodable` output: optionals that are nil are omitted,
 * everything else written under its CodingKey. (Swift's JSONEncoder escapes
 * `/` as `\/` in the relay URL; both decoders read either spelling.)
 */
export function encodeAppSettings(settings: AppSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  out.provider = settings.provider
  if (settings.sleeperUsername !== undefined) out.sleeperUsername = settings.sleeperUsername
  if (settings.userID !== undefined) out.userID = settings.userID
  if (settings.leagueID !== undefined) out.leagueID = settings.leagueID
  if (settings.rosterID !== undefined) out.rosterID = settings.rosterID
  if (settings.relayBaseURL !== undefined) out.relayBaseURL = settings.relayBaseURL
  out.accentTheme = settings.accentTheme
  out.themeVersion = settings.themeVersion
  out.hasSeenPlanningIntro = settings.hasSeenPlanningIntro
  out.gradeWeights = { ...settings.gradeWeights }
  return out
}

class SettingsDecodingError extends Error {
  constructor(key: string) {
    super(`AppSettings: ${key} has the wrong type`)
    this.name = 'SettingsDecodingError'
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isSwiftInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** `decodeIfPresent` under `try`: null/absent → undefined; wrong type throws. */
function required<T>(o: Record<string, unknown>, key: string, check: (v: unknown) => v is T): T | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (!check(v)) throw new SettingsDecodingError(key)
  return v
}

/** `decodeIfPresent` under `try?`: anything unreadable is undefined. */
function lenient<T>(o: Record<string, unknown>, key: string, check: (v: unknown) => v is T): T | undefined {
  const v = o[key]
  return v !== undefined && v !== null && check(v) ? v : undefined
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isURLString = (v: unknown): v is string => typeof v === 'string' && parseSwiftURL(v) !== undefined
const isWeights = (v: unknown): v is Record<string, number> =>
  isObject(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x))

/**
 * Swift's custom `init(from:)`. Settings saved by an older version lack the
 * newer fields, and a theme saved by a newer version may not exist in this
 * one; both decode to sensible defaults. The identity fields are decoded with
 * `try`, so a wrong type there throws — exactly as Swift, where the store then
 * falls back to fresh settings.
 */
export function decodeAppSettings(json: unknown): AppSettings {
  if (!isObject(json)) throw new Error('AppSettings: expected an object')
  const sleeperUsername = required(json, 'sleeperUsername', isString)
  const userID = required(json, 'userID', isString)
  const leagueID = required(json, 'leagueID', isString)
  const rosterID = required(json, 'rosterID', isSwiftInt)
  const relayBaseURL = required(json, 'relayBaseURL', isURLString)
  const storedTheme = accentThemeFromStored(lenient(json, 'accentTheme', isString))
  const storedVersion = lenient(json, 'themeVersion', isSwiftInt) ?? 1
  // Amber saved under version 1 was the old default, not a choice: move it to
  // the new one, once. Amber picked after that stays amber.
  const accentTheme = storedVersion < 2 && storedTheme === 'amber' ? DEFAULT_ACCENT_THEME : storedTheme
  const provider = lenient(json, 'provider', isString)
  const settings: AppSettings = {
    provider: provider !== undefined && (LEAGUE_PROVIDERS as readonly string[]).includes(provider) ? (provider as LeagueProvider) : 'sleeper',
    accentTheme,
    themeVersion: CURRENT_THEME_VERSION,
    hasSeenPlanningIntro: lenient(json, 'hasSeenPlanningIntro', isBool) ?? false,
    gradeWeights: { ...(lenient(json, 'gradeWeights', isWeights) ?? {}) },
  }
  if (sleeperUsername !== undefined) settings.sleeperUsername = sleeperUsername
  if (userID !== undefined) settings.userID = userID
  if (leagueID !== undefined) settings.leagueID = leagueID
  if (rosterID !== undefined) settings.rosterID = rosterID
  if (relayBaseURL !== undefined) settings.relayBaseURL = relayBaseURL
  return settings
}

// MARK: - URL parsing, Foundation-style

export interface SwiftURLParts {
  /** As written; callers lowercase. */
  scheme?: string
  /** `URL.host`: no brackets around an IPv6 literal, no port, no user info. */
  host?: string
  port?: number
}

/**
 * Enough of Foundation's `URL(string:)` for the relay field: RFC 3986
 * syntax, returning `undefined` where Foundation returns nil (characters
 * outside RFC 3986, a bad percent escape, a non-numeric port). Unlike a WHATWG
 * `URL`, it keeps a host like `100.77.38` as written rather than reading it
 * as the IPv4 address `100.77.0.38`, which is what the relay check relies on.
 */
export function parseSwiftURL(text: string): SwiftURLParts | undefined {
  if (!/^(?:[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/.test(text)) return undefined
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(text)
  const scheme = schemeMatch?.[1]
  const rest = schemeMatch ? text.slice(schemeMatch[0].length) : text
  if (!rest.startsWith('//')) return scheme !== undefined ? { scheme } : {}
  const authority = rest.slice(2).split(/[/?#]/, 1)[0] ?? ''
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1)
  let host: string
  let portText: string | undefined
  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']')
    if (close < 0) return undefined
    host = hostPort.slice(1, close)
    const after = hostPort.slice(close + 1)
    if (after !== '' && !after.startsWith(':')) return undefined
    portText = after === '' ? undefined : after.slice(1)
  } else {
    const colon = hostPort.lastIndexOf(':')
    host = colon < 0 ? hostPort : hostPort.slice(0, colon)
    portText = colon < 0 ? undefined : hostPort.slice(colon + 1)
  }
  if (portText !== undefined && !/^[0-9]*$/.test(portText)) return undefined
  const parts: SwiftURLParts = {}
  if (scheme !== undefined) parts.scheme = scheme
  if (host !== '') parts.host = decodeURIComponentSafe(host)
  if (portText) parts.port = Number(portText)
  return parts
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

// MARK: - Stores

/** Persistence for `AppSettings`. */
export interface AppSettingsStore {
  load(): AppSettings
  save(settings: AppSettings): void
}

/**
 * The web's `UserDefaultsSettingsStore`: the same key and JSON, in a
 * `KeyValueStorage`. Anything missing or unreadable loads as fresh settings.
 */
export class KeyValueSettingsStore implements AppSettingsStore {
  constructor(
    private readonly storage: KeyValueStorage = new LocalKeyValueStorage(),
    private readonly key = 'fcc.settings.v1',
  ) {}

  load(): AppSettings {
    const text = this.storage.getItem(this.key)
    if (text === undefined) return makeAppSettings()
    try {
      return decodeAppSettings(JSON.parse(text))
    } catch {
      return makeAppSettings()
    }
  }

  save(settings: AppSettings): void {
    this.storage.setItem(this.key, JSON.stringify(encodeAppSettings(settings)))
  }
}

/** In-memory store, for tests and previews. Holds a copy, as Swift's struct would. */
export class InMemorySettingsStore implements AppSettingsStore {
  private settings: AppSettings

  constructor(settings: AppSettings = makeAppSettings()) {
    this.settings = copyAppSettings(settings)
  }

  load(): AppSettings {
    return copyAppSettings(this.settings)
  }

  save(settings: AppSettings): void {
    this.settings = copyAppSettings(settings)
  }
}
