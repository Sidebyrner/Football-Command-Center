/**
 * The Dashboard's "this week" card and waiver targets — a port of FCApp
 * `DashboardThisWeek.swift` (`ThisWeekSummary`, `WaiverTarget` and the
 * `DashboardModel.buildThisWeek` / `buildWaiverTargets` extension).
 */
import { crunchForWeek, neededPositions } from '@core/ByeCrunch'
import { formatFixed } from '@core/numeric'
import type { Position } from '@core/Position'
import { lineupEnvironment, weekLines } from '@core/Schedule'
import { playerNflverseTeam, playerPosition } from '@data/playerIndex'
import { EMPTY_STARTER_SLOT, type SleeperMatchup, type TrendingPlayer } from '@data/sleeperModels'
import type { LeagueContext } from '../league/LeagueContext'

/** The "this week" card: you against your opponent, at a glance. */
export interface ThisWeekSummary {
  week: number
  myManager: string
  myPoints?: number
  myAverageTeamTotal?: number
  /** `undefined` in a week with no opponent. */
  opponentManager?: string
  opponentPoints?: number
  opponentAverageTeamTotal?: number
  /** Starters yet to kick off, per side — a fact, not a projection. Swift default 0. */
  myLeftToPlay: number
  opponentLeftToPlay?: number
}

/** Plain-words state of the game, for the card's subtitle (Swift `ThisWeekSummary.status`). */
export function thisWeekStatus(s: ThisWeekSummary): string {
  const opponentManager = s.opponentManager
  if (opponentManager === undefined) return 'No opponent this week'
  const mine = s.myPoints
  const theirs = s.opponentPoints
  if (mine === undefined || theirs === undefined || !(mine + theirs > 0)) {
    return `vs ${opponentManager} — not started`
  }
  if (Math.abs(mine - theirs) < 0.05) return `Tied with ${opponentManager}`
  const margin = formatFixed(Math.abs(mine - theirs), 1)
  return mine > theirs ? `Leading ${opponentManager} by ${margin}` : `Trailing ${opponentManager} by ${margin}`
}

/** A trending add worth a look from the Dashboard. */
export interface WaiverTarget {
  /** Also the row's identity (Swift `id`). */
  playerID: string
  name: string
  position: Position
  team?: string
  adds: number
  /** True when he plays this week at a position you can't currently fill. */
  fillsNeedThisWeek: boolean
}

/**
 * Builds the card from this week's matchups. Deliberately light: the Matchup
 * screen's full build scores every row of the season for defense ranks, which
 * a summary card has no use for.
 */
export function buildThisWeek(context: LeagueContext, matchups: readonly SleeperMatchup[]): ThisWeekSummary | undefined {
  const userTeam = context.userTeam
  if (!userTeam) return undefined
  const mine = matchups.find((m) => m.rosterID === userTeam.rosterID)
  if (!mine) return undefined

  const lines = weekLines(context.schedule, context.currentWeek)
  const averageTeamTotal = (starters: readonly string[] | undefined): number | undefined => {
    const teams = (starters ?? []).filter((id) => id !== EMPTY_STARTER_SLOT).map((id): string | undefined => {
      const player = context.players.players[id]
      return (player && playerNflverseTeam(player)) ?? player?.team ?? (player && playerPosition(player) === 'DEF' ? id : undefined)
    })
    const environment = lineupEnvironment(teams, lines)
    const counted = environment.teamCount - environment.missing.length
    if (environment.total === undefined || !(counted > 0)) return undefined
    return environment.total / counted
  }

  // Yet to kick off: not an empty slot, not on bye, not already locked.
  const leftToPlay = (starters: readonly string[] | undefined): number =>
    (starters ?? []).filter((id) => {
      if (id === EMPTY_STARTER_SLOT) return false
      const team = context.nflTeam(id)
      return !context.byeCalendar.isOnBye(team, context.currentWeek) && !context.isLocked(id)
    }).length

  const opponent = mine.matchupID === undefined
    ? undefined
    : matchups.find((m) => m.matchupID === mine.matchupID && m.rosterID !== userTeam.rosterID)
  const opponentTeam = opponent === undefined ? undefined : context.teams.find((t) => t.rosterID === opponent.rosterID)

  return {
    week: context.currentWeek,
    myManager: userTeam.manager,
    myPoints: mine.points,
    myAverageTeamTotal: averageTeamTotal(mine.starters),
    opponentManager: opponentTeam?.manager,
    opponentPoints: opponent?.points,
    opponentAverageTeamTotal: opponent === undefined ? undefined : averageTeamTotal(opponent.starters),
    myLeftToPlay: leftToPlay(mine.starters),
    opponentLeftToPlay: opponent === undefined ? undefined : leftToPlay(opponent.starters),
  }
}

/**
 * Trending adds nobody in the league rosters, flagged when one fills a
 * position you can't currently fill this week — ported from the web app's
 * Waiver Targets panel. Popularity only, and labelled as such.
 */
export function buildWaiverTargets(context: LeagueContext, trending: readonly TrendingPlayer[], limit = 6): WaiverTarget[] {
  const needed: Set<Position> = (() => {
    const team = context.userTeam
    if (!team) return new Set<Position>()
    return neededPositions(crunchForWeek(team.roster, context.template, context.byeCalendar.byeTeams(context.currentWeek)))
  })()

  const targets: WaiverTarget[] = []
  for (const entry of trending) {
    if (context.availabilityOf(entry.playerID).kind !== 'freeAgent') continue
    const player = context.players.players[entry.playerID]
    if (!player || !player.active) continue
    const position = playerPosition(player)
    if (position === undefined) continue
    const team = playerNflverseTeam(player) ?? player.team ?? (position === 'DEF' ? entry.playerID : undefined)
    const plays = !context.byeCalendar.isOnBye(team, context.currentWeek)
    targets.push({
      playerID: entry.playerID,
      name: player.name,
      position,
      team,
      adds: entry.count,
      fillsNeedThisWeek: plays && needed.has(position),
    })
  }
  // Needs first, then popularity — keeping Sleeper's order within each.
  const fills = targets.filter((t) => t.fillsNeedThisWeek)
  const others = targets.filter((t) => !t.fillsNeedThisWeek)
  return [...fills, ...others].slice(0, limit)
}
