/**
 * A TTL'd cache in IndexedDB — a port of FCData `DiskCache`.
 *
 * **IndexedDB, not `localStorage`.** `localStorage` is the store whose ~5 MB
 * quota the old web app hit: a silent write failure that looked exactly like a
 * working cache while every load re-downloaded megabytes. Writes here reject
 * rather than return quietly for the same reason.
 */

/** Seconds, as on the phone. */
export const CacheTTL = {
  /** Sleeper asks that the 5 MB player payload be fetched at most once daily. */
  players: 24 * 60 * 60,
  trending: 15 * 60,
  roster: 5 * 60,
  odds: 10 * 60,
  /** The preprocessed nflverse files change at most weekly. */
  staticData: 7 * 24 * 60 * 60,
  /** A finished week's scores never change again, so history is cached long. */
  completedWeek: 7 * 24 * 60 * 60,
  projections: 6 * 60 * 60,
  /** Game scores and clocks, polled about once a minute while games are on. */
  liveScores: 60,
  currentWeekStats: 30 * 60,
  news: 30 * 60,
} as const

/** What the cache writes: the value with its timestamps (ms since 1970). */
interface Envelope<T> {
  value: T
  storedAt: number
  expiresAt: number
}

/** A value read back, with enough provenance for the UI to say how old it is. */
export interface CachedValue<T> {
  value: T
  storedAt: number
  expiresAt: number
  /** Past its TTL. Returned only when the caller asked for stale data. */
  isStale: boolean
  /** Seconds since it was stored. */
  age: number
}

/** The raw key-value store underneath. */
export interface CacheStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  has(key: string): Promise<boolean>
  /** Every key in the store. */
  keys(): Promise<string[]>
}

export class MemoryStore implements CacheStore {
  readonly entries = new Map<string, unknown>()
  async get(key: string) { return structuredClone(this.entries.get(key)) }
  async set(key: string, value: unknown) { this.entries.set(key, structuredClone(value)) }
  async delete(key: string) { this.entries.delete(key) }
  async clear() { this.entries.clear() }
  async has(key: string) { return this.entries.has(key) }
  async keys() { return [...this.entries.keys()] }
}

/** One object store in one database; opened lazily and shared. */
export class IndexedDBStore implements CacheStore {
  private db: Promise<IDBDatabase> | undefined

  constructor(private readonly dbName = 'fcc-cache', private readonly storeName = 'entries') {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(this.storeName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.db
  }

  private async run<T>(mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode)
      const request = body(tx.objectStore(this.storeName))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error ?? request.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  }

  get(key: string) { return this.run('readonly', (s) => s.get(key)) }
  async set(key: string, value: unknown) { await this.run('readwrite', (s) => s.put(value, key)) }
  async delete(key: string) { await this.run('readwrite', (s) => s.delete(key)) }
  async clear() { await this.run('readwrite', (s) => s.clear()) }
  async has(key: string) { return (await this.run('readonly', (s) => s.count(key))) > 0 }
  async keys() { return (await this.run('readonly', (s) => s.getAllKeys())).map(String) }
}

/** Where the browser has IndexedDB, use it; otherwise (tests, SSR) memory. */
export function defaultCacheStore(): CacheStore {
  return typeof indexedDB === 'undefined' ? new MemoryStore() : new IndexedDBStore()
}

export interface LoadOptions {
  /** Return an expired entry, flagged, instead of discarding it. */
  allowingStale?: boolean
  /**
   * Checks the entry is still the shape the caller expects. A schema change
   * must read as a miss, not a crash, and the entry is removed so it can't rot.
   */
  validate?: (value: unknown) => boolean
}

export class Cache {
  constructor(
    readonly backing: CacheStore = defaultCacheStore(),
    private readonly clock: () => number = Date.now,
  ) {}

  /** Writes a value with a TTL in seconds. Rejects on failure by design. */
  async store<T>(value: T, key: string, ttl: number, now: number = this.clock()): Promise<void> {
    const envelope: Envelope<T> = { value, storedAt: now, expiresAt: now + ttl * 1000 }
    await this.backing.set(key, envelope)
  }

  async load<T = unknown>(key: string, options: LoadOptions = {}): Promise<CachedValue<T> | undefined> {
    let raw: unknown
    try {
      raw = await this.backing.get(key)
    } catch {
      return undefined
    }
    if (raw === undefined) return undefined
    if (!isEnvelope(raw) || (options.validate && !options.validate(raw.value))) {
      await this.backing.delete(key).catch(() => {})
      return undefined
    }
    const now = this.clock()
    const isStale = now > raw.expiresAt
    if (isStale && !options.allowingStale) return undefined
    return {
      value: raw.value as T,
      storedAt: raw.storedAt,
      expiresAt: raw.expiresAt,
      isStale,
      age: (now - raw.storedAt) / 1000,
    }
  }

  remove(key: string) { return this.backing.delete(key).catch(() => {}) }
  removeAll() { return this.backing.clear().catch(() => {}) }

  /** Removes every entry whose key starts with `prefix` — one provider's data, say, on sign-out. */
  async removeAllWithPrefix(prefix: string): Promise<void> {
    let keys: string[]
    try { keys = await this.backing.keys() } catch { return }
    for (const key of keys) if (key.startsWith(prefix)) await this.backing.delete(key).catch(() => {})
  }
  contains(key: string) { return this.backing.has(key).catch(() => false) }
}

function isEnvelope(v: unknown): v is Envelope<unknown> {
  return (
    typeof v === 'object' && v !== null && 'value' in v &&
    typeof (v as Envelope<unknown>).storedAt === 'number' &&
    typeof (v as Envelope<unknown>).expiresAt === 'number'
  )
}
