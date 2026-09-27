/**
 * The My Team hub's pieces — a port of FCApp `MyTeamModel.swift`
 * (`MyTeamZoom`, `LineupReadiness`, `WeekResult`, `UpcomingOpponent`,
 * `ByeStripWeek` and the `DashboardModel` extension that builds them).
 */
import { crunchForWeek } from '@core/ByeCrunch'
import { EMPTY_STARTER_SLOT, type SleeperMatchup } from '@data/sleeperModels'
import { startAvailability, type LeagueContext, type LeagueTeam } from '../league/LeagueContext'
import { buildGrid } from '../market/PlanningModel'
import type { SeasonHistory } from './SeasonHistory'
import type { StandingsRow } from './DashboardModel'

/** The two altitudes of the My Team hub. */
export type MyTeamZoom = 'thisWeek' | 'season'
export const MY_TEAM_ZOOMS: readonly MyTeamZoom[] = ['thisWeek', 'season']
/** Swift's raw values. */
export const myTeamZoomLabel: Readonly<Record<MyTeamZoom, string>> = {
  /** Five feet: this week's lineup, matchup and what to fix. */
  thisWeek: 'This Week',
  /** Ten thousand feet: the season and the league around you. */
  season: 'Season',
}

// MARK: - Readiness

/**
 * The state of every starting slot this week, as counts of facts.
 *
 * Deliberately not a score (§6): each slot lands in exactly one bucket for a
 * stated reason, and the ring shows the counts. It is built from the same
 * rules as the Dashboard alerts, so the two can never disagree.
 */
export interface LineupReadiness {
  slots: number
  /** Filled, playing, no injury tag. */
  ready: number
  /** Tagged Questionable — may play. */
  caution: number
  /** Empty, on bye, or tagged Out/Doubtful/IR and similar. */
  problems: number
  /** Already kicked off, so nothing more can be done either way. */
  settled: number
}

export const isAllClear = (r: LineupReadiness) => r.caution === 0 && r.problems === 0

/** Injury tags that mean a player is very unlikely to play. */
export const READINESS_PROBLEM_TAGS: ReadonlySet<string> = new Set(['OUT', 'DOUBTFUL', 'IR', 'PUP', 'SUS', 'NA', 'COV'])

export function buildLineupReadiness(context: LeagueContext): LineupReadiness | undefined {
  const team = context.userTeam
  if (!team) return undefined
  const slotCount = context.template.starters.length
  let ready = 0, caution = 0, problems = 0, settled = 0

  for (let index = 0; index < slotCount; index++) {
    const id = index < team.rawStarters.length ? team.rawStarters[index]! : EMPTY_STARTER_SLOT
    if (id === EMPTY_STARTER_SLOT || id === '') {
      problems += 1
      continue
    }
    if (context.isLocked(id)) {
      settled += 1
    } else if (context.byeCalendar.isOnBye(context.nflTeam(id), context.currentWeek)) {
      problems += 1
    } else {
      // The same rule Sit/Start uses, so the ring and the lineup advice can
      // never disagree about who is fit to start.
      switch (startAvailability(id, context).kind) {
        case 'unavailable': problems += 1; break
        case 'questionable': caution += 1; break
        case 'clear':
          // Any other tag Sleeper invents is a caution, not a pass.
          if (context.injuryStatus(id) !== undefined) caution += 1
          else ready += 1
          break
      }
    }
  }
  return { slots: slotCount, ready, caution, problems, settled }
}

// MARK: - Results

/** Swift's `WeekResult.Outcome` raw values. */
export type WeekOutcome = 'W' | 'L' | 'T'

/** One completed week, from your side. `week` is its identity. */
export interface WeekResult {
  week: number
  myPoints: number
  opponentPoints: number
  opponentManager: string
  outcome: WeekOutcome
}

/** A future opponent, and whether either side has a bye problem that week. */
export interface UpcomingOpponent {
  week: number
  rosterID: number
  manager: string
  record?: string
  /** Starting slots you can't fill that week. */
  yourShortfall: number
  /** Starting slots they can't fill that week. */
  theirShortfall: number
}

/** One remaining week on the season bye strip. */
export interface ByeStripWeek {
  week: number
  yourShortfall: number
  teamsShort: number
  teamCount: number
}

