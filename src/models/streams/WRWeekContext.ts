/**
 * WR Stream's game context — a port of FCApp `WRWeekContext.swift`: one
 * team's passing-game environment, the user's overrides, the autofill from
 * schedule lines and the defense table, and the context-file import.
 */
import { dvpCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines, type ScheduleFile } from '@core/Schedule'
import { isStreamPractice, type StreamPractice } from '@core/Stream'
import { isWRRole, type WRRole } from '@core/streams/WRStream'
import {
  isJSONObject, jsonNumber, jsonString, opponentLabel, stripUndefined, type StreamContextSource, type StreamWeekOverrides,
} from './StreamKind'

/** One NFL team's passing-game environment this week, from its offense's side. */
export interface WRTeamContext {
  /** nflverse team code. */
  team: string
  /** nflverse code of the defense this offense faces. */
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog (so it throws more). */
  spreadOff: number
  total: number
  /** Points the opposing defense allows to WRs, % above (+) or below average. */
  dvpPct?: number
  dvpGames: number
  /**
   * 1.0 neutral; below for a shadow corner or elite man coverage, above for
   * an injured secondary or zone-heavy defense.
   */
  coverageAdj: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  coverageSource: StreamContextSource
}

export const wrTeamID = (t: WRTeamContext) => t.team
export const wrTeamSpread = (t: WRTeamContext) => t.spreadOff
export const wrOpponentLabel = (t: WRTeamContext) => opponentLabel(t)

/** A manual or imported change to one team's WR context. `undefined` keeps the auto value. */
export interface WRTeamOverride {
  spreadOff?: number
  total?: number
  dvpPct?: number
  dvpGames?: number
  coverageAdj?: number
  source: StreamContextSource
}

export function wrTeamOverride(values: Partial<WRTeamOverride> = {}): WRTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isWRTeamOverrideEmpty = (o: WRTeamOverride) =>
  o.spreadOff === undefined && o.total === undefined && o.dvpPct === undefined && o.dvpGames === undefined && o.coverageAdj === undefined

/** A manual change to one receiver's inputs, keyed by Sleeper id. */
export interface WRPlayerOverride {
  role?: WRRole
  practice?: StreamPractice
  roleConf?: number
  redZoneShare?: number
  targetShareEst?: number
  rushAttemptsPerGame?: number
  notes?: string
}

export const isWRPlayerOverrideEmpty = (o: WRPlayerOverride) =>
  o.role === undefined && o.practice === undefined && o.roleConf === undefined && o.redZoneShare === undefined
    && o.targetShareEst === undefined && o.rushAttemptsPerGame === undefined && (o.notes ?? '').length === 0

export type WRWeekOverrides = StreamWeekOverrides<WRTeamOverride, WRPlayerOverride>

// MARK: - Autofill

export const WR_NEUTRAL_TOTAL = 45.0

/**
 * Every team playing `week`, filled from the schedule's recorded lines and
 * the Sleeper side of the defense-vs-position table (points WRs scored
 * against each defense), over the table's sample floor.
 */
export function buildWRContext(schedule: ScheduleFile, week: number, defense: DefenseVsPositionTable): Record<string, WRTeamContext> {
  const out: Record<string, WRTeamContext> = {}
  for (const [team, line] of Object.entries(weekLines(schedule, week))) {
    let dvp: number | undefined
    let games = 0
    const cell = dvpCell(defense, line.opponent, 'WR')
    const average = defense.leagueAverage.WR
    if (cell && cell.rank !== undefined && cell.perGame !== undefined && average !== undefined && average > 0) {
      dvp = (cell.perGame / average - 1) * 100
      games = cell.games
    }
    const hasLines = line.spread !== undefined && line.total !== undefined
    out[team] = {
      team,
      opponent: line.opponent,
      home: line.isHome,
      // TeamGameLine.spread is negative when this team is favored,
      // which is the engine's spreadOff convention (+ = underdog).
      spreadOff: line.spread ?? 0,
      total: line.total ?? WR_NEUTRAL_TOTAL,
      dvpPct: dvp,
      dvpGames: games,
      coverageAdj: 1,
      linesSource: hasLines ? 'schedule' : 'standard',
      dvpSource: dvp === undefined ? 'standard' : 'sleeperDvP',
      coverageSource: 'standard',
    }
  }
  return out
}

export function applyWRContext(overrides: Readonly<Record<string, WRTeamOverride>>, teams: Readonly<Record<string, WRTeamContext>>): Record<string, WRTeamContext> {
  const out: Record<string, WRTeamContext> = { ...teams }
  for (const [team, change] of Object.entries(overrides)) {
    const current = out[team]
    if (!current || isWRTeamOverrideEmpty(change)) continue
    const context = { ...current }
    if (change.spreadOff !== undefined) { context.spreadOff = change.spreadOff; context.linesSource = change.source }
    if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
    if (change.dvpPct !== undefined) {
      context.dvpPct = change.dvpPct
      context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
      context.dvpSource = change.source
    }
    if (change.coverageAdj !== undefined) { context.coverageAdj = change.coverageAdj; context.coverageSource = change.source }
    out[team] = context
  }
  return out
}

// MARK: - Import

export class WRContextImportError extends Error {
  constructor() {
    super('That file is not a WR context file (expected a "teams" object).')
    this.name = 'WRContextImportError'
  }
}

/**
 * Reads a WR context file in the IDP tool's shape: teams keyed by code, each
 * with `spreadOff` (or `spreadDef`), `total`, `dvpPct` (a number, or
 * `{ "WR": n }`), `dvpGames`, `coverageAdj` (or the shared file's
 * `wrCoverageAdj`); players keyed by Sleeper id. Keys starting with `_` are
 * comments.
 */
export function parseWRContext(text: string): WRWeekOverrides {
  const root: unknown = JSON.parse(text)
  if (!isJSONObject(root) || !isJSONObject(root.teams)) throw new WRContextImportError()
  const out: WRWeekOverrides = { teams: {}, players: {} }
  for (const [key, value] of Object.entries(root.teams)) {
    if (key.startsWith('_')) continue
    const team = nflverseTeam(key.toUpperCase())
    if (!isJSONObject(value) || team === undefined) continue
    const row = value
    const dvp = jsonNumber(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? jsonNumber(row.dvpPct.WR) : undefined)
    const games = jsonNumber(row.dvpGames)
    const change = wrTeamOverride({
      spreadOff: jsonNumber(row.spreadOff) ?? jsonNumber(row.spreadDef),
      total: jsonNumber(row.total), dvpPct: dvp,
      dvpGames: games === undefined ? undefined : Math.trunc(games),
      coverageAdj: jsonNumber(row.coverageAdj) ?? jsonNumber(row.wrCoverageAdj),
      source: 'imported',
    })
    if (!isWRTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
  }
  if (isJSONObject(root.players)) {
    for (const [id, value] of Object.entries(root.players)) {
      if (id.startsWith('_') || !isJSONObject(value)) continue
      const row = value
      const role = jsonString(row.role)
      const practice = jsonString(row.practice)
      const change: WRPlayerOverride = {
        role: role !== undefined && isWRRole(role) ? role : undefined,
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        roleConf: jsonNumber(row.roleConf),
        redZoneShare: jsonNumber(row.rzShare),
        targetShareEst: jsonNumber(row.tgtShareEst),
        rushAttemptsPerGame: jsonNumber(row.rushAttPg),
        notes: jsonString(row.notes),
      }
      if (!isWRPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
  }
  return out
}
