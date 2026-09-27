/**
 * D/ST Stream's part of the shared stream screen — a port of FCApp
 * `DSTStreamKind.swift`.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines } from '@core/Schedule'
import {
  dstScoringFromSleeper, dstUnmodelledKeys, projectDST,
  type DSTCandidate, type DSTProjection, type DSTScoring,
} from '@core/streams/DSTStream'
import { scoreLine } from '@data/insightsModels'
import { playerNflverseTeam, playersAt } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { StreamImport, reviveScheduleCandidate } from './QBStreamKind'
import { SleeperTeamTotals, emptyOffense, offenseDropbacks, offensePlays } from './SleeperTeamTotals'
import { StreamScreenModel } from './StreamScreenModel'
import {
  isJSONObject, jsonString, opponentLabel, stripUndefined,
  type StreamContextSource, type StreamKind, type StreamWeekOverrides,
} from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'

/** One team defense's game this week. */
export interface DSTTeamContext {
  /** The defense. */
  team: string
  /** The offense it faces. */
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog. */
  spreadDef: number
  total: number
  /** Backup QB or O-line injuries: above 1 means more giveaways. */
  oppQbAdj: number
  /** Fantasy points the opposing offense gives up to D/STs, % vs average. */
  dvpPct?: number
  dvpGames: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  qbSource: StreamContextSource
  /**
   * Every offense's generosity to D/STs, and its points per game — the
   * rest-of-season inputs.
   */
  leagueGenerosity: Record<string, number>
  leaguePointsPerGame: Record<string, number>
}

export const dstTeamSpread = (t: DSTTeamContext) => t.spreadDef
/** Points the opponent is expected to score. */
export const dstOpponentImplied = (t: DSTTeamContext) => (t.total + t.spreadDef) / 2
export const dstOpponentLabel = (t: DSTTeamContext) => opponentLabel(t)

export interface DSTTeamOverride {
  spreadDef?: number
  total?: number
  oppQbAdj?: number
  dvpPct?: number
  dvpGames?: number
  source: StreamContextSource
}

export function dstTeamOverride(values: Partial<DSTTeamOverride> = {}): DSTTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isDSTTeamOverrideEmpty = (o: DSTTeamOverride) =>
  o.spreadDef === undefined && o.total === undefined && o.oppQbAdj === undefined && o.dvpPct === undefined && o.dvpGames === undefined

export interface DSTPlayerOverride {
  notes?: string
}

export const isDSTPlayerOverrideEmpty = (o: DSTPlayerOverride) => (o.notes ?? '').length === 0

export type DSTWeekOverrides = StreamWeekOverrides<DSTTeamOverride, DSTPlayerOverride>

export interface DSTGameLine {
  week: number
  opponent?: string
  points: number
  sacks: number
  takeaways: number
  touchdowns: number
  pointsAllowed: number
}

/**
 * Each offense's generosity to team defenses: the fantasy points the
 * defenses it faced scored in this league, against the league average.
 */
export function dstGenerosity(totals: SleeperTeamTotals, scoring: Readonly<Record<string, number>>): { pct: Record<string, number>; games: Record<string, number> } {
  const byOffense = new Map<string, number[]>()
  for (const [defense, lines] of totals.defenseLines) {
    for (const [week, line] of lines) {
      const offense = totals.opponents.get(defense)?.get(week)
      if (offense === undefined) continue
      let points = byOffense.get(offense)
      if (!points) { points = []; byOffense.set(offense, points) }
      points.push(scoreLine(line, scoring).points)
    }
  }
  const all = [...byOffense.values()].flat()
  if (all.length === 0) return { pct: {}, games: {} }
  const average = all.reduce((s, v) => s + v, 0) / all.length
  if (!(average > 0)) return { pct: {}, games: {} }
  const pct: Record<string, number> = {}, games: Record<string, number> = {}
  for (const [offense, points] of byOffense) {
    pct[offense] = (points.reduce((s, v) => s + v, 0) / points.length / average - 1) * 100
    games[offense] = points.length
  }
  return { pct, games }
}

