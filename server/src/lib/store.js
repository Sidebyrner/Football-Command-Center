// Flat-file persistence for the draft plan (B3).
//
// A JSON document, not a database: one document, one writer (the browser
// app the user is running), no concurrent-writer conflict to arbitrate.
// SQLite was sketched in the original deploy design but is pure overhead
// for "write-through copy, read-only elsewhere" — this is the pragmatic
// scope. A real database earns its keep if/when B6 needs multiple synced
// entities (notes, watchlist) with actual conflict resolution.

import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.DATA_DIR || '/data'
const PLAN_PATH = join(DATA_DIR, 'plan.json')

// Serializes writes through one promise chain so two overlapping requests
// can never race on the same temp file.
let writeQueue = Promise.resolve()

export function readPlan() {
  if (!existsSync(PLAN_PATH)) return { targets: null, updatedAt: null }
  try {
    return JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
  } catch {
    // Corrupt or partially-written file — degrade to "no plan" rather than
    // crash the route. The client's local copy is the source of truth
    // regardless; this can never be the only surviving copy of the plan.
    return { targets: null, updatedAt: null }
  }
}

export function writePlan(targets) {
  writeQueue = writeQueue.then(() => {
    mkdirSync(DATA_DIR, { recursive: true })
    const payload = { targets, updatedAt: new Date().toISOString() }
    const tmpPath = `${PLAN_PATH}.tmp`
    writeFileSync(tmpPath, JSON.stringify(payload))
    renameSync(tmpPath, PLAN_PATH) // atomic on a POSIX filesystem
    return payload
  })
  return writeQueue
}
