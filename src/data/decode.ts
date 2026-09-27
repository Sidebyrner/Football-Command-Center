/**
 * Small, lenient readers for untyped JSON — the TypeScript stand-in for the
 * Swift `Decodable` conformances. Unknown fields are ignored; a field of the
 * wrong type reads as absent rather than failing the record, except where the
 * Swift side treats the field as required (`need…`).
 */
export type JSONObject = Record<string, unknown>

export class DecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecodeError'
  }
}

export function isObject(v: unknown): v is JSONObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function asObject(v: unknown, what = 'value'): JSONObject {
  if (!isObject(v)) throw new DecodeError(`expected an object for ${what}`)
  return v
}

export function asArray(v: unknown, what = 'value'): unknown[] {
  if (!Array.isArray(v)) throw new DecodeError(`expected an array for ${what}`)
  return v
}

export function str(o: JSONObject, key: string): string | undefined {
  const v = o[key]
  return typeof v === 'string' ? v : undefined
}

export function num(o: JSONObject, key: string): number | undefined {
  const v = o[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Swift `Int` decoding: a whole number only. */
export function int(o: JSONObject, key: string): number | undefined {
  const v = num(o, key)
  return v !== undefined && Number.isInteger(v) ? v : undefined
}

export function bool(o: JSONObject, key: string): boolean | undefined {
  const v = o[key]
  return typeof v === 'boolean' ? v : undefined
}

export function strings(o: JSONObject, key: string): string[] | undefined {
  const v = o[key]
  if (!Array.isArray(v)) return undefined
  return v.every((x) => typeof x === 'string') ? (v as string[]) : undefined
}

/** `[String: Double]` — any non-number value fails the map, as in Swift. */
export function numberMap(o: JSONObject, key: string): Record<string, number> | undefined {
  const v = o[key]
  if (!isObject(v)) return undefined
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'number') return undefined
    out[k] = x
  }
  return out
}

/** `[String: Double?]` with the nulls dropped — Sleeper's stat blocks. */
export function numberMapDroppingNulls(o: JSONObject, key: string): Record<string, number> {
  const v = o[key]
  if (!isObject(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'number') out[k] = x
    else if (x !== null) return {}
  }
  return out
}

export function needString(o: JSONObject, key: string): string {
  const v = str(o, key)
  if (v === undefined) throw new DecodeError(`missing string "${key}"`)
  return v
}

export function needInt(o: JSONObject, key: string): number {
  const v = int(o, key)
  if (v === undefined) throw new DecodeError(`missing integer "${key}"`)
  return v
}

/** A number Sleeper may send as a number, a numeric string, "" or null. */
export function lossyNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** A string Sleeper may send as a string, a number or a bool. */
export function lossyString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return undefined
}

/** Swift `Int(String)`: an optional sign then digits, nothing else. */
export function parseIntStrict(s: string | undefined): number | undefined {
  if (s === undefined || !/^[+-]?\d+$/.test(s)) return undefined
  return Number(s)
}

/** Drops keys whose value is `undefined`, so cached records stay compact. */
export function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]
  return o
}
