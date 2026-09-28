/**
 * The two cookies ESPN issues at sign-in, which are all a private league needs
 * — a port of FCData `ESPNCredentials`.
 *
 * The phone reads them out of a sign-in web view; a browser page cannot, so on
 * the web the user pastes them from their own ESPN session. They live in this
 * site's `localStorage` (the web's stand-in for the Keychain), are left out of
 * export files, and go nowhere but the site's own ESPN proxy.
 */
import type { SecretStore } from './secretStore'

export interface ESPNCredentials {
  /** The session cookie. Long-lived (about a year) and the actual secret. */
  espnS2: string
  /** The account id, braces included, exactly as ESPN sets it. */
  swid: string
}

export const ESPN_SECRET_KEY = 'fcc.espn-credentials'

/** The value the fantasy API expects. */
export const cookieHeader = (c: ESPNCredentials) => `espn_s2=${c.espnS2}; SWID=${c.swid}`

/** The last few characters of the account id, for "signed in as …ab12". */
export function swidSuffix(c: ESPNCredentials): string {
  return c.swid.replace(/^\{|\}$/g, '').slice(-4)
}

/** Redacted on purpose: a stray `console.log` must never put the cookie in a log. */
export function describeCredentials(c: ESPNCredentials): string {
  return `ESPNCredentials(swid: …${swidSuffix(c)}, espnS2: <redacted>)`
}

/**
 * Accepts what a person pastes: the raw cookie value, or a whole `Cookie:`
 * header / dev-tools line containing `espn_s2=…` and `SWID=…`. Braces are
 * added to a bare SWID, since ESPN compares it with them.
 */
export function parseCredentials(espnS2Text: string, swidText: string): ESPNCredentials | undefined {
  const combined = `${espnS2Text}\n${swidText}`
  const s2 = /espn_s2=([^;\s]+)/i.exec(combined)?.[1] ?? cleanCookieValue(espnS2Text)
  const swidRaw = /SWID=([^;\s]+)/i.exec(combined)?.[1] ?? cleanCookieValue(swidText)
  if (!s2 || !swidRaw) return undefined
  const swid = swidRaw.startsWith('{') ? swidRaw : `{${swidRaw.replace(/^\{|\}$/g, '')}}`
  if (!/^\{[0-9A-Za-z-]{8,}\}$/.test(swid)) return undefined
  return { espnS2: decodeURIComponentSafe(s2), swid: swid.toUpperCase() }
}

function cleanCookieValue(text: string): string {
  return text.trim().replace(/^["']|["']$/g, '').replace(/;.*$/, '').trim()
}

function decodeURIComponentSafe(s: string): string {
  // ESPN's espn_s2 is percent-encoded in the cookie jar; the API accepts it either way.
  return s
}

// MARK: - Secret store

export function loadCredentials(store: SecretStore): ESPNCredentials | undefined {
  const raw = store.load()
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null
      && typeof (parsed as ESPNCredentials).espnS2 === 'string' && typeof (parsed as ESPNCredentials).swid === 'string') {
      return { espnS2: (parsed as ESPNCredentials).espnS2, swid: (parsed as ESPNCredentials).swid }
    }
  } catch {
    // Unreadable is the same as absent.
  }
  return undefined
}

export function saveCredentials(store: SecretStore, credentials: ESPNCredentials): void {
  store.save(JSON.stringify({ espnS2: credentials.espnS2, swid: credentials.swid }))
}

export function clearCredentials(store: SecretStore): void {
  store.save(undefined)
}
