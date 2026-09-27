/**
 * Discovery — a port of FCApp `DiscoveryModel.swift`: every active player you
 * could pick up at the positions your league starts, with or without data yet,
 * searchable and sortable on any Waiver Board column. The same rows the board
 * builds; the board just hides the ones with no numbers.
 */
import { fuzzyScore } from '@core/FuzzyNameMatch'
import type { Position } from '@core/Position'
import type { SleeperService } from '@data/SleeperService'
import type { LeagueContext } from '../league/LeagueContext'
import type { LeagueContextLoader } from '../league/LeagueContextLoader'
import { Observable } from '../Observable'
import { DefenseLookup } from '../player/DefenseLookup'
import { PlayerMetricsIndex } from '../player/PlayerMetrics'
import { byPredicate } from './InjuryCenterModel'
import {
  RowBuilder, WAIVER_SORT_LABEL, WAIVER_SORT_UNIT, WAIVER_SORTS, waiverRowValue,
  type WaiverRow, type WaiverSort,
} from './WaiverBoardModel'

// MARK: - Sort

/** A Discovery sort: the Waiver Board's nine columns, or the name. */
export type DiscoverySort = { kind: 'name' } | { kind: 'column'; column: WaiverSort }

export const discoveryName: DiscoverySort = { kind: 'name' }
export const discoveryColumn = (column: WaiverSort): DiscoverySort => ({ kind: 'column', column })

export const sameDiscoverySort = (a: DiscoverySort, b: DiscoverySort) =>
  a.kind === b.kind && (a.kind === 'name' || a.column === (b as { column: WaiverSort }).column)

/** For `PanelSettings.extra["sort"]`: "name" or the column's raw value. Also the sort's `id`. */
export const discoverySortStorageKey = (s: DiscoverySort): string => (s.kind === 'name' ? 'name' : s.column)

/** Swift `DiscoverySort(storageKey:)`. */
export function discoverySortFromStorageKey(key: string): DiscoverySort | undefined {
  if (key === 'name') return discoveryName
  return (WAIVER_SORTS as readonly string[]).includes(key) ? discoveryColumn(key as WaiverSort) : undefined
}

export const discoverySortLabel = (s: DiscoverySort): string => (s.kind === 'name' ? 'Name' : WAIVER_SORT_LABEL[s.column])

export const discoverySortUnit = (s: DiscoverySort): string | undefined => (s.kind === 'name' ? undefined : WAIVER_SORT_UNIT[s.column])

export const DISCOVERY_SORTS: readonly DiscoverySort[] = [discoveryName, ...WAIVER_SORTS.map(discoveryColumn)]

// MARK: - Helpers

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Swift `trimmingCharacters(in: .whitespaces)`: spaces and tabs, not newlines. */
const trimWhitespaces = (s: string) => s.replace(/^[\p{Zs}\t]+|[\p{Zs}\t]+$/gu, '')

// MARK: - The model

export class DiscoveryModel extends Observable {
  context?: LeagueContext
  isLoading = false
  errorMessage?: string
  /** Every acquirable row, unfiltered. */
  allRows: WaiverRow[] = []
  /** `allRows` after the search, position, bench toggle and sort. */
  visible: WaiverRow[] = []
  /** Defense-vs-position for this context, built once; the Schedule and Compare panels read it from here. */
  defense: DefenseLookup = DefenseLookup.empty
  /** Weekly metrics and leaderboards for the Metric panels, per context. */
  metrics?: PlayerMetricsIndex
  trendingUnavailable = false

  private _sort: DiscoverySort = discoveryColumn('projected')
  private _positionFilter?: Position
  private _includeRivalBenches = false
  private _query = ''

  private builder?: RowBuilder
  private rowCache = new Map<string, WaiverRow>()

  constructor(private readonly loader: LeagueContextLoader, private readonly sleeper?: SleeperService) {
    super()
  }

  get sort(): DiscoverySort { return this._sort }
  set sort(value: DiscoverySort) { this._sort = value; this.applyFilters() }

  get positionFilter(): Position | undefined { return this._positionFilter }
  set positionFilter(value: Position | undefined) { this._positionFilter = value; this.applyFilters() }

