/**
 * Sleeper reads with caching and provenance — a port of FCData `SleeperService`.
 *
 * The order is always: fresh cache → network → **stale** cache → error. The
 * stale step is what makes the app usable offline; the provenance is what stops
 * it lying about freshness. Cache keys match the phone's so the two stay
 * recognisably the same design.
 */
import { Cache, CacheTTL } from './cache'
import { live, type Fetched } from './fetched'
import { SleeperClient } from './SleeperClient'
import { isObject } from './decode'
import type {
  NFLState, SleeperDraft, SleeperDraftPick, SleeperLeague, SleeperLeagueMember, SleeperMatchup, SleeperRoster,
  SleeperTransaction, SleeperUser, TrendingPlayer,
} from './sleeperModels'
import type { SleeperPlayerNews, SleeperProjection, SleeperWeekStat } from './insightsModels'
import type { SleeperGameScore } from './gameScore'
import type { PlayerIndex } from './playerIndex'

export const SleeperCacheKey = {
  nflState: 'sleeper-nfl-state-v1',
  /** v4 carries injury detail, depth chart order and position, and bio. */
  players: 'sleeper-players-v4',
  trendingAdds: 'sleeper-trending-adds-v1',
  trendingDrops: 'sleeper-trending-drops-v1',
  league: (id: string) => `sleeper-league-${id}`,
  rosters: (id: string) => `sleeper-rosters-${id}`,
  members: (id: string) => `sleeper-users-${id}`,
  matchups: (id: string, week: number) => `sleeper-matchups-${id}-${week}`,
  transactions: (id: string, week: number) => `sleeper-transactions-${id}-${week}`,
  drafts: (id: string) => `sleeper-drafts-${id}`,
  draftPicks: (id: string) => `sleeper-picks-${id}`,
  projections: (season: number, week: number) => `sleeper-projections-${season}-${week}-v1`,
  weekStats: (season: number, week: number) => `sleeper-weekstats-${season}-${week}-v1`,
  scores: (season: number, week: number) => `sleeper-scores-${season}-${week}-v1`,
  news: (playerID: string) => `sleeper-news-${playerID}-v1`,
  playerProjections: (playerID: string, season: number) => `sleeper-player-proj-${playerID}-${season}-v1`,
} as const

type Validator = (v: unknown) => boolean
const anArray: Validator = (v) => Array.isArray(v)
const anObject: Validator = (v) => isObject(v)
const aMap: Validator = (v) => v instanceof Map
const anIndex: Validator = (v) => isObject(v) && isObject(v.players) && typeof v.builtAt === 'number'

export class SleeperService {
  constructor(
    readonly client: SleeperClient = new SleeperClient(),
    readonly cache: Cache = new Cache(),
  ) {}

  private async through<T>(
    key: string, ttl: number, force: boolean, validate: Validator, fetch: () => Promise<T>,
  ): Promise<Fetched<T>> {
    if (!force) {
      const hit = await this.cache.load<T>(key, { validate })
      if (hit) return { value: hit.value, provenance: { kind: 'cached', age: hit.age } }
    }
    try {
      const fresh = await fetch()
      // A cache write failure must not fail the fetch — we have the data.
      await this.cache.store(fresh, key, ttl).catch(() => {})
      return { value: fresh, provenance: live }
    } catch (error) {
      const stale = await this.cache.load<T>(key, { allowingStale: true, validate })
      if (stale) {
        return { value: stale.value, provenance: { kind: 'staleCache', age: stale.age, failure: String((error as Error)?.message ?? error) } }
      }
      throw error
    }
  }

  private async isTooOld(key: string, maxAge: number): Promise<boolean> {
    const hit = await this.cache.load(key)
    return hit !== undefined && hit.age >= maxAge
  }

  // MARK: - League context

  nflState(force = false): Promise<Fetched<NFLState>> {
    return this.through(SleeperCacheKey.nflState, CacheTTL.trending, force, anObject, () => this.client.nflState())
  }

  /** Setup-time lookups are deliberately uncached: a retyped username expects a fresh answer. */
  user(username: string): Promise<SleeperUser> { return this.client.user(username) }
  leagues(userID: string, season: number): Promise<SleeperLeague[]> { return this.client.leagues(userID, season) }

  league(id: string, force = false): Promise<Fetched<SleeperLeague>> {
    return this.through(SleeperCacheKey.league(id), CacheTTL.roster, force, anObject, () => this.client.league(id))
  }

