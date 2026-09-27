/**
 * K Stream's part of the shared stream screen — a port of FCApp
 * `KStreamKind.swift`.
 */
import { nflverseTeam } from '@core/NFLTeams'
import { weekLines } from '@core/Schedule'
import { intKeyed, isStreamPractice, type StreamPractice } from '@core/Stream'
import {
  DOME_HOME, K_BUCKETS, K_VENUES, kScoringFromSleeper, kUnmodelledKeys, projectK,
  type KBucket, type KBucketValues, type KCandidate, type KProjection, type KScoring, type KVenue,
} from '@core/streams/KStream'
import { played, scoreLine } from '@data/insightsModels'
import { playerNflverseTeam, playersAt } from '@data/playerIndex'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { StreamImport } from './QBStreamKind'
import { SleeperTeamTotals } from './SleeperTeamTotals'
import { StreamScreenModel } from './StreamScreenModel'
import {
  isJSONObject, jsonString, opponentLabel, streamPracticeStatus, stripUndefined,
  type StreamContextSource, type StreamKind, type StreamWeekOverrides,
} from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'

/** One team's kicking conditions this week. */
export interface KTeamContext {
  team: string
  opponent: string
  home?: boolean
  spreadOff: number
  total: number
  venue: KVenue
  windMph: number
  /** Chance of rain, 0–100. */
  precipPct: number
  altitude: boolean
  /** Points the opposing defense allows to kickers, % vs average. */
  dvpPct?: number
  dvpGames: number
  linesSource: StreamContextSource
  dvpSource: StreamContextSource
  weatherSource: StreamContextSource
  /** Every defense's generosity to kickers — the rest-of-season input. */
  leagueGenerosity: Record<string, number>
}

export const kTeamSpread = (t: KTeamContext) => t.spreadOff
export const kTeamImplied = (t: KTeamContext) => (t.total - t.spreadOff) / 2
export const kOpponentLabel = (t: KTeamContext) => opponentLabel(t)

export interface KTeamOverride {
  spreadOff?: number
  total?: number
  venue?: KVenue
  windMph?: number
  precipPct?: number
  dvpPct?: number
  dvpGames?: number
  source: StreamContextSource
}

export function kTeamOverride(values: Partial<KTeamOverride> = {}): KTeamOverride {
  return { ...values, source: values.source ?? 'manual' }
}

export const isKTeamOverrideEmpty = (o: KTeamOverride) =>
  o.spreadOff === undefined && o.total === undefined && o.venue === undefined && o.windMph === undefined
    && o.precipPct === undefined && o.dvpPct === undefined && o.dvpGames === undefined

export interface KPlayerOverride {
  practice?: StreamPractice
  notes?: string
}

export const isKPlayerOverrideEmpty = (o: KPlayerOverride) => o.practice === undefined && (o.notes ?? '').length === 0

export type KWeekOverrides = StreamWeekOverrides<KTeamOverride, KPlayerOverride>

export interface KGameLine {
  week: number
  opponent?: string
  points: number
  made: number
  attempts: number
  longest?: number
  extraPoints: number
}

export interface KStreamTypes {
  Candidate: KCandidate
  Projection: KProjection
  Scoring: KScoring
  Team: KTeamContext
  TeamOverride: KTeamOverride
  PlayerOverride: KPlayerOverride
  GameLine: KGameLine
}