  get includeRivalBenches(): boolean { return this._includeRivalBenches }
  set includeRivalBenches(value: boolean) { this._includeRivalBenches = value; this.applyFilters() }

  get query(): string { return this._query }
  set query(value: string) { this._query = value; this.applyFilters() }

  async load({ leagueID, userRosterID, season, force = false }: { leagueID: string; userRosterID: number; season?: number; force?: boolean }): Promise<void> {
    this.isLoading = true
    this.errorMessage = undefined
    this.changed()
    try {
      const context = await this.loader.load({ leagueID, userRosterID, season, force })
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
      // Swift builds this off the main thread; here it simply runs inline.
      const defense = DefenseLookup.build(context)
      this.context = context
      this.builder = builder
      this.defense = defense
      this.metrics = new PlayerMetricsIndex(context)
      this.rowCache = new Map()
      this.allRows = builder.acquirableRows(true)
      this.fallBackToAValuedSort()
      this.applyFilters()
    } catch (error) {
      this.errorMessage = describeError(error)
    } finally {
      this.isLoading = false
      this.changed()
    }
  }

  /**
   * A column nobody has a number for is a wall of dashes — projections
   * unreachable, or no Sleeper lines yet. Move to the first column that
   * values someone, as the Waiver Board does.
   */
  fallBackToAValuedSort(): void {
    const sort = this.sort
    if (sort.kind !== 'column' || this.allRows.length === 0
      || this.allRows.some((r) => waiverRowValue(r, sort.column) !== undefined)) return
    const usable = WAIVER_SORTS.find((c) => this.allRows.some((r) => waiverRowValue(r, c) !== undefined))
    if (usable !== undefined) this.sort = discoveryColumn(usable)
  }

  /** A row for any player in the pool, rostered or not. */
  row(id: string): WaiverRow | undefined {
    const cached = this.rowCache.get(id)
    if (cached) return cached
    const row = this.allRows.find((r) => r.id === id) ?? this.builder?.row(id)
    if (row) {
      this.rowCache.set(id, row)
      return row
    }
    return undefined
  }

  /** Positions the league starts, in template order. */
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

  /** Rows the current sort can't value — they sit at the bottom. */
  get unvaluedCount(): number {
    const sort = this.sort
    if (sort.kind !== 'column') return 0
    return this.visible.filter((r) => waiverRowValue(r, sort.column) === undefined).length
  }

  /**
   * The rows a panel shows: the shared search and bench toggle, with the
   * panel's own position and sort when it has them.
   */
  rows(position: Position | undefined, sort: DiscoverySort | undefined): WaiverRow[] {
    if (position === undefined && sort === undefined) return this.visible
    return DiscoveryModel.filtered(this.allRows, this.query, position ?? this.positionFilter,
      this.includeRivalBenches, sort ?? this.sort)
  }

  applyFilters(): void {
    this.visible = DiscoveryModel.filtered(this.allRows, this.query, this.positionFilter, this.includeRivalBenches, this.sort)
    this.changed()
  }

  static filtered(rows: readonly WaiverRow[], query: string, position: Position | undefined,
    includeRivalBenches: boolean, sort: DiscoverySort): WaiverRow[] {
    const needle = trimWhitespaces(query)
    const out: { row: WaiverRow; match: number }[] = []
    for (const row of rows) {
      if (!includeRivalBenches && row.availability.kind !== 'freeAgent') continue
      if (position !== undefined && row.position !== position) continue
      if (needle === '') {
        out.push({ row, match: 0 })
      } else {
        const extra = [row.team, row.position].filter((x): x is string => x !== undefined)
        const score = fuzzyScore(needle, row.name, extra)
        if (score !== undefined) out.push({ row, match: score })
      }
    }
    out.sort(byPredicate((a, b) => {
      if (sort.kind === 'name') return a.row.name < b.row.name
      const x = waiverRowValue(a.row, sort.column), y = waiverRowValue(b.row, sort.column)
      if (x !== undefined && y !== undefined) return x === y ? a.row.name < b.row.name : x > y
      if (x !== undefined) return true
      if (y !== undefined) return false
      return a.row.name < b.row.name
    }))
    return out.map((e) => e.row)
  }
}
