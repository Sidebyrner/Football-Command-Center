/**
 * Moving your setup between browsers and devices: one JSON file holding every
 * saved setting — league, accent, Board layout, workspaces, stream overrides
 * and snapshots — plus the original tools' own saves (watchlist, research
 * notes, mock draft, scoring profile, their settings). The relay token, ESPN
 * cookies and the Odds API key are never included.
 */
/** Board layout keeps the native app's own key (`board.layout.v1`). */
const PREFIXES = ['fcc.', 'FantasyCommandCenter/', 'board.layout']
const EXCLUDED = new Set(['fcc.relay-token', 'fcc.espn-credentials', 'fcc.theme-probe'])
/**
 * The original tools save under `fcc-` keys. Named one by one: the same
 * prefix also covers caches (`fcc-draft-players-v3`) that don't belong in a file.
 */
const LEGACY_KEYS = new Set([
  'fcc-watchlist-v2', 'fcc-draft-watchlist', 'fcc-research-store',
  'fcc-mock-draft', 'fcc-scoring-profile', 'fcc-app-store',
])
/** The tools' settings hold the Odds API key — a secret, so it stays put. */
const APP_STORE_KEY = 'fcc-app-store'
const SECRET_FIELDS = ['oddsApiKey']

/** A zustand-persisted value (`{ state, version }`), parsed; undefined when it isn't one. */
function persisted(value: string | null): { state: Record<string, unknown>; [k: string]: unknown } | undefined {
  if (value === null) return undefined
  try {
    const v = JSON.parse(value)
    return v && typeof v === 'object' && v.state && typeof v.state === 'object' ? v : undefined
  } catch {
    return undefined
  }
}

function withoutSecrets(value: string): string | undefined {
  const v = persisted(value)
  if (!v) return undefined
  const state = { ...v.state }
  for (const f of SECRET_FIELDS) delete state[f]
  return JSON.stringify({ ...v, state })
}

/** The incoming settings, keeping this browser's own secrets. */
function mergeKeepingSecrets(incoming: string, current: string | null): string | undefined {
  const stripped = withoutSecrets(incoming)
  if (stripped === undefined) return undefined
  const local = persisted(current)
  if (!local) return stripped
  const v = persisted(stripped)!
  for (const f of SECRET_FIELDS) if (f in local.state) v.state[f] = local.state[f]
  return JSON.stringify(v)
}
export const EXPORT_FORMAT = 'football-command-center-export'

export interface ExportFile {
  format: typeof EXPORT_FORMAT
  version: 1
  exportedAt: string
  items: Record<string, string>
}

const included = (key: string) => LEGACY_KEYS.has(key) || (PREFIXES.some((p) => key.startsWith(p)) && !EXCLUDED.has(key))

export function buildExport(storage: Storage = localStorage, now = new Date()): ExportFile {
  const items: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key === null || !included(key)) continue
    const raw = storage.getItem(key)
    const value = raw !== null && key === APP_STORE_KEY ? withoutSecrets(raw) : raw
    if (value !== null && value !== undefined) items[key] = value
  }
  return { format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(), items }
}

/** Writes an export back; returns how many items were restored. Throws on a file that isn't one. */
export function applyImport(text: string, storage: Storage = localStorage): number {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('That file isn’t a Football Command Center export.') }
  const file = parsed as Partial<ExportFile>
  if (file?.format !== EXPORT_FORMAT || typeof file.items !== 'object' || file.items === null) {
    throw new Error('That file isn’t a Football Command Center export.')
  }
  let count = 0
  for (const [key, value] of Object.entries(file.items)) {
    if (!included(key) || typeof value !== 'string') continue
    const write = key === APP_STORE_KEY ? mergeKeepingSecrets(value, storage.getItem(key)) : value
    if (write === undefined) continue
    storage.setItem(key, write)
    count++
  }
  return count
}

export function downloadExport(file: ExportFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `football-command-center-${file.exportedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
