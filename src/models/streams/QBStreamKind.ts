/**
 * QB Stream's part of the shared stream screen — a port of FCApp
 * `QBStreamKind.swift`: the team context, overrides, candidate builder, the
 * kind itself, and the shared `StreamImport` reader the QB, D/ST and K
 * streams use.
 */
import { DEFAULT_MINIMUM_GAMES, dvpCell } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines } from '@core/Schedule'
import { clamp, intKeyed, isStreamPractice, type StreamPractice } from '@core/Stream'
import {
  QB_KNOBS, QB_ROLES, projectQB, qbScoringFromSleeper, qbUnmodelledKeys,
  type QBCandidate, type QBProjection, type QBRole, type QBScoring,
} from '@core/streams/QBStream'
import { played, scoreLine } from '@data/insightsModels'
import { playerNflverseTeam, playersAt, type IndexedPlayer } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { SleeperTeamTotals, offenseDropbacks } from './SleeperTeamTotals'
import { StreamScreenModel } from './StreamScreenModel'
import {
  isJSONObject, jsonNumber, jsonString, opponentLabel, streamPracticeStatus, stripUndefined,
  type StreamContextSource, type StreamKind, type StreamWeekOverrides,
} from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'

// MARK: - Team context

/** One team's passing game this week, from its offense's side. */
export interface QBTeamContext {
  team: string
  opponent: string
  home?: boolean
  /** Positive when this team is the underdog (so it throws more). */
  spreadOff: number
  total: number
  /** Points the opposing defense allows to QBs, % vs average. */
  dvpPct?: number
  dvpGames: number
  /** Completion rate the opposing defense allows (0–1). */
  oppCompAllowed?: number
  /** Sacks per dropback the opposing defense gets. */
  oppSackRate?: number
  /** Interceptions per attempt the opposing defense gets. */
  oppIntRate?: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  ratesSource: StreamContextSource
  /** Every defense's generosity to QBs, % vs average — the rest-of-season input. */
  leagueGenerosity: Record<string, number>
}

export const qbTeamSpread = (t: QBTeamContext) => t.spreadOff
export const qbTeamImplied = (t: QBTeamContext) => (t.total - t.spreadOff) / 2
export const qbOpponentLabel = (t: QBTeamContext) => opponentLabel(t)

export interface QBTeamOverride {
  spreadOff?: number
  total?: number
  dvpPct?: number
  dvpGames?: number
  oppCompAllowed?: number
  oppSackRate?: number
  oppIntRate?: number
  source: StreamContextSource
}

export function qbTeamOverride(values: Partial<QBTeamOverride> = {}): QBTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isQBTeamOverrideEmpty = (o: QBTeamOverride) =>
  o.spreadOff === undefined && o.total === undefined && o.dvpPct === undefined && o.dvpGames === undefined
    && o.oppCompAllowed === undefined && o.oppSackRate === undefined && o.oppIntRate === undefined

export interface QBPlayerOverride {
  role?: QBRole
  practice?: StreamPractice
  starterConf?: number
  notes?: string
}

export const isQBPlayerOverrideEmpty = (o: QBPlayerOverride) =>
  o.role === undefined && o.practice === undefined && o.starterConf === undefined && (o.notes ?? '').length === 0

export type QBWeekOverrides = StreamWeekOverrides<QBTeamOverride, QBPlayerOverride>

/** One completed game, for the comparison's recent-form rows. */
export interface QBGameLine {
  week: number
  opponent?: string
  points: number
  completions: number
  attempts: number
  yards: number
  touchdowns: number
  interceptions: number
  sacks: number
  rushYards: number
}

// MARK: - Import

/**
 * Reading a stream context file: `teams` keyed by team code, `players` by
 * Sleeper id; keys starting with `_` are comments.
 */
export class StreamImportError extends Error {
  constructor() {
    super('That file is not a stream context file (expected a "teams" object).')
    this.name = 'StreamImportError'
  }
}

export const StreamImport = {
  root(text: string): Record<string, unknown> {
    const root: unknown = JSON.parse(text)
    if (!isJSONObject(root) || !(Object.prototype.hasOwnProperty.call(root, 'teams') || Object.prototype.hasOwnProperty.call(root, 'players'))) {
      throw new StreamImportError()
    }
    return root
  },

  teams(root: Record<string, unknown>): [string, Record<string, unknown>][] {
    const teams = isJSONObject(root.teams) ? root.teams : {}
    const out: [string, Record<string, unknown>][] = []
    for (const [key, value] of Object.entries(teams)) {
      if (key.startsWith('_') || !isJSONObject(value)) continue
      const team = nflverseTeam(key.toUpperCase())
      if (team === undefined) continue
      out.push([team, value])
    }
    return out
  },

  players(root: Record<string, unknown>): [string, Record<string, unknown>][] {
    const players = isJSONObject(root.players) ? root.players : {}
    const out: [string, Record<string, unknown>][] = []
    for (const [key, value] of Object.entries(players)) {
      if (key.startsWith('_') || !isJSONObject(value)) continue
      out.push([key, value])
    }
    return out
  },

  number: jsonNumber,
}

