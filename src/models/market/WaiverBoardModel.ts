/**
 * Waiver Board — a port of FCApp `WaiverBoardModel` and its `RowBuilder`:
 * every free agent with what he has actually been doing and what he is
 * projected to do, ranked on one named column at a time.
 */
import { acquisitionSignals, type SignalHit } from '@core/AcquisitionSignals'
import { baselineLines, type Baselines } from '@core/Baselines'
import { crunchOutlook, neededPositions } from '@core/ByeCrunch'
import { optimizeLineup } from '@core/LineupOptimizer'
import { nflverseTeam } from '@core/NFLTeams'
import { IDP, type Position } from '@core/Position'
import type { SeasonProfile } from '@core/SeasonProfile'
import { roundAwayFromZero } from '@core/rounding'
import { weekLines, type TeamGameLine } from '@core/Schedule'
import {
  defensiveSnapShare, linePosition, offensiveSnapShare, played, redZoneCarries, redZoneTargets, scoreLine, targets,
} from '@data/insightsModels'
import { activePlayers, hasInjuryDesignation, playerPosition, type IndexedPlayer } from '@data/playerIndex'
import type { SleeperService } from '@data/SleeperService'
import { isDegraded } from '../league/Freshness'
import { hasProjections, statLines } from '../league/InSeasonData'
import {
  availabilityLabel, benchIDs, blocksStart, faabRemaining, startAvailability,
  type Availability, type LeagueContext, type WaiverSystem,
} from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { Observable } from '../Observable'
import { byPredicate, InjurySeverity, injurySeverity } from './InjuryCenterModel'

// MARK: - Columns

/**
 * One column the board can rank on. Each is a separately named measure from
 * a named source; the board never folds them into one number (§6).
 */
export type WaiverSort =
  | 'projectedOverLine' | 'projected' | 'expectedPoints' | 'snapShare' | 'targetShare'
  | 'redZone' | 'sleeperPointsPerGame' | 'seasonPointsPerGame' | 'trending'

/** Swift's `allCases`, in declaration order — the order the columns are offered. */
export const WAIVER_SORTS: readonly WaiverSort[] = [
  'projectedOverLine', 'projected', 'expectedPoints', 'snapShare', 'targetShare',
  'redZone', 'sleeperPointsPerGame', 'seasonPointsPerGame', 'trending',
]

export const WAIVER_SORT_LABEL: Readonly<Record<WaiverSort, string>> = {
  projectedOverLine: 'Proj. over start line',
  projected: 'Projected this week',
  expectedPoints: 'Expected pts, last 4',
  snapShare: 'Snap share, last 4',
  targetShare: 'Target share, last 4',
  redZone: 'Red zone touches, last 4',
  sleeperPointsPerGame: 'This season pts/gm',
  seasonPointsPerGame: 'Stats season pts/gm',
  trending: 'Trending adds',
}

export const WAIVER_SORT_SOURCE: Readonly<Record<WaiverSort, string>> = {
  projectedOverLine: 'Rotowire via Sleeper, in your scoring',
  projected: 'Rotowire via Sleeper, in your scoring',
  expectedPoints: 'ffopportunity expected fantasy points, a usage measure',
  snapShare: 'Sleeper weekly stat lines',
  targetShare: 'Sleeper weekly stat lines',
  redZone: 'Sleeper weekly stat lines',
  sleeperPointsPerGame: 'Sleeper weekly stat lines, in your scoring',
  seasonPointsPerGame: 'nflverse weekly file, in your scoring',
  trending: 'Sleeper league-wide add counts — popularity, not production',
}

/** Short unit for the prominent number. */
export const WAIVER_SORT_UNIT: Readonly<Record<WaiverSort, string>> = {
  projectedOverLine: 'over line',
  projected: 'proj',
  expectedPoints: 'xFP',
  snapShare: 'snaps',
  targetShare: 'tgt share',
  redZone: 'RZ',
  sleeperPointsPerGame: 'pts/gm',
  seasonPointsPerGame: 'pts/gm',
  trending: 'adds',
}

