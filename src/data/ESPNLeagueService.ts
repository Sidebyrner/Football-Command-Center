/**
 * The cache-through layer over `ESPNClient`, answering in Sleeper's shapes — a
 * port of FCData `ESPNLeagueService`. Same rule as `SleeperService`: fresh
 * cache, then network, then an expired entry labelled as such. Keys are
 * namespaced `espn-` so signing out removes exactly this provider's data.
 */
import { Cache, CacheTTL } from './cache'
import { isObject } from './decode'
import { ESPNClient } from './ESPNClient'
import { ESPNPlayerIDMapper, translateLeague, translateMatchups, translateMembers, translateRosters } from './ESPNTranslator'
import { live, type Fetched } from './fetched'
import type { LeagueDataSource } from './LeagueDataSource'
import type { PlayerIDCrosswalk } from './playerIdCrosswalk'
import type { PlayerIndex } from './playerIndex'
import type {
  SleeperDraft, SleeperDraftPick, SleeperLeague, SleeperLeagueMember, SleeperMatchup, SleeperRoster, SleeperTransaction,
} from './sleeperModels'

export const ESPN_CACHE_PREFIX = 'espn-'

export const ESPNCacheKey = {
  league: (id: string) => `${ESPN_CACHE_PREFIX}league-${id}-v1`,
  rosters: (id: string) => `${ESPN_CACHE_PREFIX}rosters-${id}-v1`,
  members: (id: string) => `${ESPN_CACHE_PREFIX}members-${id}-v1`,
  matchups: (id: string, week: number) => `${ESPN_CACHE_PREFIX}matchups-${id}-${week}-v1`,
} as const

export interface ESPNLeagueServiceInit {
  client: ESPNClient
  cache?: Cache
  /** The season to ask ESPN about — from Sleeper's `/state/nfl`. */
  season: () => Promise<number>
  /** The player pool and crosswalk, for the id mapper; either may be unavailable. */
  playerIndex: () => Promise<PlayerIndex | undefined>
  crosswalk: () => Promise<PlayerIDCrosswalk | undefined>
}

const anArray = (v: unknown) => Array.isArray(v)
const anObject = (v: unknown) => isObject(v)

export class ESPNLeagueService implements LeagueDataSource {
  private readonly client: ESPNClient
  private readonly cache: Cache
  private readonly season: () => Promise<number>
  private readonly playerIndex: () => Promise<PlayerIndex | undefined>
  private readonly crosswalk: () => Promise<PlayerIDCrosswalk | undefined>
  private mapper?: Promise<ESPNPlayerIDMapper>

  constructor(init: ESPNLeagueServiceInit) {
    this.client = init.client
    this.cache = init.cache ?? new Cache()
    this.season = init.season
    this.playerIndex = init.playerIndex
    this.crosswalk = init.crosswalk
  }

  /** Built once per service; a signed-out service is rebuilt anyway. */
  private playerMapper(): Promise<ESPNPlayerIDMapper> {
    this.mapper ??= (async () => {
      const [crosswalk, players] = await Promise.all([
        this.crosswalk().catch(() => undefined),
        this.playerIndex().catch(() => undefined),
      ])
      return new ESPNPlayerIDMapper(crosswalk, players)
    })()
    return this.mapper
  }

  private async through<T>(key: string, ttl: number, force: boolean, validate: (v: unknown) => boolean, fetch: () => Promise<T>): Promise<Fetched<T>> {
    if (!force) {
      const hit = await this.cache.load<T>(key, { validate })
      if (hit) return { value: hit.value, provenance: { kind: 'cached', age: hit.age } }
    }
    try {
      const fresh = await fetch()
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

  // MARK: - LeagueDataSource

  league(id: string, force = false): Promise<Fetched<SleeperLeague>> {
    return this.through(ESPNCacheKey.league(id), CacheTTL.roster, force, anObject, async () =>
      translateLeague(await this.client.league(id, await this.season()), id))
  }

  rosters(leagueID: string, force = false): Promise<Fetched<SleeperRoster[]>> {
    return this.through(ESPNCacheKey.rosters(leagueID), CacheTTL.roster, force, anArray, async () =>
      translateRosters(await this.client.rosters(leagueID, await this.season()), leagueID, await this.playerMapper()))
  }

  members(leagueID: string, force = false): Promise<Fetched<SleeperLeagueMember[]>> {
    return this.through(ESPNCacheKey.members(leagueID), CacheTTL.roster, force, anArray, async () =>
      translateMembers(await this.client.league(leagueID, await this.season())))
  }

  matchups(leagueID: string, week: number, force = false): Promise<Fetched<SleeperMatchup[]>> {
    return this.through(ESPNCacheKey.matchups(leagueID, week), CacheTTL.roster, force, anArray, () => this.fetchMatchups(leagueID, week))
  }

  completedMatchups(leagueID: string, week: number): Promise<Fetched<SleeperMatchup[]>> {
    return this.through(ESPNCacheKey.matchups(leagueID, week), CacheTTL.completedWeek, false, anArray, () => this.fetchMatchups(leagueID, week))
  }

  private async fetchMatchups(leagueID: string, week: number): Promise<SleeperMatchup[]> {
    return translateMatchups(await this.client.matchups(leagueID, await this.season(), week), week, await this.playerMapper())
  }

  // Not translated yet: an empty answer, which every caller treats as "nothing to show".
  async transactions(): Promise<Fetched<SleeperTransaction[]>> { return { value: [], provenance: live } }
  async drafts(): Promise<Fetched<SleeperDraft[]>> { return { value: [], provenance: live } }
  async draftPicks(): Promise<Fetched<SleeperDraftPick[]>> { return { value: [], provenance: live } }

  /** Removes every cached ESPN response: a private league's rosters leave with the user. */
  purgeCache(): Promise<void> {
    return this.cache.removeAllWithPrefix(ESPN_CACHE_PREFIX)
  }
}
