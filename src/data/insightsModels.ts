/**
 * Payloads from Sleeper's undocumented projection, stats and news routes — a
 * port of FCData `SleeperInsightsModels`. Keyless and unofficial, so every
 * model decodes leniently and every caller labels the source.
 */
import { positionFromSleeper } from '@core/Position'
import { scoreSleeperStats, type SleeperScoredLine } from '@core/SleeperStatScoring'
import { asObject, compact, int, isObject, needString, num, numberMapDroppingNulls, str, type JSONObject } from './decode'

/** The player block Sleeper embeds in a projection or stat line. */
export interface SleeperLinePlayer {
  firstName?: string
  lastName?: string
  position?: string
  team?: string
  injuryStatus?: string
  injuryBodyPart?: string
  injuryNotes?: string
  /** Milliseconds since 1970. */
  newsUpdated?: number
}

export const linePlayerName = (p: SleeperLinePlayer) => [p.firstName, p.lastName].filter((x) => x !== undefined).join(' ')

function decodeLinePlayer(v: unknown): SleeperLinePlayer | undefined {
  if (!isObject(v)) return undefined
  return compact({
    firstName: str(v, 'first_name'),
    lastName: str(v, 'last_name'),
    position: str(v, 'position'),
    team: str(v, 'team'),
    injuryStatus: str(v, 'injury_status'),
    injuryBodyPart: str(v, 'injury_body_part'),
    injuryNotes: str(v, 'injury_notes'),
    newsUpdated: num(v, 'news_updated'),
  })
}

interface StatLine {
  playerID: string
  week?: number
  season?: string
  team?: string
  opponent?: string
  /** Sleeper's stat keys with fractional units; nulls dropped. */
  stats: Record<string, number>
  player?: SleeperLinePlayer
  /** Milliseconds since 1970. */
  updatedAt?: number
  gameDate?: string
}

function decodeStatLine(o: JSONObject): StatLine {
  return compact({
    playerID: needString(o, 'player_id'),
    week: int(o, 'week'),
    season: str(o, 'season'),
    team: str(o, 'team'),
    opponent: str(o, 'opponent'),
    stats: numberMapDroppingNulls(o, 'stats'),
    player: decodeLinePlayer(o.player),
    updatedAt: num(o, 'updated_at'),
    gameDate: str(o, 'date'),
  })
}

/** Points under a league's own scoring (projection or actual line). */
export const scoreLine = (line: { stats: Record<string, number> }, scoring: Record<string, number>): SleeperScoredLine =>
  scoreSleeperStats(line.stats, scoring)

export const linePosition = (line: { player?: SleeperLinePlayer }) => positionFromSleeper(line.player?.position)

/** One player's projected stat line for a week, from Rotowire via Sleeper. */
export interface SleeperProjection extends StatLine {
  /** Who produced the numbers — `rotowire` today. */
  company?: string
}

export function decodeProjection(json: unknown): SleeperProjection {
  const o = asObject(json, 'projection')
  return compact({ ...decodeStatLine(o), company: str(o, 'company') })
}

const capitalized = (s: string) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a: string, b: string) => a + b.toUpperCase())

/** The label every projected number carries on screen. */
export function projectionSourceLabel(p: SleeperProjection): string {
  const company = p.company?.toLowerCase()
  if (company === undefined) return 'Sleeper'
  if (company === 'rotowire') return 'Rotowire via Sleeper'
  return `${capitalized(company)} via Sleeper`
}

/**
 * One player's actual stat line for a week. Unlike the nflverse weekly file
 * this covers DEF and IDP and carries snaps, red-zone looks and air yards.
 */
export type SleeperWeekStat = StatLine

export function decodeWeekStat(json: unknown): SleeperWeekStat {
  return decodeStatLine(asObject(json, 'week stat'))
}

/** Did the player take the field. */
export const played = (s: SleeperWeekStat) => (s.stats.gp ?? 0) > 0

function share(snaps: number | undefined, team: number | undefined) {
  return snaps !== undefined && team !== undefined && team > 0 ? snaps / team : undefined
}
export const offensiveSnapShare = (s: SleeperWeekStat) => share(s.stats.off_snp, s.stats.tm_off_snp)
export const defensiveSnapShare = (s: SleeperWeekStat) => share(s.stats.def_snp, s.stats.tm_def_snp)
export const targets = (s: SleeperWeekStat) => s.stats.rec_tgt
export const redZoneTargets = (s: SleeperWeekStat) => s.stats.rec_rz_tgt
export const redZoneCarries = (s: SleeperWeekStat) => s.stats.rush_rz_att
export const airYards = (s: SleeperWeekStat) => s.stats.rec_air_yd

/** One news item Sleeper relays for a player (FantasyPros or Rotowire). */
export interface SleeperPlayerNews {
  playerID?: string
  source?: string
  sourceKey?: string
  /** Milliseconds since 1970. */
  published?: number
  metadata?: { title?: string; description?: string; analysis?: string; url?: string }
}

export function decodePlayerNews(json: unknown): SleeperPlayerNews {
  const o = asObject(json, 'news item')
  const m = isObject(o.metadata) ? o.metadata : undefined
  return compact({
    playerID: str(o, 'player_id'),
    source: str(o, 'source'),
    sourceKey: str(o, 'source_key'),
    published: num(o, 'published'),
    metadata: m && compact({ title: str(m, 'title'), description: str(m, 'description'), analysis: str(m, 'analysis'), url: str(m, 'url') }),
  })
}

export const newsID = (n: SleeperPlayerNews) => n.sourceKey ?? `${n.playerID ?? ''}-${n.published ?? 0}`
export const newsPublishedAt = (n: SleeperPlayerNews) => (n.published === undefined ? undefined : new Date(n.published))

export function newsSourceLabel(n: SleeperPlayerNews): string {
  const source = n.source?.toLowerCase()
  if (source === undefined) return 'Sleeper'
  if (source === 'fantasy_pros' || source === 'fantasypros') return 'FantasyPros via Sleeper'
  if (source === 'rotowire') return 'Rotowire via Sleeper'
  return `${capitalized(source)} via Sleeper`
}
