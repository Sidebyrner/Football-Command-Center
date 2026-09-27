/**
 * The four in-season files (injuries, depth charts, usage, team context) — a
 * port of FCCore `InSeasonFiles`. Rows are zipped against each file's own
 * `fields` header; a column the file lacks reads as absent, not zero.
 */
import { nflverseTeam } from './NFLTeams'
import { positionFromSleeper, type Position } from './Position'

export interface InSeasonFileMeta {
  generated?: string
  season?: number
  source?: string
  weeks?: number[]
  asOf?: string
}

/** `generated` as ms since 1970, for freshness labels. */
export const generatedAt = (m: InSeasonFileMeta | undefined) => {
  const t = m?.generated ? Date.parse(m.generated) : NaN
  return Number.isFinite(t) ? t : undefined
}

type Raw = number | string | boolean | null

/** Reads a tuple row through its file's header. */
export class TupleReader {
  private readonly index: Map<string, number>
  constructor(fields: readonly string[], private readonly row: readonly Raw[]) {
    this.index = new Map(fields.map((f, i) => [f, i]))
  }

  private raw(field: string): Raw | undefined {
    const i = this.index.get(field)
    if (i === undefined || i >= this.row.length) return undefined
    const v = this.row[i]!
    return typeof v === 'boolean' ? (v ? 1 : 0) : v
  }

  number(field: string): number | undefined {
    const v = this.raw(field)
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }

  text(field: string): string | undefined {
    const v = this.raw(field)
    if (typeof v === 'string') return v === '' ? undefined : v
    if (typeof v === 'number') return String(Math.trunc(v))
    return undefined
  }

  int(field: string): number | undefined {
    const v = this.number(field)
    return v === undefined ? undefined : Math.trunc(v)
  }
}

const asObject = (json: unknown, what: string) => {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error(`${what}: expected an object`)
  return json as Record<string, unknown>
}
const fieldsOf = (o: Record<string, unknown>, what: string) => {
  if (!Array.isArray(o.fields)) throw new Error(`${what}: expected fields`)
  return o.fields as string[]
}
const metaOf = (o: Record<string, unknown>) => (typeof o._meta === 'object' && o._meta ? (o._meta as InSeasonFileMeta) : undefined)

// MARK: - Injuries

export type InjuryDesignation = 'Out' | 'Doubtful' | 'Questionable'
const DESIGNATIONS: readonly InjuryDesignation[] = ['Out', 'Doubtful', 'Questionable']
/** Worse first: Out < Doubtful < Questionable. */
export const designationSeverity = (d: InjuryDesignation) => DESIGNATIONS.indexOf(d)

export type PracticeStatus = 'DNP' | 'LTD' | 'FULL'
export const PRACTICE_LABEL: Readonly<Record<PracticeStatus, string>> = { DNP: 'Did not practice', LTD: 'Limited', FULL: 'Full' }
export const PRACTICE_PHRASE: Readonly<Record<PracticeStatus, string>> = { DNP: 'Did not practice', LTD: 'Limited practice', FULL: 'Full practice' }

export interface PracticeReport {
  gsisID: string
  team?: string
  position?: Position
  designation?: InjuryDesignation
  practice?: PracticeStatus
  /** The reported primary injury — "Knee", "Hamstring". */
  injury?: string
}

export class InjuryReportFile {
  readonly fileMeta?: InSeasonFileMeta
  readonly fields: string[]
  private readonly byWeek: Record<string, Raw[][]>

  constructor(json: unknown) {
    const o = asObject(json, 'injuries')
    this.fields = fieldsOf(o, 'injuries')
    this.byWeek = asObject(o.byWeek, 'injuries.byWeek') as Record<string, Raw[][]>
    this.fileMeta = metaOf(o)
  }

  get weeks(): number[] {
    return Object.keys(this.byWeek).filter((k) => /^[+-]?\d+$/.test(k)).map(Number).sort((a, b) => a - b)
  }

  reports(week: number): PracticeReport[] {
    const out: PracticeReport[] = []
    for (const row of this.byWeek[String(week)] ?? []) {
      const r = new TupleReader(this.fields, row)
      const gsisID = r.text('gsis')
      if (!gsisID) continue
      const status = r.text('status')
      const practice = r.text('practice')
      out.push({
        gsisID,
        team: r.text('team'),
        position: positionFromSleeper(r.text('pos')),
        designation: DESIGNATIONS.includes(status as InjuryDesignation) ? (status as InjuryDesignation) : undefined,
        practice: practice === 'DNP' || practice === 'LTD' || practice === 'FULL' ? practice : undefined,
        injury: r.text('primary'),
      })
    }
    return out
  }

  /** Reports keyed by gsis id; the first row wins. */
  reportsByPlayer(week: number): Map<string, PracticeReport> {
    const out = new Map<string, PracticeReport>()
    for (const r of this.reports(week)) if (!out.has(r.gsisID)) out.set(r.gsisID, r)
    return out
  }
}

// MARK: - Depth charts

export class DepthChartFile {
  readonly fileMeta?: InSeasonFileMeta
  private readonly teams: Record<string, Record<string, string[]>>

  constructor(json: unknown) {
    const o = asObject(json, 'depth')
    this.teams = asObject(o.teams, 'depth.teams') as Record<string, Record<string, string[]>>
    this.fileMeta = metaOf(o)
  }

  get teamCount() { return Object.keys(this.teams).length }

  /** gsis ids at a position for a team, starters first. */
  chart(team: string | undefined, position: Position): string[] {
    if (!team) return []
    return this.teams[nflverseTeam(team) ?? team]?.[position] ?? []
  }