export const waiverSortIsPercent = (sort: WaiverSort) => sort === 'snapShare' || sort === 'targetShare'

// MARK: - Rows

/**
 * One free agent (or rival bench player) with every measure the board shows.
 * Every measure is optional: absent is not zero.
 */
export interface WaiverRow {
  id: string
  name: string
  position: Position
  team?: string
  opponent?: string
  availability: Availability
  byeWeek?: number
  injuryTag?: string
  playsThisWeek: boolean
  isLocked: boolean
  projected?: number
  projectedOverLine?: number
  expectedPoints?: number
  snapShare?: number
  targetShare?: number
  redZoneTouches?: number
  sleeperPointsPerGame?: number
  sleeperGames: number
  seasonPointsPerGame?: number
  trendingAdds?: number
  signals: SignalHit[]
  /** Your short weeks he could actually play in at a position you need. */
  coversWeeks: number[]
}

/** Swift `WaiverRow.value(_:)`. */
export function waiverRowValue(row: WaiverRow, sort: WaiverSort): number | undefined {
  switch (sort) {
    case 'projectedOverLine': return row.projectedOverLine
    case 'projected': return row.projected
    case 'expectedPoints': return row.expectedPoints
    case 'snapShare': return row.snapShare
    case 'targetShare': return row.targetShare
    case 'redZone': return row.redZoneTouches
    case 'sleeperPointsPerGame': return row.sleeperPointsPerGame
    case 'seasonPointsPerGame': return row.seasonPointsPerGame
    case 'trending': return row.trendingAdds
  }
}

/** A sort key with no value ranks last — Swift's `…ForSort` properties for desktop tables. */
export const waiverRowSortKey = (row: WaiverRow, sort: WaiverSort): number => waiverRowValue(row, sort) ?? -Infinity

export const waiverRowAvailabilityLabel = (row: WaiverRow) => availabilityLabel(row.availability)

/** At least one of the nine columns has a number. */
export const waiverRowHasAnyMeasure = (row: WaiverRow) => WAIVER_SORTS.some((s) => waiverRowValue(row, s) !== undefined)

/** One of your bench players as a drop. */
export interface DropCandidate {
  /** Same as `row.id`. */
  id: string
  row: WaiverRow
  /** Tagged with a status Sleeper lets you park on IR. */
  irEligible: boolean
  /** "Out" — IR-eligible only if the league allows it. */
  maybeIRWithLeagueSetting: boolean
}

/** What a claim does to your best legal lineup this week, on the projection. */
export interface PairEffect {
  addID: string
  dropID: string
  before?: number
  after?: number
  delta?: number
  basisLabel: string
  /** Why there is no delta, when there is none. */
  note?: string
}

/** The league rules that price a claim, for the strip at the top. */
export interface WaiverFacts {
  system: WaiverSystem
  waiverPosition?: number
  faabRemaining?: number
  processingDay?: string
  irSlots: number
  irUsed: number
  benchCount: number
  teamCount: number
}

export const waiverFactsIRFree = (f: WaiverFacts) => Math.max(0, f.irSlots - f.irUsed)

