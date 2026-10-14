/**
 * TE Stream's part of the shared stream screen — a port of FCApp
 * `TEStreamKind`: tight ends, projected by the TE engine under the league's
 * own scoring, TE premium included.
 */
import { DEFAULT_MINIMUM_GAMES } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import {
  makeTEScoring, projectTE, teScoringFromSleeper, teUnmodelledKeys,
  type TECandidate, type TEProjection, type TEScoring,
} from '@core/streams/TEStream'
import { offensiveSnapShare, scoreLine } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { StreamScreenModel } from './StreamScreenModel'
import type { StreamKind } from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'
import { TECandidateBuilder } from './TECandidateBuilder'
import {
  applyTEContext, buildTEContext, isTEPlayerOverrideEmpty, isTETeamOverrideEmpty, parseTEContext,
  type TEPlayerOverride, type TETeamContext, type TETeamOverride,
} from './TEWeekContext'

/** One completed game, for the comparison's recent-form rows. */
export interface TEGameLine {
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
  redZoneTargets: number
  snapShare?: number
}

export interface TEStreamTypes {
  Candidate: TECandidate
  Projection: TEProjection
  Scoring: TEScoring
  Team: TETeamContext
  TeamOverride: TETeamOverride
  PlayerOverride: TEPlayerOverride
  GameLine: TEGameLine
}

export const TEStreamKind: StreamKind<TEStreamTypes> = {
  storeFolder: 'TEStream',
  positions: ['TE'],
  playerNoun: 'tight end',
  emptyScoring: makeTEScoring(),
  usesHorizon: false,

  scoring: (settings) => teScoringFromSleeper(settings),
  unmodelledKeys: (settings) => teUnmodelledKeys(settings),

  autofill: (context, defense) => buildTEContext(context.schedule, context.currentWeek, defense.sleeper),
  apply: (overrides, teams) => applyTEContext(overrides, teams),

  candidates(context, teams, players, alwaysInclude) {
    const builder = new TECandidateBuilder(context, teams, players)
    builder.alwaysInclude = alwaysInclude
    return builder.candidates()
  },

  project: (candidate, scoring, risk) => projectTE(candidate, scoring, risk),

  recentGames(context: LeagueContext, playerID: string, limit: number): TEGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: TEGameLine[] = []
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
        redZoneTargets: s.rec_rz_tgt ?? 0,
        snapShare: offensiveSnapShare(line),
      })
    }
    return out.slice(0, limit)
  },

  roleLabel: () => undefined,

  parseImport: (text) => parseTEContext(text),

  sourceNotes(teams) {
    const notes: string[] = []
    if (!Object.values(teams).some((t) => t.dvpSource === 'sleeperDvP')) {
      notes.push(`TE matchup (points a defense allows to tight ends) needs ${DEFAULT_MINIMUM_GAMES} games per defense before it is used, so it is neutral for now unless edited or imported.`)
    }
    notes.push('Spread and total are recorded closing lines from the schedule file, not live odds. Seam coverage (injured or weak linebackers and safeties) and vacated targets (a teammate out) are neutral unless edited.')
    notes.push('Routes are estimated from snap share by role (featured and seam TEs run a route on ~85% of snaps, inline TEs ~55%), and TD rates are regressed hard toward the role norm — both heuristic until backtested.')
    return notes
  },

  isTeamOverrideEmpty: isTETeamOverrideEmpty,
  isPlayerOverrideEmpty: isTEPlayerOverrideEmpty,
}

export class TEStreamScreenModel extends StreamScreenModel<TEStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(TEStreamKind, loader, store)
  }
}

export type TEStreamSnapshot = StreamSnapshot<TEStreamTypes>
