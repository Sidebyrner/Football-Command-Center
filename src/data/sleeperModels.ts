/**
 * Sleeper's v1 payloads, decoded only as far as the app uses them — a port of
 * FCData `SleeperModels`. Unknown fields are ignored rather than rejected:
 * Sleeper adds fields without warning.
 *
 * Every decoder takes raw JSON and returns camelCase; a record missing a field
 * the Swift side requires throws `DecodeError`, which the client reports as
 * `undecodable` with the path.
 */
import {
  asArray, asObject, compact, int, isObject, needInt, needString, num, numberMap, str, strings,
  type JSONObject,
} from './decode'

/** `/state/nfl` — the authoritative current week. */
export interface NFLState {
  week?: number
  season?: string
  seasonType?: string
  leg?: number
}

export const seasonYear = (s: NFLState) => (s.season !== undefined && /^\d+$/.test(s.season) ? Number(s.season) : undefined)
export const isRegularSeason = (s: NFLState) => s.seasonType === 'regular'

export function decodeNFLState(json: unknown): NFLState {
  const o = asObject(json, 'NFL state')
  return compact({ week: int(o, 'week'), season: str(o, 'season'), seasonType: str(o, 'season_type'), leg: int(o, 'leg') })
}

/** `/user/{username}`. */
export interface SleeperUser {
  userID: string
  username?: string
  displayName?: string
  avatar?: string
}

export function decodeUser(json: unknown): SleeperUser {
  const o = asObject(json, 'user')
  return compact({ userID: needString(o, 'user_id'), username: str(o, 'username'), displayName: str(o, 'display_name'), avatar: str(o, 'avatar') })
}

/** `/league/{id}/users` — display names for the other managers. */
export interface SleeperLeagueMember {
  userID: string
  displayName?: string
  avatar?: string
  /** `metadata.team_name`, which supersedes the display name in Sleeper's UI. */
  teamName?: string
}

/** What to put on screen for this manager. */
export const memberLabel = (m: SleeperLeagueMember) => m.teamName ?? m.displayName ?? m.userID

export function decodeMember(json: unknown): SleeperLeagueMember {
  const o = asObject(json, 'league member')
  const metadata = isObject(o.metadata) ? o.metadata : undefined
  return compact({
    userID: needString(o, 'user_id'),
    displayName: str(o, 'display_name'),
    avatar: str(o, 'avatar'),
    teamName: (metadata && str(metadata, 'team_name')) ?? str(o, 'team_name'),
  })
}

/** The parts of a league's `settings` the app acts on. */
export interface LeagueSettings {
  /** The last week trades are allowed. Sleeper uses 0 for "no deadline". */
  tradeDeadline?: number
  /** Day waivers process, 0 = Sunday … 6 = Saturday. */
  waiverDayOfWeek?: number
  playoffWeekStart?: number
  /** 0 rolling, 1 reverse standings, 2 FAAB. */
  waiverType?: number
  waiverBudget?: number
  waiverClearDays?: number
  dailyWaivers?: number
  playoffTeams?: number
  reserveSlots?: number
  taxiSlots?: number
}

/** `undefined` when the league has no deadline. */
export const effectiveTradeDeadline = (s: LeagueSettings | undefined) =>
  s?.tradeDeadline !== undefined && s.tradeDeadline > 0 ? s.tradeDeadline : undefined

function decodeLeagueSettings(o: JSONObject): LeagueSettings {
  return compact({
    tradeDeadline: int(o, 'trade_deadline'),
    waiverDayOfWeek: int(o, 'waiver_day_of_week'),
    playoffWeekStart: int(o, 'playoff_week_start'),
    waiverType: int(o, 'waiver_type'),
    waiverBudget: int(o, 'waiver_budget'),
    waiverClearDays: int(o, 'waiver_clear_days'),
    dailyWaivers: int(o, 'daily_waivers'),
    playoffTeams: int(o, 'playoff_teams'),
    reserveSlots: int(o, 'reserve_slots'),
    taxiSlots: int(o, 'taxi_slots'),
  })
}

/** `/league/{id}` — the league's own rules, read live on every load. */
export interface SleeperLeague {
  leagueID: string
  name?: string
  season?: string
  status?: string
  totalRosters?: number
  /** Positional slots in order, including `BN`, `IR` and `TAXI`. */
  rosterPositions?: string[]
  /** Raw Sleeper scoring keys. */
  scoringSettings?: Record<string, number>
  previousLeagueID?: string
  settings?: LeagueSettings
}

export function decodeLeague(json: unknown): SleeperLeague {
  const o = asObject(json, 'league')
  return compact({
    leagueID: needString(o, 'league_id'),
    name: str(o, 'name'),
    season: str(o, 'season'),
    status: str(o, 'status'),
    totalRosters: int(o, 'total_rosters'),
    rosterPositions: strings(o, 'roster_positions'),
    scoringSettings: numberMap(o, 'scoring_settings'),
    previousLeagueID: str(o, 'previous_league_id'),
    settings: isObject(o.settings) ? decodeLeagueSettings(o.settings) : undefined,
  })
}

export interface RosterSettings {
  wins?: number
  losses?: number
  ties?: number
  fpts?: number
  fptsDecimal?: number
  fptsAgainst?: number
  fptsAgainstDecimal?: number
  waiverBudgetUsed?: number
  waiverPosition?: number
}

/** Sleeper splits points either side of the decimal point. */
export const pointsFor = (s: RosterSettings | undefined) =>
  s?.fpts === undefined ? undefined : s.fpts + (s.fptsDecimal ?? 0) / 100