export const WAIVER_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Swift `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not newlines. */
const trimWhitespaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

// MARK: - The model

export class WaiverBoardModel extends Observable {
  context?: LeagueContext
  isLoading = false
  errorMessage?: string
  rows: WaiverRow[] = []
  dropCandidates: DropCandidate[] = []
  facts?: WaiverFacts
  trendingUnavailable = false
  refreshCount = 0
  /**
   * Projected start line per position, from every projected player in the
   * league's pool — the Nth-best projected line, N = dedicated slots × teams.
   */
  projectedLines: Baselines = {}

  private _sort: WaiverSort = 'projectedOverLine'
  private _positionFilter?: Position
  private _includeRivalBenches = false
  private _query = ''
  private _playingThisWeekOnly = false

  private allRows: WaiverRow[] = []
  private lastRequest?: { leagueID: string; rosterID: number; season?: number }

  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper?: SleeperService) {
    super()
  }

  get sort(): WaiverSort { return this._sort }
  set sort(value: WaiverSort) { this._sort = value; this.applyFilters() }

  get positionFilter(): Position | undefined { return this._positionFilter }
  set positionFilter(value: Position | undefined) { this._positionFilter = value; this.applyFilters() }

  get includeRivalBenches(): boolean { return this._includeRivalBenches }
  set includeRivalBenches(value: boolean) { this._includeRivalBenches = value; this.applyFilters() }

  get query(): string { return this._query }
  set query(value: string) { this._query = value; this.applyFilters() }

  /** Hide players whose team is on bye this week. */
  get playingThisWeekOnly(): boolean { return this._playingThisWeekOnly }
  set playingThisWeekOnly(value: boolean) { this._playingThisWeekOnly = value; this.applyFilters() }

  async refresh(): Promise<void> {
    const request = this.lastRequest
    if (!request) return
    await this.load({ leagueID: request.leagueID, userRosterID: request.rosterID, season: request.season, force: true })
    if (this.errorMessage === undefined && this.context && !isDegraded(this.context.provenance)) {
      this.refreshCount += 1
      this.changed()
    }
  }

  async load({ leagueID, userRosterID, season, force = false }: { leagueID: string; userRosterID: number; season?: number; force?: boolean }): Promise<void> {
    this.lastRequest = { leagueID, rosterID: userRosterID, season }
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()
    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
      this.context = context

      const trending: Record<string, number> = {}
      let adds: { playerID: string; count: number }[] | undefined
      if (this.sleeper) {
        try {
          adds = (await this.sleeper.trendingAdds(force)).value
        } catch {
          adds = undefined
        }
      }
      if (adds) {
        for (const a of adds) if (!Object.hasOwn(trending, a.playerID)) trending[a.playerID] = a.count
        this.trendingUnavailable = false
      } else {
        this.trendingUnavailable = true
      }

      const builder = new RowBuilder(context, trending)
      this.projectedLines = builder.projectedLines
      this.allRows = builder.acquirableRows()
      this.dropCandidates = builder.dropCandidates()
      this.facts = buildWaiverFacts(context)
      this.fallBackToAValuedSort()
      this.applyFilters()
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  // MARK: - Filtering and sorting

  /**
   * A column nobody on the board has a number for is a wall of dashes, not
   * a ranking. When the current sort values no one — projections unreachable,
   * or a season with no Sleeper lines yet — move to the first column that
   * does, in the order the columns are offered.
   */
  fallBackToAValuedSort(): void {
    if (this.allRows.length === 0 || !this.allRows.every((r) => waiverRowValue(r, this.sort) === undefined)) return
    const usable = WAIVER_SORTS.find((column) => this.allRows.some((r) => waiverRowValue(r, column) !== undefined))
    if (usable !== undefined) this.sort = usable
  }

  /**
   * Every free agent at these positions, whatever the board's filters say —
   * the Decide hopper must not change when the user sorts the board.
   */
  freeAgents(eligible: ReadonlySet<Position>): WaiverRow[] {
    return this.allRows.filter((r) => r.availability.kind === 'freeAgent' && eligible.has(r.position))
  }

  applyFilters(): void {
    const needle = trimWhitespaces(this.query).toLowerCase()
    const positionFilter = this.positionFilter
    const out = this.allRows.filter((row) => {
      if (!this.includeRivalBenches && row.availability.kind !== 'freeAgent') return false
      if (positionFilter !== undefined && row.position !== positionFilter) return false
      if (this.playingThisWeekOnly && !row.playsThisWeek) return false
      if (needle !== '' && !row.name.toLowerCase().includes(needle) && !(row.team?.toLowerCase().includes(needle) ?? false)) return false
      return true
    })
    const sort = this.sort
    out.sort(byPredicate((a, b) => {
      const x = waiverRowValue(a, sort), y = waiverRowValue(b, sort)
      if (x !== undefined && y !== undefined) return x === y ? a.name < b.name : x > y
      if (x !== undefined) return true
      if (y !== undefined) return false
      return a.name < b.name
    }))
    this.rows = out
    this.changed()
  }

  /** Positions the board can filter on: those the league starts, in template order. */
  get filterablePositions(): Position[] {
    const context = this.context
    if (!context) return []
    const seen = new Set<Position>()
    const out: Position[] = []
    for (const slot of context.template.starters) {
      for (const position of [...slot.eligible].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        if (seen.has(position)) continue
        seen.add(position)
        out.push(position)
      }
    }
    return out
  }

  /** Rows the current sort cannot value, for the "and N more without this number" line. */
  get unvaluedCount(): number {
    return this.rows.filter((r) => waiverRowValue(r, this.sort) === undefined).length
  }

  // MARK: - Add/drop pair

  /**
   * What your best legal lineup this week gains from adding one player and
   * dropping another, on Rotowire's projection under your scoring.
   */
  pairEffect(add: WaiverRow, drop: DropCandidate): PairEffect {
    const label = `Projected this week, ${this.context?.inSeason.projectionSourceLabel ?? 'Sleeper'}`
    const context = this.context
    const mine = context?.userTeam
    if (!context || !mine) {
      return { addID: add.id, dropID: drop.id, basisLabel: label, note: 'No league loaded.' }
    }
    if (!hasProjections(context.inSeason)) {
      return { addID: add.id, dropID: drop.id, basisLabel: label, note: 'Projections are unavailable, so the lineup effect cannot be measured.' }
    }
    if (add.projected === undefined) {
      return { addID: add.id, dropID: drop.id, basisLabel: label, note: `${add.name} has no projection this week.` }
    }
    const locked = new Set(mine.roster.map((e) => e.id).filter((id) => context.isLocked(id)))
    // Out, Doubtful and IR players can't be in this week's lineup — the
    // same rule Sit/Start uses — so neither side of the pair counts them.
    const best = (ids: string[]) =>
      optimizeLineup({
        currentStarterIDs: mine.rawStarters,
        playerIDs: ids,
        template: context.template,
        positions: (id) => context.position(id),
        valueOf: (id) => (blocksStart(startAvailability(id, context)) ? undefined : context.projectedPoints(id)),
        locked,
      }).proposedTotal
    const current = mine.roster.map((e) => e.id)
    const before = best(current) ?? 0
    const after = best([...current.filter((id) => id !== drop.id), add.id]) ?? 0
    let note: string | undefined
    const availability = startAvailability(add.id, context)
    if (availability.kind === 'unavailable') {
      note = `${add.name} is ${availability.label}, so he can't help this week's lineup — a stash, not a start.`
    }
    return {
      addID: add.id, dropID: drop.id,
      before, after,
      delta: roundAwayFromZero((after - before) * 10) / 10,
      basisLabel: label, note,
    }
  }

  /** Source notes for the foot of the screen. */
  get sourceNotes(): string[] {
    const context = this.context
    if (!context) return []
    const notes: string[] = [`${WAIVER_SORT_LABEL[this.sort]}: ${WAIVER_SORT_SOURCE[this.sort]}.`]
    const label = context.inSeason.projectionSourceLabel
    if (label !== undefined) {
      notes.push(`Start line: the projected points of the last player your league starts at each position, from ${label}.`)
    }
    const note = context.statsSeasonNote
    if (note !== undefined) notes.push(note)
    if (context.inSeason.unavailable.length > 0) {
      notes.push('Unavailable: ' + context.inSeason.unavailable.join(', ') + '.')
    }
    return notes
  }
}

// MARK: - Facts

export function buildWaiverFacts(context: LeagueContext): WaiverFacts {
  const facts = context.leagueFacts
  const day = facts.waiverDayOfWeek
  return {
    system: facts.waivers,
    waiverPosition: facts.waiverPosition,
    faabRemaining: faabRemaining(facts),
    processingDay: day !== undefined && day >= 0 && day < 7 ? WAIVER_DAY_NAMES[day] : undefined,
    irSlots: facts.irSlots,
    irUsed: context.userTeam?.reserveIDs.length ?? 0,
    benchCount: context.template.benchCount,
    teamCount: facts.teamCount,
  }
}

// MARK: - Row building

const mean = (values: number[]) => values.reduce((s, x) => s + x, 0) / values.length

/**
 * Turns a league context into board rows. Pure once built; kept separate so
 * the joins — Sleeper id to gsis id, per-week team target totals — happen once.
 */
export class RowBuilder {
  readonly projectedLines: Baselines
  private readonly profilesBySleeper = new Map<string, SeasonProfile>()
  private readonly gsisBySleeper: ReadonlyMap<string, string>
  /** Targets thrown by each team in each week, from every Sleeper line. */
  private readonly teamTargets = new Map<number, Map<string, number>>()
  private readonly lines: Record<string, TeamGameLine>
  private readonly neededByWeek = new Map<number, Set<Position>>()
  private readonly scoring: Record<string, number>

  constructor(readonly context: LeagueContext, readonly trending: Readonly<Record<string, number>>) {
    this.scoring = context.league.scoringSettings ?? {}
    this.gsisBySleeper = context.gsisIDsBySleeper

    const byGSIS = new Map<string, SeasonProfile>()
    for (const p of context.seasonProfiles) if (!byGSIS.has(p.gsisID)) byGSIS.set(p.gsisID, p)
    for (const [gsis, sleeper] of Object.entries(context.sleeperIDsByGSIS)) {
      const profile = byGSIS.get(gsis)
      if (profile) this.profilesBySleeper.set(sleeper, profile)
    }

    for (const [week, linesByID] of context.inSeason.weekStats) {
      const byTeam = new Map<string, number>()
      for (const line of linesByID.values()) {
        const team = line.team, tgt = targets(line)
        if (team === undefined || tgt === undefined) continue
        const key = nflverseTeam(team) ?? team
        byTeam.set(key, (byTeam.get(key) ?? 0) + tgt)
      }
      this.teamTargets.set(week, byTeam)
    }

    this.lines = weekLines(context.schedule, context.currentWeek)

    const mine = context.userTeam
    if (mine) {
      const outlook = crunchOutlook(mine.roster, context.template, context.byeCalendar, context.remainingWeeks)
      for (const [week, report] of outlook) if (report.totalShortfall > 0) this.neededByWeek.set(week, neededPositions(report))
    }

    const projectedByPosition: Partial<Record<Position, number[]>> = {}
    for (const projection of context.inSeason.projections.values()) {
      const position = linePosition(projection)
      if (position === undefined) continue
      ;(projectedByPosition[position] ??= []).push(scoreLine(projection, this.scoring).points)
    }
    this.projectedLines = baselineLines(projectedByPosition, context.template, context.teams.length)
  }

  private get startablePositions(): Set<Position> {
    return new Set(this.context.template.starters.flatMap((s) => [...s.eligible]))
  }

  /**
   * Free agents and rivals' bench players at positions the league starts.
   * The Waiver Board keeps only those with at least one measure — a name
   * with no number on any column is not a candidate there, it is noise.
   * Discovery passes `includeNoData` and lists everyone.
   */
  acquirableRows(includeNoData = false): WaiverRow[] {
    const positions = this.startablePositions
    const out: WaiverRow[] = []
    for (const player of activePlayers(this.context.players)) {
      const position = playerPosition(player)
      if (position === undefined || !positions.has(position)) continue
      const availability = this.context.availabilityOf(player.id)
      if (availability.kind === 'mine' || availability.kind === 'rivalStarter') continue
      const row = this.rowFor(player, position, availability)
      if (includeNoData || waiverRowHasAnyMeasure(row)) out.push(row)
    }
    return out
  }

  /** Any player in the pool as a row, wherever he's rostered — Compare may hold your own starters. */
  row(id: string): WaiverRow | undefined {
    const player = this.context.players.players[id]
    const position = player ? playerPosition(player) : undefined
    if (!player || position === undefined) return undefined
    return this.rowFor(player, position, this.context.availabilityOf(id))
  }

  /** Your bench, as rows, with the IR eligibility a drop decision needs. */
  dropCandidates(): DropCandidate[] {
    const context = this.context
    const mine = context.userTeam
    if (!mine) return []
    const out: DropCandidate[] = []
    for (const id of benchIDs(mine)) {
      const player = context.players.players[id]
      const position = player ? playerPosition(player) : undefined
      if (!player || position === undefined) continue
      const row = this.rowFor(player, position, { kind: 'mine' })
      const severity = injurySeverity(player.injuryStatus, context.practiceReport(id))
      out.push({
        id: row.id,
        row,
        irEligible: severity === InjurySeverity.reserve,
        maybeIRWithLeagueSetting: severity === InjurySeverity.out,
      })
    }
    // Weakest first on the projection, unvalued last — the ones you
    // would drop, not the ones you would keep.
    return out.sort(byPredicate((a, b) => {
      const x = a.row.projected, y = b.row.projected
      if (x !== undefined && y !== undefined) return x < y
      if (x !== undefined) return true
      if (y !== undefined) return false
      return a.row.name < b.row.name
    }))
  }

  rowFor(player: IndexedPlayer, position: Position, availability: Availability): WaiverRow {
    const context = this.context
    const id = player.id
    const team = context.nflTeam(id)
    const gsis = this.gsisBySleeper.get(id)
    const profile = this.profilesBySleeper.get(id)
    const recent = statLines(context.inSeason, id).filter(played).slice(-4)

    const projected = context.projectedPoints(id)
    const startLine = this.projectedLines[position]?.startLine
    const overLine = projected !== undefined && startLine !== undefined ? projected - startLine : undefined

    const snapShares = recent
      .map((line) => (IDP.has(position) ? defensiveSnapShare(line) : offensiveSnapShare(line)))
      .filter((x): x is number => x !== undefined)
    const targetShares: number[] = []
    for (const line of recent) {
      const week = line.week, lineTeam = line.team, tgt = targets(line)
      if (week === undefined || lineTeam === undefined || tgt === undefined) continue
      const total = this.teamTargets.get(week)?.get(nflverseTeam(lineTeam) ?? lineTeam)
      if (total === undefined || !(total > 0)) continue
      targetShares.push(tgt / total)
    }
    const redZone = (() => {
      const touches: number[] = []
      for (const line of recent) {
        const rzt = redZoneTargets(line), rzc = redZoneCarries(line)
        if (rzt === undefined && rzc === undefined) continue
        touches.push((rzt ?? 0) + (rzc ?? 0))
      }
      return touches.length === 0 ? undefined : touches.reduce((s, x) => s + x, 0)
    })()
    const expected = (() => {
      const usage = context.inSeason.usage
      if (gsis === undefined || !usage) return undefined
      const points = usage.recentWeeks(gsis, 4).map((w) => w.expectedPoints).filter((x): x is number => x !== undefined)
      return points.length === 0 ? undefined : mean(points)
    })()

    const byeWeek = context.seasonWeeks.find((w) => context.byeCalendar.isOnBye(team, w))
    const covers = [...this.neededByWeek.keys()].sort((a, b) => a - b).filter((week) =>
      this.neededByWeek.get(week)?.has(position) === true && !context.byeCalendar.isOnBye(team, week))

    return {
      id,
      name: player.name,
      position,
      team,
      opponent: team === undefined ? undefined : this.lines[team]?.opponent,
      availability,
      byeWeek,
      injuryTag: hasInjuryDesignation(player) ? player.injuryStatus : undefined,
      playsThisWeek: !context.byeCalendar.isOnBye(team, context.currentWeek),
      isLocked: context.isLocked(id),
      projected,
      projectedOverLine: overLine,
      expectedPoints: expected,
      snapShare: snapShares.length === 0 ? undefined : mean(snapShares),
      targetShare: targetShares.length === 0 ? undefined : mean(targetShares),
      redZoneTouches: redZone,
      sleeperPointsPerGame: context.sleeperPointsPerGame(id),
      sleeperGames: recent.length,
      seasonPointsPerGame: profile?.pointsPerGame,
      trendingAdds: Object.hasOwn(this.trending, id) ? this.trending[id] : undefined,
      signals: profile ? acquisitionSignals(profile, context.baselines) : [],
      coversWeeks: covers,
    }
  }
}
