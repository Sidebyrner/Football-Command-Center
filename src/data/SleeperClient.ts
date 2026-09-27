/**
 * Direct client for `api.sleeper.app` — public, unofficial, no key, and
 * CORS-open, so the browser calls it straight. A port of FCData `SleeperClient`.
 *
 * One retry and a short timeout: a hung request during a lineup decision is
 * worse than a failed one, because a failure can be retried.
 */
import { POSITIONS, type Position } from '@core/Position'
import { DataLayerError } from './errors'
import { DecodeError } from './decode'
import { FetchTransport, isOK, type HTTPResponse, type HTTPTransport } from './transport'
import {
  decodeDraft, decodeDraftPick, decodeLeague, decodeMatchup, decodeMember, decodeNFLState, decodeRoster,
  decodeTransaction, decodeTrending, decodeUser, listOf,
} from './sleeperModels'
import { decodePlayerNews, decodeProjection, decodeWeekStat, type SleeperProjection } from './insightsModels'
import { decodeGameScore, type SleeperGameScore } from './gameScore'
import { buildPlayerIndex, type PlayerIndex } from './playerIndex'
import { isObject } from './decode'

export const DEFAULT_BASE_URL = 'https://api.sleeper.app/v1'
/** The undocumented projection, stats, scores and news routes, with no `/v1`. */
export const DEFAULT_INSIGHTS_BASE_URL = 'https://api.sleeper.app'

export interface SleeperClientOptions {
  baseURL?: string
  insightsBaseURL?: string
  transport?: HTTPTransport
  retries?: number
}

export class SleeperClient {
  private readonly baseURL: string
  private readonly insightsBaseURL: string
  private readonly transport: HTTPTransport
  private readonly retries: number

  constructor(options: SleeperClientOptions = {}) {
    this.baseURL = options.baseURL ?? DEFAULT_BASE_URL
    // Tests point both at one stub host; the app leaves the default.
    this.insightsBaseURL = options.insightsBaseURL
      ?? (this.baseURL === DEFAULT_BASE_URL ? DEFAULT_INSIGHTS_BASE_URL : this.baseURL)
    this.transport = options.transport ?? new FetchTransport()
    this.retries = options.retries ?? 1
  }

  // MARK: - v1

  /** The authoritative current week and season. */
  nflState() { return this.get('/state/nfl', decodeNFLState) }
  user(username: string) { return this.get(`/user/${esc(username)}`, decodeUser) }
  leagues(userID: string, season: number) { return this.get(`/user/${esc(userID)}/leagues/nfl/${season}`, listOf(decodeLeague)) }
  league(id: string) { return this.get(`/league/${esc(id)}`, decodeLeague) }
  rosters(leagueID: string) { return this.get(`/league/${esc(leagueID)}/rosters`, listOf(decodeRoster)) }
  members(leagueID: string) { return this.get(`/league/${esc(leagueID)}/users`, listOf(decodeMember)) }
  matchups(leagueID: string, week: number) { return this.get(`/league/${esc(leagueID)}/matchups/${week}`, listOf(decodeMatchup)) }
  transactions(leagueID: string, week: number) { return this.get(`/league/${esc(leagueID)}/transactions/${week}`, listOf(decodeTransaction)) }
  drafts(leagueID: string) { return this.get(`/league/${esc(leagueID)}/drafts`, listOf(decodeDraft)) }
  draftPicks(draftID: string) { return this.get(`/draft/${esc(draftID)}/picks`, listOf(decodeDraftPick)) }
  trendingAdds(limit = 25) { return this.get(`/players/nfl/trending/add?limit=${limit}`, listOf(decodeTrending)) }
  trendingDrops(limit = 25) { return this.get(`/players/nfl/trending/drop?limit=${limit}`, listOf(decodeTrending)) }

  /** The ~5 MB player payload, returned already trimmed — never the raw body. */
  async playerIndex(now: number = Date.now()): Promise<PlayerIndex> {
    const response = await this.send('/players/nfl')
    return buildPlayerIndex(parse(response, '/players/nfl'), now)
  }