export const pointsAgainst = (s: RosterSettings | undefined) =>
  s?.fptsAgainst === undefined ? undefined : s.fptsAgainst + (s.fptsAgainstDecimal ?? 0) / 100

/**
 * `/league/{id}/rosters`. Player ids are strings, and a team defense's id is
 * its abbreviation (`"PHI"`).
 */
export interface SleeperRoster {
  rosterID: number
  ownerID?: string
  leagueID?: string
  players?: string[]
  /** Positionally aligned to the starting slots; `"0"` is an unset slot. */
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  settings?: RosterSettings
}

/** Sleeper's sentinel for "this starting slot is empty". */
export const EMPTY_STARTER_SLOT = '0'

/** Starter ids with unset slots removed — only when the slot no longer matters. */
export const filledStarters = (r: SleeperRoster) => (r.starters ?? []).filter((id) => id !== EMPTY_STARTER_SLOT)

/** Rostered players who are not in a starting slot. */
export function bench(r: SleeperRoster): string[] {
  const starting = new Set(filledStarters(r))
  return (r.players ?? []).filter((id) => !starting.has(id))
}

export function decodeRoster(json: unknown): SleeperRoster {
  const o = asObject(json, 'roster')
  const s = isObject(o.settings) ? o.settings : undefined
  return compact({
    rosterID: needInt(o, 'roster_id'),
    ownerID: str(o, 'owner_id'),
    leagueID: str(o, 'league_id'),
    players: strings(o, 'players'),
    starters: strings(o, 'starters'),
    reserve: strings(o, 'reserve'),
    taxi: strings(o, 'taxi'),
    settings: s && compact({
      wins: int(s, 'wins'),
      losses: int(s, 'losses'),
      ties: int(s, 'ties'),
      fpts: num(s, 'fpts'),
      fptsDecimal: num(s, 'fpts_decimal'),
      fptsAgainst: num(s, 'fpts_against'),
      fptsAgainstDecimal: num(s, 'fpts_against_decimal'),
      waiverBudgetUsed: int(s, 'waiver_budget_used'),
      waiverPosition: int(s, 'waiver_position'),
    }),
  })
}

/** `/league/{id}/matchups/{week}`. */
export interface SleeperMatchup {
  rosterID: number
  /** Rosters sharing a `matchupID` play each other. */
  matchupID?: number
  points?: number
  starters?: string[]
  players?: string[]
  playersPoints?: Record<string, number>
  startersPoints?: number[]
}

export function decodeMatchup(json: unknown): SleeperMatchup {
  const o = asObject(json, 'matchup')
  const sp = o.starters_points
  return compact({
    rosterID: needInt(o, 'roster_id'),
    matchupID: int(o, 'matchup_id'),
    points: num(o, 'points'),
    starters: strings(o, 'starters'),
    players: strings(o, 'players'),
    playersPoints: numberMap(o, 'players_points'),
    startersPoints: Array.isArray(sp) && sp.every((x) => typeof x === 'number') ? (sp as number[]) : undefined,
  })
}

/** `/league/{id}/transactions/{week}`. */
export interface SleeperTransaction {
  transactionID: string
  type?: string
  status?: string
  /** Epoch **milliseconds**. */
  created?: number
  rosterIDs?: number[]
  /** Player id → roster that acquired them. */
  adds?: Record<string, number>
  /** Player id → roster that gave them up. */
  drops?: Record<string, number>
}

export const isTransactionComplete = (t: SleeperTransaction) => t.status === 'complete'

export function decodeTransaction(json: unknown): SleeperTransaction {
  const o = asObject(json, 'transaction')
  const ids = o.roster_ids
  return compact({
    transactionID: needString(o, 'transaction_id'),
    type: str(o, 'type'),
    status: str(o, 'status'),
    created: num(o, 'created'),
    rosterIDs: Array.isArray(ids) && ids.every((x) => Number.isInteger(x)) ? (ids as number[]) : undefined,
    adds: numberMap(o, 'adds'),
    drops: numberMap(o, 'drops'),
  })
}

/**
 * `/players/nfl/trending/{add,drop}` — the only signal for DEF and IDP, so
 * anything built on it is labelled popularity rather than production.
 */
export interface TrendingPlayer {
  playerID: string
  count: number
}

export function decodeTrending(json: unknown): TrendingPlayer {
  const o = asObject(json, 'trending player')
  return { playerID: needString(o, 'player_id'), count: needInt(o, 'count') }
}

/** `/league/{id}/drafts`. */
export interface SleeperDraft {
  draftID: string
  status?: string
  season?: string
  startTime?: number
}

export function decodeDraft(json: unknown): SleeperDraft {
  const o = asObject(json, 'draft')
  return compact({ draftID: needString(o, 'draft_id'), status: str(o, 'status'), season: str(o, 'season'), startTime: num(o, 'start_time') })
}

/** `/draft/{id}/picks`. */
export interface SleeperDraftPick {
  /** Overall pick number, 1-based. */
  pickNo: number
  playerID?: string
  rosterID?: number
  /** The user who made the pick. */
  pickedBy?: string
  round?: number
}

export function decodeDraftPick(json: unknown): SleeperDraftPick {
  const o = asObject(json, 'draft pick')
  return compact({
    pickNo: needInt(o, 'pick_no'),
    playerID: str(o, 'player_id'),
    rosterID: int(o, 'roster_id'),
    pickedBy: str(o, 'picked_by'),
    round: int(o, 'round'),
  })
}

/** Decodes an array whose every element must decode. */
export const listOf = <T>(decode: (v: unknown) => T) => (json: unknown): T[] => asArray(json, 'list').map(decode)

