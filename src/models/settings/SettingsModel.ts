/**
 * The username → league pick flow named in step 2 of the build order — a port
 * of FCApp `SettingsModel`.
 *
 * Uncached on purpose at both steps: a user who mistyped their username and
 * retypes it expects a fresh answer, not their own typo played back from a
 * cache (see `SleeperService.user`).
 */
import { DataLayerError } from '@data/errors'
import { ESPNLeagueService } from '@data/ESPNLeagueService'
import { clearCredentials, ESPN_SECRET_KEY, loadCredentials, saveCredentials, swidSuffix, type ESPNCredentials } from '@data/espnCredentials'
import { SwitchableLeagueSource, type LeagueDataSource, type LeagueProvider } from '@data/LeagueDataSource'
import { LocalStorageSecretStore, type SecretStore } from '@data/secretStore'
import type { SleeperService } from '@data/SleeperService'
import { memberLabel, seasonYear, type SleeperLeague } from '@data/sleeperModels'
import { Observable } from '../Observable'
import {
  copyAppSettings, isConfigured, parseSwiftURL,
  type AccentTheme, type AppSettings, type AppSettingsStore,
} from './AppSettings'

export type SettingsStage =
  | 'needsUsername' | 'pickingLeague' | 'pickingTeam' | 'ready'
  /** ESPN: no cookies saved, or ESPN rejected the saved ones. */
  | 'needsESPNSignIn'
  /** ESPN: signed in, waiting for a league id. */
  | 'needsESPNLeague'

export interface SettingsModelOptions {
  espnSecrets?: SecretStore
  leagueSource?: SwitchableLeagueSource
  makeESPNSource?: (credentials: ESPNCredentials) => ESPNLeagueService
}

export interface SettingsTeam {
  rosterID: number
  manager: string
}

export class SettingsModel extends Observable {
  stage: SettingsStage = 'needsUsername'
  private usernameValue = ''
  leagues: SleeperLeague[] = []
  teams: SettingsTeam[] = []
  isWorking = false
  errorMessage?: string
  relayError?: string
  /** Replaced (never mutated in place) on every change, so it can be compared by identity. */
  settings: AppSettings

  /**
   * Whether a relay token is saved. The token itself never leaves the secret
   * store except in a request header to the relay.
   */
  hasRelayToken = false
  /** Whether ESPN cookies are saved. They never leave the store except to the site's own ESPN proxy. */
  hasESPNCredentials = false
  /** "…ab12", for saying which account is signed in without showing the id. */
  espnAccountSuffix?: string
  private espnLeagueTextValue = ''
  private readonly espnSecrets: SecretStore
  private readonly leagueSource?: SwitchableLeagueSource
  private readonly makeESPNSource?: (credentials: ESPNCredentials) => ESPNLeagueService
  private espnService?: ESPNLeagueService

  constructor(
    private readonly sleeper: SleeperService,
    private readonly store: AppSettingsStore,
    private readonly secrets: SecretStore = new LocalStorageSecretStore(),
    options: SettingsModelOptions = {},
  ) {
    super()
    this.espnSecrets = options.espnSecrets ?? new LocalStorageSecretStore(ESPN_SECRET_KEY)
    this.leagueSource = options.leagueSource
    this.makeESPNSource = options.makeESPNSource
    this.hasRelayToken = secrets.load() !== undefined
    const loaded = store.load()
    this.settings = loaded
    this.usernameValue = loaded.sleeperUsername ?? ''
    const credentials = loadCredentials(this.espnSecrets)
    this.hasESPNCredentials = credentials !== undefined
    this.espnAccountSuffix = credentials && swidSuffix(credentials)
    this.stage = initialStage(loaded, this.hasESPNCredentials)
    this.applyLeagueSource()
  }

  /** What the user pasted for their ESPN league: an id, or the league's URL. */
  get espnLeagueText(): string { return this.espnLeagueTextValue }
  set espnLeagueText(value: string) {
    this.espnLeagueTextValue = value
    this.changed()
  }

  /** The league reads for setup, from whichever provider is current. */
  private get source(): LeagueDataSource { return this.leagueSource ?? this.sleeper }

