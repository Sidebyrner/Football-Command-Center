/**
 * Planning's three jobs — a port of FCApp `PlanningJobs` (the `PlanningModel`
 * extension). The functions take the model; `PlanningModel` exposes each as a
 * method under Swift's name.
 */
import type { SignalHit } from '@core/AcquisitionSignals'
import { neededPositions as reportNeededPositions } from '@core/ByeCrunch'
import { nflverseTeam } from '@core/NFLTeams'
import { hasWeeklyProductionData, type Position } from '@core/Position'
import type { SeasonProfile } from '@core/SeasonProfile'
import { playerNflverseTeam, playerPosition } from '@data/playerIndex'
import { FREE_AGENT, type Availability, type LeagueTeam } from '../league/LeagueContext'
import type { PlanningModel } from './PlanningModel'

// MARK: - Modes

/** Planning's three jobs, each with the one sentence the screen leads with. */
export const PLANNING_MODES = ['byes', 'trades', 'waivers'] as const
export type PlanningMode = (typeof PLANNING_MODES)[number]

/** Swift's raw value — the segment title. */
export const PLANNING_MODE_TITLE: Readonly<Record<PlanningMode, string>> = {
  byes: 'Byes',
  trades: 'Trades',
  waivers: 'Waivers',
}

export function planningModePurpose(mode: PlanningMode): string {
  switch (mode) {
    case 'byes': return "Find the weeks you can't field a full lineup, and fix them."
    case 'trades': return 'Rivals who can spare a player for your problem weeks.'
    case 'waivers': return "Free agents worth grabbing before the weeks you'll need them."
  }
}

/** SF Symbol name in Swift; kept so the UI can map it to an icon. */
export function planningModeSystemImage(mode: PlanningMode): string {
  switch (mode) {
    case 'byes': return 'calendar.badge.exclamationmark'
    case 'trades': return 'arrow.left.arrow.right'
    case 'waivers': return 'tray.and.arrow.down'
  }
}

// MARK: - Types

/** One player the planner is suggesting, whichever job suggested him. */
export interface PlanningPlayer {
  id: string
  sleeperID?: string
  name: string
  position: Position
  /** nflverse spelling, current team where Sleeper knows it. */
  team?: string
  /**
   * Season points per game in the stats season. `undefined` for DEF and IDP,
   * which have no production data — never shown as zero.
   */
  pointsPerGame?: number
  signals: SignalHit[]
  availability: Availability
  /** Your short weeks this player could actually play in at a position you need that week. */
  coversWeeks: number[]
  /** True when the only evidence is Sleeper's league-wide add count. The UI must say "popularity only" (§3.2). */
  popularityOnly: boolean
  trendingAdds?: number
}

/** A rival who could cover some of your short weeks from their bench. */
export interface TradeTarget {
  /** `rival.rosterID` (Swift's computed `id`). */
  id: number
  rival: LeagueTeam
  /**
   * Your short weeks where this rival is *not* short and has a bench player
   * at a position you need who plays that week.
   */
  weeksCovered: number[]
  candidates: PlanningPlayer[]
}

/** A Swift `sorted(by:)` predicate as a JS comparator (JS sort is stable, as Swift's is in practice). */
function by<T>(areInIncreasingOrder: (a: T, b: T) => boolean): (a: T, b: T) => number {
  return (a, b) => (areInIncreasingOrder(a, b) ? -1 : areInIncreasingOrder(b, a) ? 1 : 0)
}

// MARK: - Shared

/**
 * Positions the user needs in a week: dedicated positions that are short,
 * plus every position eligible for a flex group that is short.
 */
export function neededPositions(model: PlanningModel, week: number): Set<Position> {
  const context = model.context
  if (!context) return new Set()
  const cell = model.cell(context.userRosterID, week)
  if (!cell) return new Set()
  return reportNeededPositions(cell.report)
}

/** The user's short weeks, soonest first. */
export function shortWeekNumbers(model: PlanningModel): number[] {
  return model.userShortWeeks().map((c) => c.week).sort((a, b) => a - b)
}

/**
 * A player's current NFL team in nflverse spelling. Sleeper's team wins over
 * the stats season's, because players change teams between seasons and a
 * bye check against last year's team would be wrong.
 */
export function currentTeam(model: PlanningModel, sleeperID: string | undefined, fallback: string | undefined): string | undefined {
  const context = model.context
  if (!context) return fallback
  if (sleeperID !== undefined) {
    const player = context.players.players[sleeperID]
    if (player) return playerNflverseTeam(player) ?? player.team ?? fallback
  }
  return nflverseTeam(fallback) ?? fallback
}

