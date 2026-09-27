/**
 * The iPhone Board's tiles and their saved layout — a port of FCApp
 * `BoardTile` and `BoardLayout` (Board/BoardTile.swift).
 */
import type { Screen } from '../navigation/screens'

/** One tile on the Board: a glance at one part of the week, opening the full screen behind it. */
export type BoardTile =
  | 'liveMatchup' | 'games' | 'readiness' | 'injuries' | 'topPickup'
  | 'streams' | 'standings' | 'scoringTrend' | 'news' | 'byeWeeks'

/** Swift's `BoardTile.allCases`, in declaration order. */
export const BOARD_TILES: readonly BoardTile[] = [
  'liveMatchup', 'games', 'readiness', 'injuries', 'topPickup', 'streams', 'standings', 'scoringTrend', 'news', 'byeWeeks',
]

export type BoardTileWidth = 'full' | 'half'

export const boardTileTitle: Readonly<Record<BoardTile, string>> = {
  liveMatchup: 'Matchup',
  games: 'Your games',
  readiness: 'Lineup',
  injuries: 'Injuries',
  topPickup: 'Top pickup',
  streams: 'Best streams',
  standings: 'Standings',
  scoringTrend: 'Weekly scoring',
  news: 'News',
  byeWeeks: 'Byes',
}

/** SF Symbol names, kept for parity; the web maps them to its own icons. */
export const boardTileSystemImage: Readonly<Record<BoardTile, string>> = {
  liveMatchup: 'person.2',
  games: 'sportscourt',
  readiness: 'checklist',
  injuries: 'cross.case',
  topPickup: 'tray.and.arrow.down',
  streams: 'figure.run',
  standings: 'list.number',
  scoringTrend: 'chart.xyaxis.line',
  news: 'newspaper',
  byeWeeks: 'calendar.badge.exclamationmark',
}

/** What the tile is for, in the edit sheet. */
export const boardTileBlurb: Readonly<Record<BoardTile, string>> = {
  liveMatchup: 'Your score against theirs, live during games',
  games: "Quarter, clock and red zone for your players' games",
  readiness: 'Slots set, questionable and needing a fix',
  injuries: 'Starters who are out or questionable',
  topPickup: "The Waiver Board's number one",
  streams: 'The best stream at each position this week',
  standings: 'Your rank, record and points',
  scoringTrend: 'Your weekly points against the league average',
  news: 'Headlines on your players',
  byeWeeks: 'Your next bye crunch',
}

export function boardTileWidth(tile: BoardTile): BoardTileWidth {
  switch (tile) {
    case 'readiness': case 'injuries': case 'topPickup': case 'standings': case 'byeWeeks': return 'half'
    default: return 'full'
  }
}

/** The screen a tap opens. */
export function boardTileDestination(tile: BoardTile): Screen {
  switch (tile) {
    case 'liveMatchup': case 'games': return 'matchup'
    case 'readiness': return 'sitStart'
    case 'injuries': return 'injuries'
    case 'topPickup': return 'waivers'
    case 'streams': return 'wrStream'
    case 'standings': case 'scoringTrend': case 'news': return 'dashboard'
    case 'byeWeeks': return 'planning'
  }
}

const isBoardTile = (raw: string): raw is BoardTile => (BOARD_TILES as readonly string[]).includes(raw)

/**
 * Which tiles the Board shows, in what order. Kept on the device as a short
 * string (`liveMatchup,games,-news,…`, a leading `-` for a hidden tile).
 *
 * Swift's is a value type; here `standard` returns a fresh instance each time
 * so a caller mutating one can't change everyone's default.
 */
export class BoardLayout {
  constructor(public order: BoardTile[], public hidden: Set<BoardTile> = new Set()) {}

  /** Game day up top, the week's decisions next, the season last. */
  static get standard(): BoardLayout {
    return new BoardLayout(['liveMatchup', 'games', 'readiness', 'injuries', 'streams', 'topPickup', 'standings',
      'scoringTrend', 'byeWeeks', 'news'])
  }

  get visible(): BoardTile[] { return this.order.filter((t) => !this.hidden.has(t)) }

  /** Swift's synthesized `Hashable` equality: same order, same hidden set. */
  equals(other: BoardLayout): boolean {
    return this.order.length === other.order.length
      && this.order.every((t, i) => other.order[i] === t)
      && this.hidden.size === other.hidden.size
      && [...this.hidden].every((t) => other.hidden.has(t))
  }

  /**
   * Reads a stored layout. Unknown tiles are dropped; tiles added in a later
   * version go on the end, shown. Unset is the standard layout.
   */
  static decode(stored: string | undefined | null): BoardLayout {
    if (stored === undefined || stored === null || stored === '') return BoardLayout.standard
    const order: BoardTile[] = []
    const hidden = new Set<BoardTile>()
    // Swift's `split(separator:)` drops empty pieces.
    for (const item of stored.split(',').filter((s) => s !== '')) {
      const isHidden = item.startsWith('-')
      const raw = isHidden ? item.slice(1) : item
      if (!isBoardTile(raw) || order.includes(raw)) continue
      order.push(raw)
      if (isHidden) hidden.add(raw)
    }
    for (const tile of BoardLayout.standard.order) if (!order.includes(tile)) order.push(tile)
    return new BoardLayout(order, hidden)
  }

  get encoded(): string {
    return this.order.map((t) => (this.hidden.has(t) ? `-${t}` : t)).join(',')
  }

  /**
   * Rows for a two-column grid: a full tile alone, half tiles in pairs
   * (a half tile with no partner sits alone).
   */
  static rows(tiles: readonly BoardTile[]): BoardTile[][] {
    const rows: BoardTile[][] = []
    let pending: BoardTile | undefined
    for (const tile of tiles) {
      if (boardTileWidth(tile) === 'full') {
        if (pending !== undefined) { rows.push([pending]); pending = undefined }
        rows.push([tile])
      } else if (pending !== undefined) {
        rows.push([pending, tile])
        pending = undefined
      } else {
        pending = tile
      }
    }
    if (pending !== undefined) rows.push([pending])
    return rows
  }
}
