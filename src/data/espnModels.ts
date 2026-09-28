/**
 * ESPN's league payload, decoded only as far as the translator needs — a port
 * of FCData `ESPNModels`. One shape serves every `view=` combination: ESPN
 * returns the same object with more or fewer fields filled in. Every field is
 * optional, and one malformed team or roster entry costs that entry, not the
 * league.
 */
import { asObject, bool, compact, int, isObject, num, str, type JSONObject } from './decode'

export interface ESPNLeague {
  id?: number
  seasonId?: number
  /** The week ESPN is currently scoring. */
  scoringPeriodId?: number
  settings?: ESPNSettings
  members?: ESPNMember[]
  teams?: ESPNTeam[]
  schedule?: ESPNMatchup[]
}

export interface ESPNSettings {
  name?: string
  /** Slot id (as a string key) → how many of that slot. */
  lineupSlotCounts?: Record<string, number>
  scoringItems?: ESPNScoringItem[]
  /** Regular-season matchup weeks; playoffs start the week after. */
  matchupPeriodCount?: number
  playoffTeamCount?: number
  /** Epoch milliseconds. ESPN sets it far in the future for "no deadline". */
  tradeDeadlineDate?: number
  acquisitionBudget?: number
  isUsingAcquisitionBudget?: boolean
  /** `WAIVERS_TRADITIONAL`, `WAIVERS_CONTINUOUS` or `FREEAGENCY`. */
  acquisitionType?: string
  /** Day names, e.g. `["WEDNESDAY"]`. */
  waiverProcessDays?: string[]
}

export interface ESPNScoringItem {
  statId?: number
  points?: number
}

export interface ESPNMember {
  /** The SWID, braces included. */
  id?: string
  displayName?: string
  firstName?: string
  lastName?: string
}

export interface ESPNTeam {
  id?: number
  /** Seasons from 2024 send one `name`; earlier ones `location` + `nickname`. */
  name?: string
  location?: string
  nickname?: string
  abbrev?: string
  /** SWIDs. Co-managed teams have more than one; the first is the owner. */
  owners?: string[]
  record?: ESPNRecordLine
  entries?: ESPNEntry[]
  waiverRank?: number
  acquisitionBudgetSpent?: number
}

export interface ESPNRecordLine {
  wins?: number
  losses?: number
  ties?: number
  pointsFor?: number
  pointsAgainst?: number
}

export interface ESPNEntry {
  playerId?: number
  /** Which slot the manager put him in. 20 is bench, 21 IR. */
  lineupSlotId?: number
  /** Fantasy points for the scoring period the response was asked for. */
  appliedStatTotal?: number
  player?: ESPNPlayer
}

export interface ESPNPlayer {
  id?: number
  fullName?: string
  firstName?: string
  lastName?: string
  /** ESPN's team number; see `PRO_TEAMS`. */
  proTeamId?: number
  /** 1 QB, 2 RB, 3 WR, 4 TE, 5 K, 16 D/ST. */
  defaultPositionId?: number
  injuryStatus?: string
}

export interface ESPNMatchup {
  id?: number
  matchupPeriodId?: number
  home?: ESPNSide
  away?: ESPNSide
  winner?: string
}

export interface ESPNSide {
  teamId?: number
  /** The matchup's total so far — for a completed week, the final score. */
  totalPoints?: number
  /** Week (as a string key) → points that week, when ESPN splits it. */
  pointsByScoringPeriod?: Record<string, number>
  /** Only with `view=mBoxscore`: the lineup and each player's points for the requested period. */
  entries?: ESPNEntry[]
}

/** The team's display name in either era's shape. */
export function teamDisplayName(team: ESPNTeam): string | undefined {
  if (team.name) return team.name
  const joined = [team.location, team.nickname].filter((s): s is string => !!s).join(' ').trim()
  return joined === '' ? undefined : joined
}

// MARK: - Decoding

export function decodeESPNLeague(json: unknown): ESPNLeague {
  const o = asObject(json, 'ESPN league')
  return compact({
    id: int(o, 'id'),
    seasonId: int(o, 'seasonId'),
    scoringPeriodId: int(o, 'scoringPeriodId'),
    settings: isObject(o.settings) ? decodeSettings(o.settings) : undefined,
    members: listOfObjects(o.members).map(decodeMember),
    teams: listOfObjects(o.teams).map(decodeTeam),
    schedule: listOfObjects(o.schedule).map(decodeMatchup),
  })
}

function listOfObjects(v: unknown): JSONObject[] {
  return Array.isArray(v) ? v.filter(isObject) : []
}

