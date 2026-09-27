/**
 * The username → league pick flow named in step 2 of the build order — a port
 * of FCApp `SettingsModel`.
 *
 * Uncached on purpose at both steps: a user who mistyped their username and
 * retypes it expects a fresh answer, not their own typo played back from a
 * cache (see `SleeperService.user`).
 */
import { DataLayerError } from '@data/errors'
import { LocalStorageSecretStore, type SecretStore } from '@data/secretStore'
import type { SleeperService } from '@data/SleeperService'
import { memberLabel, seasonYear, type SleeperLeague } from '@data/sleeperModels'
import { Observable } from '../Observable'
import {
  copyAppSettings, isConfigured, parseSwiftURL,
  type AccentTheme, type AppSettings, type AppSettingsStore,
} from './AppSettings'

export type SettingsStage = 'needsUsername' | 'pickingLeague' | 'pickingTeam' | 'ready'

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

  constructor(
    private readonly sleeper: SleeperService,
    private readonly store: AppSettingsStore,
    private readonly secrets: SecretStore = new LocalStorageSecretStore(),
  ) {
    super()
    this.hasRelayToken = secrets.load() !== undefined
    const loaded = store.load()
    this.settings = loaded
    this.usernameValue = loaded.sleeperUsername ?? ''
    this.stage = isConfigured(loaded) ? 'ready' : 'needsUsername'
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
      const rosters = await this.sleeper.rosters(league.leagueID)
      const members = await this.sleeper.members(league.leagueID)
      const names = new Map<string, string>()
      for (const m of members.value) if (!names.has(m.userID)) names.set(m.userID, memberLabel(m))

      this.teams = rosters.value
        .map((roster) => ({
          rosterID: roster.rosterID,
          manager: (roster.ownerID !== undefined ? names.get(roster.ownerID) : undefined) ?? `Roster ${roster.rosterID}`,
        }))
        .sort((a, b) => a.rosterID - b.rosterID)

      // If we can tell which roster is theirs, take it and skip a step.
      const userID = this.settings.userID
      const mine = userID !== undefined ? rosters.value.find((r) => r.ownerID === userID) : undefined
      if (mine) {
        this.selectTeam(mine.rosterID)
      } else {
        this.stage = 'pickingTeam'
      }
    } catch (error) {
      this.errorMessage = describeError(error)
      this.stage = 'pickingLeague'
    } finally {
      this.isWorking = false
      this.changed()
    }
  }

  selectTeam(rosterID: number): void {
    this.stage = 'ready'
    this.update((s) => { s.rosterID = rosterID })
  }

  /** Clears the league selection but keeps the username, which is what "switch league" means in practice. */
  changeLeague(): void {
    this.leagues = []
    this.teams = []
    this.stage = 'needsUsername'
    this.update((s) => {
      delete s.leagueID
      delete s.rosterID
    })
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
