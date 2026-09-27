/**
 * Assembles a `LeagueContext` from the data layer — a port of FCApp
 * `LeagueContextLoader`. Every read can come back cached, stale or bundled,
 * and the context carries the weakest of them, so a screen says so once.
 */
import { seasonPaceBaselines } from '@core/Baselines'
import { ByeCalendar } from '@core/ByeWeeks'
import type { RosterEntry } from '@core/ByeCrunch'
import { KickoffCalendar } from '@core/GameClock'
import { hasWeeklyProductionData, type Position } from '@core/Position'
import { runSeasonScan } from '@core/SeasonProfile'
import { fromSleeper } from '@core/SleeperScoring'
import { parseSlots, type SlotTemplate } from '@core/RosterSlots'
import type { WeeklyFile } from '@core/WeeklyStats'
import { CacheTTL } from '@data/cache'
import { DataLayerError } from '@data/errors'
import { weakestProvenance, type Fetched, type Provenance } from '@data/fetched'
import { projectionSourceLabel, type SleeperWeekStat } from '@data/insightsModels'
import { playerNflverseTeam, playerPosition, type PlayerIndex } from '@data/playerIndex'
import { sleeperIDsByGSIS } from '@data/playerIdCrosswalk'
import { filledStarters, memberLabel, seasonYear, type SleeperRoster } from '@data/sleeperModels'
import type { SleeperService } from '@data/SleeperService'
import type { StaticDataStore } from '@data/StaticDataStore'
import { playerIndexMaxAge } from './GameDayWindow'
import type { InSeasonData } from './InSeasonData'
import { LeagueContext, leagueFactsFrom, MINIMUM_WEEKS_FOR_STATS_SEASON, type Availability, type LeagueTeam } from './LeagueContext'

export interface LoadRequest {
  leagueID: string
  userRosterID: number
  /** Overrides the schedule season; normally the one Sleeper says is current. */
  season?: number
  /** Rebuild even if a recent context exists — a league change or pull to refresh. */
  force?: boolean
}

export class LeagueContextLoader {
  private readonly memo: ContextMemo

  /**
   * @param reuseForMs how long an assembled context is shared before rebuilding;
   *   Board, Matchup and Planning share one loader.
   * @param now the clock, injected so tests and the demo league can fix it.
   */
  constructor(
    private readonly sleeper: SleeperService,
    private readonly staticData: StaticDataStore,
    private readonly now: () => number = Date.now,
    reuseForMs = 60_000,
  ) {
    this.memo = new ContextMemo(reuseForMs)
  }

  load(request: LoadRequest): Promise<LeagueContext> {
    const key = `${request.leagueID}|${request.userRosterID}|${request.season ?? ''}`
    return this.memo.value(key, request.force ?? false, () => this.assemble(request))
  }

