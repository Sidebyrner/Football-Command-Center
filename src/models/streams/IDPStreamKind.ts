/**
 * IDP Stream's part of the shared stream screen — a port of FCApp
 * `IDPStreamKind`: defenders at LB/DL/DB, projected by the IDP engine.
 */
import { DEFAULT_MINIMUM_GAMES } from '@core/DefenseVsPosition'
import { nflverseTeam } from '@core/NFLTeams'
import {
  IDP_SUB_POSITION_LABEL, idpScoring, idpScoringFromSleeper, idpUnmodelledKeys, project as projectIDP, resolveIDPSubPosition,
  type IDPCandidate, type IDPProjection, type IDPScoring,
} from '@core/streams/IDPStream'
import { defensiveSnapShare, scoreLine } from '@data/insightsModels'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { IDPCandidateBuilder } from './IDPCandidateBuilder'
import {
  applyIDPContext, buildIDPContext, isIDPPlayerOverrideEmpty, isIDPTeamOverrideEmpty, parseIDPContext,
  type IDPPlayerOverride, type IDPTeamContext, type IDPTeamOverride,
} from './IDPWeekContext'
import { StreamScreenModel } from './StreamScreenModel'
import type { StreamKind } from './StreamKind'
import type { StreamSnapshot, StreamStore } from './StreamStore'

/** One completed game, for the comparison's recent-form rows. */
export interface IDPGameLine {
  week: number
  opponent?: string
  /** Scored in the league's own settings. */
  points: number
  snapShare?: number
  tackles: number
  sacks: number
}

export interface IDPStreamTypes {
  Candidate: IDPCandidate
  Projection: IDPProjection
  Scoring: IDPScoring
  Team: IDPTeamContext
  TeamOverride: IDPTeamOverride
  PlayerOverride: IDPPlayerOverride
  GameLine: IDPGameLine
}

export const IDPStreamKind: StreamKind<IDPStreamTypes> = {
  storeFolder: 'IDPStream',
  positions: ['LB', 'DL', 'DB'],
  playerNoun: 'defender',
  emptyScoring: idpScoring(),
  usesHorizon: false,

  scoring: (settings) => idpScoringFromSleeper(settings),
  unmodelledKeys: (settings) => idpUnmodelledKeys(settings),

  autofill: (context, defense) => buildIDPContext(context.schedule, context.currentWeek, defense.sleeper),
  apply: (overrides, teams) => applyIDPContext(overrides, teams),

  candidates(context, teams, players, alwaysInclude) {
    const builder = new IDPCandidateBuilder(context, teams, players)
    builder.alwaysInclude = alwaysInclude
    return builder.candidates()
  },

  project: (candidate, scoring, risk) => projectIDP(candidate, scoring, risk),

  recentGames(context: LeagueContext, playerID: string, limit: number): IDPGameLine[] {
    const scoring = context.league.scoringSettings ?? {}
    const weeks = [...context.inSeason.weekStats.keys()].filter((w) => w < context.currentWeek).sort((a, b) => b - a)
    const out: IDPGameLine[] = []
    for (const week of weeks) {
      const line = context.inSeason.weekStats.get(week)?.get(playerID)
      if (!line) continue
      const s = line.stats
      out.push({
        week,
        opponent: nflverseTeam(line.opponent),
        points: scoreLine(line, scoring).points,
        snapShare: defensiveSnapShare(line),
        tackles: s.idp_tkl ?? ((s.idp_tkl_solo ?? 0) + (s.idp_tkl_ast ?? 0)),
        sacks: s.idp_sack ?? 0,
      })
    }
    return out.slice(0, limit)
  },

  roleLabel(player) {
    const resolved = resolveIDPSubPosition(player.positionCode, player.depthChartPosition)
    return resolved ? IDP_SUB_POSITION_LABEL[resolved.position] : undefined
  },

  parseImport: (text) => parseIDPContext(text),

  sourceNotes(teams) {
    const notes: string[] = []
    if (!Object.values(teams).some((t) => t.dvpSource === 'sleeperDvP')) {
      notes.push(`IDP matchup (points an offense allows to LB/DL/DB) needs ${DEFAULT_MINIMUM_GAMES} games per offense before it is used, so it is neutral for now unless edited or imported.`)
    }
    notes.push('Spread and total are recorded closing lines from the schedule file, not live odds. Opponent pass protection is neutral unless edited.')
    return notes
  },

  isTeamOverrideEmpty: isIDPTeamOverrideEmpty,
  isPlayerOverrideEmpty: isIDPPlayerOverrideEmpty,
}

export class IDPStreamScreenModel extends StreamScreenModel<IDPStreamTypes> {
  constructor(loader: LeagueContextLoader, store?: StreamStore) {
    super(IDPStreamKind, loader, store)
  }
}

export type IDPStreamSnapshot = StreamSnapshot<IDPStreamTypes>