  rosters(leagueID: string, force = false): Promise<Fetched<SleeperRoster[]>> {
    return this.through(SleeperCacheKey.rosters(leagueID), CacheTTL.roster, force, anArray, () => this.client.rosters(leagueID))
  }

  members(leagueID: string, force = false): Promise<Fetched<SleeperLeagueMember[]>> {
    return this.through(SleeperCacheKey.members(leagueID), CacheTTL.roster, force, anArray, () => this.client.members(leagueID))
  }

  matchups(leagueID: string, week: number, force = false): Promise<Fetched<SleeperMatchup[]>> {
    return this.through(SleeperCacheKey.matchups(leagueID, week), CacheTTL.roster, force, anArray, () => this.client.matchups(leagueID, week))
  }

  /** A finished week never changes, so it reuses the live entry on a long TTL. */
  completedMatchups(leagueID: string, week: number): Promise<Fetched<SleeperMatchup[]>> {
    return this.through(SleeperCacheKey.matchups(leagueID, week), CacheTTL.completedWeek, false, anArray, () => this.client.matchups(leagueID, week))
  }

  transactions(leagueID: string, week: number, force = false): Promise<Fetched<SleeperTransaction[]>> {
    return this.through(SleeperCacheKey.transactions(leagueID, week), CacheTTL.roster, force, anArray, () => this.client.transactions(leagueID, week))
  }

  // MARK: - Drafts

  drafts(leagueID: string, force = false): Promise<Fetched<SleeperDraft[]>> {
    return this.through(SleeperCacheKey.drafts(leagueID), CacheTTL.roster, force, anArray, () => this.client.drafts(leagueID))
  }

  draftPicks(draftID: string): Promise<Fetched<SleeperDraftPick[]>> {
    return this.through(SleeperCacheKey.draftPicks(draftID), CacheTTL.completedWeek, false, anArray, () => this.client.draftPicks(draftID))
  }

  // MARK: - Player pool

  /**
   * The daily player index. On a game day pass a shorter `maxAge` (seconds) so
   * injury tags are fresher; a failed early refetch still serves the cached
   * copy, labelled.
   */
  async playerIndex(force = false, maxAge: number = CacheTTL.players): Promise<Fetched<PlayerIndex>> {
    const tooOld = force || (await this.isTooOld(SleeperCacheKey.players, maxAge))
    return this.through(SleeperCacheKey.players, CacheTTL.players, tooOld, anIndex, () => this.client.playerIndex())
  }

  // MARK: - Trending

  trendingAdds(force = false): Promise<Fetched<TrendingPlayer[]>> {
    return this.through(SleeperCacheKey.trendingAdds, CacheTTL.trending, force, anArray, () => this.client.trendingAdds())
  }

  trendingDrops(force = false): Promise<Fetched<TrendingPlayer[]>> {
    return this.through(SleeperCacheKey.trendingDrops, CacheTTL.trending, force, anArray, () => this.client.trendingDrops())
  }

  // MARK: - Insights

  async projections(season: number, week: number, force = false, maxAge: number = CacheTTL.projections): Promise<Fetched<SleeperProjection[]>> {
    const key = SleeperCacheKey.projections(season, week)
    const tooOld = await this.isTooOld(key, maxAge)
    return this.through(key, CacheTTL.projections, force || tooOld, anArray, () => this.client.projections(season, week))
  }

  weekStats(season: number, week: number, isCompleted: boolean, force = false): Promise<Fetched<SleeperWeekStat[]>> {
    const ttl = isCompleted ? CacheTTL.completedWeek : CacheTTL.currentWeekStats
    return this.through(SleeperCacheKey.weekStats(season, week), ttl, force, anArray, () => this.client.weekStats(season, week))
  }

  scores(season: number, week: number, force = false): Promise<Fetched<SleeperGameScore[]>> {
    return this.through(SleeperCacheKey.scores(season, week), CacheTTL.liveScores, force, anArray, () => this.client.scores(season, week))
  }

  playerProjections(playerID: string, season: number, force = false): Promise<Fetched<Map<number, SleeperProjection>>> {
    return this.through(SleeperCacheKey.playerProjections(playerID, season), CacheTTL.projections, force, aMap, () => this.client.playerProjections(playerID, season))
  }

  playerNews(playerID: string, force = false): Promise<Fetched<SleeperPlayerNews[]>> {
    return this.through(SleeperCacheKey.news(playerID), CacheTTL.news, force, anArray, () => this.client.playerNews(playerID))
  }
}