  private async assemble({ leagueID, userRosterID, season, force = false }: LoadRequest): Promise<LeagueContext> {
    const state = await this.sleeper.nflState(force)
    const scheduleSeason = season ?? seasonYear(state.value) ?? new Date(this.now()).getFullYear()
    const currentWeek = state.value.week ?? 1
    const league = await this.sleeper.league(leagueID, force)
    const rosters = await this.sleeper.rosters(leagueID, force)
    const members = await this.sleeper.members(leagueID, force)
    // The schedule first: it decides how fresh the player index has to be.
    const schedule = await this.staticData.schedule(scheduleSeason)
    const kickoffs = new KickoffCalendar(schedule.value)
    const players = await this.sleeper.playerIndex(false, playerIndexMaxAge(kickoffs, currentWeek, this.now()))
    const stats = await this.loadStatsSeason(scheduleSeason)
    const crosswalk = await this.staticData.playerCrosswalk()
    const template = parseSlots(league.value.rosterPositions)
    const scoring = fromSleeper(league.value.scoringSettings ?? {}, league.value.name ?? 'League')

    const managerNames = new Map<string, string>()
    for (const m of members.value) if (!managerNames.has(m.userID)) managerNames.set(m.userID, memberLabel(m))
    const teams: LeagueTeam[] = rosters.value.map((roster) => ({
      rosterID: roster.rosterID,
      ownerID: roster.ownerID,
      manager: (roster.ownerID && managerNames.get(roster.ownerID)) || `Roster ${roster.rosterID}`,
      isUser: roster.rosterID === userRosterID,
      roster: rosterEntries(roster, players.value),
      starterIDs: filledStarters(roster),
      rawStarters: roster.starters ?? [],
      settings: roster.settings,
      reserveIDs: roster.reserve ?? [],
    }))

    const seasonProfiles = runSeasonScan(stats.weekly.value, scoring.profile)
    const baselines = seasonPaceBaselines(seasonProfiles, template, teams.length)
    // Forward-looking reads never fail the load.
    const inSeason = await this.loadInSeason(scheduleSeason, currentWeek, force, kickoffs)
    const userRoster = rosters.value.find((r) => r.rosterID === userRosterID)
    const sleeperProvs = [state, league, rosters, members, players].map((f) => f.provenance)
    const staticProvs = [schedule, stats.weekly, crosswalk].map((f) => f.provenance)

    return new LeagueContext({
      league: league.value,
      scheduleSeason,
      statsSeason: stats.season,
      currentSeasonWeeks: stats.currentSeasonWeeks,
      template,
      scoring,
      teams,
      userRosterID,
      byeCalendar: new ByeCalendar(schedule.value),
      kickoffs,
      now: this.now,
      schedule: schedule.value,
      weekly: stats.weekly.value,
      currentWeek,
      seasonWeeks: Object.keys(schedule.value.byWeek).filter((k) => /^[+-]?\d+$/.test(k)).map(Number).sort((a, b) => a - b),
      seasonProfiles,
      baselines,
      sleeperIDsByGSIS: sleeperIDsByGSIS(crosswalk.value),
      availabilityBySleeperID: availability(teams, userRosterID),
      unsupportedPositions: unsupportedStartingPositions(template),
      players: players.value,
      provenance: weakestProvenance([...sleeperProvs, ...staticProvs]),
      sleeperProvenance: weakestProvenance(sleeperProvs),
      staticProvenance: weakestProvenance(staticProvs),
      leagueFacts: leagueFactsFrom(league.value, userRoster?.settings),
      inSeason,
    })
  }

  /** Each in-season read fails soft and names itself when missing. */
  private async loadInSeason(season: number, currentWeek: number, force: boolean, kickoffs: KickoffCalendar): Promise<InSeasonData> {
    const soft = <T>(p: Promise<T>) => p.catch(() => undefined)
    const onGameDay = playerIndexMaxAge(kickoffs, currentWeek, this.now()) < CacheTTL.players
    const projectionMaxAge = onGameDay ? 60 * 60 : CacheTTL.projections
    const weeks = Array.from({ length: Math.max(1, currentWeek) }, (_, i) => i + 1)
    const [projections, injuries, depth, usage, teamContext, ...statReads] = await Promise.all([
      soft(this.sleeper.projections(season, currentWeek, force, projectionMaxAge)),
      soft(this.staticData.injuries(season)),
      soft(this.staticData.depthCharts(season)),
      soft(this.staticData.usage(season)),
      soft(this.staticData.teamContext(season)),
      ...weeks.map((week) => soft(this.sleeper.weekStats(season, week, week < currentWeek, force && week === currentWeek))),
    ])

    const unavailable: string[] = []
    if (!projections) unavailable.push('Rotowire projections via Sleeper')
    if (!injuries) unavailable.push('official injury report')
    if (!depth) unavailable.push('depth charts')
    if (!usage) unavailable.push('snap counts and expected points')
    if (!teamContext) unavailable.push('team context')

    const weekStats = new Map<number, Map<string, SleeperWeekStat>>()
    const statProvenances: Provenance[] = []
    const missing: number[] = []
    ;(statReads as (Fetched<SleeperWeekStat[]> | undefined)[]).forEach((read, i) => {
      const week = weeks[i]!
      if (!read) { missing.push(week); return }
      statProvenances.push(read.provenance)
      const byID = new Map<string, SleeperWeekStat>()
      for (const line of read.value) if (!byID.has(line.playerID)) byID.set(line.playerID, line)
      weekStats.set(week, byID)
    })
    if (missing.length) unavailable.push(`Sleeper stats for week${missing.length === 1 ? '' : 's'} ${missing.join(', ')}`)

    const projectionsByID = new Map((projections?.value ?? []).map((p) => [p.playerID, p] as const).reverse())
    const sleeperProvs = [...(projections ? [projections.provenance] : []), ...statProvenances]
    const fileProvs = [injuries, depth, usage, teamContext].filter((f) => f !== undefined).map((f) => f!.provenance)
    return {
      projections: projectionsByID,
      weekStats,
      practiceReports: injuries?.value.reportsByPlayer(currentWeek) ?? new Map(),
      depthCharts: depth?.value,
      usage: usage?.value,
      teamContext: teamContext?.value,
      sleeperProvenance: sleeperProvs.length ? weakestProvenance(sleeperProvs) : undefined,
      filesProvenance: fileProvs.length ? weakestProvenance(fileProvs) : undefined,
      unavailable,
      projectionSourceLabel: projections?.value[0] ? projectionSourceLabel(projections.value[0]) : undefined,
    }
  }