export interface DSTStreamTypes {
  Candidate: DSTCandidate
  Projection: DSTProjection
  Scoring: DSTScoring
  Team: DSTTeamContext
  TeamOverride: DSTTeamOverride
  PlayerOverride: DSTPlayerOverride
  GameLine: DSTGameLine
}

/** D/ST Stream's part of the shared stream screen. */
export const DSTStreamKind: StreamKind<DSTStreamTypes> = {
  storeFolder: 'DSTStream',
  positions: ['DEF'],
  playerNoun: 'defense',
  emptyScoring: {
    sack: 0, interception: 0, fumbleRecovery: 0, forcedFumble: 0, touchdown: 0, safety: 0, block: 0,
    pointsAllowed: [], yardsAllowed: [],
  },
  usesHorizon: true,

  scoring: (settings) => dstScoringFromSleeper(settings),
  unmodelledKeys: (settings) => dstUnmodelledKeys(settings),

  autofill(context, _defense) {
    const totals = new SleeperTeamTotals(context)
    const scoring = context.league.scoringSettings ?? {}
    const generosity = dstGenerosity(totals, scoring)
    const ppg: Record<string, number> = {}
    for (const team of totals.offense.keys()) {
      const scored = totals.scored(team)
      if (scored.games > 0) ppg[team] = scored.points / scored.games
    }
    const out: Record<string, DSTTeamContext> = {}
    for (const [team, line] of Object.entries(weekLines(context.schedule, context.currentWeek))) {
      const dvp = generosity.pct[line.opponent]
      out[team] = {
        team, opponent: line.opponent, home: line.isHome,
        spreadDef: line.spread ?? 0, total: line.total ?? 45, oppQbAdj: 1,
        dvpPct: dvp, dvpGames: generosity.games[line.opponent] ?? 0,
        linesSource: line.spread !== undefined && line.total !== undefined ? 'schedule' : 'standard',
        dvpSource: dvp === undefined ? 'standard' : 'sleeperDvP', qbSource: 'standard',
        leagueGenerosity: generosity.pct, leaguePointsPerGame: ppg,
      }
    }
    return out
  },

  apply(overrides, teams) {
    const out: Record<string, DSTTeamContext> = { ...teams }
    for (const [team, change] of Object.entries(overrides)) {
      const current = out[team]
      if (!current || isDSTTeamOverrideEmpty(change)) continue
      const context = { ...current }
      if (change.spreadDef !== undefined) { context.spreadDef = change.spreadDef; context.linesSource = change.source }
      if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
      if (change.oppQbAdj !== undefined) { context.oppQbAdj = change.oppQbAdj; context.qbSource = change.source }
      if (change.dvpPct !== undefined) {
        context.dvpPct = change.dvpPct
        context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
        context.dvpSource = change.source
      }
      out[team] = context
    }
    return out
  },

  candidates(context: LeagueContext, teams, players, _alwaysInclude) {
    const totals = new SleeperTeamTotals(context)
    const first = Object.values(teams)[0]
    const generosity = first?.leagueGenerosity ?? {}
    const ppg = first?.leaguePointsPerGame ?? {}
    const out: DSTCandidate[] = []
    for (const player of playersAt(context.players, 'DEF')) {
      const team = playerNflverseTeam(player) ?? nflverseTeam(player.id)
      if (team === undefined) continue
      const game = teams[team]
      const lines = totals.defenseLines.get(team) ?? new Map()
      const sum = (key: string) => [...lines.values()].reduce((s, l) => s + (l.stats[key] ?? 0), 0)
      const faced = totals.faced(team)
      const flags: string[] = []
      let opponentStats = { total: emptyOffense(), games: 0 }
      let oppScored = { points: 0, yards: 0, games: 0 }
      if (game) {
        opponentStats = totals.offenseTotal(game.opponent)
        oppScored = totals.scored(game.opponent)
      } else {
        flags.push('bye week')
      }
      if (game?.linesSource === 'standard') flags.push('no recorded line — neutral spread and total')
      out.push({
        name: `${team} D/ST`, team, opp: game ? opponentLabel(game) : 'BYE', home: game?.home,
        spreadDef: game?.spreadDef ?? 0, total: game?.total ?? 45, games: lines.size,
        sacks: sum('sack'), ints: sum('int'), fr: sum('fum_rec'), ff: sum('ff'), defTd: sum('def_td'),
        retTd: sum('def_st_td') + sum('st_td'), safeties: sum('safe'), blocks: sum('blk_kick'),
        paTotal: sum('pts_allow'), yaTotal: sum('yds_allow'),
        dropbacksFaced: offenseDropbacks(faced.total), playsFaced: offensePlays(faced.total),
        oppGames: opponentStats.games, oppDropbacks: offenseDropbacks(opponentStats.total),
        oppPlays: offensePlays(opponentStats.total), oppSacksTaken: opponentStats.total.sacksTaken,
        oppIntsThrown: opponentStats.total.interceptions, oppFumLost: opponentStats.total.fumblesLost,
        oppPpg: oppScored.games > 0 ? oppScored.points / oppScored.games : 22.5,
        oppYpg: oppScored.games > 0 ? oppScored.yards / oppScored.games : 330,
        oppQbAdj: game?.oppQbAdj ?? 1,
        dvpPct: game?.dvpPct ?? 0, dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
        schedule: SleeperTeamTotals.schedule(context.schedule, team), oppDvp: generosity,
        oppPpgMap: ppg, currentWeek: context.currentWeek, practice: game === undefined ? 'OUT' : 'none',
        rosterPct: undefined, available: context.availabilityOf(player.id).kind === 'freeAgent',
        notes: players[player.id]?.notes ?? '', sources: ['Sleeper weekly stats', 'schedule lines'],
        dataFlags: flags, playerID: player.id,
      })
    }
    // All 32 defenses: every one is a candidate every week.
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  },

  project: (candidate, scoring, risk, horizon = 'week') => projectDST(candidate, scoring, risk, horizon),

  recentGames(context: LeagueContext, playerID: string, limit: number): DSTGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: DSTGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line) continue
      const s = line.stats
      out.push({
        week, opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points, sacks: s.sack ?? 0,
        takeaways: (s.int ?? 0) + (s.fum_rec ?? 0),
        touchdowns: (s.def_td ?? 0) + (s.def_st_td ?? 0),
        pointsAllowed: s.pts_allow ?? 0,
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => 'D/ST',

  parseImport(text) {
    const root = StreamImport.root(text)
    const out: DSTWeekOverrides = { teams: {}, players: {} }
    for (const [team, row] of StreamImport.teams(root)) {
      const dvp = StreamImport.number(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? StreamImport.number(row.dvpPct.DST) : undefined)
      const games = StreamImport.number(row.dvpGames)
      const change = dstTeamOverride({
        spreadDef: StreamImport.number(row.spreadDef) ?? StreamImport.number(row.spreadOff),
        total: StreamImport.number(row.total), oppQbAdj: StreamImport.number(row.oppQbAdj),
        dvpPct: dvp, dvpGames: dvp === undefined || games === undefined ? undefined : Math.trunc(games),
        source: 'imported',
      })
      if (!isDSTTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
    }
    for (const [id, row] of StreamImport.players(root)) {
      const change: DSTPlayerOverride = { notes: jsonString(row.notes) }
      if (!isDSTPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
    return out
  },

  sourceNotes: () => [
    "Sacks, interceptions and fumbles blend each defense's rate with the opposing offense's giveaway rate, from Sleeper's lines. Points allowed are scored as an expected value around the opponent's implied total from the recorded closing line.",
    "An offense's generosity to D/STs is the points defenses have scored against it in your scoring. Rest of season adds how many points the remaining offenses score. All heuristic until backtested.",
  ],

  isTeamOverrideEmpty: isDSTTeamOverrideEmpty,
  isPlayerOverrideEmpty: isDSTPlayerOverrideEmpty,
  reviveCandidate: (raw) => reviveScheduleCandidate<DSTCandidate>(raw),
}

export class DSTStreamScreenModel extends StreamScreenModel<DSTStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(DSTStreamKind, loader, store)
  }
}

export type DSTStreamSnapshot = StreamSnapshot<DSTStreamTypes>