  // MARK: - Insights (undocumented routes)

  /** Every position's projected lines for one week. */
  projections(season: number, week: number, positions: readonly Position[] = POSITIONS) {
    return this.getInsights(
      `/projections/nfl/${season}/${week}?season_type=regular${positionQuery(positions)}&order_by=pts_std`,
      listOf(decodeProjection),
    )
  }

  /** One player's projections for a season, keyed by week. */
  playerProjections(playerID: string, season: number) {
    return this.getInsights(
      `/projections/nfl/player/${esc(playerID)}?season_type=regular&season=${season}&grouping=week`,
      (json) => {
        if (!isObject(json)) throw new DecodeError('expected an object keyed by week')
        const out = new Map<number, SleeperProjection>()
        for (const [key, value] of Object.entries(json)) {
          if (/^[+-]?\d+$/.test(key) && value !== null) out.set(Number(key), decodeProjection(value))
        }
        return out
      },
    )
  }

  /** Every position's actual lines for one week — including DEF and IDP. */
  weekStats(season: number, week: number, positions: readonly Position[] = POSITIONS) {
    return this.getInsights(
      `/stats/nfl/${season}/${week}?season_type=regular${positionQuery(positions)}&order_by=pts_std`,
      listOf(decodeWeekStat),
    )
  }

  /** Every game in a week with its live state; unplaceable games are dropped. */
  scores(season: number, week: number) {
    return this.getInsights(`/scores/nfl/regular/${season}/${week}`, (json) => {
      if (!Array.isArray(json)) throw new DecodeError('expected an array of games')
      return json.map(decodeGameScore).filter((g): g is SleeperGameScore => g !== undefined)
    })
  }

  /** Recent news items for one player. */
  playerNews(playerID: string, limit = 5) {
    return this.getInsights(`/players/nfl/${esc(playerID)}/news?limit=${limit}`, listOf(decodePlayerNews))
  }

  // MARK: - Plumbing

  private get<T>(path: string, decode: (json: unknown) => T) {
    return this.decoded(path, this.baseURL, decode)
  }

  private getInsights<T>(path: string, decode: (json: unknown) => T) {
    return this.decoded(path, this.insightsBaseURL, decode)
  }

  private async decoded<T>(path: string, base: string, decode: (json: unknown) => T): Promise<T> {
    const response = await this.send(path, base)
    try {
      return decode(parse(response, path))
    } catch (error) {
      if (error instanceof DataLayerError) throw error
      throw new DataLayerError({ kind: 'undecodable', path, underlying: String((error as Error).message ?? error) })
    }
  }

  private async send(path: string, base: string = this.baseURL): Promise<HTTPResponse> {
    const url = base + path
    let lastError: unknown = new DataLayerError({ kind: 'badURL', path })
    for (let attempt = 0; attempt <= Math.max(0, this.retries); attempt++) {
      try {
        const response = await this.transport.send({ url })
        if (!isOK(response)) throw new DataLayerError({ kind: 'httpStatus', status: response.status, path })
        return response
      } catch (error) {
        lastError = error
        // A 404 on a username the user typed is an answer, not a blip.
        const status = error instanceof DataLayerError ? error.status : undefined
        if (status !== undefined && status >= 400 && status < 500) throw error
        if (attempt >= this.retries) throw error
      }
    }
    throw lastError
  }
}

/** Like Swift's `.urlPathAllowed`: keeps `/` but escapes spaces and the rest. */
function esc(component: string): string {
  return encodeURI(component).replace(/[?#]/g, encodeURIComponent)
}

/** Percent-encoded brackets; Sleeper reads `position%5B%5D` identically. */
function positionQuery(positions: readonly Position[]): string {
  return positions.map((p) => `&position%5B%5D=${p}`).join('')
}

function parse(response: HTTPResponse, path: string): unknown {
  try {
    return JSON.parse(response.body)
  } catch (error) {
    throw new DataLayerError({ kind: 'undecodable', path, underlying: (error as Error).message })
  }
}