  /**
   * The weekly file to use — not necessarily this season's: the newest listed
   * season at or before the schedule season with at least three weeks of games,
   * then thinner ones, then last season and this one without a manifest.
   */
  private async loadStatsSeason(scheduleSeason: number): Promise<{ season: number; weekly: Fetched<WeeklyFile>; currentSeasonWeeks: number }> {
    const listed = (await this.staticData.weeklyManifest().catch(() => undefined))?.value.seasons ?? []
    const eligible = listed.filter((s) => s.season <= scheduleSeason).sort((a, b) => b.season - a.season)
    const current = listed.find((s) => s.season === scheduleSeason)
    const currentSeasonWeeks = current ? weeksPlayed(current) : 0
    let candidates = [
      ...eligible.filter((s) => weeksPlayed(s) >= MINIMUM_WEEKS_FOR_STATS_SEASON).map((s) => s.season),
      ...eligible.filter((s) => weeksPlayed(s) < MINIMUM_WEEKS_FOR_STATS_SEASON).map((s) => s.season),
    ]
    if (candidates.length === 0) candidates = [scheduleSeason - 1, scheduleSeason]
    let lastError: unknown = new DataLayerError({ kind: 'noFallbackAvailable', resource: `weekly-${scheduleSeason}` })
    for (const season of candidates) {
      try {
        return { season, weekly: await this.staticData.weeklyFile(season), currentSeasonWeeks }
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
}

/** Weeks of games a season has, 18 for a complete one. */
export const weeksPlayed = (s: { weeks?: number; latestWeek?: number }) => s.weeks ?? s.latestWeek ?? 0

/**
 * A player the index doesn't know still becomes an entry with no position —
 * the crunch reports it rather than quietly dropping a roster spot.
 */
function rosterEntries(roster: SleeperRoster, players: PlayerIndex): RosterEntry[] {
  return (roster.players ?? []).map((id) => {
    const p = players.players[id]
    return { id, position: p ? playerPosition(p) : undefined, team: (p && playerNflverseTeam(p)) ?? p?.team }
  })
}

function availability(teams: readonly LeagueTeam[], userRosterID: number): Map<string, Availability> {
  const out = new Map<string, Availability>()
  for (const team of teams) {
    const starting = new Set(team.starterIDs)
    for (const e of team.roster) {
      out.set(e.id, team.rosterID === userRosterID ? { kind: 'mine' }
        : starting.has(e.id) ? { kind: 'rivalStarter', rosterID: team.rosterID, manager: team.manager }
        : { kind: 'rivalBench', rosterID: team.rosterID, manager: team.manager })
    }
  }
  return out
}

/** Starting positions with no production data behind them — stated, not hidden. */
function unsupportedStartingPositions(template: SlotTemplate): Position[] {
  const positions = new Set<Position>()
  for (const slot of template.starters) {
    if (slot.dedicated) { if (!hasWeeklyProductionData(slot.dedicated)) positions.add(slot.dedicated) }
    else for (const p of slot.eligible) if (!hasWeeklyProductionData(p)) positions.add(p)
  }
  return [...positions].sort()
}

/**
 * Shares one assembled context between screens; two asking at once get the
 * same in-flight load. A failure isn't memoised.
 */
class ContextMemo {
  private readonly entries = new Map<string, { builtAt: number; context: LeagueContext }>()
  private readonly inFlight = new Map<string, Promise<LeagueContext>>()

  constructor(private readonly maxAgeMs: number) {}

  async value(key: string, force: boolean, make: () => Promise<LeagueContext>): Promise<LeagueContext> {
    const entry = this.entries.get(key)
    if (!force && entry && Date.now() - entry.builtAt < this.maxAgeMs) return entry.context
    const running = this.inFlight.get(key)
    if (!force && running) return running
    const task = make()
    this.inFlight.set(key, task)
    try {
      const context = await task
      this.entries.set(key, { builtAt: Date.now(), context })
      return context
    } finally {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key)
    }
  }
}
