/**
 * Pure ESPN → Sleeper-shape translation and the player-id mapper — a port of
 * FCData `ESPNTranslator` and `ESPNPlayerIDMapper`. No I/O, so every table
 * here is exercised by the same fixture the Swift tests use.
 */
import { sleeperIDsByESPN, type PlayerIDCrosswalk } from './playerIdCrosswalk'
import { normaliseName, playerPosition, type PlayerIndex } from './playerIndex'
import type { ESPNEntry, ESPNLeague, ESPNPlayer } from './espnModels'
import { teamDisplayName } from './espnModels'
import { EMPTY_STARTER_SLOT, type SleeperLeague, type SleeperLeagueMember, type SleeperMatchup, type SleeperRoster } from './sleeperModels'
import { compact } from './decode'

// MARK: - Tables

/** ESPN lineup slot id → Sleeper `roster_positions` token. Slots with no token (punter, coach) are dropped. */
export const SLOT_TOKENS: Readonly<Record<number, string>> = {
  0: 'QB', 1: 'QB', 2: 'RB', 3: 'WRRB_FLEX', 4: 'WR', 5: 'WRTE_FLEX', 6: 'TE', 7: 'SUPER_FLEX',
  8: 'DL', 9: 'DL', 10: 'LB', 11: 'DL', 12: 'DB', 13: 'DB', 14: 'DB', 15: 'IDP_FLEX',
  16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX',
}

/** The order slots appear in a Sleeper template: offense, flex, DEF, K, IDP, bench, IR. */
const SLOT_ORDER = [0, 1, 2, 4, 6, 3, 5, 23, 7, 16, 17, 8, 9, 11, 10, 12, 13, 14, 15, 20, 21]
const BENCH_SLOT = 20
const IR_SLOT = 21

/** ESPN `defaultPositionId` → Sleeper position code. */
export const POSITIONS: Readonly<Record<number, string>> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }

/** ESPN `proTeamId` → the abbreviation Sleeper uses (`LAR`, `JAX`, `WAS`). */
export const PRO_TEAMS: Readonly<Record<number, string>> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',
  10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
  28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}

/**
 * ESPN `statId` → Sleeper scoring key(s). Yardage is per-yard on both, so the
 * points carry over. ESPN's single 0–39 field-goal bucket fans out to Sleeper's
 * three; unlisted ids are dropped and score as zero.
 */
export const SCORING_KEYS: Readonly<Record<number, readonly string[]>> = {
  3: ['pass_yd'], 4: ['pass_td'], 19: ['pass_2pt'], 20: ['pass_int'],
  24: ['rush_yd'], 25: ['rush_td'], 26: ['rush_2pt'],
  42: ['rec_yd'], 43: ['rec_td'], 44: ['rec_2pt'], 53: ['rec'],
  68: ['fum'], 72: ['fum_lost'],
  74: ['fgm_50p'], 77: ['fgm_40_49'], 80: ['fgm_0_19', 'fgm_20_29', 'fgm_30_39'],
  85: ['fgmiss'], 86: ['xpm'], 88: ['xpmiss'],
  89: ['pts_allow_0'], 90: ['pts_allow_1_6'], 91: ['pts_allow_7_13'], 92: ['pts_allow_14_20'],
  121: ['pts_allow_14_20'], 122: ['pts_allow_21_27'], 123: ['pts_allow_28_34'], 124: ['pts_allow_35p'], 125: ['pts_allow_35p'],
  95: ['int'], 96: ['fum_rec'], 97: ['blk_kick'], 98: ['safe'], 99: ['sack'],
  101: ['def_st_td'], 102: ['def_st_td'], 103: ['def_td'], 104: ['def_td'], 106: ['ff'],
  108: ['idp_tkl_solo'], 107: ['idp_tkl_ast'], 111: ['idp_pass_def'],
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
}

/** ESPN compares SWIDs case-insensitively and is not consistent about which case it sends. */
const swid = (raw: string | undefined) => raw?.toUpperCase()

// MARK: - Player ids

/**
 * Resolves ESPN player ids to Sleeper ids: the crosswalk (about nine rostered
 * players in ten), then Sleeper's own `espn_id`, then name + team + position.
 * A player none of them place keeps a stable `espn:<id>` so he still occupies
 * his slot; screens show him by name with no production data.
 */
export class ESPNPlayerIDMapper {
  private readonly byESPNID: Record<string, string>
  private readonly byNameKey = new Map<string, string>()