export function coversWeeks(model: PlanningModel, position: Position, team: string | undefined): number[] {
  const context = model.context
  if (!context) return []
  return shortWeekNumbers(model).filter((week) =>
    neededPositions(model, week).has(position) && !context.byeCalendar.isOnBye(team, week))
}

function signalsByGSIS(model: PlanningModel): Map<string, SignalHit[]> {
  const out = new Map<string, SignalHit[]>()
  for (const row of model.board) if (!out.has(row.id)) out.set(row.id, row.signals)
  return out
}

/** Everyone with production data, as planning players. */
function productionPlayers(model: PlanningModel, include: (a: Availability) => boolean): PlanningPlayer[] {
  const context = model.context
  if (!context) return []
  const signals = signalsByGSIS(model)
  const out: PlanningPlayer[] = []
  for (const profile of context.seasonProfiles) {
    const availability = context.availabilityOfGSIS(profile.gsisID)
    if (!include(availability)) continue
    const sleeperID = context.sleeperIDsByGSIS[profile.gsisID]
    const team = currentTeam(model, sleeperID, profile.team)
    out.push({
      id: sleeperID ?? profile.gsisID,
      sleeperID,
      name: context.playerName(sleeperID ?? '') ?? profile.name,
      position: profile.position,
      team,
      pointsPerGame: profile.pointsPerGame,
      signals: signals.get(profile.gsisID) ?? [],
      availability,
      coversWeeks: coversWeeks(model, profile.position, team),
      popularityOnly: false,
      trendingAdds: undefined,
    })
  }
  return out
}

const isFreeAgent = (a: Availability) => a.kind === 'freeAgent'

/**
 * Trending adds nobody in the league rosters. The only signal that covers
 * DEF and IDP at all, and labelled popularity-only everywhere it appears.
 */
function trendingFreeAgents(model: PlanningModel): PlanningPlayer[] {
  const context = model.context
  if (!context) return []
  const out: PlanningPlayer[] = []
  for (const entry of model.trending) {
    if (context.availabilityOf(entry.playerID).kind !== 'freeAgent') continue
    const player = context.players.players[entry.playerID]
    if (!player || !player.active) continue
    const position = playerPosition(player)
    if (position === undefined) continue
    const team = playerNflverseTeam(player) ?? player.team ?? (position === 'DEF' ? entry.playerID : undefined)
    out.push({
      id: entry.playerID,
      sleeperID: entry.playerID,
      name: player.name,
      position,
      team,
      pointsPerGame: undefined,
      signals: [],
      availability: FREE_AGENT,
      coversWeeks: coversWeeks(model, position, team),
      popularityOnly: true,
      trendingAdds: entry.count,
    })
  }
  return out
}

// MARK: - Byes

/**
 * Free agents who fix one short week: at a position you're short at that
 * week, and not on bye that week.
 *
 * Free agents only — rivals' spare players belong to the Trades job, where
 * they are bench-only and framed as an ask. Positions with production data
 * are ranked by season points per game; DEF and IDP can only come from
 * trending adds, labelled popularity only.
 */
export function pickups(model: PlanningModel, week: number, limit = 8): PlanningPlayer[] {
  const context = model.context
  if (!context) return []
  const needed = neededPositions(model, week)
  if (needed.size === 0) return []

  const playsThatWeek = (player: PlanningPlayer) => !context.byeCalendar.isOnBye(player.team, week)

  const production = productionPlayers(model, isFreeAgent)
    .filter((p) => needed.has(p.position) && playsThatWeek(p))
    .sort(by((a, b) => (a.pointsPerGame ?? 0) > (b.pointsPerGame ?? 0)))
    .slice(0, limit)

  const popularity = trendingFreeAgents(model)
    .filter((p) => needed.has(p.position) && !hasWeeklyProductionData(p.position) && playsThatWeek(p))

  return [...production, ...popularity]
}

// MARK: - Trades

/**
 * Rivals ranked by how many of your short weeks they can cover.
 *
 * A rival qualifies for a week when they are *not* short that week and have
 * a **bench** player at a position you need who plays that week. Bench, not
 * starters: a bench player is one a rival can spare without breaking their
 * own lineup, which is what makes the ask realistic.
 */
