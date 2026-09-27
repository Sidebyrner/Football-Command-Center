/**
 * RB Stream's game context — a port of FCApp `RBWeekContext.swift`: one
 * team's running-game environment, the user's overrides, the autofill from
 * schedule lines and the defense table, and the context-file import.
 */
import { dvpCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines, type ScheduleFile } from '@core/Schedule'
import { isStreamPractice, type StreamPractice } from '@core/Stream'
import { isRBRole, type RBRole } from '@core/streams/RBStream'
import {
  isJSONObject, jsonNumber, jsonString, opponentLabel, stripUndefined, type StreamContextSource, type StreamWeekOverrides,
} from './StreamKind'

/** One NFL team's running-game environment this week, from its offense's side. */
export interface RBTeamContext {
  /** nflverse team code. */
  team: string
  /** nflverse code of the defense this offense faces. */
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog (so it runs less). */
  spreadOff: number
  total: number
  /** Points the opposing defense allows to RBs, % above (+) or below average. */
  dvpPct?: number
  dvpGames: number
  /** O-line / box-count / front-seven-injury adjustment; 1.0 neutral. */
  lineAdj: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  lineSource: StreamContextSource
}

export const rbTeamSpread = (t: RBTeamContext) => t.spreadOff
/** Points this team is expected to score. */
export const rbTeamImplied = (t: RBTeamContext) => (t.total - t.spreadOff) / 2
export const rbOpponentLabel = (t: RBTeamContext) => opponentLabel(t)

/** A manual or imported change to one team's RB context. `undefined` keeps the auto value. */
export interface RBTeamOverride {
  spreadOff?: number
  total?: number
  dvpPct?: number
  dvpGames?: number
  lineAdj?: number
  source: StreamContextSource
}

export function rbTeamOverride(values: Partial<RBTeamOverride> = {}): RBTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isRBTeamOverrideEmpty = (o: RBTeamOverride) =>
  o.spreadOff === undefined && o.total === undefined && o.dvpPct === undefined && o.dvpGames === undefined && o.lineAdj === undefined

/** A manual change to one back's inputs, keyed by Sleeper id. */
export interface RBPlayerOverride {
  role?: RBRole
  practice?: StreamPractice
  roleConf?: number
  redZoneShare?: number
  carryShareEst?: number
  notes?: string
}

export const isRBPlayerOverrideEmpty = (o: RBPlayerOverride) =>
  o.role === undefined && o.practice === undefined && o.roleConf === undefined && o.redZoneShare === undefined
    && o.carryShareEst === undefined && (o.notes ?? '').length === 0

export type RBWeekOverrides = StreamWeekOverrides<RBTeamOverride, RBPlayerOverride>

// MARK: - Autofill

export const RB_NEUTRAL_TOTAL = 45.0

/**
 * Every team playing `week`, from the schedule's recorded lines and the
 * Sleeper side of the defense-vs-position table (points RBs scored against
 * each defense), over the table's sample floor.
 */
export function buildRBContext(schedule: ScheduleFile, week: number, defense: DefenseVsPositionTable): Record<string, RBTeamContext> {
  const out: Record<string, RBTeamContext> = {}
  for (const [team, line] of Object.entries(weekLines(schedule, week))) {
    let dvp: number | undefined
    let games = 0
    const cell = dvpCell(defense, line.opponent, 'RB')
    const average = defense.leagueAverage.RB
    if (cell && cell.rank !== undefined && cell.perGame !== undefined && average !== undefined && average > 0) {
      dvp = (cell.perGame / average - 1) * 100
      games = cell.games
    }
    const hasLines = line.spread !== undefined && line.total !== undefined
    out[team] = {
      team,
      opponent: line.opponent,
      home: line.isHome,
      // Negative when this team is favored — the engine's convention.
      spreadOff: line.spread ?? 0,
      total: line.total ?? RB_NEUTRAL_TOTAL,
      dvpPct: dvp,
      dvpGames: games,
      lineAdj: 1,
      linesSource: hasLines ? 'schedule' : 'standard',
      dvpSource: dvp === undefined ? 'standard' : 'sleeperDvP',
      lineSource: 'standard',
    }
  }
  return out
}

export function applyRBContext(overrides: Readonly<Record<string, RBTeamOverride>>, teams: Readonly<Record<string, RBTeamContext>>): Record<string, RBTeamContext> {
  const out: Record<string, RBTeamContext> = { ...teams }
  for (const [team, change] of Object.entries(overrides)) {
    const current = out[team]
    if (!current || isRBTeamOverrideEmpty(change)) continue
    const context = { ...current }
    if (change.spreadOff !== undefined) { context.spreadOff = change.spreadOff; context.linesSource = change.source }
    if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
    if (change.dvpPct !== undefined) {
      context.dvpPct = change.dvpPct
      context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
      context.dvpSource = change.source
    }
    if (change.lineAdj !== undefined) { context.lineAdj = change.lineAdj; context.lineSource = change.source }
    out[team] = context
  }
  return out
}

// MARK: - Import

export class RBContextImportError extends Error {
  constructor() {
    super('That file is not an RB context file (expected a "teams" object).')
    this.name = 'RBContextImportError'
  }
}

/**
 * Reads an RB context file: teams keyed by code, each with `spreadOff` (or
 * the shared file's `spreadDef`), `total`, `dvpPct` (a number, or
 * `{ "RB": n }`), `dvpGames`, and `lineAdj` (or `rbLineAdj`); players keyed by
 * Sleeper id. Keys starting with `_` are comments.
 */
export function parseRBContext(text: string): RBWeekOverrides {
  const root: unknown = JSON.parse(text)
  if (!isJSONObject(root) || !isJSONObject(root.teams)) throw new RBContextImportError()
  const out: RBWeekOverrides = { teams: {}, players: {} }
  for (const [key, value] of Object.entries(root.teams)) {
    if (key.startsWith('_')) continue
    const team = nflverseTeam(key.toUpperCase())
    if (!isJSONObject(value) || team === undefined) continue
    const row = value
    const dvp = jsonNumber(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? jsonNumber(row.dvpPct.RB) : undefined)
    const games = jsonNumber(row.dvpGames)
    const change = rbTeamOverride({
      spreadOff: jsonNumber(row.spreadOff) ?? jsonNumber(row.spreadDef),
      total: jsonNumber(row.total),
      dvpPct: dvp,
      dvpGames: dvp === undefined || games === undefined ? undefined : Math.trunc(games),
      lineAdj: jsonNumber(row.lineAdj) ?? jsonNumber(row.rbLineAdj),
      source: 'imported',
    })
    if (!isRBTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
  }
  if (isJSONObject(root.players)) {
    for (const [id, value] of Object.entries(root.players)) {
      if (id.startsWith('_') || !isJSONObject(value)) continue
      const row = value
      const role = jsonString(row.role)
      const practice = jsonString(row.practice)
      const change: RBPlayerOverride = {
        role: role !== undefined && isRBRole(role) ? role : undefined,
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        roleConf: jsonNumber(row.roleConf),
        redZoneShare: jsonNumber(row.rzShare),
        carryShareEst: jsonNumber(row.carryShareEst),
        notes: jsonString(row.notes),
      }
      if (!isRBPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
  }
  return out
}
