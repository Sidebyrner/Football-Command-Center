/**
 * RB Stream's part of the shared stream screen — a port of FCApp
 * `RBStreamKind`: running backs, projected by the RB engine under the
 * league's no-PPR, first-down-heavy scoring.
 */
import { DEFAULT_MINIMUM_GAMES } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import {
  projectRB, rbScoring, rbScoringFromSleeper, rbUnmodelledKeys,
  type RBCandidate, type RBProjection, type RBScoring,
} from '@core/streams/RBStream'
import { scoreLine } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { RBCandidateBuilder } from './RBCandidateBuilder'
import {
  applyRBContext, buildRBContext, isRBPlayerOverrideEmpty, isRBTeamOverrideEmpty, parseRBContext,
  type RBPlayerOverride, type RBTeamContext, type RBTeamOverride,
} from './RBWeekContext'
import { StreamScreenModel } from './StreamScreenModel'
import type { StreamKind } from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'

/** One completed game, for the comparison's recent-form rows. */
export interface RBGameLine {
  week: number
  opponent?: string
  /** Scored in the league's own settings. */
  points: number
  carries: number
  rushYards: number
  /** Rushing plus receiving. */
  firstDowns: number
  targets: number
  touchdowns: number
  longestRun?: number
  fumblesLost: number
}

export interface RBStreamTypes {
  Candidate: RBCandidate
  Projection: RBProjection
  Scoring: RBScoring
  Team: RBTeamContext
  TeamOverride: RBTeamOverride
  PlayerOverride: RBPlayerOverride
  GameLine: RBGameLine
}

export const RBStreamKind: StreamKind<RBStreamTypes> = {
  storeFolder: 'RBStream',
  positions: ['RB'],
  playerNoun: 'running back',
  emptyScoring: rbScoring(),
  usesHorizon: false,

  scoring: (settings) => rbScoringFromSleeper(settings),
  unmodelledKeys: (settings) => rbUnmodelledKeys(settings),

  autofill: (context, defense) => buildRBContext(context.schedule, context.currentWeek, defense.sleeper),
  apply: (overrides, teams) => applyRBContext(overrides, teams),

  candidates(context, teams, players, alwaysInclude) {
    const builder = new RBCandidateBuilder(context, teams, players)
    builder.alwaysInclude = alwaysInclude
    return builder.candidates()
  },

  project: (candidate, scoring, risk) => projectRB(candidate, scoring, risk),

  recentGames(context: LeagueContext, playerID: string, limit: number): RBGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: RBGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line) continue
      const s = line.stats
      out.push({
        week,
        opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points,
        carries: s.rush_att ?? 0,
        rushYards: s.rush_yd ?? 0,
        firstDowns: (s.rush_fd ?? 0) + (s.rec_fd ?? 0),
        targets: s.rec_tgt ?? 0,
        touchdowns: (s.rush_td ?? 0) + (s.rec_td ?? 0),
        longestRun: s.rush_lng,
        fumblesLost: s.fum_lost ?? 0,
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => undefined,

  parseImport: (text) => parseRBContext(text),

  sourceNotes(teams) {
    const notes: string[] = []
    if (!Object.values(teams).some((t) => t.dvpSource === 'sleeperDvP')) {
      notes.push(`RB matchup (points a defense allows to backs) needs ${DEFAULT_MINIMUM_GAMES} games per defense before it is used, so it is neutral for now unless edited or imported.`)
    }
    notes.push('Spread and total are recorded closing lines from the schedule file, not live odds; the implied team total drives touchdowns. The O-line / front-seven adjustment is neutral unless edited.')
    notes.push('Roles are inferred from carry, target and red-zone shares. Long runs are counted from each game\'s longest run, and long-TD bonuses assume 35% of 40+ and 45% of 50+ yard runs score — all heuristic until backtested.')
    return notes
  },

  isTeamOverrideEmpty: isRBTeamOverrideEmpty,
  isPlayerOverrideEmpty: isRBPlayerOverrideEmpty,
}

export class RBStreamScreenModel extends StreamScreenModel<RBStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(RBStreamKind, loader, store)
  }
}

export type RBStreamSnapshot = StreamSnapshot<RBStreamTypes>
