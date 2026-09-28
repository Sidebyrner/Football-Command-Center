/**
 * The searchable player pool — a port of FCData `PlayerIndex`.
 *
 * The **trimmed projection** of Sleeper's ~5 MB `/players/nfl`: keeping the
 * raw payload is what blew the old web app's storage quota. Plain data, so it
 * caches as-is in IndexedDB; behaviour lives in the functions below.
 */
import { positionFromSleeper, type Position } from '@core/Position'
import { nflverseTeam, teamName } from '@core/NFLTeams'
import { DataLayerError } from './errors'
import { compact, isObject, lossyString, parseIntStrict, type JSONObject } from './decode'

export interface IndexedPlayer {
  /** Sleeper's id. A **string**; for a team defense, the abbreviation (`"PHI"`). */
  id: string
  name: string
  positionCode?: string
  team?: string
  injuryStatus?: string
  /** Sleeper's own active flag; absent reads as inactive. */
  active: boolean
  injuryBodyPart?: string
  injuryNotes?: string
  /** One-based depth at his position on Sleeper's chart. */
  depthChartOrder?: number
  /** Milliseconds since 1970 — when Sleeper last attached news. */
  newsUpdated?: number
  /** `SS`, `FS`, `NB`, `LDE`… — finer than `positionCode`. */
  depthChartPosition?: string
  age?: number
  /** 0 for a rookie. */
  yearsExperience?: number
  college?: string
  heightInches?: number
  weightPounds?: number
  /** "1996-04-21", as Sleeper sends it. */
  birthDate?: string
  jerseyNumber?: number
  /** ESPN's id for the same player, when Sleeper carries it (a minority). */
  espnID?: number
}

export interface PlayerIndex {
  players: Record<string, IndexedPlayer>
  /** Milliseconds since 1970, so a caller can say how old the pool is. */
  builtAt: number
}

// MARK: - Player helpers

export const playerPosition = (p: IndexedPlayer): Position | undefined => positionFromSleeper(p.positionCode)
export const isTeamDefense = (p: IndexedPlayer) => playerPosition(p) === 'DEF'
/** The team in nflverse's spelling, for joins against the static files. */
export const playerNflverseTeam = (p: IndexedPlayer) => nflverseTeam(p.team)

/** `6'1"`, from inches. */
export function heightLabel(p: IndexedPlayer): string | undefined {
  if (!p.heightInches || p.heightInches <= 0) return undefined
  return `${Math.floor(p.heightInches / 12)}'${p.heightInches % 12}"`
}

/** True only when Sleeper is actually reporting something. */
export function hasInjuryDesignation(p: IndexedPlayer): boolean {
  return !!p.injuryStatus && p.injuryStatus.toLowerCase() !== 'healthy'
}

// MARK: - Index queries

export const playerCount = (index: PlayerIndex) => Object.keys(index.players).length

/** Active players only — the pool anything user-facing should draw from. */
export const activePlayers = (index: PlayerIndex) => Object.values(index.players).filter((p) => p.active)

export const playersAt = (index: PlayerIndex, position: Position) =>
  Object.values(index.players).filter((p) => p.active && playerPosition(p) === position)

export function normaliseName(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Case- and punctuation-insensitive name search, for the player pickers. */
export function searchPlayers(index: PlayerIndex, query: string, limit = 25): IndexedPlayer[] {
  const needle = normaliseName(query)
  if (!needle) return []
  return Object.values(index.players)
    .filter((p) => p.active && normaliseName(p.name).includes(needle))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, limit)
}

// MARK: - Building from Sleeper's payload

/**
 * Builds the trimmed index from Sleeper's raw payload. Lenient per field: one
 * odd bio value must not cost the player, and one malformed player must not
 * cost the pool.
 */
export function buildPlayerIndex(payload: unknown, now: number = Date.now()): PlayerIndex {
  if (!isObject(payload) || !Object.values(payload).every(isObject)) {
    throw new DataLayerError({ kind: 'undecodable', path: '/players/nfl', underlying: 'expected an object of player records' })
  }
  const players: Record<string, IndexedPlayer> = {}
  for (const [id, raw] of Object.entries(payload as Record<string, JSONObject>)) {
    const name = bestName(raw, id)
    if (name === undefined) continue
    const birthDate = s(raw, 'birth_date')
    const college = s(raw, 'college')
    const weight = lossyWhole(raw.weight)
    players[id] = compact({
      id,
      name,
      positionCode: s(raw, 'position'),
      team: s(raw, 'team'),
      injuryStatus: s(raw, 'injury_status'),
      active: typeof raw.active === 'boolean' ? raw.active : false,
      injuryBodyPart: s(raw, 'injury_body_part'),
      injuryNotes: s(raw, 'injury_notes'),
      depthChartOrder: i(raw, 'depth_chart_order'),
      newsUpdated: typeof raw.news_updated === 'number' ? raw.news_updated : undefined,
      depthChartPosition: s(raw, 'depth_chart_position'),
      age: i(raw, 'age') ?? ageFrom(birthDate, now),
      yearsExperience: i(raw, 'years_exp'),
      college: college ? college : undefined,
      heightInches: inches(lossyWhole(raw.height)),
      weightPounds: weight === undefined ? undefined : parseIntStrict(weight.trim()),
      birthDate,
      jerseyNumber: i(raw, 'number'),
      espnID: i(raw, 'espn_id'),
    })
  }
  return { players, builtAt: now }
}

const s = (o: JSONObject, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined)

/** An Int, or a string holding one. */
function i(o: JSONObject, k: string): number | undefined {
  const v = o[k]
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined
  return parseIntStrict(typeof v === 'string' ? v : undefined)
}

/** Sleeper's `LenientString`: a string, or a number rounded to a whole one. */
function lossyWhole(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v))
  return typeof v === 'string' ? lossyString(v) : undefined
}

/** Inches (`"73"`) for most players, `6'1"` for some older records. */
export function inches(raw: string | undefined): number | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  const whole = parseIntStrict(text)
  if (whole !== undefined) return whole > 0 ? whole : undefined
  const digits = text.split(/\D+/).filter(Boolean).map(Number)
  if (digits.length === 0) return undefined
  return digits[0]! * 12 + (digits[1] ?? 0)
}

/** Whole years from a UTC birth date to `now`. */
export function ageFrom(birthDate: string | undefined, now: number): number | undefined {
  const m = birthDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(now)
  let years = at.getUTCFullYear() - y
  const beforeBirthday = at.getUTCMonth() + 1 < mo || (at.getUTCMonth() + 1 === mo && at.getUTCDate() < d)
  if (beforeBirthday) years -= 1
  return years
}

/**
 * Team defenses have no `full_name` and often no first/last name — their id
 * *is* the team, so fall back to it rather than dropping them.
 */
function bestName(raw: JSONObject, id: string): string | undefined {
  const full = s(raw, 'full_name')
  if (full) return full
  const joined = [s(raw, 'first_name'), s(raw, 'last_name')].filter((x) => x !== undefined).join(' ')
  if (joined.trim()) return joined
  const position = s(raw, 'position')
  if (position === 'DEF' || positionFromSleeper(position) === 'DEF') return teamName(id) ?? id
  return undefined
}
