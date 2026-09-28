/**
 * The preprocessed nflverse files — a port of FCData `StaticDataStore`.
 *
 * The copy shipped with the site (`public/data`) makes a first visit work; the
 * refresh from the repo's `data` branch keeps a season current without a
 * redeploy. Order: fresh cache → conditional GET (`If-None-Match`) → stale
 * cache → bundled copy. Bundled is last because mid-season it's the most
 * likely to be out of date.
 *
 * Values come back as parsed JSON; the typed file models (weekly, schedule,
 * in-season files) are FCCore ports that pass a `decode` function.
 */
import { Cache, CacheTTL } from './cache'
import { DataLayerError } from './errors'
import { live, type Fetched } from './fetched'
import { FetchTransport, isNotModified, isOK, type HTTPTransport } from './transport'
import { isObject } from './decode'
import { decodeCrosswalk, type PlayerIDCrosswalk } from './playerIdCrosswalk'
import { WeeklyFile, type WeeklyManifest } from '@core/WeeklyStats'
import { decodeSchedule, type ScheduleFile } from '@core/Schedule'
import { DepthChartFile, InjuryReportFile, TeamContextFile, UsageFile } from '@core/InSeasonFiles'

export interface StaticResource {
  /** Name without extension, as the phone bundles it (`weekly-2026`). */
  bundledName: string
  /** Path under the site's `data/` folder and the `data` branch. */
  remotePath: string
  /** Cache key and the name an error gives. */
  identifier: string
  /** Seconds a downloaded copy is trusted before asking again. */
  ttl: number
}

/** Files that change during the season are re-checked twice a day. */
export const IN_SEASON_TTL = 12 * 60 * 60

const resource = (bundledName: string, remotePath: string, ttl: number = CacheTTL.staticData): StaticResource =>
  ({ bundledName, remotePath, identifier: bundledName, ttl })

export const StaticResources = {
  weekly: (season: number) => resource(`weekly-${season}`, `weekly/${season}.json`, IN_SEASON_TTL),
  schedule: (season: number) => resource(`schedule-${season}`, `schedule-${season}.json`, IN_SEASON_TTL),
  weeklyIndex: resource('weekly-index', 'weekly/index.json', IN_SEASON_TTL),
  playerIDs: resource('player-ids', 'player-ids.json'),
  adp: resource('adp', 'adp.json'),
  cohorts: resource('cohorts', 'cohorts.json'),
  injuries: (season: number) => resource(`injuries-${season}`, `injuries-${season}.json`, IN_SEASON_TTL),
  depthCharts: (season: number) => resource(`depth-${season}`, `depth-${season}.json`, IN_SEASON_TTL),
  usage: (season: number) => resource(`usage-${season}`, `usage-${season}.json`, IN_SEASON_TTL),
  teamContext: (season: number) => resource(`context-${season}`, `context-${season}.json`, IN_SEASON_TTL),
} as const

/** Where the refreshed copies live: the repo's `data` branch, CORS-open. */
export const DEFAULT_STATIC_BASE_URL = 'https://raw.githubusercontent.com/Sidebyrner/Football-Command-Center/data/'

/** Reads the bundled copy; `undefined` when there isn't one. */
export type BundledSource = (resource: StaticResource) => Promise<unknown | undefined>

/** The site's own `data/` folder, under whatever base path it's served from. */
export function siteBundle(transport: HTTPTransport, base: string = import.meta.env?.BASE_URL ?? '/'): BundledSource {
  return async (r) => {
    try {
      const response = await transport.send({ url: `${base}data/${r.remotePath}` })
      return isOK(response) ? JSON.parse(response.body) : undefined
    } catch {
      return undefined
    }
  }
}

/** Parsed body plus the ETag it arrived with, for the next conditional GET. */
interface StoredPayload {
  data: unknown
  etag?: string
}

const isStoredPayload = (v: unknown): v is StoredPayload => isObject(v) && 'data' in v

export interface StaticDataStoreOptions {
  cache?: Cache
  transport?: HTTPTransport
  /** `null` runs bundle-only, which is legitimate and what some tests use. */
  baseURL?: string | null
  bundled?: BundledSource
}

export class StaticDataStore {
  private readonly cache: Cache
  private readonly transport: HTTPTransport
  private readonly baseURL: string | null
  private readonly bundled: BundledSource

  constructor(options: StaticDataStoreOptions = {}) {
    this.cache = options.cache ?? new Cache()
    this.transport = options.transport ?? new FetchTransport()
    this.baseURL = options.baseURL === undefined ? DEFAULT_STATIC_BASE_URL : options.baseURL
    this.bundled = options.bundled ?? siteBundle(this.transport)
  }

