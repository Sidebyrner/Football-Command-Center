/**
 * Assembles `CommandCenterInputs` for a player from a league context and runs
 * the projection — a port of FCApp `CommandCenterProjector`.
 */
import { projectCommandCenter, type CommandCenterInputs, type CommandCenterProjection } from '@core/CommandCenterProjection'
import { gameOpponent, gamesInWeek, weekLines, type TeamGameLine } from '@core/Schedule'
import type { SeasonProfile } from '@core/SeasonProfile'
import { played } from '@data/insightsModels'
import { playerPosition } from '@data/playerIndex'
import { statLines } from '../league/InSeasonData'
import type { LeagueContext } from '../league/LeagueContext'
import type { DefenseLookup } from './DefenseLookup'

export class CommandCenterProjector {
  private readonly profilesBySleeper = new Map<string, SeasonProfile>()
  private readonly thisWeekLines: Record<string, TeamGameLine>

  constructor(readonly context: LeagueContext, readonly defense: DefenseLookup) {
    const byGSIS = new Map<string, SeasonProfile>()
    for (const p of context.seasonProfiles) if (!byGSIS.has(p.gsisID)) byGSIS.set(p.gsisID, p)
    for (const [gsis, sleeper] of Object.entries(context.sleeperIDsByGSIS)) {
      const profile = byGSIS.get(gsis)
      if (profile) this.profilesBySleeper.set(sleeper, profile)
    }
    this.thisWeekLines = weekLines(context.schedule, context.currentWeek)
  }

  /** The inputs, or `undefined` when the player is unknown to the pool. */
  inputs(id: string): CommandCenterInputs | undefined {
    const { context, defense } = this
    const player = context.players.players[id]
    if (!player) return undefined
    const position = playerPosition(player)
    const team = context.nflTeam(id)
    const profile = this.profilesBySleeper.get(id)
    const playedLines = statLines(context.inSeason, id).filter(played)
    const sleeperPPG = context.sleeperPointsPerGame(id)
    // This season is Sleeper's lines; when the stats season *is* this season and
    // Sleeper has nothing, the nflverse profile is this season.
    const thisSeason = sleeperPPG !== undefined ? { ppg: sleeperPPG, games: playedLines.length }
      : context.statsSeason === context.scheduleSeason && profile ? { ppg: profile.pointsPerGame, games: profile.games }
      : undefined
    const lastSeason = context.statsSeason < context.scheduleSeason ? profile?.pointsPerGame : undefined

    let recentX: number | undefined
    let seasonX: number | undefined
    const gsis = context.gsisIDsBySleeper.get(id)
    if (gsis !== undefined && context.inSeason.usage) {
      const all = context.inSeason.usage.weeks(gsis).map((w) => w.expectedPoints).filter((x): x is number => x !== undefined)
      if (all.length) {
        seasonX = all.reduce((s, v) => s + v, 0) / all.length
        const recent = all.slice(-4)
        recentX = recent.reduce((s, v) => s + v, 0) / recent.length
      }
    }

    const opponent = team ? this.thisWeekLines[team]?.opponent : undefined
    const cell = defense.cell(opponent, position)
    const average = defense.leagueAverage(position)
    const remaining: { allowed: number; average: number }[] = []
    if (team && average !== undefined) {
      for (const week of context.remainingWeeks) {
        if (week <= context.currentWeek) continue
        const game = gamesInWeek(context.schedule, week).find((g) => g.home === team || g.away === team)
        const opp = game && gameOpponent(game, team)
        const allowed = opp ? defense.cell(opp, position)?.perGame : undefined
        if (allowed !== undefined) remaining.push({ allowed, average })
      }
    }
    return {
      position,
      thisSeasonPointsPerGame: thisSeason?.ppg,
      thisSeasonGames: thisSeason?.games ?? 0,
      lastSeasonPointsPerGame: lastSeason,
      replacementLine: position ? context.baselines[position]?.replacementLine : undefined,
      expectedPointsRecent: recentX,
      expectedPointsSeason: seasonX,
      opponentAllowedPerGame: cell?.perGame,
      leagueAverageAllowed: cell?.perGame !== undefined ? average : undefined,
      remainingOpponents: remaining,
    }
  }

  project(id: string): CommandCenterProjection | undefined {
    const inputs = this.inputs(id)
    return inputs ? projectCommandCenter(inputs) : undefined
  }
}
