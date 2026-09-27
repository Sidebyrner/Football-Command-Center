/**
 * The Planning screen's state — a port of FCApp `PlanningModel` (with the
 * `PlanningJobs` extension's methods delegating to `./PlanningJobs`).
 *
 * Two halves and the link between them, which is the whole reason they share a
 * screen (§7.4): the grid says which weeks break, and selecting a shortfall
 * filters the board to players who can actually play that week.
 */
import { acquisitionBoard, type AcquisitionCandidate, type SignalHit } from '@core/AcquisitionSignals'
import { crunchOutlook, type CrunchReport } from '@core/ByeCrunch'
import type { Position } from '@core/Position'
import type { TrendingPlayer } from '@data/sleeperModels'
import type { SleeperService } from '@data/SleeperService'
import { freshnessLabel, isDegraded } from '../league/Freshness'
import type { Availability, LeagueContext, LeagueTeam } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { Observable } from '../Observable'
import {
  buildBestAvailable, buildTradeTargets, buildWaiverFills, buildWaiverTrending, coversWeeks, currentTeam,
  neededPositions, pickups, shortWeekNumbers, type PlanningMode, type PlanningPlayer, type TradeTarget,
} from './PlanningJobs'

/** One cell of the bye-crunch grid: what a team cannot field in a given week. */
export class CrunchCell {
  constructor(readonly rosterID: number, readonly week: number, readonly report: CrunchReport) {}

  get id(): string { return `${this.rosterID}-${this.week}` }
  get shortfall(): number { return this.report.totalShortfall }
  get isShort(): boolean { return this.report.totalShortfall > 0 }

  /** The positions actually short, for the cell's detail. */
  get shortPositions(): Position[] {
    return (Object.entries(this.report.byPosition) as [Position, { shortfall: number }][])
      .filter(([, c]) => c.shortfall > 0)
      .map(([p]) => p)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }
}

/** A row of the acquisition board. */
export class BoardRow {
  /**
   * @param sleeperID the player's Sleeper id, when the crosswalk knows it.
   *   `undefined` for anyone the export has no row for.
   */
  constructor(readonly candidate: AcquisitionCandidate, readonly availability: Availability, readonly sleeperID?: string) {}

  get id(): string { return this.candidate.player.gsisID }
  get name(): string { return this.candidate.player.name }
  get position(): Position { return this.candidate.player.position }
  get team(): string | undefined { return this.candidate.player.team }
  get signals(): SignalHit[] { return this.candidate.signals }
  get valueOverStartLine(): number { return this.candidate.valueOverStartLine }
}