  async load<T = unknown>(r: StaticResource, options: { force?: boolean; decode?: (json: unknown) => T } = {}): Promise<Fetched<T>> {
    const decode = (json: unknown): T => {
      try {
        return options.decode ? options.decode(json) : (json as T)
      } catch (error) {
        throw new DataLayerError({ kind: 'undecodable', path: r.identifier, underlying: (error as Error).message })
      }
    }
    const key = `static-${r.identifier}`
    if (!options.force) {
      const hit = await this.cache.load<StoredPayload>(key, { validate: isStoredPayload })
      if (hit) return { value: decode(hit.value.data), provenance: { kind: 'cached', age: hit.age } }
    }
    const stale = await this.cache.load<StoredPayload>(key, { allowingStale: true, validate: isStoredPayload })

    if (this.baseURL !== null) {
      try {
        const headers: Record<string, string> = {}
        if (stale?.value.etag) headers['If-None-Match'] = stale.value.etag
        const response = await this.transport.send({ url: this.baseURL + r.remotePath, headers })
        if (isNotModified(response)) {
          // Confirmed current: re-stamp the TTL rather than re-download.
          if (stale) {
            await this.cache.store(stale.value, key, r.ttl).catch(() => {})
            return { value: decode(stale.value.data), provenance: { kind: 'cached', age: stale.age } }
          }
        } else {
          if (!isOK(response)) throw new DataLayerError({ kind: 'httpStatus', status: response.status, path: r.remotePath })
          let data: unknown
          try {
            data = JSON.parse(response.body)
          } catch (error) {
            throw new DataLayerError({ kind: 'undecodable', path: r.identifier, underlying: (error as Error).message })
          }
          const value = decode(data)
          const payload: StoredPayload = response.headers.etag ? { data, etag: response.headers.etag } : { data }
          await this.cache.store(payload, key, r.ttl).catch(() => {})
          return { value, provenance: live }
        }
      } catch (error) {
        if (stale) {
          return { value: decode(stale.value.data), provenance: { kind: 'staleCache', age: stale.age, failure: String((error as Error)?.message ?? error) } }
        }
        // Fall through to the bundled copy — a failed refresh is no reason to have nothing.
      }
    } else if (stale) {
      return { value: decode(stale.value.data), provenance: { kind: 'cached', age: stale.age } }
    }

    const bundled = await this.bundled(r)
    if (bundled === undefined) throw new DataLayerError({ kind: 'noFallbackAvailable', resource: r.identifier })
    return { value: decode(bundled), provenance: { kind: 'bundled' } }
  }

  // MARK: - Typed conveniences

  weeklyFile(season: number, force = false): Promise<Fetched<WeeklyFile>> {
    return this.load(StaticResources.weekly(season), { force, decode: (j) => new WeeklyFile(j) })
  }

  schedule(season: number, force = false): Promise<Fetched<ScheduleFile>> {
    return this.load(StaticResources.schedule(season), { force, decode: decodeSchedule })
  }

  /** Which seasons have a weekly production file. */
  weeklyManifest(force = false): Promise<Fetched<WeeklyManifest>> {
    return this.load(StaticResources.weeklyIndex, {
      force,
      decode: (j) => {
        if (!isObject(j) || !Array.isArray(j.seasons)) throw new Error('expected seasons')
        return j as unknown as WeeklyManifest
      },
    })
  }

  injuries(season: number, force = false): Promise<Fetched<InjuryReportFile>> {
    return this.load(StaticResources.injuries(season), { force, decode: (j) => new InjuryReportFile(j) })
  }

  depthCharts(season: number, force = false): Promise<Fetched<DepthChartFile>> {
    return this.load(StaticResources.depthCharts(season), { force, decode: (j) => new DepthChartFile(j) })
  }

  usage(season: number, force = false): Promise<Fetched<UsageFile>> {
    return this.load(StaticResources.usage(season), { force, decode: (j) => new UsageFile(j) })
  }

  teamContext(season: number, force = false): Promise<Fetched<TeamContextFile>> {
    return this.load(StaticResources.teamContext(season), { force, decode: (j) => new TeamContextFile(j) })
  }

  playerCrosswalk(force = false): Promise<Fetched<PlayerIDCrosswalk>> {
    return this.load(StaticResources.playerIDs, { force, decode: decodeCrosswalk })
  }

  /**
   * The crosswalk shipped with the site, read directly. A refreshed copy
   * published by an older data pipeline can lack columns this build relies on
   * (ESPN ids, say); the bundled copy is the floor it must not fall below.
   */
  async bundledPlayerCrosswalk(): Promise<PlayerIDCrosswalk | undefined> {
    const json = await this.bundled(StaticResources.playerIDs)
    if (json === undefined) return undefined
    try { return decodeCrosswalk(json) } catch { return undefined }
  }
}
