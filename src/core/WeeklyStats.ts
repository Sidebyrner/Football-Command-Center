/**
 * `public/data/weekly/{season}.json` — a port of FCCore `WeeklyStats`.
 *
 * Rows are tuples matched to the file's own `fields` header, so decoding zips
 * the header against the tuple — never a fixed index. Unknown columns are
 * ignored. Coverage gap: **QB, RB, WR, TE and K only** — no DEF, no IDP.
 */
import { positionFromSleeper, type Position } from './Position'
import { finite } from './rounding'

/** The columns the app reads, keyed by their name in the file. */
export const STAT = {
  week: 'week', team: 'team', opponent: 'opp',
  completions: 'cmp', attempts: 'att', passYards: 'pass_yd', passTD: 'pass_td', interceptions: 'int',
  sacks: 'sack', passFirstDowns: 'pass_fd', pass2pt: 'pass_2pt',
  carries: 'car', rushYards: 'rush_yd', rushTD: 'rush_td', rushFirstDowns: 'rush_fd', rushFumblesLost: 'rush_fl', rush2pt: 'rush_2pt',
  receptions: 'rec', targets: 'tgt', recYards: 'rec_yd', recTD: 'rec_td', recFirstDowns: 'rec_fd', recFumblesLost: 'rec_fl', rec2pt: 'rec_2pt',
  sackFumblesLost: 'sack_fl', specialTeamsTD: 'st_td',
  fg0to19: 'fg0_19', fg20to29: 'fg20_29', fg30to39: 'fg30_39', fg40to49: 'fg40_49', fg50to59: 'fg50_59', fg60plus: 'fg60',
  fgMissed: 'fg_miss', extraPointsMade: 'xpm', extraPointsAttempted: 'xpa',
  targetShare: 'tgt_share', airYardsShare: 'ay_share',
  /** nflverse's own `fantasy_points_ppr` — for checking the engine, never a score. */
  pprReference: 'fp_ppr_ref',
} as const

export type Stat = Exclude<keyof typeof STAT, 'week' | 'team' | 'opponent'>
const statByColumn = new Map<string, Stat>(
  (Object.entries(STAT) as [keyof typeof STAT, string][])
    .filter(([k]) => k !== 'week' && k !== 'team' && k !== 'opponent')
    .map(([k, col]) => [col, k as Stat]),
)

/** One decoded weekly stat line. */
export class WeeklyRow {
  constructor(
    readonly week: number,
    readonly team: string | undefined,
    readonly opponent: string | undefined,
    private readonly numbers: Partial<Record<Stat, number>>,
  ) {}

  /** The column's value, or `undefined` when this row doesn't carry it. */
  value(stat: Stat): number | undefined {
    const raw = this.numbers[stat]
    return raw !== undefined && Number.isFinite(raw) ? raw : undefined
  }

  /** The value with a missing column read as zero — right for scoring arithmetic. */
  number(stat: Stat): number {
    return finite(this.value(stat))
  }
}

export interface WeeklyPlayerMeta {
  name: string
  positionCode: string
}

export const metaPosition = (m: WeeklyPlayerMeta | undefined): Position | undefined => positionFromSleeper(m?.positionCode)

export interface PlayerSeason {
  gsisID: string
  meta?: WeeklyPlayerMeta
  rows: WeeklyRow[]
  position?: Position
}

export interface WeeklyFileMeta {
  generated?: string
  season?: number
  weeks?: number[]
  complete?: boolean
  rowCount?: number
  playerCount?: number
  source?: string
}

type Raw = number | string | boolean | null

export class WeeklyFile {
  readonly fields: string[]
  readonly meta: Record<string, WeeklyPlayerMeta>
  readonly fileMeta: WeeklyFileMeta | undefined
  private readonly players: Record<string, Raw[][]>

  constructor(json: unknown) {
    const o = json as { fields?: unknown; meta?: unknown; players?: unknown; _meta?: unknown }
    if (!o || !Array.isArray(o.fields) || typeof o.meta !== 'object' || typeof o.players !== 'object' || !o.meta || !o.players) {
      throw new Error('weekly file: expected fields, meta and players')
    }
    this.fields = o.fields as string[]
    this.meta = {}
    for (const [id, m] of Object.entries(o.meta as Record<string, { n?: unknown; p?: unknown }>)) {
      if (typeof m?.n !== 'string' || typeof m?.p !== 'string') throw new Error(`weekly file: bad meta for ${id}`)
      this.meta[id] = { name: m.n, positionCode: m.p }
    }
    this.players = o.players as Record<string, Raw[][]>
    this.fileMeta = typeof o._meta === 'object' && o._meta !== null ? (o._meta as WeeklyFileMeta) : undefined
  }

  get playerIDs(): string[] { return Object.keys(this.players) }
  get playerCount(): number { return this.playerIDs.length }
  get rowCount(): number { return Object.values(this.players).reduce((n, rows) => n + rows.length, 0) }
  playerMeta(gsisID: string) { return this.meta[gsisID] }
  position(gsisID: string) { return metaPosition(this.meta[gsisID]) }

  /** Every decoded week for one player, ascending. */
  rows(gsisID: string): WeeklyRow[] {
    const tuples = this.players[gsisID]
    if (!tuples) return []
    return tuples.map((t) => this.decode(t)).filter((r): r is WeeklyRow => r !== undefined).sort((a, b) => a.week - b.week)
  }

  /** Every player with their rows, in a stable order. */
  allPlayers(): PlayerSeason[] {
    return this.playerIDs.sort().map((gsisID) => {
      const meta = this.meta[gsisID]
      return { gsisID, meta, rows: this.rows(gsisID), position: metaPosition(meta) }
    })
  }

  /** Zips this file's own header against one tuple. */
  decode(tuple: Raw[]): WeeklyRow | undefined {
    const numbers: Partial<Record<Stat, number>> = {}
    let week: number | undefined
    let team: string | undefined
    let opponent: string | undefined
    this.fields.forEach((field, i) => {
      if (i >= tuple.length) return
      let v = tuple[i]
      if (typeof v === 'boolean') v = v ? 1 : 0
      if (v === null || v === undefined) return
      if (field === 'week') week = typeof v === 'number' ? Math.trunc(v) : /^[+-]?\d+$/.test(v) ? Number(v) : week
      else if (field === 'team') { if (typeof v === 'string') team = v }
      else if (field === 'opp') { if (typeof v === 'string') opponent = v }
      else if (typeof v === 'number') {
        const stat = statByColumn.get(field)
        if (stat) numbers[stat] = v
      }
    })
    return week === undefined ? undefined : new WeeklyRow(week, team, opponent, numbers)
  }
}

/** `public/data/weekly/index.json` — which seasons are on disk. */
export interface WeeklyManifest {
  seasons: { season: number; file: string; weeks?: number; latestWeek?: number; complete?: boolean; bytes?: number }[]
  _meta?: { generated?: string }
}
