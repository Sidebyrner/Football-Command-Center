/**
 * Everything the screens read from, assembled once — a port of FCApp
 * `LeagueContext`, `LeagueFacts` and `StartAvailability`. The join point for
 * the three feeds, so every dialect is already translated here: Sleeper ids on
 * rosters, gsis ids on production, nflverse team spellings throughout.
 */
import type { Baselines } from '@core/Baselines'
import type { ByeCalendar } from '@core/ByeWeeks'
import type { RosterEntry } from '@core/ByeCrunch'
import type { KickoffCalendar } from '@core/GameClock'
import type { PracticeReport, InjuryDesignation } from '@core/InSeasonFiles'
import { hasWeeklyProductionData, type Position } from '@core/Position'
import type { SlotTemplate } from '@core/RosterSlots'
import type { ScheduleFile } from '@core/Schedule'
import type { SeasonProfile } from '@core/SeasonProfile'
import type { SleeperScoringTranslation } from '@core/SleeperScoring'
import type { WeeklyFile } from '@core/WeeklyStats'
import type { Provenance } from '@data/fetched'
import { hasInjuryDesignation, playerNflverseTeam, playerPosition, type PlayerIndex } from '@data/playerIndex'
import { linePosition } from '@data/insightsModels'
import { effectiveTradeDeadline, type RosterSettings, type SleeperLeague } from '@data/sleeperModels'
import { EMPTY_IN_SEASON, projectedPoints as inSeasonProjected, sleeperPointsPerGame as inSeasonPPG, type InSeasonData } from './InSeasonData'

// MARK: - Availability

/** Where a player sits relative to the user — what turns a name into an action. */
export type Availability =
  | { kind: 'freeAgent' }
  | { kind: 'rivalBench'; rosterID: number; manager: string }
  | { kind: 'rivalStarter'; rosterID: number; manager: string }
  | { kind: 'mine' }

export const FREE_AGENT: Availability = { kind: 'freeAgent' }
export const isAcquirable = (a: Availability) => a.kind !== 'mine'

export function availabilityLabel(a: Availability): string {
  switch (a.kind) {
    case 'freeAgent': return 'Free agent'
    case 'rivalBench': return `${a.manager}'s bench`
    case 'rivalStarter': return `${a.manager}'s starter`
    case 'mine': return 'Yours'
  }
}

// MARK: - Teams

export interface LeagueTeam {
  rosterID: number
  /** How draft picks are attributed. */
  ownerID?: string
  manager: string
  isUser: boolean
  roster: RosterEntry[]
  /** Starters with unset slots removed. */
  starterIDs: string[]
  /** Starters exactly as Sleeper sent them, `"0"` included. */
  rawStarters: string[]
  settings?: RosterSettings
  /** Players parked in IR slots (also in `roster`). */
  reserveIDs: string[]
}

/** Rostered, not starting, not on IR — the players a claim would drop. */
export function benchIDs(t: LeagueTeam): string[] {
  const starting = new Set(t.starterIDs)
  const reserve = new Set(t.reserveIDs)
  return t.roster.map((e) => e.id).filter((id) => !starting.has(id) && !reserve.has(id))
}

// MARK: - League facts

export type WaiverSystem =
  | { kind: 'rolling' }
  | { kind: 'reverseStandings' }
  | { kind: 'faab'; budget: number }
  | { kind: 'unknown' }

export function waiverLabel(w: WaiverSystem): string {
  switch (w.kind) {
    case 'rolling': return 'Rolling waivers'
    case 'reverseStandings': return 'Reverse-standings waivers'
    case 'faab': return `FAAB, $${w.budget} budget`
    case 'unknown': return 'Waiver system not reported'
  }
}

/** League rules that time or price a move, read live every load. */
export interface LeagueFacts {
  waivers: WaiverSystem
  waiverPosition?: number
  faabUsed?: number
  /** 0 = Sunday … 6 = Saturday. */
  waiverDayOfWeek?: number
  tradeDeadlineWeek?: number
  playoffStartWeek?: number
  playoffTeams?: number
  irSlots: number
  teamCount: number
}

export const UNKNOWN_FACTS: LeagueFacts = { waivers: { kind: 'unknown' }, irSlots: 0, teamCount: 0 }

export const faabRemaining = (f: LeagueFacts) => (f.waivers.kind === 'faab' ? f.waivers.budget - (f.faabUsed ?? 0) : undefined)

/** Weeks 15–17 by default; the league's own window when it says. */
export function playoffWeeks(f: LeagueFacts): number[] {
  const start = f.playoffStartWeek ?? 15
  const out: number[] = []
  for (let w = start; w <= Math.max(start, 17); w++) out.push(w)
  return out
}

