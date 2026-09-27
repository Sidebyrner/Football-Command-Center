/**
 * Durable stream state — a port of FCApp `StreamStore.swift`: each week's
 * overrides and the frozen snapshots, one folder per stream.
 *
 * Not the data cache: nothing here expires. An override typed in on Tuesday
 * must still be there on Sunday, and a snapshot is a record, not a cache.
 * Swift wrote files under Application Support; the web writes the same file
 * names as keys in an injectable key-value storage (localStorage in the app,
 * memory in tests).
 */
import type { StreamReport, StreamRiskMode } from '@core/Stream'
import { emptyOverrides, isJSONObject, type StreamKind, type StreamKindTypes, type StreamWeekOverrides } from './StreamKind'

// MARK: - Storage

/** The file system stand-in. `setItem` and `removeItem` throw on failure, as the Swift writes did. */
export interface StreamKeyValueStorage {
  getItem(key: string): string | undefined
  setItem(key: string, value: string): void
  /** Throws when there is nothing to remove, like `FileManager.removeItem`. */
  removeItem(key: string): void
  keys(): string[]
}

/** For tests, and wherever there is no browser storage. */
export class MemoryStreamStorage implements StreamKeyValueStorage {
  private readonly items = new Map<string, string>()
  getItem(key: string) { return this.items.get(key) }
  setItem(key: string, value: string) { this.items.set(key, value) }
  removeItem(key: string) {
    if (!this.items.delete(key)) throw new Error(`No such item: ${key}`)
  }
  keys() { return [...this.items.keys()] }
}