  /** `bundledCrosswalk` fills any ESPN id the refreshed crosswalk lacks — a pipeline that published without the column must not blank out every roster. */
  constructor(crosswalk: PlayerIDCrosswalk | undefined, players: PlayerIndex | undefined, bundledCrosswalk?: PlayerIDCrosswalk) {
    this.byESPNID = { ...(bundledCrosswalk ? sleeperIDsByESPN(bundledCrosswalk) : {}), ...(crosswalk ? sleeperIDsByESPN(crosswalk) : {}) }
    for (const player of Object.values(players?.players ?? {})) {
      if (player.espnID !== undefined && this.byESPNID[String(player.espnID)] === undefined) {
        this.byESPNID[String(player.espnID)] = player.id
      }
      if (!player.active || playerPosition(player) === 'DEF') continue
      const key = nameKey(player.name, player.team, playerPosition(player))
      // First one wins; an ambiguous name key is not worth guessing on.
      if (!this.byNameKey.has(key)) this.byNameKey.set(key, player.id)
    }
  }

  sleeperID(player: ESPNPlayer | undefined, espnID: number): string {
    if (espnID <= -16000) {
      // A team defense: ESPN ids them as -16000 - proTeamId; Sleeper as the abbreviation.
      const team = PRO_TEAMS[-16000 - espnID]
      if (team) return team
    }
    const hit = this.byESPNID[String(espnID)]
    if (hit) return hit
    const name = player?.fullName ?? joinName(player?.firstName, player?.lastName)
    if (player && name) {
      const team = player.proTeamId !== undefined ? PRO_TEAMS[player.proTeamId] : undefined
      const position = player.defaultPositionId !== undefined ? POSITIONS[player.defaultPositionId] : undefined
      const byName = this.byNameKey.get(nameKey(name, team, position))
      if (byName) return byName
    }
    return syntheticID(espnID)
  }
}

export const syntheticID = (espnID: number) => `espn:${espnID}`

function nameKey(name: string, team: string | undefined, position: string | undefined): string {
  return `${normaliseName(name)}|${team ?? ''}|${position ?? ''}`
}

function joinName(first?: string, last?: string): string | undefined {
  const name = [first, last].filter((s): s is string => !!s).join(' ').trim()
  return name === '' ? undefined : name
}

// MARK: - League

export function translateLeague(raw: ESPNLeague, id: string): SleeperLeague {
  const settings = raw.settings
  const counts = settings?.lineupSlotCounts ?? {}
  const scoring: Record<string, number> = {}
  for (const item of settings?.scoringItems ?? []) {
    if (item.statId === undefined || item.points === undefined) continue
    for (const key of SCORING_KEYS[item.statId] ?? []) scoring[key] = item.points
  }
  const regularWeeks = settings?.matchupPeriodCount
  const usesBudget = settings?.isUsingAcquisitionBudget === true
  const waiverType = settings === undefined || settings.acquisitionType === undefined && !usesBudget
    ? undefined
    : usesBudget ? 2 : settings.acquisitionType === 'WAIVERS_CONTINUOUS' ? 0 : 1
  const day = settings?.waiverProcessDays?.[0]
  return compact({
    leagueID: id,
    name: settings?.name,
    season: raw.seasonId !== undefined ? String(raw.seasonId) : undefined,
    status: 'in_season',
    totalRosters: raw.teams?.length,
    rosterPositions: rosterPositions(counts),
    scoringSettings: Object.keys(scoring).length === 0 ? undefined : scoring,
    settings: compact({
      // ESPN keeps the deadline as a date, not a week; "unknown" is more honest than a guess.
      waiverDayOfWeek: day !== undefined ? WEEKDAYS[day.toUpperCase()] : undefined,
      playoffWeekStart: regularWeeks !== undefined ? regularWeeks + 1 : undefined,
      waiverType,
      waiverBudget: usesBudget ? settings?.acquisitionBudget : undefined,
      playoffTeams: settings?.playoffTeamCount,
      reserveSlots: counts[String(IR_SLOT)],
    }),
  })
}

/** Sleeper's `roster_positions`: one token per slot, starters first. */
export function rosterPositions(counts: Record<string, number>): string[] {
  const tokens: string[] = []
  for (const slot of SLOT_ORDER) {
    const count = counts[String(slot)]
    const token = SLOT_TOKENS[slot]
    if (count === undefined || count <= 0 || token === undefined) continue
    for (let i = 0; i < count; i++) tokens.push(token)
  }
  return tokens
}

// MARK: - Members