export function leagueFactsFrom(league: SleeperLeague, userRoster: RosterSettings | undefined): LeagueFacts {
  const s = league.settings
  const waivers: WaiverSystem =
    s?.waiverType === 0 ? { kind: 'rolling' }
    : s?.waiverType === 1 ? { kind: 'reverseStandings' }
    : s?.waiverType === 2 ? { kind: 'faab', budget: s.waiverBudget ?? 100 }
    : { kind: 'unknown' }
  return {
    waivers,
    waiverPosition: userRoster?.waiverPosition,
    faabUsed: userRoster?.waiverBudgetUsed,
    waiverDayOfWeek: s?.waiverDayOfWeek,
    tradeDeadlineWeek: effectiveTradeDeadline(s),
    playoffStartWeek: s?.playoffWeekStart,
    playoffTeams: s?.playoffTeams,
    irSlots: s?.reserveSlots ?? 0,
    teamCount: league.totalRosters ?? 0,
  }
}

// MARK: - Coverage

export type PositionCoverage = 'nflverseWeekly' | 'sleeperStats' | 'none'
export const COVERAGE_LABEL: Readonly<Record<PositionCoverage, string>> = {
  nflverseWeekly: 'nflverse weekly stats', sleeperStats: 'Sleeper weekly stats', none: 'no production data',
}

// MARK: - The context

export interface LeagueContextInit {
  league: SleeperLeague
  scheduleSeason: number
  statsSeason: number
  currentSeasonWeeks: number
  template: SlotTemplate
  scoring: SleeperScoringTranslation
  teams: LeagueTeam[]
  userRosterID: number
  byeCalendar: ByeCalendar
  kickoffs: KickoffCalendar
  now: () => number
  schedule: ScheduleFile
  weekly: WeeklyFile
  currentWeek: number
  seasonWeeks: number[]
  seasonProfiles: SeasonProfile[]
  baselines: Baselines
  sleeperIDsByGSIS: Readonly<Record<string, string>>
  availabilityBySleeperID: ReadonlyMap<string, Availability>
  unsupportedPositions: Position[]
  players: PlayerIndex
  provenance: Provenance
  sleeperProvenance: Provenance
  staticProvenance: Provenance
  leagueFacts?: LeagueFacts
  inSeason?: InSeasonData
}

/** The current season becomes the stats season once it has this many weeks. */
export const MINIMUM_WEEKS_FOR_STATS_SEASON = 3

export class LeagueContext {
  readonly league!: SleeperLeague
  readonly scheduleSeason!: number
  /** Early in a year this is last season — a weekly file can't exist before games. */
  readonly statsSeason!: number
  readonly currentSeasonWeeks!: number
  readonly template!: SlotTemplate
  readonly scoring!: SleeperScoringTranslation
  readonly teams!: LeagueTeam[]
  readonly userRosterID!: number
  readonly byeCalendar!: ByeCalendar
  readonly kickoffs!: KickoffCalendar
  /** Read fresh each time — locks change at kickoff, not at load. */
  readonly now!: () => number
  readonly schedule!: ScheduleFile
  readonly weekly!: WeeklyFile
  readonly currentWeek!: number
  readonly seasonWeeks!: number[]
  readonly seasonProfiles!: SeasonProfile[]
  readonly baselines!: Baselines
  readonly sleeperIDsByGSIS!: Readonly<Record<string, string>>
  readonly availabilityBySleeperID!: ReadonlyMap<string, Availability>
  /** DEF and IDP starting positions the weekly file has no data for. */
  readonly unsupportedPositions!: Position[]
  readonly players!: PlayerIndex
  /** The weakest provenance of everything that went into this. */
  readonly provenance!: Provenance
  readonly sleeperProvenance!: Provenance
  readonly staticProvenance!: Provenance
  leagueFacts: LeagueFacts = UNKNOWN_FACTS
  inSeason: InSeasonData = EMPTY_IN_SEASON
  private reverseCrosswalk?: Map<string, string>

  constructor(init: LeagueContextInit) {
    Object.assign(this, init)
    this.leagueFacts = init.leagueFacts ?? UNKNOWN_FACTS
    this.inSeason = init.inSeason ?? EMPTY_IN_SEASON
  }

  /** What a starting position can be valued from in this context. */
  coverage(position: Position): PositionCoverage {
    if (hasWeeklyProductionData(position)) return 'nflverseWeekly'
    for (const lines of this.inSeason.weekStats.values()) {
      for (const line of lines.values()) if (linePosition(line) === position) return 'sleeperStats'
    }
    return 'none'
  }

  /** gsis id for a Sleeper id (the reverse of `sleeperIDsByGSIS`), first mapping wins. */
  get gsisIDsBySleeper(): ReadonlyMap<string, string> {
    if (!this.reverseCrosswalk) {
      this.reverseCrosswalk = new Map()
      for (const [gsis, sleeper] of Object.entries(this.sleeperIDsByGSIS)) if (!this.reverseCrosswalk.has(sleeper)) this.reverseCrosswalk.set(sleeper, gsis)
    }
    return this.reverseCrosswalk
  }

  practiceReport(sleeperID: string): PracticeReport | undefined {
    const gsis = this.gsisIDsBySleeper.get(sleeperID)
    return gsis === undefined ? undefined : this.inSeason.practiceReports.get(gsis)
  }