  /** Zero-based depth, `undefined` when not listed. */
  rank(gsisID: string, team: string | undefined, position: Position): number | undefined {
    const i = this.chart(team, position).indexOf(gsisID)
    return i < 0 ? undefined : i
  }

  behind(gsisID: string, team: string | undefined, position: Position): string[] {
    const chart = this.chart(team, position)
    const i = chart.indexOf(gsisID)
    return i < 0 ? [] : chart.slice(i + 1)
  }
}

// MARK: - Usage

/** One player-week of usage. Every field is optional: absent is not zero. */
export interface UsageWeek {
  week: number
  offensiveSnaps?: number
  offensiveSnapShare?: number
  defensiveSnaps?: number
  defensiveSnapShare?: number
  expectedPoints?: number
  expectedRushPoints?: number
  expectedReceivingPoints?: number
  rushAttempts?: number
  targets?: number
  yardsBeforeContactPerAttempt?: number
  yardsAfterContactPerAttempt?: number
  brokenTackles?: number
  drops?: number
}

export interface UsagePlayerMeta {
  name: string
  positionCode?: string
  team?: string
}

export class UsageFile {
  readonly fileMeta?: InSeasonFileMeta
  readonly fields: string[]
  readonly meta: Record<string, UsagePlayerMeta> = {}
  private readonly players: Record<string, Raw[][]>

  constructor(json: unknown) {
    const o = asObject(json, 'usage')
    this.fields = fieldsOf(o, 'usage')
    for (const [id, m] of Object.entries(asObject(o.meta, 'usage.meta') as Record<string, { n?: unknown; p?: unknown; t?: unknown }>)) {
      if (typeof m?.n !== 'string') throw new Error(`usage: bad meta for ${id}`)
      this.meta[id] = { name: m.n, positionCode: typeof m.p === 'string' ? m.p : undefined, team: typeof m.t === 'string' ? m.t : undefined }
    }
    this.players = asObject(o.players, 'usage.players') as Record<string, Raw[][]>
    this.fileMeta = metaOf(o)
  }

  get playerCount() { return Object.keys(this.players).length }
  get playerIDs() { return Object.keys(this.players) }
  metaPosition(gsisID: string) { return positionFromSleeper(this.meta[gsisID]?.positionCode) }

  weeks(gsisID: string): UsageWeek[] {
    const out: UsageWeek[] = []
    for (const row of this.players[gsisID] ?? []) {
      const r = new TupleReader(this.fields, row)
      const week = r.int('week')
      if (week === undefined) continue
      out.push({
        week,
        offensiveSnaps: r.number('off_snp'),
        offensiveSnapShare: r.number('off_pct'),
        defensiveSnaps: r.number('def_snp'),
        defensiveSnapShare: r.number('def_pct'),
        expectedPoints: r.number('xfp'),
        expectedRushPoints: r.number('xfp_rush'),
        expectedReceivingPoints: r.number('xfp_rec'),
        rushAttempts: r.number('rush_att'),
        targets: r.number('tgt'),
        yardsBeforeContactPerAttempt: r.number('ybc_avg'),
        yardsAfterContactPerAttempt: r.number('yac_avg'),
        brokenTackles: r.number('broken_tackles'),
        drops: r.number('drops'),
      })
    }
    return out.sort((a, b) => a.week - b.week)
  }

  /** The last `count` weeks with a row, most recent last. */
  recentWeeks(gsisID: string, count: number): UsageWeek[] {
    const all = this.weeks(gsisID)
    return count <= 0 ? [] : all.slice(-count)
  }
}

// MARK: - Team context

export interface TeamContextWeek {
  week: number
  opponent?: string
  plays?: number
  passAttempts?: number
  rushAttempts?: number
  /** Share of dropbacks with the primary passer pressured. */
  pressureRate?: number
  sacksAllowed?: number
  yardsBeforeContactPerAttempt?: number
  /** ESPN Total QBR. */
  qbr?: number
  passerRating?: number
  topTargetShare?: number
  topTwoTargetShare?: number
}

export class TeamContextFile {
  readonly fileMeta?: InSeasonFileMeta
  readonly fields: string[]
  private readonly teams: Record<string, Raw[][]>

  constructor(json: unknown) {
    const o = asObject(json, 'context')
    this.fields = fieldsOf(o, 'context')
    this.teams = asObject(o.teams, 'context.teams') as Record<string, Raw[][]>
    this.fileMeta = metaOf(o)
  }

  get teamCount() { return Object.keys(this.teams).length }

  weeks(team: string | undefined): TeamContextWeek[] {
    if (!team) return []
    const rows = this.teams[nflverseTeam(team) ?? team]
    if (!rows) return []
    const out: TeamContextWeek[] = []
    for (const row of rows) {
      const r = new TupleReader(this.fields, row)
      const week = r.int('week')
      if (week === undefined) continue
      out.push({
        week,
        opponent: r.text('opp'),
        plays: r.number('plays'),
        passAttempts: r.number('pass_att'),
        rushAttempts: r.number('rush_att'),
        pressureRate: r.number('pressure_pct'),
        sacksAllowed: r.number('sacks'),
        yardsBeforeContactPerAttempt: r.number('ybc_avg'),
        qbr: r.number('qbr'),
        passerRating: r.number('pass_rtg'),
        topTargetShare: r.number('top_tgt_share'),
        topTwoTargetShare: r.number('top2_tgt_share'),
      })
    }
    return out.sort((a, b) => a.week - b.week)
  }

  /** Every team's weeks, for league-wide percentiles. */
  allTeams(): Record<string, TeamContextWeek[]> {
    return Object.fromEntries(Object.keys(this.teams).map((t) => [t, this.weeks(t)]))
  }
}
