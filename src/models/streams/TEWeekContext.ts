/**
 * TE Stream's game context — a port of FCApp `TEWeekContext.swift`: one
 * team's passing-game environment, the user's overrides, the autofill from
 * schedule lines and the defense table, and the context-file import.
 */
import { dvpCell, type DefenseVsPositionTable } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines, type ScheduleFile } from '@core/Schedule'
import { isStreamPractice, type StreamPractice } from '@core/Stream'
import { isTERole, type TERole } from '@core/streams/TEStream'
import {
  isJSONObject, jsonNumber, jsonString, opponentLabel, stripUndefined, type StreamContextSource, type StreamWeekOverrides,
} from './StreamKind'

/**
 * One NFL team's passing-game environment this week, from its offense's side,
 * as it bears on its tight ends.
 */
export interface TETeamContext {
  /** nflverse team code. */
  team: string
  /** nflverse code of the defense this offense faces. */
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog (so it throws more). */
  spreadOff: number
  total: number
  /** Points the opposing defense allows to TEs, % above (+) or below average. */
  dvpPct?: number
  dvpGames: number
  /**
   * 1.0 neutral; above when the opponent's linebackers or safeties are hurt
   * or weak in coverage, below against a strong coverage linebacker or safety.
   */
  seamCoverageAdj: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  seamCoverageSource: StreamContextSource
}

export const teTeamID = (t: TETeamContext) => t.team
export const teTeamSpread = (t: TETeamContext) => t.spreadOff
export const teOpponentLabel = (t: TETeamContext) => opponentLabel(t)

/** A manual or imported change to one team's TE context. `undefined` keeps the auto value. */
export interface TETeamOverride {
  spreadOff?: number
  total?: number
  dvpPct?: number
  dvpGames?: number
  seamCoverageAdj?: number
  source: StreamContextSource
}

export function teTeamOverride(values: Partial<TETeamOverride> = {}): TETeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isTETeamOverrideEmpty = (o: TETeamOverride) =>
  o.spreadOff === undefined && o.total === undefined && o.dvpPct === undefined && o.dvpGames === undefined && o.seamCoverageAdj === undefined

/** A manual change to one tight end's inputs, keyed by Sleeper id. */
export interface TEPlayerOverride {
  role?: TERole
  practice?: StreamPractice
  roleConf?: number
  redZoneShare?: number
  targetShareEst?: number
  /** Share of targets freed up by an injured teammate (WR1, the other TE); capped at 0.10. */
  vacatedTargetBoost?: number
  notes?: string
}

export const isTEPlayerOverrideEmpty = (o: TEPlayerOverride) =>
  o.role === undefined && o.practice === undefined && o.roleConf === undefined && o.redZoneShare === undefined
    && o.targetShareEst === undefined && o.vacatedTargetBoost === undefined && (o.notes ?? '').length === 0

export type TEWeekOverrides = StreamWeekOverrides<TETeamOverride, TEPlayerOverride>

// MARK: - Autofill

export const TE_NEUTRAL_TOTAL = 45.0

/**
 * Every team playing `week`, filled from the schedule's recorded lines and
 * the Sleeper side of the defense-vs-position table (points TEs scored
 * against each defense), over the table's sample floor. Seam coverage
 * starts neutral.
 */
export function buildTEContext(schedule: ScheduleFile, week: number, defense: DefenseVsPositionTable): Record<string, TETeamContext> {
  const out: Record<string, TETeamContext> = {}
  for (const [team, line] of Object.entries(weekLines(schedule, week))) {
    let dvp: number | undefined
    let games = 0
    const cell = dvpCell(defense, line.opponent, 'TE')
    const average = defense.leagueAverage.TE
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
      total: line.total ?? TE_NEUTRAL_TOTAL,
      dvpPct: dvp,
      dvpGames: games,
      seamCoverageAdj: 1,
      linesSource: hasLines ? 'schedule' : 'standard',
      dvpSource: dvp === undefined ? 'standard' : 'sleeperDvP',
      seamCoverageSource: 'standard',
    }
  }
  return out
}

export function applyTEContext(overrides: Readonly<Record<string, TETeamOverride>>, teams: Readonly<Record<string, TETeamContext>>): Record<string, TETeamContext> {
  const out: Record<string, TETeamContext> = { ...teams }
  for (const [team, change] of Object.entries(overrides)) {
    const current = out[team]
    if (!current || isTETeamOverrideEmpty(change)) continue
    const context = { ...current }
    if (change.spreadOff !== undefined) { context.spreadOff = change.spreadOff; context.linesSource = change.source }
    if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
    if (change.dvpPct !== undefined) {
      context.dvpPct = change.dvpPct
      context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
      context.dvpSource = change.source
    }
    if (change.seamCoverageAdj !== undefined) { context.seamCoverageAdj = change.seamCoverageAdj; context.seamCoverageSource = change.source }
    out[team] = context
  }
  return out
}

// MARK: - Import

export class TEContextImportError extends Error {
  constructor() {
    super('That file is not a TE context file (expected a "teams" object).')
    this.name = 'TEContextImportError'
  }
}

/**
 * Reads a TE context file in the IDP tool's shape: teams keyed by code, each
 * with `spreadOff` (or `spreadDef`), `total`, `dvpPct` (a number, or
 * `{ "TE": n }`), `dvpGames`, `seamCoverageAdj` (or the shared file's
 * `teCoverageAdj`); players keyed by Sleeper id. Keys starting with `_` are
 * comments.
 */
export function parseTEContext(text: string): TEWeekOverrides {
  const root: unknown = JSON.parse(text)
  if (!isJSONObject(root) || !isJSONObject(root.teams)) throw new TEContextImportError()
  const out: TEWeekOverrides = { teams: {}, players: {} }
  for (const [key, value] of Object.entries(root.teams)) {
    if (key.startsWith('_')) continue
    const team = nflverseTeam(key.toUpperCase())
    if (!isJSONObject(value) || team === undefined) continue
    const row = value
    const dvp = jsonNumber(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? jsonNumber(row.dvpPct.TE) : undefined)
    const games = jsonNumber(row.dvpGames)
    const change = teTeamOverride({
      spreadOff: jsonNumber(row.spreadOff) ?? jsonNumber(row.spreadDef),
      total: jsonNumber(row.total), dvpPct: dvp,
      dvpGames: games === undefined ? undefined : Math.trunc(games),
      seamCoverageAdj: jsonNumber(row.seamCoverageAdj) ?? jsonNumber(row.teCoverageAdj),
      source: 'imported',
    })
    if (!isTETeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
  }
  if (isJSONObject(root.players)) {
    for (const [id, value] of Object.entries(root.players)) {
      if (id.startsWith('_') || !isJSONObject(value)) continue
      const row = value
      const role = jsonString(row.role)
      const practice = jsonString(row.practice)
      const change: TEPlayerOverride = {
        role: role !== undefined && isTERole(role) ? role : undefined,
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        roleConf: jsonNumber(row.roleConf),
        redZoneShare: jsonNumber(row.rzShare),
        targetShareEst: jsonNumber(row.tgtShareEst),
        vacatedTargetBoost: jsonNumber(row.vacatedTargetBoost),
        notes: jsonString(row.notes),
      }
      if (!isTEPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
  }
  return out
}
