/**
 * IDP Stream's game context — a port of FCApp `IDPWeekContext.swift`: one
 * team's game environment from its defense's side, the user's overrides, the
 * autofill and the reference tool's context-file import.
 */
import { dvpCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import { POSITIONS, type Position } from '@core/Position'
import { weekLines, type ScheduleFile } from '@core/Schedule'
import { isStreamPractice, type StreamPractice } from '@core/Stream'
import { isIDPSubPosition, type IDPSubPosition } from '@core/streams/IDPStream'
import {
  isJSONObject, jsonNumber, jsonString, opponentLabel, stripUndefined, type StreamContextSource, type StreamWeekOverrides,
} from './StreamKind'

/** One NFL team's game environment this week, from its defense's side. */
export interface IDPTeamContext {
  /** nflverse team code. */
  team: string
  /** nflverse code of the offense this defense faces. */
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog. */
  spreadDef: number
  total: number
  /** Opponent generosity to each IDP position, % above (+) or below the average. */
  dvpPct: Partial<Record<Position, number>>
  dvpGames: number
  /** Opponent pass-protection leakiness; 1.0 is average. */
  oppSackEnv: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  sackSource: StreamContextSource
}

export const idpTeamSpread = (t: IDPTeamContext) => t.spreadDef
/** "@NYG" or "vs NYG". */
export const idpOpponentLabel = (t: IDPTeamContext) => opponentLabel(t)

/** A manual or imported change to one team's context. `undefined` keeps the auto value. */
export interface IDPTeamOverride {
  spreadDef?: number
  total?: number
  dvpPct?: Partial<Record<Position, number>>
  dvpGames?: number
  oppSackEnv?: number
  source: StreamContextSource
}

export function idpTeamOverride(values: Partial<IDPTeamOverride> = {}): IDPTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isIDPTeamOverrideEmpty = (o: IDPTeamOverride) =>
  o.spreadDef === undefined && o.total === undefined && o.dvpPct === undefined && o.dvpGames === undefined && o.oppSackEnv === undefined

/** A manual change to one player's inputs, keyed by Sleeper id. */
export interface IDPPlayerOverride {
  position?: IDPSubPosition
  roleConf?: number
  practice?: StreamPractice
  snapShareEst?: number
  pressures?: number
  notes?: string
}

export const isIDPPlayerOverrideEmpty = (o: IDPPlayerOverride) =>
  o.position === undefined && o.roleConf === undefined && o.practice === undefined && o.snapShareEst === undefined
    && o.pressures === undefined && (o.notes ?? '').length === 0

/** Everything the user has changed for one week of IDP Stream. */
export type IDPWeekOverrides = StreamWeekOverrides<IDPTeamOverride, IDPPlayerOverride>

// MARK: - Autofill

/** Neutral values used when a game has no recorded line. */
export const IDP_NEUTRAL_TOTAL = 45.0

/**
 * Every team playing `week`, filled from the schedule's recorded lines and
 * the Sleeper side of the defense-vs-position table.
 *
 * The IDP half of that table is keyed by the *offense* a defender faced —
 * it is built from IDP lines with `defense: line.opponent` — which is
 * exactly "how many IDP points does this offense give up", the matchup
 * number wanted here.
 */
export function buildIDPContext(schedule: ScheduleFile, week: number, defense: DefenseVsPositionTable): Record<string, IDPTeamContext> {
  const out: Record<string, IDPTeamContext> = {}
  for (const [team, line] of Object.entries(weekLines(schedule, week))) {
    const dvp: Partial<Record<Position, number>> = {}
    let games = 0
    for (const position of ['LB', 'DL', 'DB'] as const) {
      // Only defenses over the table's sample floor are ranked and
      // averaged; below it there is no matchup claim to make.
      const cell = dvpCell(defense, line.opponent, position)
      const average = defense.leagueAverage[position]
      if (!cell || cell.rank === undefined || cell.perGame === undefined || average === undefined || !(average > 0)) continue
      dvp[position] = (cell.perGame / average - 1) * 100
      games = Math.max(games, cell.games)
    }
    const empty = Object.keys(dvp).length === 0
    const hasLines = line.spread !== undefined && line.total !== undefined
    out[team] = {
      team,
      opponent: line.opponent,
      home: line.isHome,
      // TeamGameLine.spread is negative when this team is favored,
      // which is the engine's convention (+ = underdog) as-is.
      spreadDef: line.spread ?? 0,
      total: line.total ?? IDP_NEUTRAL_TOTAL,
      dvpPct: dvp,
      dvpGames: empty ? 0 : games,
      oppSackEnv: 1,
      linesSource: hasLines ? 'schedule' : 'standard',
      dvpSource: empty ? 'standard' : 'sleeperDvP',
      sackSource: 'standard',
    }
  }
  return out
}

/** Applies the user's overrides on top of the auto values. */
export function applyIDPContext(overrides: Readonly<Record<string, IDPTeamOverride>>, teams: Readonly<Record<string, IDPTeamContext>>): Record<string, IDPTeamContext> {
  const out: Record<string, IDPTeamContext> = { ...teams }
  for (const [team, change] of Object.entries(overrides)) {
    const current = out[team]
    if (!current || isIDPTeamOverrideEmpty(change)) continue
    const context = { ...current }
    if (change.spreadDef !== undefined) { context.spreadDef = change.spreadDef; context.linesSource = change.source }
    if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
    if (change.dvpPct !== undefined) {
      context.dvpPct = { ...change.dvpPct }
      context.dvpGames = change.dvpGames ?? context.dvpGames
      context.dvpSource = change.source
    }
    if (change.oppSackEnv !== undefined) { context.oppSackEnv = change.oppSackEnv; context.sackSource = change.source }
    out[team] = context
  }
  return out
}

// MARK: - Import

export class IDPContextImportError extends Error {
  constructor() {
    super('That file is not an IDP context file (expected a "teams" object).')
    this.name = 'IDPContextImportError'
  }
}

const isPosition = (code: string): code is Position => (POSITIONS as readonly string[]).includes(code)

/**
 * Reads the reference tool's `WeekContext` JSON — teams keyed by code, each
 * with `spreadDef`, `total`, `dvpPct` {LB, DL, DB}, `dvpGames`, `oppSackEnv`;
 * players keyed by Sleeper id. Keys starting with `_` are comments.
 */
export function parseIDPContext(text: string): IDPWeekOverrides {
  const root: unknown = JSON.parse(text)
  if (!isJSONObject(root) || !isJSONObject(root.teams)) throw new IDPContextImportError()
  const out: IDPWeekOverrides = { teams: {}, players: {} }
  for (const [key, value] of Object.entries(root.teams)) {
    if (key.startsWith('_')) continue
    const team = nflverseTeam(key.toUpperCase())
    if (!isJSONObject(value) || team === undefined) continue
    const row = value
    let dvp: Partial<Record<Position, number>> | undefined
    if (isJSONObject(row.dvpPct)) {
      dvp = {}
      for (const [code, pct] of Object.entries(row.dvpPct)) {
        const upper = code.toUpperCase()
        const n = jsonNumber(pct)
        if (isPosition(upper) && n !== undefined) dvp[upper] = n
      }
    }
    const games = jsonNumber(row.dvpGames)
    const change = idpTeamOverride({
      spreadDef: jsonNumber(row.spreadDef), total: jsonNumber(row.total), dvpPct: dvp,
      dvpGames: games === undefined ? undefined : Math.trunc(games), oppSackEnv: jsonNumber(row.oppSackEnv),
      source: 'imported',
    })
    if (!isIDPTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
  }
  if (isJSONObject(root.players)) {
    for (const [id, value] of Object.entries(root.players)) {
      if (id.startsWith('_') || !isJSONObject(value)) continue
      const row = value
      const pos = jsonString(row.pos)
      const practice = jsonString(row.practice)
      const change: IDPPlayerOverride = {
        position: pos !== undefined && isIDPSubPosition(pos) ? pos : undefined,
        roleConf: jsonNumber(row.roleConf),
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        snapShareEst: jsonNumber(row.snapShareEst),
        pressures: jsonNumber(row.pressures),
        notes: jsonString(row.notes),
      }
      if (!isIDPPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
  }
  return out
}