  /**
   * Points the shared league source at the right provider. Sleeper when ESPN
   * is selected but not signed in — every read then fails plainly rather than
   * with a cookie error.
   */
  private applyLeagueSource(): void {
    if (!this.leagueSource) return
    if (this.settings.provider === 'espn') {
      const credentials = loadCredentials(this.espnSecrets)
      if (credentials && this.makeESPNSource) {
        this.espnService = this.makeESPNSource(credentials)
        this.leagueSource.use(this.espnService)
        return
      }
    }
    this.espnService = undefined
    this.leagueSource.use(this.sleeper)
  }

  // MARK: - Provider

  /** Switches platform. The league selection is cleared — an id from one platform means nothing on the other — but credentials for each are kept. */
  setProvider(provider: LeagueProvider): void {
    if (provider === this.settings.provider) return
    this.leagues = []
    this.teams = []
    this.errorMessage = undefined
    this.update((s) => {
      s.provider = provider
      delete s.leagueID
      delete s.rosterID
    })
    this.applyLeagueSource()
    this.stage = initialStage(this.settings, this.hasESPNCredentials)
    this.changed()
  }

  // MARK: - ESPN

  /** Saves the pasted cookies and moves on to the league. */
  saveESPNCredentials(credentials: ESPNCredentials): void {
    saveCredentials(this.espnSecrets, credentials)
    this.hasESPNCredentials = true
    this.espnAccountSuffix = swidSuffix(credentials)
    this.errorMessage = undefined
    this.applyLeagueSource()
    this.stage = isConfigured(this.settings) ? 'ready' : 'needsESPNLeague'
    this.changed()
  }

  /** Forgets the cookies and every cached ESPN response. The league selection goes too: it cannot be loaded without them. */
  signOutESPN(): void {
    clearCredentials(this.espnSecrets)
    this.hasESPNCredentials = false
    this.espnAccountSuffix = undefined
    void this.espnService?.purgeCache()
    this.teams = []
    this.errorMessage = undefined
    this.update((s) => {
      delete s.leagueID
      delete s.rosterID
    })
    this.applyLeagueSource()
    this.stage = 'needsESPNSignIn'
    this.changed()
  }

  /** Connects the league the user pasted — its id, or its URL on espn.com. */
  async connectESPNLeague(): Promise<void> {
    const leagueID = parseESPNLeagueID(this.espnLeagueText)
    if (leagueID === undefined) {
      this.errorMessage = "Paste your league's id, or its address from espn.com."
      this.changed()
      return
    }
    if (!this.hasESPNCredentials) {
      this.stage = 'needsESPNSignIn'
      this.changed()
      return
    }
    this.isWorking = true
    this.errorMessage = undefined
    this.changed()
    try {
      // The league read doubles as the cookie check.
      await this.source.league(leagueID, true)
      this.update((s) => { s.leagueID = leagueID })
      await this.loadTeams(leagueID)
    } catch (error) {
      this.update((s) => { delete s.leagueID })
      if (error instanceof DataLayerError && error.detail.kind === 'unauthorized') {
        // Expired cookies, or a league this account isn't in. Either way the fix starts with signing in again.
        this.errorMessage = "ESPN wouldn't show that league to this account. Sign in again, and check the league id."
        this.stage = 'needsESPNSignIn'
      } else {
        this.errorMessage = espnErrorMessage(error)
        this.stage = 'needsESPNLeague'
      }
    } finally {
      this.isWorking = false
      this.changed()
    }
  }

  get username(): string { return this.usernameValue }
  set username(value: string) {
    this.usernameValue = value
    this.changed()
  }

  private update(change: (s: AppSettings) => void): void {
    const next = copyAppSettings(this.settings)
    change(next)
    this.settings = next
    this.store.save(next)
    this.changed()
  }

  /** Looks up the user, then their leagues for the current season. */
  async lookUpUser(): Promise<void> {
    const trimmed = this.username.trim()
    if (trimmed === '') {
      this.errorMessage = 'Enter your Sleeper username.'
      this.changed()
      return
    }

    this.isWorking = true
    this.errorMessage = undefined
    this.changed()

    try {
      const user = await this.sleeper.user(trimmed)
      const season = await this.currentSeason()
      const found = await this.sleeper.leagues(user.userID, season)

      this.update((s) => {
        s.sleeperUsername = trimmed
        s.userID = user.userID
      })

      this.leagues = found
      if (found.length === 0) {
        // A real answer, not a failure — say which season was searched rather
        // than leaving them guessing.
        this.errorMessage = `No leagues found for ${trimmed} in ${season}.`
        this.stage = 'needsUsername'
      } else {
        this.stage = 'pickingLeague'
      }
    } catch (error) {
      this.errorMessage = settingsErrorMessage(error, trimmed)
      this.stage = 'needsUsername'
    } finally {
      this.isWorking = false
      this.changed()
    }
  }