/** Swift's `String(describing: error)`, near enough: the error's own message. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PlanningModel extends Observable {
  context?: LeagueContext
  grid: CrunchCell[] = []
  board: BoardRow[] = []
  isLoading = false
  errorMessage?: string

  private _selectedWeek?: number
  private _excludeOwnPlayers = true

  private _mode: PlanningMode = 'byes'

  tradeTargets: TradeTarget[] = []
  waiverFills: PlanningPlayer[] = []
  waiverTrending: PlanningPlayer[] = []
  bestAvailable: PlanningPlayer[] = []
  /**
   * Set when trending adds could not be loaded, so the popularity-only
   * sections can say why they are empty.
   */
  trendingUnavailable = false

  /** The relay the trade wizard polishes pitches through. Optional, like every relay feature. */
  relayBaseURL?: string

  /** League-wide trending adds, the only data covering DEF and IDP. */
  trending: TrendingPlayer[] = []

  /**
   * Bumped by each successful pull-to-refresh, so the screen can play a
   * success haptic for a refresh without also playing one on first load.
   */
  refreshCount = 0

  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  /**
   * @param sleeper for trending adds. Optional: without it the planner still
   *   works on production data alone, and says the trending sections are
   *   unavailable.
   */
  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper?: SleeperService) {
    super()
  }

  /**
   * The week whose shortfall the user tapped. Filters the board to players
   * not themselves on bye that week.
   */
  get selectedWeek(): number | undefined { return this._selectedWeek }
  set selectedWeek(week: number | undefined) {
    this._selectedWeek = week
    this.rebuildBoard()
    this.changed()
  }

  /** Hide players already on the user's roster, which is the default — the board is about who to *get*. */
  get excludeOwnPlayers(): boolean { return this._excludeOwnPlayers }
  set excludeOwnPlayers(value: boolean) {
    this._excludeOwnPlayers = value
    this.rebuildBoard()
    this.changed()
  }

  /** Which of the three jobs is on screen. */
  get mode(): PlanningMode { return this._mode }
  set mode(mode: PlanningMode) {
    this._mode = mode
    this.changed()
  }

  /** Re-reads everything that can change during a week. Wired to pull-to-refresh. */
  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load(request.leagueID, request.rosterID, request.season, true)
    // Only a refresh that actually reached Sleeper counts. A failed fetch
    // falls back to the cached copy, labelled offline — keeping the screen
    // useful, but not something to confirm with a success haptic.
    if (this.errorMessage === undefined && this.context && !isDegraded(this.context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  async load(leagueID: string, userRosterID: number, season?: number, force = false): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()

    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
      this.context = context
      this.grid = buildGrid(context)
      this.rebuildBoard()

      let adds: TrendingPlayer[] | undefined
      if (this.sleeper) {
        try {
          adds = (await this.sleeper.trendingAdds(force)).value
        } catch {
          adds = undefined
        }
      }
      if (adds !== undefined) {
        this.trending = adds
        this.trendingUnavailable = false
      } else {
        this.trending = []
        this.trendingUnavailable = true
      }
      this.tradeTargets = this.buildTradeTargets()
      this.waiverFills = this.buildWaiverFills()
      this.waiverTrending = this.buildWaiverTrending()
      this.bestAvailable = this.buildBestAvailable()
    } catch (error) {
      // Name what failed. "Couldn't load" with no subject is the failure
      // mode §6 exists to prevent.
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Grid

  cell(rosterID: number, week: number): CrunchCell | undefined {
    return this.grid.find((c) => c.rosterID === rosterID && c.week === week)
  }

  /** The user's own row, which the screen breaks out above the rest. */
  userRow(): CrunchCell[] {
    const context = this.context
    if (!context) return []
    return this.grid.filter((c) => c.rosterID === context.userRosterID)
  }

  /** Weeks where the user cannot field a legal lineup — the alarm the screen exists to raise. */
  userShortWeeks(): CrunchCell[] {
    return this.userRow().filter((c) => c.isShort)
  }

  /** Rivals who are *not* short in the same week, which is who the trade is actually available with (§7.4). */
  tradePartners(week: number): LeagueTeam[] {
    const context = this.context
    if (!context) return []
    return context.rivals.filter((team) => {
      const cell = this.cell(team.rosterID, week)
      return cell ? !cell.isShort : false
    })
  }

  // MARK: - Board

  rebuildBoard(): void {
    const context = this.context
    if (!context) {
      this.board = []
      return
    }

    const candidates = acquisitionBoard(context.seasonProfiles, context.baselines)

    const board: BoardRow[] = []
    for (const candidate of candidates) {
      const sleeperID = context.sleeperIDsByGSIS[candidate.player.gsisID]
      const availability = context.availabilityOfGSIS(candidate.player.gsisID)

      if (this._excludeOwnPlayers && availability.kind === 'mine') continue

      // The link between the two halves: with a week selected, a player
      // on bye *that* week cannot solve that week, however good he is.
      const week = this._selectedWeek
      if (week !== undefined && context.byeCalendar.isOnBye(candidate.player.team, week)) continue

      board.push(new BoardRow(candidate, availability, sleeperID))
    }
    this.board = board
  }

  /**
   * What the screen says when a position in the starting lineup has no
   * production data behind it. Stated plainly rather than papered over, and
   * never as a zero (§3.2).
   */
  get coverageWarning(): string | undefined {
    const context = this.context
    if (!context || context.unsupportedPositions.length === 0) return undefined
    const names = context.unsupportedPositions.join(', ')
    return `No production data exists for ${names}. `
      + 'Bye weeks for those slots are still accurate — they come from the schedule, '
      + 'not from stats — but players there are only suggested from trending adds, '
      + 'which measure popularity, not production.'
  }

  /** The one freshness note for the whole screen, since it is assembled from several reads of differing age. */
  get freshnessLabel(): string | undefined {
    return this.context ? freshnessLabel(this.context.provenance) : undefined
  }

  // MARK: - Jobs (Swift's `PlanningJobs` extension)

  /** Positions the user needs in a week: short dedicated positions plus every position of a short flex group. */
  neededPositions(week: number): Set<Position> { return neededPositions(this, week) }
  /** The user's short weeks, soonest first. */
  get shortWeekNumbers(): number[] { return shortWeekNumbers(this) }
  currentTeam(sleeperID: string | undefined, fallback: string | undefined): string | undefined { return currentTeam(this, sleeperID, fallback) }
  coversWeeks(position: Position, team: string | undefined): number[] { return coversWeeks(this, position, team) }
  pickups(week: number, limit = 8): PlanningPlayer[] { return pickups(this, week, limit) }
  buildTradeTargets(): TradeTarget[] { return buildTradeTargets(this) }
  buildWaiverFills(limit = 12): PlanningPlayer[] { return buildWaiverFills(this, limit) }
  buildWaiverTrending(): PlanningPlayer[] { return buildWaiverTrending(this) }
  buildBestAvailable(limit = 10): PlanningPlayer[] { return buildBestAvailable(this, limit) }
}

export function buildGrid(context: LeagueContext): CrunchCell[] {
  const cells: CrunchCell[] = []
  for (const team of context.teams) {
    const outlook = crunchOutlook(team.roster, context.template, context.byeCalendar, context.remainingWeeks)
    for (const [week, report] of outlook) cells.push(new CrunchCell(team.rosterID, week, report))
  }
  return cells.sort((a, b) => (a.week === b.week ? a.rosterID - b.rosterID : a.week - b.week))
}