export function buildTradeTargets(model: PlanningModel): TradeTarget[] {
  const context = model.context
  if (!context) return []
  const shortWeeks = shortWeekNumbers(model)
  if (shortWeeks.length === 0) return []

  const profileBySleeper = new Map<string, SeasonProfile>()
  {
    const byGSIS = new Map<string, SeasonProfile>()
    for (const p of context.seasonProfiles) if (!byGSIS.has(p.gsisID)) byGSIS.set(p.gsisID, p)
    for (const [gsis, sleeper] of Object.entries(context.sleeperIDsByGSIS)) {
      const profile = byGSIS.get(gsis)
      if (profile) profileBySleeper.set(sleeper, profile)
    }
  }

  const targets: TradeTarget[] = []
  for (const rival of context.rivals) {
    const starters = new Set(rival.starterIDs)
    // Swift's dictionary order here is unspecified; insertion order stands in.
    const candidateWeeks = new Map<string, number[]>()

    for (const week of shortWeeks) {
      const cell = model.cell(rival.rosterID, week)
      if (!cell || cell.isShort) continue
      const needed = neededPositions(model, week)
      for (const entry of rival.roster) {
        if (starters.has(entry.id)) continue
        const position = entry.position
        if (position === undefined || !needed.has(position) || context.byeCalendar.isOnBye(entry.team, week)) continue
        let weeks = candidateWeeks.get(entry.id)
        if (!weeks) candidateWeeks.set(entry.id, (weeks = []))
        weeks.push(week)
      }
    }

    if (candidateWeeks.size === 0) continue

    const candidates: PlanningPlayer[] = []
    for (const [id, weeks] of candidateWeeks) {
      const position = context.position(id)
      if (position === undefined) continue
      const profile = profileBySleeper.get(id)
      candidates.push({
        id,
        sleeperID: id,
        name: context.playerName(id) ?? id,
        position,
        team: currentTeam(model, id, profile?.team),
        pointsPerGame: profile?.pointsPerGame,
        signals: [],
        availability: { kind: 'rivalBench', rosterID: rival.rosterID, manager: rival.manager },
        coversWeeks: [...weeks].sort((a, b) => a - b),
        popularityOnly: false,
        trendingAdds: undefined,
      })
    }
    candidates.sort(by((a, b) => {
      if (a.coversWeeks.length !== b.coversWeeks.length) return a.coversWeeks.length > b.coversWeeks.length
      return (a.pointsPerGame ?? -1) > (b.pointsPerGame ?? -1)
    }))

    const covered = new Set<number>()
    for (const weeks of candidateWeeks.values()) for (const w of weeks) covered.add(w)
    targets.push({ id: rival.rosterID, rival, weeksCovered: [...covered].sort((a, b) => a - b), candidates })
  }

  return targets.sort(by((a, b) => {
    if (a.weeksCovered.length !== b.weeksCovered.length) return a.weeksCovered.length > b.weeksCovered.length
    return (a.candidates[0]?.pointsPerGame ?? -1) > (b.candidates[0]?.pointsPerGame ?? -1)
  }))
}

// MARK: - Waivers

/**
 * Free agents with production data who would fill at least one of your
 * short weeks — most weeks covered first, then season points per game.
 */
export function buildWaiverFills(model: PlanningModel, limit = 12): PlanningPlayer[] {
  return productionPlayers(model, isFreeAgent)
    .filter((p) => p.coversWeeks.length > 0)
    .sort(by((a, b) => {
      if (a.coversWeeks.length !== b.coversWeeks.length) return a.coversWeeks.length > b.coversWeeks.length
      return (a.pointsPerGame ?? 0) > (b.pointsPerGame ?? 0)
    }))
    .slice(0, limit)
}

/** Trending free agents, those covering a short week first. */
export function buildWaiverTrending(model: PlanningModel): PlanningPlayer[] {
  return trendingFreeAgents(model).sort(by((a, b) => {
    if (a.coversWeeks.length !== b.coversWeeks.length) return a.coversWeeks.length > b.coversWeeks.length
    return (a.trendingAdds ?? 0) > (b.trendingAdds ?? 0)
  }))
}

/**
 * When nothing is short, the waiver job is simply "who's worth having":
 * the best free agents by season points per game.
 */
export function buildBestAvailable(model: PlanningModel, limit = 10): PlanningPlayer[] {
  return productionPlayers(model, isFreeAgent)
    .sort(by((a, b) => (a.pointsPerGame ?? 0) > (b.pointsPerGame ?? 0)))
    .slice(0, limit)
}