// MARK: - Candidates

/** Quarterbacks with a real role, or on the user's roster, as QB candidates. */
export class QBCandidateBuilder {
  constructor(
    readonly context: LeagueContext,
    readonly teams: Readonly<Record<string, QBTeamContext>>,
    readonly players: Readonly<Record<string, QBPlayerOverride>>,
    readonly alwaysInclude: ReadonlySet<string>,
  ) {}

  candidates(): QBCandidate[] {
    const totals = new SleeperTeamTotals(this.context)
    const league = totals.leagueRates
    const generosity = Object.values(this.teams)[0]?.leagueGenerosity ?? {}
    const mine = new Set(this.context.userTeam?.roster.map((e) => e.id) ?? [])
    return playersAt(this.context.players, 'QB')
      .map((p) => this.candidate(p, totals, league, generosity, mine.has(p.id)))
      .filter((c): c is QBCandidate => c !== undefined)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  private candidate(player: IndexedPlayer, totals: SleeperTeamTotals, league: { comp: number; sack: number; int: number },
    generosity: Record<string, number>, isMine: boolean): QBCandidate | undefined {
    const context = this.context
    const team = playerNflverseTeam(player)
    if (team === undefined) return undefined
    const override = this.players[player.id]
    let att = 0, comp = 0, yds = 0, td = 0, ints = 0, sacks = 0, fd = 0, sawFd = false
    let pickSix = 0, c40 = 0, c50 = 0, c30 = 0, saw30 = false
    let rushAtt = 0, rushYd = 0, rushTd = 0, rushFd = 0, sawRushFd = false, fumLost = 0
    let games = 0
    let lastShare: number | undefined
    for (const week of totals.weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(player.id)
      if (!line) continue
      const s = line.stats
      const a = s.pass_att ?? 0, r = s.rush_att ?? 0
      if (!(a > 0 || r > 0 || (s.off_snp ?? 0) > 0)) continue
      games += 1
      att += a; comp += s.pass_cmp ?? 0; yds += s.pass_yd ?? 0; td += s.pass_td ?? 0
      ints += s.pass_int ?? 0; sacks += s.pass_sack ?? 0; pickSix += s.pass_int_td ?? 0
      if (s.pass_fd !== undefined) { fd += s.pass_fd; sawFd = true }
      c40 += s.pass_cmp_40p ?? 0
      c50 += s.pass_cmp_50p ?? 0
      if (s.pass_cmp_30_39 !== undefined) { c30 += s.pass_cmp_30_39; saw30 = true }
      rushAtt += r; rushYd += s.rush_yd ?? 0; rushTd += s.rush_td ?? 0; fumLost += s.fum_lost ?? 0
      if (s.rush_fd !== undefined) { rushFd += s.rush_fd; sawRushFd = true }
      const teamWeek = totals.offense.get(team)?.get(week)
      if (teamWeek && offenseDropbacks(teamWeek) > 0) {
        lastShare = (a + (s.pass_sack ?? 0)) / offenseDropbacks(teamWeek)
      }
    }
    const starter = player.depthChartOrder === 1
    const hasRole = att >= 10 || (lastShare ?? 0) >= 0.5 || starter
    if (!(hasRole || isMine || this.alwaysInclude.has(player.id))) return undefined

    const flags: string[] = []
    let comp30: number
    if (saw30) {
      comp30 = c30 + c40
    } else {
      comp30 = c40 * (QB_KNOBS.prior30 / QB_KNOBS.prior40)
      if (c40 > 0) flags.push('30+ completions estimated from 40+')
    }
    const rushPerGame = games > 0 ? rushAtt / games : 0
    const role: QBRole = override?.role ?? (rushPerGame >= 7 ? 'DUAL' : rushPerGame >= 3.5 ? 'MOBILE' : 'POCKET')
    if (override?.role === undefined) flags.push(games > 0 ? 'role from rushing volume' : 'role defaulted — no games yet')
    const starterConf = override?.starterConf ?? (() => {
      if (lastShare !== undefined) return lastShare >= 0.85 ? 0.95 : clamp(lastShare, 0.3, 0.9)
      return starter ? 0.85 : 0.4
    })()

    const offense = totals.offenseTotal(team)
    const game = this.teams[team]
    let practice = override?.practice ?? streamPracticeStatus(player, context)
    if (game === undefined) {
      practice = 'OUT'
      flags.push('bye week')
    } else if (game.linesSource === 'standard') {
      flags.push('no recorded line — neutral spread and total')
    }
    const sources = ['Sleeper weekly stats', 'schedule lines']
    if (context.practiceReport(player.id) !== undefined) sources.push('nflverse practice report')

    return {
      name: player.name, team, role, opp: game ? opponentLabel(game) : 'BYE', home: game?.home,
      spreadOff: game?.spreadOff ?? 0, total: game?.total ?? 45,
      teamDropbacks: offenseDropbacks(offense.total), teamGames: offense.games, starterConf,
      att, comp, passYd: yds, passTd: td, ints, sacks, passFd: sawFd ? fd : undefined,
      pickSix, comp30p: comp30, comp40p: c40, comp50p: c50, games,
      rushAtt, rushYd, rushTd, rushFd: sawRushFd ? rushFd : undefined, fumblesLost: fumLost,
      dvpPct: game?.dvpPct ?? 0, dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
      oppCompAllowed: game?.oppCompAllowed, oppSackRate: game?.oppSackRate, oppIntRate: game?.oppIntRate,
      leagueComp: league.comp, leagueSack: league.sack, leagueInt: league.int,
      schedule: SleeperTeamTotals.schedule(context.schedule, team), oppDvp: generosity,
      currentWeek: context.currentWeek, practice, rosterPct: undefined,
      available: context.availabilityOf(player.id).kind === 'freeAgent',
      notes: override?.notes ?? '', sources, dataFlags: flags, playerID: player.id,
    }
  }
}

/** A snapshot's candidate, with its week-keyed maps restored. */
export function reviveScheduleCandidate<C extends { schedule: Map<number, string> }>(raw: unknown): C {
  const o = raw as Record<string, unknown>
  const schedule = o.schedule instanceof Map ? o.schedule : intKeyed((o.schedule ?? {}) as Record<string, string>)
  return { ...(o as object), schedule } as C
}

// MARK: - The kind

export interface QBStreamTypes {
  Candidate: QBCandidate
  Projection: QBProjection
  Scoring: QBScoring
  Team: QBTeamContext
  TeamOverride: QBTeamOverride
  PlayerOverride: QBPlayerOverride
  GameLine: QBGameLine
}

export const QBStreamKind: StreamKind<QBStreamTypes> = {
  storeFolder: 'QBStream',
  positions: ['QB'],
  playerNoun: 'quarterback',
  emptyScoring: qbScoringFromSleeper({}),
  usesHorizon: true,

  scoring: (settings) => qbScoringFromSleeper(settings),
  unmodelledKeys: (settings) => qbUnmodelledKeys(settings),

  /**
   * Every team playing this week: the schedule's recorded lines, and what
   * the opposing defense allows to quarterbacks from Sleeper's lines.
   */
  autofill(context, defense) {
    const totals = new SleeperTeamTotals(context)
    const generosity = SleeperTeamTotals.generosity(defense.sleeper, 'QB').pct
    const out: Record<string, QBTeamContext> = {}
    for (const [team, line] of Object.entries(weekLines(context.schedule, context.currentWeek))) {
      let dvp: number | undefined
      let games = 0
      const cell = dvpCell(defense.sleeper, line.opponent, 'QB')
      const average = defense.sleeper.leagueAverage.QB
      if (cell && cell.rank !== undefined && cell.perGame !== undefined && average !== undefined && average > 0) {
        dvp = (cell.perGame / average - 1) * 100
        games = cell.games
      }
      const faced = totals.faced(line.opponent)
      const hasRates = faced.total.passAttempts > 0
      out[team] = {
        team, opponent: line.opponent, home: line.isHome,
        spreadOff: line.spread ?? 0, total: line.total ?? 45, dvpPct: dvp, dvpGames: games,
        oppCompAllowed: hasRates ? faced.total.completions / faced.total.passAttempts : undefined,
        oppSackRate: hasRates ? faced.total.sacksTaken / Math.max(offenseDropbacks(faced.total), 1) : undefined,
        oppIntRate: hasRates ? faced.total.interceptions / faced.total.passAttempts : undefined,
        linesSource: line.spread !== undefined && line.total !== undefined ? 'schedule' : 'standard',
        dvpSource: dvp === undefined ? 'standard' : 'sleeperDvP',
        ratesSource: hasRates ? 'sleeperDvP' : 'standard',
        leagueGenerosity: generosity,
      }
    }
    return out
  },

  apply(overrides, teams) {
    const out: Record<string, QBTeamContext> = { ...teams }
    for (const [team, change] of Object.entries(overrides)) {
      const current = out[team]
      if (!current || isQBTeamOverrideEmpty(change)) continue
      const context = { ...current }
      if (change.spreadOff !== undefined) { context.spreadOff = change.spreadOff; context.linesSource = change.source }
      if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
      if (change.dvpPct !== undefined) {
        context.dvpPct = change.dvpPct
        context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
        context.dvpSource = change.source
      }
      if (change.oppCompAllowed !== undefined) { context.oppCompAllowed = change.oppCompAllowed; context.ratesSource = change.source }
      if (change.oppSackRate !== undefined) { context.oppSackRate = change.oppSackRate; context.ratesSource = change.source }
      if (change.oppIntRate !== undefined) { context.oppIntRate = change.oppIntRate; context.ratesSource = change.source }
      out[team] = context
    }
    return out
  },

  candidates: (context, teams, players, alwaysInclude) => new QBCandidateBuilder(context, teams, players, alwaysInclude).candidates(),

  project: (candidate, scoring, risk, horizon = 'week') => projectQB(candidate, scoring, risk, horizon),

  recentGames(context: LeagueContext, playerID: string, limit: number): QBGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: QBGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line || !played(line)) continue
      const s = line.stats
      out.push({
        week, opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points, completions: s.pass_cmp ?? 0,
        attempts: s.pass_att ?? 0, yards: s.pass_yd ?? 0, touchdowns: s.pass_td ?? 0,
        interceptions: s.pass_int ?? 0, sacks: s.pass_sack ?? 0, rushYards: s.rush_yd ?? 0,
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => undefined,

  parseImport(text) {
    const root = StreamImport.root(text)
    const out: QBWeekOverrides = { teams: {}, players: {} }
    for (const [team, row] of StreamImport.teams(root)) {
      const dvp = StreamImport.number(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? StreamImport.number(row.dvpPct.QB) : undefined)
      const games = StreamImport.number(row.dvpGames)
      const change = qbTeamOverride({
        spreadOff: StreamImport.number(row.spreadOff) ?? StreamImport.number(row.spreadDef),
        total: StreamImport.number(row.total), dvpPct: dvp,
        dvpGames: dvp === undefined || games === undefined ? undefined : Math.trunc(games),
        oppCompAllowed: StreamImport.number(row.oppCompAllowed),
        oppSackRate: StreamImport.number(row.oppSackRate),
        oppIntRate: StreamImport.number(row.oppIntRate), source: 'imported',
      })
      if (!isQBTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
    }
    for (const [id, row] of StreamImport.players(root)) {
      const role = jsonString(row.role)
      const practice = jsonString(row.practice)
      const change: QBPlayerOverride = {
        role: role !== undefined && (QB_ROLES as readonly string[]).includes(role) ? (role as QBRole) : undefined,
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        starterConf: StreamImport.number(row.starterConf), notes: jsonString(row.notes),
      }
      if (!isQBPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
    return out
  },

  sourceNotes(teams) {
    const notes: string[] = []
    if (!Object.values(teams).some((t) => t.dvpSource === 'sleeperDvP')) {
      notes.push(`QB matchup needs ${DEFAULT_MINIMUM_GAMES} games per defense before it is used, so it is neutral for now unless edited or imported.`)
    }
    notes.push("Completion, sack and INT rates each defense allows are summed from Sleeper's lines of the quarterbacks it has faced. Spread and total are recorded closing lines, not live odds.")
    notes.push('Rest of season scores his remaining schedule against each defense\'s generosity to QBs; the horizon decides how much it counts. Roles and starter confidence are inferred from usage — all heuristic until backtested.')
    return notes
  },

  isTeamOverrideEmpty: isQBTeamOverrideEmpty,
  isPlayerOverrideEmpty: isQBPlayerOverrideEmpty,
  reviveCandidate: (raw) => reviveScheduleCandidate<QBCandidate>(raw),
}

export class QBStreamScreenModel extends StreamScreenModel<QBStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(QBStreamKind, loader, store)
  }
}

export type QBStreamSnapshot = StreamSnapshot<QBStreamTypes>