function decodeSettings(o: JSONObject): ESPNSettings {
  const roster = isObject(o.rosterSettings) ? o.rosterSettings : {}
  const scoring = isObject(o.scoringSettings) ? o.scoringSettings : {}
  const schedule = isObject(o.scheduleSettings) ? o.scheduleSettings : {}
  const trade = isObject(o.tradeSettings) ? o.tradeSettings : {}
  const acquisition = isObject(o.acquisitionSettings) ? o.acquisitionSettings : {}
  const counts: Record<string, number> = {}
  if (isObject(roster.lineupSlotCounts)) {
    for (const [k, v] of Object.entries(roster.lineupSlotCounts)) if (typeof v === 'number' && Number.isInteger(v)) counts[k] = v
  }
  const days = Array.isArray(acquisition.waiverProcessDays)
    ? acquisition.waiverProcessDays.filter((d): d is string => typeof d === 'string') : undefined
  return compact({
    name: str(o, 'name'),
    lineupSlotCounts: isObject(roster.lineupSlotCounts) ? counts : undefined,
    scoringItems: listOfObjects(scoring.scoringItems).map((item) => compact({ statId: int(item, 'statId'), points: num(item, 'points') })),
    matchupPeriodCount: int(schedule, 'matchupPeriodCount'),
    playoffTeamCount: int(schedule, 'playoffTeamCount'),
    tradeDeadlineDate: num(trade, 'deadlineDate'),
    acquisitionBudget: int(acquisition, 'acquisitionBudget'),
    isUsingAcquisitionBudget: bool(acquisition, 'isUsingAcquisitionBudget'),
    acquisitionType: str(acquisition, 'acquisitionType'),
    waiverProcessDays: days,
  })
}

function decodeMember(o: JSONObject): ESPNMember {
  return compact({ id: str(o, 'id'), displayName: str(o, 'displayName'), firstName: str(o, 'firstName'), lastName: str(o, 'lastName') })
}

function decodeTeam(o: JSONObject): ESPNTeam {
  const record = isObject(o.record) && isObject(o.record.overall) ? o.record.overall : undefined
  const roster = isObject(o.roster) ? o.roster : undefined
  const counter = isObject(o.transactionCounter) ? o.transactionCounter : undefined
  const owners = Array.isArray(o.owners) ? o.owners.filter((x): x is string => typeof x === 'string') : undefined
  return compact({
    id: int(o, 'id'),
    name: str(o, 'name'),
    location: str(o, 'location'),
    nickname: str(o, 'nickname'),
    abbrev: str(o, 'abbrev'),
    owners,
    record: record && compact({
      wins: int(record, 'wins'), losses: int(record, 'losses'), ties: int(record, 'ties'),
      pointsFor: num(record, 'pointsFor'), pointsAgainst: num(record, 'pointsAgainst'),
    }),
    entries: roster ? listOfObjects(roster.entries).map(decodeEntry) : undefined,
    waiverRank: int(o, 'waiverRank'),
    acquisitionBudgetSpent: counter ? int(counter, 'acquisitionBudgetSpent') : undefined,
  })
}

function decodeEntry(o: JSONObject): ESPNEntry {
  const pool = isObject(o.playerPoolEntry) ? o.playerPoolEntry : undefined
  const player = pool && isObject(pool.player) ? pool.player : undefined
  return compact({
    playerId: int(o, 'playerId') ?? (pool ? int(pool, 'id') : undefined),
    lineupSlotId: int(o, 'lineupSlotId'),
    appliedStatTotal: pool ? num(pool, 'appliedStatTotal') : undefined,
    player: player && compact({
      id: int(player, 'id'),
      fullName: str(player, 'fullName'),
      firstName: str(player, 'firstName'),
      lastName: str(player, 'lastName'),
      proTeamId: int(player, 'proTeamId'),
      defaultPositionId: int(player, 'defaultPositionId'),
      injuryStatus: str(player, 'injuryStatus'),
    }),
  })
}

function decodeMatchup(o: JSONObject): ESPNMatchup {
  return compact({
    id: int(o, 'id'),
    matchupPeriodId: int(o, 'matchupPeriodId'),
    home: isObject(o.home) ? decodeSide(o.home) : undefined,
    away: isObject(o.away) ? decodeSide(o.away) : undefined,
    winner: str(o, 'winner'),
  })
}

function decodeSide(o: JSONObject): ESPNSide {
  const byPeriod: Record<string, number> = {}
  if (isObject(o.pointsByScoringPeriod)) {
    for (const [k, v] of Object.entries(o.pointsByScoringPeriod)) if (typeof v === 'number') byPeriod[k] = v
  }
  const roster = isObject(o.rosterForCurrentScoringPeriod) ? o.rosterForCurrentScoringPeriod : undefined
  return compact({
    teamId: int(o, 'teamId'),
    totalPoints: num(o, 'totalPoints'),
    pointsByScoringPeriod: isObject(o.pointsByScoringPeriod) ? byPeriod : undefined,
    entries: roster ? listOfObjects(roster.entries).map(decodeEntry) : undefined,
  })
}