// MARK: - Results and streak

export function buildResults(context: LeagueContext, history: SeasonHistory): WeekResult[] {
  const managers = new Map<number, string>()
  for (const t of context.teams) if (!managers.has(t.rosterID)) managers.set(t.rosterID, t.manager)
  const out: WeekResult[] = []
  for (const mine of history.weeksForRoster(context.userRosterID)) {
    const matchupID = mine.matchupID
    const myPoints = mine.points
    if (matchupID === undefined || myPoints === undefined) continue
    let opponent
    for (const [rosterID, weeks] of history.byRoster) {
      if (rosterID === context.userRosterID) continue
      const found = weeks.find((w) => w.week === mine.week && w.matchupID === matchupID)
      if (found) { opponent = found; break }
    }
    const theirPoints = opponent?.points
    if (!opponent || theirPoints === undefined) continue
    const outcome: WeekOutcome = Math.abs(myPoints - theirPoints) < 0.005 ? 'T' : (myPoints > theirPoints ? 'W' : 'L')
    out.push({
      week: mine.week,
      myPoints,
      opponentPoints: theirPoints,
      opponentManager: managers.get(opponent.rosterID) ?? `Roster ${opponent.rosterID}`,
      outcome,
    })
  }
  return out
}

/** "W3" — the current run of identical results, most recent first. */
export function streak(results: readonly WeekResult[]): string | undefined {
  // Swift's `max(by:)` keeps the first of equal maxima.
  let last: WeekResult | undefined
  for (const r of results) if (last === undefined || last.week < r.week) last = r
  if (!last) return undefined
  const sorted = [...results].sort((a, b) => b.week - a.week)
  let run = 0
  for (const r of sorted) {
    if (r.outcome !== last.outcome) break
    run += 1
  }
  return `${last.outcome}${run}`
}

// MARK: - Standings place

export function place(standings: readonly StandingsRow[]): { rank: number; of: number } | undefined {
  const index = standings.findIndex((r) => r.isUser)
  return index < 0 ? undefined : { rank: index + 1, of: standings.length }
}

// MARK: - Upcoming opponents

export function buildUpcoming(context: LeagueContext, matchupsByWeek: ReadonlyMap<number, readonly SleeperMatchup[]>): UpcomingOpponent[] {
  const userTeam = context.userTeam
  if (!userTeam) return []
  const shortfall = (team: LeagueTeam, week: number) =>
    crunchForWeek(team.roster, context.template, context.byeCalendar.byeTeams(week)).totalShortfall
  const out: UpcomingOpponent[] = []
  for (const week of [...matchupsByWeek.keys()].sort((a, b) => a - b)) {
    const matchups = matchupsByWeek.get(week) ?? []
    const mine = matchups.find((m) => m.rosterID === userTeam.rosterID)
    const matchupID = mine?.matchupID
    if (!mine || matchupID === undefined) continue
    const theirs = matchups.find((m) => m.matchupID === matchupID && m.rosterID !== userTeam.rosterID)
    if (!theirs) continue
    const rival = context.teams.find((t) => t.rosterID === theirs.rosterID)
    if (!rival) continue
    const settings = rival.settings
    let record: string | undefined
    if (settings) {
      const ties = settings.ties ?? 0
      record = ties > 0
        ? `${settings.wins ?? 0}-${settings.losses ?? 0}-${ties}`
        : `${settings.wins ?? 0}-${settings.losses ?? 0}`
    }
    out.push({
      week, rosterID: rival.rosterID, manager: rival.manager, record,
      yourShortfall: shortfall(userTeam, week),
      theirShortfall: shortfall(rival, week),
    })
  }
  return out
}

// MARK: - Season bye strip

export function buildByeStrip(context: LeagueContext): ByeStripWeek[] {
  const grid = buildGrid(context)
  return context.remainingWeeks.map((week) => {
    const cells = grid.filter((c) => c.week === week)
    return {
      week,
      yourShortfall: cells.find((c) => c.rosterID === context.userRosterID)?.shortfall ?? 0,
      teamsShort: cells.filter((c) => c.isShort).length,
      teamCount: context.teams.length,
    }
  })
}