  /** Rotowire's points this week under this league's scoring; never zero-filled. */
  projectedPoints(sleeperID: string) { return inSeasonProjected(this.inSeason, sleeperID, this.league.scoringSettings ?? {}) }
  /** Points per game from Sleeper's lines under this league's scoring. */
  sleeperPointsPerGame(sleeperID: string) { return inSeasonPPG(this.inSeason, sleeperID, this.league.scoringSettings ?? {}) }

  playerName(id: string) { return this.players.players[id]?.name }
  position(id: string): Position | undefined {
    const p = this.players.players[id]
    return p ? playerPosition(p) : undefined
  }

  /** Sleeper's injury tag, only when there's one to report. */
  injuryStatus(id: string): string | undefined {
    const p = this.players.players[id]
    return p && hasInjuryDesignation(p) ? p.injuryStatus : undefined
  }

  /** Said whenever production is from a different season than the schedule. */
  get statsSeasonNote(): string | undefined {
    if (this.statsSeason === this.scheduleSeason) return undefined
    if (this.currentSeasonWeeks <= 0) return `Production numbers are from the ${this.statsSeason} season — there is no ${this.scheduleSeason} weekly data yet.`
    return `Production numbers are from the ${this.statsSeason} season until ${this.scheduleSeason} has ${MINIMUM_WEEKS_FOR_STATS_SEASON} weeks of games (it has ${this.currentSeasonWeeks}).`
  }

  get userTeam() { return this.teams.find((t) => t.rosterID === this.userRosterID) }
  get rivals() { return this.teams.filter((t) => t.rosterID !== this.userRosterID) }
  /** From the current week to the end of the regular season. */
  get remainingWeeks() { return this.seasonWeeks.filter((w) => w >= this.currentWeek) }

  /** NFL team in nflverse spelling; a team defense's id is its team. */
  nflTeam(id: string): string | undefined {
    const p = this.players.players[id]
    return (p && playerNflverseTeam(p)) ?? p?.team ?? (p && playerPosition(p) === 'DEF' ? id : undefined)
  }

  isLocked(id: string) { return this.kickoffs.isLocked(this.nflTeam(id), this.currentWeek, this.now()) }
  isLive(id: string) { return this.kickoffs.isLive(this.nflTeam(id), this.currentWeek, this.now()) }

  availabilityOf(sleeperID: string): Availability { return this.availabilityBySleeperID.get(sleeperID) ?? FREE_AGENT }
  availabilityOfGSIS(gsisID: string): Availability {
    const sleeperID = this.sleeperIDsByGSIS[gsisID]
    return sleeperID === undefined ? FREE_AGENT : this.availabilityOf(sleeperID)
  }
}

// MARK: - Start availability

export type StartAvailability =
  | { kind: 'clear' }
  | { kind: 'questionable' }
  | { kind: 'unavailable'; label: string }

/** Sleeper tags meaning very unlikely to play; shared with the readiness ring. */
export const UNAVAILABLE_TAGS: Readonly<Record<string, string>> = {
  OUT: 'Out', DOUBTFUL: 'Doubtful', IR: 'IR', PUP: 'PUP', 'PUP-R': 'PUP', 'PUP-P': 'PUP',
  NFI: 'NFI', 'NFI-R': 'NFI', 'NFI-A': 'NFI', SUS: 'Suspended', NA: 'Not active', COV: 'Illness list', DNR: 'Did not report',
}

export const blocksStart = (a: StartAvailability) => a.kind === 'unavailable'
export const startBadge = (a: StartAvailability) => (a.kind === 'clear' ? undefined : a.kind === 'questionable' ? 'Q' : a.label)

/** The most severe of Sleeper's tag, the official designation and an IR slot. */
export function evaluateStart(sleeperTag: string | undefined, designation: InjuryDesignation | undefined, onReserve: boolean, reserveLabel = 'On your IR'): StartAvailability {
  if (onReserve) return { kind: 'unavailable', label: reserveLabel }
  if (designation === 'Out') return { kind: 'unavailable', label: 'Out' }
  if (designation === 'Doubtful') return { kind: 'unavailable', label: 'Doubtful' }
  const tag = sleeperTag?.trim().toUpperCase()
  if (tag) {
    const label = Object.prototype.hasOwnProperty.call(UNAVAILABLE_TAGS, tag) ? UNAVAILABLE_TAGS[tag] : undefined
    if (label) return { kind: 'unavailable', label }
    if (tag === 'QUESTIONABLE') return { kind: 'questionable' }
  }
  return designation === 'Questionable' ? { kind: 'questionable' } : { kind: 'clear' }
}

/** Checks every roster's IR slots — a rival's IR player can't start for anyone. */
export function startAvailability(id: string, context: LeagueContext): StartAvailability {
  const onMine = context.userTeam?.reserveIDs.includes(id) ?? false
  const onAny = onMine || context.teams.some((t) => t.reserveIDs.includes(id))
  return evaluateStart(context.injuryStatus(id), context.practiceReport(id)?.designation, onAny, onMine ? 'On your IR' : 'On IR')
}