  /**
   * Picks a league and loads its rosters so the user can say which team is
   * theirs. Sleeper's own user id usually identifies it, so the matching
   * roster is offered first rather than making them hunt.
   */
  async selectLeague(league: SleeperLeague): Promise<void> {
    this.isWorking = true
    this.errorMessage = undefined
    this.changed()

    this.update((s) => { s.leagueID = league.leagueID })

    try {
      await this.loadTeams(league.leagueID)
    } catch (error) {
      this.errorMessage = describeError(error)
      this.stage = 'pickingLeague'
    } finally {
      this.isWorking = false
      this.changed()
    }
  }

  /** Loads a league's rosters and managers, picks the user's team when the owner id says which it is, and otherwise asks. */
  private async loadTeams(leagueID: string): Promise<void> {
    const rosters = await this.source.rosters(leagueID, true)
    const members = await this.source.members(leagueID, true)
    const names = new Map<string, string>()
    for (const m of members.value) if (!names.has(m.userID)) names.set(m.userID, memberLabel(m))

    this.teams = rosters.value
      .map((roster) => ({
        rosterID: roster.rosterID,
        manager: (roster.ownerID !== undefined ? names.get(roster.ownerID) : undefined) ?? `Roster ${roster.rosterID}`,
      }))
      .sort((a, b) => a.rosterID - b.rosterID)

    // If we can tell which roster is theirs, take it and skip a step.
    const mine = rosters.value.find((r) => this.isUsersOwn(r.ownerID))
    if (mine) {
      this.selectTeam(mine.rosterID)
    } else {
      this.stage = 'pickingTeam'
    }
  }

  /** Sleeper rosters carry the user id; ESPN teams carry the SWID, which ESPN compares case-insensitively. */
  private isUsersOwn(ownerID: string | undefined): boolean {
    if (ownerID === undefined) return false
    if (this.settings.provider === 'espn') {
      const swid = loadCredentials(this.espnSecrets)?.swid
      return swid !== undefined && ownerID.toUpperCase() === swid.toUpperCase()
    }
    return ownerID === this.settings.userID
  }

  selectTeam(rosterID: number): void {
    this.stage = 'ready'
    this.update((s) => { s.rosterID = rosterID })
  }

  /** Clears the league selection but keeps the username — or the ESPN sign-in — which is what "switch league" means in practice. */
  changeLeague(): void {
    this.leagues = []
    this.teams = []
    this.update((s) => {
      delete s.leagueID
      delete s.rosterID
    })
    this.stage = initialStage(this.settings, this.hasESPNCredentials)
    this.changed()
  }

  /** Saves the relay token to the secret store; an empty value removes it. */
  setRelayToken(token: string): void {
    const trimmed = token.trim()
    this.secrets.save(trimmed === '' ? undefined : trimmed)
    this.hasRelayToken = this.secrets.load() !== undefined
    this.changed()
  }

  /** Swift `setRelayURL(_ url: URL?)`: saves the address as given, unchecked. */
  setRelayURL(url: string | undefined): void {
    this.update((s) => {
      if (url === undefined) delete s.relayBaseURL
      else s.relayBaseURL = url
    })
  }

  /**
   * Swift `setRelayURL(text:)`. Accepts what a person types — trims it, adds
   * `https://` when no scheme was given — and rejects anything that isn't an
   * http(s) address rather than saving a URL every request would fail against.
   */
  setRelayURLText(text: string): boolean {
    const trimmed = text.trim()
    if (trimmed === '') {
      this.setRelayURL(undefined)
      this.relayError = undefined
      this.changed()
      return true
    }
    const candidate = trimmed.includes('://') ? trimmed : 'https://' + trimmed
    const url = parseSwiftURL(candidate)
    const scheme = url?.scheme?.toLowerCase()
    const host = url?.host
    if (!url || (scheme !== 'http' && scheme !== 'https') || host === undefined || host === '') {
      this.relayError = "That isn't a web address the relay could be reached at."
      this.changed()
      return false
    }
    const problem = relayHostProblem(host, scheme)
    if (problem !== undefined) {
      this.relayError = problem
      this.changed()
      return false
    }
    this.relayError = undefined
    this.setRelayURL(candidate)
    return true
  }

