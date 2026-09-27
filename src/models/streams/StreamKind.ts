/**
 * What every weekly stream screen shares — a port of FCApp `StreamKind.swift`:
 * where a piece of game context came from, the override shapes, the
 * per-stream `StreamKind` contract, the practice-status mapper and the
 * any-player picker row.
 */
import type { Position } from '@core/Position'
import type { StreamHorizon, StreamPractice, StreamProjection, StreamRiskMode } from '@core/Stream'
import type { IndexedPlayer } from '@data/playerIndex'
import type { Availability, LeagueContext } from '../league/LeagueContext'
import type { DefenseLookup } from '../player/DefenseLookup'

// MARK: - Context source

/** Where one piece of a stream's game context came from, so the screen can say so. */
export type StreamContextSource = 'schedule' | 'sleeperDvP' | 'standard' | 'manual' | 'imported'

export const STREAM_CONTEXT_SOURCES: readonly StreamContextSource[] = ['schedule', 'sleeperDvP', 'standard', 'manual', 'imported']

export const STREAM_CONTEXT_SOURCE_LABEL: Readonly<Record<StreamContextSource, string>> = {
  schedule: 'Schedule lines',
  sleeperDvP: 'Sleeper DvP',
  standard: 'Default',
  manual: 'Edited',
  imported: 'Imported',
}

// MARK: - Contracts

/** One NFL team's game this week, as a stream model sees it. */
export interface StreamTeamContext {
  team: string
  opponent: string
  home?: boolean
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
}

/** "vs NYG", "@NYG", or "vs NYG (neutral)" when home/away is unknown. */
export function opponentLabel(t: { opponent: string; home?: boolean }): string {
  switch (t.home) {
    case true: return `vs ${t.opponent}`
    case false: return `@${t.opponent}`
    default: return `vs ${t.opponent} (neutral)`
  }
}

/** A stream model's input for one player. */
export interface StreamCandidate {
  playerID?: string
  name: string
}

/** Swift's `Identifiable.id` on every stream candidate. */
export const streamCandidateID = (c: StreamCandidate) => c.playerID ?? c.name

/**
 * Everything the user has changed for one week of one stream, persisted by
 * `StreamStore`. Same JSON shape as the Swift Codable struct.
 */
export interface StreamWeekOverrides<TeamOverride, PlayerOverride> {
  teams: Record<string, TeamOverride>
  players: Record<string, PlayerOverride>
  /** The starter candidates are compared against; `undefined` picks the weakest. */
  incumbentID?: string
}

export function emptyOverrides<T, P>(): StreamWeekOverrides<T, P> {
  return { teams: {}, players: {} }
}

/**
 * An import over what is already stored: imported values win, and nothing
 * the import does not mention is touched.
 */
export function mergingOverrides<T, P>(current: StreamWeekOverrides<T, P>, incoming: StreamWeekOverrides<T, P>): StreamWeekOverrides<T, P> {
  const out: StreamWeekOverrides<T, P> = { teams: { ...current.teams }, players: { ...current.players } }
  if (current.incumbentID !== undefined) out.incumbentID = current.incumbentID
  for (const [team, change] of Object.entries(incoming.teams)) out.teams[team] = change
  for (const [id, change] of Object.entries(incoming.players)) out.players[id] = change
  return out
}

/** The associated types of one stream kind. */
export interface StreamKindTypes {
  Candidate: StreamCandidate
  Projection: StreamProjection
  Scoring: unknown
  Team: StreamTeamContext
  TeamOverride: unknown
  PlayerOverride: unknown
  GameLine: unknown
}

/**
 * What makes one stream — IDP, WR — different from another. Everything else
 * (loading, the starter to beat, compare, search, snapshots, edits) is shared
 * by `StreamScreenModel`.
 */
export interface StreamKind<K extends StreamKindTypes> {
  /** Folder under FantasyCommandCenter (a key prefix on the web). */
  readonly storeFolder: string
  /** Slot positions this stream covers. */
  readonly positions: readonly Position[]
  /** "defender", "receiver". */
  readonly playerNoun: string
  readonly emptyScoring: K['Scoring']
  /** Streams with a rest-of-season layer rank by a horizon too. */
  readonly usesHorizon: boolean