/** `window.localStorage`, every access guarded: private windows and blocked storage throw. */
export class LocalStreamStorage implements StreamKeyValueStorage {
  private get storage(): Storage | undefined {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage
    } catch {
      return undefined
    }
  }

  getItem(key: string) {
    try {
      return this.storage?.getItem(key) ?? undefined
    } catch {
      return undefined
    }
  }

  setItem(key: string, value: string) {
    const storage = this.storage
    if (!storage) throw new Error('Browser storage is unavailable.')
    try {
      storage.setItem(key, value)
    } catch (error) {
      throw new Error(`Browser storage refused the write: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  removeItem(key: string) {
    const storage = this.storage
    if (!storage) throw new Error('Browser storage is unavailable.')
    try {
      if (storage.getItem(key) === null) throw new Error(`No such item: ${key}`)
      storage.removeItem(key)
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  keys() {
    try {
      const storage = this.storage
      if (!storage) return []
      const out: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key !== null) out.push(key)
      }
      return out
    } catch {
      return []
    }
  }
}

// MARK: - Snapshots

/**
 * One frozen stream run — inputs and output together — so Monday can compare
 * what actually happened with the forecast that was on screen.
 */
export interface StreamSnapshot<K extends StreamKindTypes> {
  id: string
  season: number
  week: number
  /** Milliseconds since 1970 (whole seconds once decoded — stored as ISO 8601). */
  asOf: number
  risk: StreamRiskMode
  scoring: K['Scoring']
  teams: K['Team'][]
  candidates: K['Candidate'][]
  report: StreamReport<K['Projection']>
  /** True when the user froze it by hand rather than the daily auto-save. */
  pinned: boolean
}

/** A snapshot's listing row, readable without decoding the whole run. */
export interface StreamSnapshotSummary {
  id: string
  season: number
  week: number
  asOf: number
  pinned: boolean
}

// MARK: - JSON

/**
 * `JSONEncoder` with `.iso8601` dates and non-finite numbers as strings, so a
 * record never fails to save over one NaN. Maps (week → opponent) encode as
 * objects, the way Swift encodes `[Int: String]`.
 */
export function encodeStreamJSON(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(k), x]))
    if (v instanceof Set) return [...v]
    if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf'
    return v
  })
}

/** The matching decoder: "inf", "-inf" and "nan" come back as numbers. */
export function decodeStreamJSON(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v === 'inf') return Infinity
    if (v === '-inf') return -Infinity
    if (v === 'nan') return NaN
    return v
  })
}

/** Swift's `.iso8601` date strategy: whole seconds, UTC. */
export function iso8601(ms: number): string {
  return new Date(Math.trunc(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z')
}

// MARK: - The store

export interface StreamStoreOptions {
  /** The stream's folder under `FantasyCommandCenter`. */
  folder?: string
  /** An explicit location instead, for tests. */
  directory?: string
  storage?: StreamKeyValueStorage
}

export class StreamStore {
  private readonly directory: string
  private readonly storage: StreamKeyValueStorage

  constructor({ folder = 'IDPStream', directory, storage = new LocalStreamStorage() }: StreamStoreOptions = {}) {
    this.directory = directory ?? `FantasyCommandCenter/${folder}`
    this.storage = storage
  }

  // MARK: Overrides

  overrides<T, P>(leagueID: string, season: number, week: number): StreamWeekOverrides<T, P> {
    const text = this.storage.getItem(this.file(`overrides-${leagueID}-${season}-wk${week}.json`))
    if (text === undefined) return emptyOverrides()
    try {
      return decodeOverrides<T, P>(decodeStreamJSON(text)) ?? emptyOverrides()
    } catch {
      return emptyOverrides()
    }
  }

  saveOverrides<T, P>(overrides: StreamWeekOverrides<T, P>, leagueID: string, season: number, week: number): void {
    this.write(overrides, `overrides-${leagueID}-${season}-wk${week}.json`)
  }

  // MARK: Snapshots

  /** Freezes a run. The id sorts by time and names the league and week. */
  saveSnapshot<K extends StreamKindTypes>(args: {
    leagueID: string; season: number; week: number; asOf: number; risk: StreamRiskMode
    scoring: K['Scoring']; teams: K['Team'][]; candidates: K['Candidate'][]
    report: StreamReport<K['Projection']>; pinned: boolean
  }): StreamSnapshot<K> {
    const { leagueID, season, week, asOf, risk, scoring, teams, candidates, report, pinned } = args
    const stamp = Math.trunc(asOf / 1000)
    const id = `snapshot-${leagueID}-${season}-wk${week}-${stamp}${pinned ? '-pinned' : ''}`
    const snapshot: StreamSnapshot<K> = {
      id, season, week, asOf, risk, scoring,
      teams: [...teams].sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : 0)),
      candidates, report, pinned,
    }
    this.write({ ...snapshot, asOf: iso8601(asOf) }, `${id}.json`)
    return snapshot
  }

  /** Every snapshot for a league, newest first, from file names alone. */
  snapshots(leagueID: string): StreamSnapshotSummary[] {
    const prefix = `snapshot-${leagueID}-`
    const folder = `${this.directory}/`
    const names = this.storage.keys().filter((k) => k.startsWith(folder)).map((k) => k.slice(folder.length)).filter((n) => !n.includes('/'))
    const out: StreamSnapshotSummary[] = []
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      const parts = id.slice(prefix.length).split('-').filter((p) => p.length > 0)
      // season, wkN, timestamp, optional "pinned"
      if (parts.length < 3) continue
      const season = swiftInt(parts[0]!)
      if (season === undefined || !parts[1]!.startsWith('wk')) continue
      const week = swiftInt(parts[1]!.slice(2))
      const stamp = swiftDouble(parts[2]!)
      if (week === undefined || stamp === undefined) continue
      out.push({ id, season, week, asOf: stamp * 1000, pinned: parts.length > 3 })
    }
    return out.sort((a, b) => b.asOf - a.asOf)
  }

  snapshot<K extends StreamKindTypes>(kind: StreamKind<K>, id: string): StreamSnapshot<K> | undefined {
    const text = this.storage.getItem(this.file(`${id}.json`))
    if (text === undefined) return undefined
    try {
      const raw = decodeStreamJSON(text)
      if (!isJSONObject(raw)) return undefined
      const asOf = typeof raw.asOf === 'string' ? Date.parse(raw.asOf) : NaN
      if (Number.isNaN(asOf) || typeof raw.id !== 'string' || typeof raw.season !== 'number' || typeof raw.week !== 'number'
        || typeof raw.pinned !== 'boolean' || !Array.isArray(raw.teams) || !Array.isArray(raw.candidates) || !isJSONObject(raw.report)) {
        return undefined
      }
      const revive = kind.reviveCandidate
      return {
        id: raw.id, season: raw.season, week: raw.week, asOf,
        risk: raw.risk as StreamRiskMode,
        scoring: raw.scoring as K['Scoring'],
        teams: raw.teams as K['Team'][],
        candidates: revive ? raw.candidates.map((c) => revive(c)) : (raw.candidates as K['Candidate'][]),
        report: raw.report as unknown as StreamReport<K['Projection']>,
        pinned: raw.pinned,
      }
    } catch {
      return undefined
    }
  }

  deleteSnapshot(id: string): void {
    this.storage.removeItem(this.file(`${id}.json`))
  }

  // MARK: Files

  private file(name: string) { return `${this.directory}/${name}` }

  private write(value: unknown, name: string) {
    this.storage.setItem(this.file(name), encodeStreamJSON(value))
  }
}

/** The synthesized decoder's shape check: `teams` and `players` objects, optional string starter. */
function decodeOverrides<T, P>(raw: unknown): StreamWeekOverrides<T, P> | undefined {
  if (!isJSONObject(raw) || !isJSONObject(raw.teams) || !isJSONObject(raw.players)) return undefined
  if (!Object.values(raw.teams).every(isJSONObject) || !Object.values(raw.players).every(isJSONObject)) return undefined
  const incumbent = raw.incumbentID
  if (incumbent !== undefined && incumbent !== null && typeof incumbent !== 'string') return undefined
  const out: StreamWeekOverrides<T, P> = { teams: raw.teams as Record<string, T>, players: raw.players as Record<string, P> }
  if (typeof incumbent === 'string') out.incumbentID = incumbent
  return out
}

/** Swift `Int(String)`: an optional sign and digits only. */
function swiftInt(text: string): number | undefined {
  return /^[+-]?\d+$/.test(text) ? Number(text) : undefined
}

/** Swift `TimeInterval(String)` (strtod, whole string). */
function swiftDouble(text: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined
  return Number(text)
}