  /** Flags a saved relay address that can't work, for Settings to show. */
  checkSavedRelay(): void {
    const saved = this.settings.relayBaseURL
    if (saved === undefined) return
    const url = parseSwiftURL(saved)
    const host = url?.host
    const scheme = url?.scheme?.toLowerCase()
    if (host === undefined || scheme === undefined) return
    this.relayError = relayHostProblem(host, scheme)
    this.changed()
  }

  setAccentTheme(theme: AccentTheme): void {
    this.update((s) => { s.accentTheme = theme })
  }

  markPlanningIntroSeen(): void {
    this.update((s) => { s.hasSeenPlanningIntro = true })
  }

  private async currentSeason(): Promise<number> {
    try {
      const season = seasonYear((await this.sleeper.nflState()).value)
      if (season !== undefined) return season
    } catch {
      // Fall through to the calendar year, as Swift's `try?` does.
    }
    return new Date().getFullYear()
  }
}

function initialStage(settings: AppSettings, hasESPNCredentials: boolean): SettingsStage {
  if (settings.provider === 'espn') {
    // Configured but signed out (cleared storage, say) still needs a sign-in; the screens keep working from cache until it happens.
    if (!hasESPNCredentials) return 'needsESPNSignIn'
    return isConfigured(settings) ? 'ready' : 'needsESPNLeague'
  }
  return isConfigured(settings) ? 'ready' : 'needsUsername'
}

/** Accepts `123456`, or any espn.com address carrying `leagueId=123456`. (`SettingsModel.parseESPNLeagueID`.) */
export function parseESPNLeagueID(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (/^\d+$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : 'https://' + trimmed)
    for (const [name, value] of url.searchParams) {
      if (name.toLowerCase() === 'leagueid' && /^\d+$/.test(value.trim())) return value.trim()
    }
  } catch {
    // Not an address either.
  }
  return undefined
}

export function espnErrorMessage(error: unknown): string {
  if (error instanceof DataLayerError && error.detail.kind === 'httpStatus' && error.detail.status === 404) {
    return 'ESPN has no league with that id this season.'
  }
  return describeError(error)
}

/** The saved relay address, or `undefined` when it can't be reached as written. (`SettingsModel.usableRelay`.) */
export function usableRelay(url: string): string | undefined {
  const parts = parseSwiftURL(url)
  const host = parts?.host
  const scheme = parts?.scheme?.toLowerCase()
  if (host === undefined || scheme === undefined) return undefined
  return relayHostProblem(host, scheme) === undefined ? url : undefined
}

/**
 * Why a relay host can't work, or `undefined`. A numeric host must be a whole
 * IPv4 address — "100.77.38" is a Tailscale address missing a number, which
 * the system reads as a hostname and never reaches. Plain http is only allowed
 * to IP addresses, `.local` names and bare hostnames; App Transport Security
 * blocks it to anything else. (ATS is an iOS rule, kept on the web so both
 * clients accept the same addresses; browsers impose their own mixed-content
 * rule on an https page.)
 */
export function relayHostProblem(host: string, scheme: string): string | undefined {
  const parts = host.split('.')
  // `Character.isNumber` is Unicode-wide, as is \p{N}.
  const numeric = /^[\p{N}.]*$/u.test(host)
  if (numeric) {
    const valid = parts.length === 4 && parts.every((p) => /^[0-9]+$/.test(p) && Number(p) <= 255)
    return valid ? undefined : `${host} isn't a complete IP address — it needs four numbers, like 100.77.38.12.`
  }
  if (scheme === 'http' && !host.endsWith('.local') && host.includes('.') && !host.includes(':')) {
    return `Plain http only works to an IP address or a .local name. Use https:// for ${host} (Tailscale can serve https with \`tailscale serve\`).`
  }
  return undefined
}

/**
 * A 404 here means the username does not exist, which is worth saying plainly
 * — it is by far the most common thing to go wrong in setup.
 * (`SettingsModel.message(for:username:)`.)
 */
export function settingsErrorMessage(error: unknown, username: string): string {
  if (error instanceof DataLayerError && error.detail.kind === 'httpStatus' && error.detail.status === 404) {
    return `Sleeper has no user called "${username}".`
  }
  return describeError(error)
}

/** `String(describing: error)`: DataLayerError's message is its Swift `description`. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error)
}