export function translateMembers(raw: ESPNLeague): SleeperLeagueMember[] {
  const teamNames = new Map<string, string>()
  for (const team of raw.teams ?? []) {
    const owner = swid(team.owners?.[0])
    const name = teamDisplayName(team)
    if (owner && name && !teamNames.has(owner)) teamNames.set(owner, name)
  }
  const out: SleeperLeagueMember[] = []
  for (const member of raw.members ?? []) {
    const id = swid(member.id)
    if (!id) continue
    const fullName = joinName(member.firstName, member.lastName)
    out.push(compact({ userID: id, displayName: member.displayName ?? fullName, teamName: teamNames.get(id) }))
  }
  return out
}

// MARK: - Rosters

export function translateRosters(raw: ESPNLeague, leagueID: string, mapper: ESPNPlayerIDMapper): SleeperRoster[] {
  const counts = raw.settings?.lineupSlotCounts ?? {}
  const out: SleeperRoster[] = []
  for (const team of raw.teams ?? []) {
    if (team.id === undefined) continue
    const lineup = buildLineup(team.entries ?? [], counts, mapper)
    const record = team.record
    out.push(compact({
      rosterID: team.id,
      ownerID: swid(team.owners?.[0]),
      leagueID,
      players: lineup.players,
      starters: lineup.starters,
      reserve: lineup.reserve,
      settings: compact({
        wins: record?.wins, losses: record?.losses, ties: record?.ties,
        // Whole values; no decimal half, so `pointsFor` is exactly this.
        fpts: record?.pointsFor, fptsAgainst: record?.pointsAgainst,
        waiverBudgetUsed: team.acquisitionBudgetSpent, waiverPosition: team.waiverRank,
      }),
    }))
  }
  return out
}

interface Lineup {
  players: string[]
  /** Aligned to `rosterPositions` with bench/IR removed; `"0"` for an unfilled slot. */
  starters: string[]
  reserve: string[]
}

/** Fills the league's starting slots from the entries' `lineupSlotId`s; with no counts, the template is inferred from the slots used. */
function buildLineup(entries: readonly ESPNEntry[], counts: Record<string, number>, mapper: ESPNPlayerIDMapper): Lineup {
  const idsBySlot = new Map<number, string[]>()
  const players: string[] = []
  const reserve: string[] = []
  for (const entry of entries) {
    if (entry.playerId === undefined) continue
    const id = mapper.sleeperID(entry.player, entry.playerId)
    players.push(id)
    const slot = entry.lineupSlotId ?? BENCH_SLOT
    if (slot === IR_SLOT) { reserve.push(id); continue }
    idsBySlot.set(slot, [...(idsBySlot.get(slot) ?? []), id])
  }
  let effective = counts
  if (Object.keys(effective).length === 0) {
    effective = {}
    for (const [slot, ids] of idsBySlot) effective[String(slot)] = ids.length
  }
  const starters: string[] = []
  for (const slot of SLOT_ORDER) {
    if (slot === BENCH_SLOT || slot === IR_SLOT) continue
    const count = effective[String(slot)]
    if (count === undefined || count <= 0 || SLOT_TOKENS[slot] === undefined) continue
    const filled = [...(idsBySlot.get(slot) ?? [])]
    for (let i = 0; i < count; i++) starters.push(filled.length === 0 ? EMPTY_STARTER_SLOT : filled.shift()!)
  }
  return { players, starters, reserve }
}

// MARK: - Matchups

/** Two Sleeper matchups per ESPN game in the given week, sharing an id. */
export function translateMatchups(raw: ESPNLeague, week: number, mapper: ESPNPlayerIDMapper): SleeperMatchup[] {
  const counts = raw.settings?.lineupSlotCounts ?? {}
  const out: SleeperMatchup[] = []
  for (const game of raw.schedule ?? []) {
    if (game.matchupPeriodId !== week || game.id === undefined) continue
    for (const side of [game.home, game.away]) {
      if (!side || side.teamId === undefined) continue
      const entries = side.entries ?? []
      const lineup = buildLineup(entries, counts, mapper)
      const playersPoints: Record<string, number> = {}
      for (const entry of entries) {
        if (entry.playerId === undefined || entry.appliedStatTotal === undefined) continue
        playersPoints[mapper.sleeperID(entry.player, entry.playerId)] = entry.appliedStatTotal
      }
      const hasLineup = entries.length > 0
      out.push(compact({
        rosterID: side.teamId,
        matchupID: game.id,
        points: side.pointsByScoringPeriod?.[String(week)] ?? side.totalPoints,
        starters: hasLineup ? lineup.starters : undefined,
        players: hasLineup ? lineup.players : undefined,
        playersPoints: Object.keys(playersPoints).length === 0 ? undefined : playersPoints,
        startersPoints: hasLineup ? lineup.starters.map((id) => playersPoints[id] ?? 0) : undefined,
      }))
    }
  }
  return out
}