  scoring(sleeperSettings: Readonly<Record<string, number>>): K['Scoring']
  unmodelledKeys(sleeperSettings: Readonly<Record<string, number>>): string[]
  autofill(context: LeagueContext, defense: DefenseLookup): Record<string, K['Team']>
  apply(overrides: Readonly<Record<string, K['TeamOverride']>>, teams: Readonly<Record<string, K['Team']>>): Record<string, K['Team']>
  candidates(context: LeagueContext, teams: Readonly<Record<string, K['Team']>>,
    players: Readonly<Record<string, K['PlayerOverride']>>, alwaysInclude: ReadonlySet<string>): K['Candidate'][]
  /** Without a horizon this is Swift's `project(_:scoring:risk:)`. */
  project(candidate: K['Candidate'], scoring: K['Scoring'], risk: StreamRiskMode, horizon?: StreamHorizon): K['Projection']
  recentGames(context: LeagueContext, playerID: string, limit: number): K['GameLine'][]
  /** The finer role for a player not yet projected, for picker rows. */
  roleLabel(player: IndexedPlayer): string | undefined
  /** Swift took `Data`; the web reads the file's text. Throws on a file of the wrong shape. */
  parseImport(text: string): StreamWeekOverrides<K['TeamOverride'], K['PlayerOverride']>
  /** Notes specific to this stream's sources, shown under the list. */
  sourceNotes(teams: Readonly<Record<string, K['Team']>>): string[]
  /** `StreamOverride.isEmpty` for each override type. */
  isTeamOverrideEmpty(change: K['TeamOverride']): boolean
  isPlayerOverrideEmpty(change: K['PlayerOverride']): boolean
  /** Turns a decoded snapshot candidate back into its in-memory shape (maps). */
  reviveCandidate?(raw: unknown): K['Candidate']
}

// MARK: - Practice status

/**
 * The official report first — a game designation outranks a practice line —
 * then Sleeper's own injury tag. Shared by every stream.
 */
export function streamPracticeStatus(player: IndexedPlayer, context: LeagueContext): StreamPractice {
  const report = context.practiceReport(player.id)
  if (report) {
    switch (report.designation) {
      case 'Out': return 'OUT'
      case 'Doubtful': return 'D'
      case 'Questionable': return 'Q'
      case undefined: break
    }
    switch (report.practice) {
      case 'DNP': return 'DNP'
      case 'LTD': return 'LP'
      case 'FULL': return 'FP'
      case undefined: break
    }
  }
  switch (player.injuryStatus?.toLowerCase()) {
    case 'ir': case 'pup': case 'pup-r': case 'nfi': case 'nfi-r': return 'IR'
    case 'out': case 'sus': case 'cov': return 'OUT'
    case 'doubtful': return 'D'
    case 'questionable': return 'Q'
    default: return 'none'
  }
}

/** One row in the any-player pickers. */
export interface StreamPickerRow {
  id: string
  name: string
  team?: string
  platform?: Position
  roleLabel?: string
  availability: Availability
  /** `undefined` until he has been projected this session. */
  projected?: number
}

// MARK: - Shared helpers for the kinds

/** Weeks with stats that are over: every week before the one being played. */
export function completedStatWeeks(context: LeagueContext): number[] {
  return [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => a - b)
}

/** Swift `Array.suffix(3)` mean; `undefined` for an empty array. */
export function meanOfLast3(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined
  const window = xs.slice(-3)
  return window.reduce((s, v) => s + v, 0) / window.length
}

/** A JSON object (not an array), as `as? [String: Any]` reads it. */
export function isJSONObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** `(value as? NSNumber)?.doubleValue` — JSON booleans are NSNumbers too. */
export function jsonNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  return undefined
}

/** `as? String`. */
export const jsonString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Drops `undefined` members, so a stored override reads like Swift's encoded one. */
export function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