/** K Stream's part of the shared stream screen. */
export const KStreamKind: StreamKind<KStreamTypes> = {
  storeFolder: 'KStream',
  positions: ['K'],
  playerNoun: 'kicker',
  emptyScoring: { make: {}, miss: {}, extraPoint: 0, extraPointMiss: 0 },
  usesHorizon: true,

  scoring: (settings) => kScoringFromSleeper(settings),
  unmodelledKeys: (settings) => kUnmodelledKeys(settings),

  autofill(context, defense) {
    const generosity = SleeperTeamTotals.generosity(defense.sleeper, 'K')
    const out: Record<string, KTeamContext> = {}
    for (const [team, line] of Object.entries(weekLines(context.schedule, context.currentWeek))) {
      // The stadium belongs to the home side.
      const site = line.isHome ? team : line.opponent
      out[team] = {
        team, opponent: line.opponent, home: line.isHome,
        spreadOff: line.spread ?? 0, total: line.total ?? 45,
        venue: DOME_HOME.has(site) ? 'dome' : 'outdoor',
        windMph: 0, precipPct: 0, altitude: site === 'DEN',
        dvpPct: generosity.pct[line.opponent], dvpGames: generosity.games[line.opponent] ?? 0,
        linesSource: line.spread !== undefined && line.total !== undefined ? 'schedule' : 'standard',
        dvpSource: generosity.pct[line.opponent] === undefined ? 'standard' : 'sleeperDvP',
        weatherSource: 'standard', leagueGenerosity: generosity.pct,
      }
    }
    return out
  },

  apply(overrides, teams) {
    const out: Record<string, KTeamContext> = { ...teams }
    for (const [team, change] of Object.entries(overrides)) {
      const current = out[team]
      if (!current || isKTeamOverrideEmpty(change)) continue
      const context = { ...current }
      if (change.spreadOff !== undefined) { context.spreadOff = change.spreadOff; context.linesSource = change.source }
      if (change.total !== undefined) { context.total = change.total; context.linesSource = change.source }
      if (change.venue !== undefined) { context.venue = change.venue; context.weatherSource = change.source }
      if (change.windMph !== undefined) { context.windMph = change.windMph; context.weatherSource = change.source }
      if (change.precipPct !== undefined) { context.precipPct = change.precipPct; context.weatherSource = change.source }
      if (change.dvpPct !== undefined) {
        context.dvpPct = change.dvpPct
        context.dvpGames = change.dvpGames ?? Math.max(context.dvpGames, 1)
        context.dvpSource = change.source
      }
      out[team] = context
    }
    return out
  },

  candidates(context: LeagueContext, teams, players, alwaysInclude) {
    const totals = new SleeperTeamTotals(context)
    const generosity = Object.values(teams)[0]?.leagueGenerosity ?? {}
    const mine = new Set(context.userTeam?.roster.map((e) => e.id) ?? [])
    const out: KCandidate[] = []
    for (const player of playersAt(context.players, 'K')) {
      const team = playerNflverseTeam(player)
      if (team === undefined) continue
      const fga: KBucketValues = {}, fgm: KBucketValues = {}
      let xpa = 0, xpm = 0, games = 0
      let flags: string[] = []
      for (const week of totals.weeks) {
        const line = context.inSeason.weekStats.get(week)?.get(player.id)
        if (!line) continue
        const s = line.stats
        if (!((s.fga ?? 0) > 0 || (s.xpa ?? 0) > 0 || played(line))) continue
        games += 1
        const v = (k: string) => s[k] ?? 0
        const made: Record<KBucket, number> = {
          '0_39': v('fgm_0_19') + v('fgm_20_29') + v('fgm_30_39'),
          '40_49': v('fgm_40_49'),
          '50_59': s.fgm_50_59 ?? Math.max(0, v('fgm_50p') - v('fgm_60p')),
          '60': v('fgm_60p'),
        }
        const missed: Record<KBucket, number> = {
          '0_39': v('fgmiss_0_19') + v('fgmiss_20_29') + v('fgmiss_30_39'),
          '40_49': v('fgmiss_40_49'),
          '50_59': s.fgmiss_50_59 ?? Math.max(0, v('fgmiss_50p') - v('fgmiss_60p')),
          '60': v('fgmiss_60p'),
        }
        // A miss Sleeper didn't bucket: count it from 40–49.
        const unplaced = v('fgmiss') - K_BUCKETS.reduce((sum, b) => sum + missed[b], 0)
        if (unplaced > 0.5) {
          missed['40_49'] += unplaced
          flags.push('some misses without a distance counted as 40–49')
        }
        for (const b of K_BUCKETS) {
          fgm[b] = (fgm[b] ?? 0) + made[b]
          fga[b] = (fga[b] ?? 0) + made[b] + missed[b]
        }
        xpa += v('xpa'); xpm += v('xpm')
      }
      const hasRole = games > 0 || player.depthChartOrder === 1
      if (!(hasRole || mine.has(player.id) || alwaysInclude.has(player.id))) continue
      const offense = totals.offenseTotal(team)
      const game = teams[team]
      const override = players[player.id]
      let practice = override?.practice ?? streamPracticeStatus(player, context)
      if (game === undefined) {
        practice = 'OUT'
        flags.push('bye week')
      } else if (game.linesSource === 'standard') {
        flags.push('no recorded line — neutral spread and total')
      }
      if (game?.weatherSource === 'standard' && game?.venue !== 'dome') {
        flags.push('no weather entered — calm and dry')
      }
      const seen = new Set<string>()
      flags = flags.filter((f) => (seen.has(f) ? false : (seen.add(f), true)))
      out.push({
        name: player.name, team, opp: game ? opponentLabel(game) : 'BYE', home: game?.home,
        spreadOff: game?.spreadOff ?? 0, total: game?.total ?? 45, games,
        fga, fgm, xpa, xpm,
        teamFga: offense.total.fieldGoalAttempts, teamOffTd: offense.total.touchdowns, teamGames: offense.games,
        venue: game?.venue ?? 'outdoor', windMph: game?.windMph ?? 0, precipPct: game?.precipPct ?? 0,
        altitude: game?.altitude ?? false, dvpPct: game?.dvpPct ?? 0,
        dvpGames: game?.dvpPct === undefined ? 0 : (game?.dvpGames ?? 0),
        schedule: SleeperTeamTotals.schedule(context.schedule, team), oppDvp: generosity,
        homeMap: SleeperTeamTotals.homeMap(context.schedule, team),
        currentWeek: context.currentWeek, practice, rosterPct: undefined,
        available: context.availabilityOf(player.id).kind === 'freeAgent',
        notes: override?.notes ?? '', sources: ['Sleeper weekly stats', 'schedule lines'],
        dataFlags: flags, playerID: player.id,
      })
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  },

  project: (candidate, scoring, risk, horizon = 'week') => projectK(candidate, scoring, risk, horizon),

  recentGames(context: LeagueContext, playerID: string, limit: number): KGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: KGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line || !played(line)) continue
      const s = line.stats
      out.push({
        week, opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points, made: s.fgm ?? 0,
        attempts: s.fga ?? 0, longest: s.fgm_lng, extraPoints: s.xpm ?? 0,
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => undefined,

  parseImport(text) {
    const root = StreamImport.root(text)
    const out: KWeekOverrides = { teams: {}, players: {} }
    for (const [team, row] of StreamImport.teams(root)) {
      const dvp = StreamImport.number(row.dvpPct) ?? (isJSONObject(row.dvpPct) ? StreamImport.number(row.dvpPct.K) : undefined)
      const games = StreamImport.number(row.dvpGames)
      const venue = jsonString(row.venue)
      const change = kTeamOverride({
        spreadOff: StreamImport.number(row.spreadOff) ?? StreamImport.number(row.spreadDef),
        total: StreamImport.number(row.total),
        venue: venue !== undefined && (K_VENUES as readonly string[]).includes(venue) ? (venue as KVenue) : undefined,
        windMph: StreamImport.number(row.windMph) ?? StreamImport.number(row.wind_mph),
        precipPct: StreamImport.number(row.precipPct) ?? StreamImport.number(row.precip_pct),
        dvpPct: dvp, dvpGames: dvp === undefined || games === undefined ? undefined : Math.trunc(games),
        source: 'imported',
      })
      if (!isKTeamOverrideEmpty(change)) out.teams[team] = stripUndefined(change)
    }
    for (const [id, row] of StreamImport.players(root)) {
      const practice = jsonString(row.practice)
      const change: KPlayerOverride = {
        practice: practice !== undefined && isStreamPractice(practice) ? practice : undefined,
        notes: jsonString(row.notes),
      }
      if (!isKPlayerOverrideEmpty(change)) out.players[id] = stripUndefined(change)
    }
    return out
  },

  sourceNotes: () => [
    "Field-goal attempts follow the implied team total and how often the offense stalls into kicks; distances and make rates are shrunk to league norms from Sleeper's lines.",
    "There's no weather feed: wind and rain are calm and dry unless you enter them in Game context. Domes and Denver's altitude are set from the stadium.",
    "Rest of season scores the remaining schedule against each defense's generosity to kickers, with domes (+3%) and late-season cold outdoors (−6%).",
  ],

  isTeamOverrideEmpty: isKTeamOverrideEmpty,
  isPlayerOverrideEmpty: isKPlayerOverrideEmpty,

  reviveCandidate(raw) {
    const o = raw as Record<string, unknown>
    const schedule = o.schedule instanceof Map ? o.schedule : intKeyed((o.schedule ?? {}) as Record<string, string>)
    const homeMap = o.homeMap instanceof Map ? o.homeMap : intKeyed((o.homeMap ?? {}) as Record<string, boolean>)
    return { ...(o as object), schedule, homeMap } as KCandidate
  },
}

export class KStreamScreenModel extends StreamScreenModel<KStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(KStreamKind, loader, store)
  }
}

export type KStreamSnapshot = StreamSnapshot<KStreamTypes>
