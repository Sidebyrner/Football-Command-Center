/**
 * WR Stream's part of the shared stream screen — a port of FCApp
 * `WRStreamKind`: wide receivers, projected by the WR engine under the
 * league's no-PPR, first-down-heavy scoring.
 */
import { DEFAULT_MINIMUM_GAMES } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import {
  makeWRScoring, projectWR, wrScoringFromSleeper, wrUnmodelledKeys,
  type WRCandidate, type WRProjection, type WRScoring,
} from '@core/streams/WRStream'
import { offensiveSnapShare, scoreLine } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { StreamScreenModel } from './StreamScreenModel'
import type { StreamKind } from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'
import { WRCandidateBuilder } from './WRCandidateBuilder'
import {
  applyWRContext, buildWRContext, isWRPlayerOverrideEmpty, isWRTeamOverrideEmpty, parseWRContext,
  type WRPlayerOverride, type WRTeamContext, type WRTeamOverride,
} from './WRWeekContext'

/** One completed game, for the comparison's recent-form rows. */
export interface WRGameLine {
  week: number
  opponent?: string
  /** Scored in the league's own settings. */
  points: number
  targets: number
  receptions: number
  yards: number
  firstDowns: number
  touchdowns: number
  /** Catches of 30+ yards. */
  longCatches: number
  snapShare?: number
}

export interface WRStreamTypes {
  Candidate: WRCandidate
  Projection: WRProjection
  Scoring: WRScoring
  Team: WRTeamContext
  TeamOverride: WRTeamOverride
  PlayerOverride: WRPlayerOverride
  GameLine: WRGameLine
}

export const WRStreamKind: StreamKind<WRStreamTypes> = {
  storeFolder: 'WRStream',
  positions: ['WR'],
  playerNoun: 'receiver',
  emptyScoring: makeWRScoring(),
  usesHorizon: false,

  scoring: (settings) => wrScoringFromSleeper(settings),
  unmodelledKeys: (settings) => wrUnmodelledKeys(settings),

  autofill: (context, defense) => buildWRContext(context.schedule, context.currentWeek, defense.sleeper),
  apply: (overrides, teams) => applyWRContext(overrides, teams),

  candidates(context, teams, players, alwaysInclude) {
    const builder = new WRCandidateBuilder(context, teams, players)
    builder.alwaysInclude = alwaysInclude
    return builder.candidates()
  },

  project: (candidate, scoring, risk) => projectWR(candidate, scoring, risk),

  recentGames(context: LeagueContext, playerID: string, limit: number): WRGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: WRGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line) continue
      const s = line.stats
      out.push({
        week,
        opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points,
        targets: s.rec_tgt ?? 0,
        receptions: s.rec ?? 0,
        yards: s.rec_yd ?? 0,
        firstDowns: s.rec_fd ?? 0,
        touchdowns: s.rec_td ?? 0,
        longCatches: (s.rec_30_39 ?? 0) + (s.rec_40p ?? 0),
        snapShare: offensiveSnapShare(line),
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => undefined,

  parseImport: (text) => parseWRContext(text),

  sourceNotes(teams) {
    const notes: string[] = []
    if (!Object.values(teams).some((t) => t.dvpSource === 'sleeperDvP')) {
      notes.push(`WR matchup (points a defense allows to receivers) needs ${DEFAULT_MINIMUM_GAMES} games per defense before it is used, so it is neutral for now unless edited or imported.`)
    }
    notes.push('Spread and total are recorded closing lines from the schedule file, not live odds. Coverage (shadow corners, injured secondaries, QB downgrades) is neutral unless edited.')
    notes.push('Roles are inferred from target share, aDOT and rushing usage; long-TD bonuses assume 30% of 40+ and 40% of 50+ catches score — both heuristic until backtested.')
    return notes
  },

  isTeamOverrideEmpty: isWRTeamOverrideEmpty,
  isPlayerOverrideEmpty: isWRPlayerOverrideEmpty,
}

export class WRStreamScreenModel extends StreamScreenModel<WRStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(WRStreamKind, loader, store)
  }
}

export type WRStreamSnapshot = StreamSnapshot<WRStreamTypes>
